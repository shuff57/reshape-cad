#!/usr/bin/env node
// mouse-interaction-parity notes. Accepts either a YouTube URL (sent as-is)
// or an autodesk.com/learn tutorial URL (downloaded via yt-dlp's generic
// extractor, which resolves Autodesk's player to the underlying mp4/webm,
// then sent as a base64 data URL). Every timestamp the model cites is
// cross-checked against a real transcript so claims aren't taken on faith:
// YouTube auto-captions for YouTube URLs, local faster-whisper (via uvx,
// no persistent install) for Autodesk-hosted videos which have no caption API.
//
// Usage: node scripts/fusion-video-parity.mjs <youtube_or_autodesk_url_or_local_video_file> ["focus prompt override"] [--pro]
//   A local .webm/.mp4 path (e.g. a parity-recording output) is read from disk
//   and sent as a base64 data URL, like the Autodesk download path.
//   --pro elevates from the default model to the more expensive/accurate one,
//   for a video whose default-model findings look vague or fail spot-check.

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_MODEL = "google/gemini-3.8-flash";
const PRO_MODEL = "google/gemini-3.1-pro-preview";
const DEFAULT_FOCUS = `You are analyzing this Autodesk Fusion tutorial video to help a team building a browser-based CAD tool achieve mouse-interaction parity with Fusion.
Focus ONLY on:
1. Cursor/pointer states during hover vs. select vs. drag
2. How glyphs/handles appear, highlight on hover, and get deleted
3. Click sequencing (single click vs click-drag, order of entity selection) for applying commands
4. Keyboard modifiers used alongside mouse actions
Give a structured list with approximate timestamps (mm:ss). Be concise. Do not speculate beyond what is visible/audible.`;

function getOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const authPath = path.join(process.env.HOME, ".local/share/opencode/auth.json");
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  const key = auth.openrouter?.key;
  if (!key) throw new Error("No OpenRouter key: set OPENROUTER_API_KEY or configure opencode's OpenRouter provider");
  return key;
}

async function callGemini(videoContentPart, focus, model) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: focus }, videoContentPart],
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/.test(url);
}

const EXT_TO_MIME = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

// Autodesk's tutorial pages sit behind Cloudflare (403 on direct fetch), but
// yt-dlp's generic extractor finds the html5 <video> embed and resolves it to
// the real file on help.autodesk.com.
function downloadVideo(url, outDir) {
  const outTemplate = path.join(outDir, "video.%(ext)s");
  execFileSync("uvx", ["yt-dlp", "-f", "b[ext=mp4]/b", "-o", outTemplate, url], { stdio: "pipe" });
  const [file] = execFileSync("bash", ["-c", `ls ${JSON.stringify(outDir)}/video.*`]).toString().trim().split("\n");
  return file;
}

// OpenRouter/Gemini only accepts video_url pointing at YouTube or a data URL
// -- not arbitrary third-party hosts -- so inline the downloaded file.
function encodeDataUrl(file) {
  const ext = path.extname(file).slice(1);
  const mime = EXT_TO_MIME[ext] || "video/mp4";
  const b64 = readFileSync(file).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function fetchTranscript(videoId, outDir) {
  try {
    execFileSync(
      "uvx",
      [
        "yt-dlp",
        "--write-auto-sub",
        "--sub-lang",
        "en",
        "--skip-download",
        "--sub-format",
        "vtt",
        "-o",
        path.join(outDir, `captions_${videoId}.%(ext)s`),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { stdio: "pipe" },
    );
    return readFileSync(path.join(outDir, `captions_${videoId}.en.vtt`), "utf8");
  } catch {
    return null;
  }
}

function secondsToHms(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// Local, offline transcription for non-YouTube videos (no caption API to rely
// on). Uses faster-whisper's "base" model via uvx so no persistent install is
// needed -- good enough for spot-checking timestamps in a short tutorial.
function transcribeWithWhisper(videoFile) {
  const pyScript = [
    "import sys",
    "from faster_whisper import WhisperModel",
    'model = WhisperModel("base", device="cpu", compute_type="int8")',
    'segments, _ = model.transcribe(sys.argv[1], language="en", vad_filter=True)',
    "for seg in segments:",
    '    print(f"{seg.start:.2f}\\t{seg.text.strip()}")',
  ].join("\n");
  const out = execFileSync(
    "uvx",
    ["--with", "faster-whisper", "--with", "ctranslate2", "python3", "-c", pyScript, videoFile],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sec, ...rest] = line.split("\t");
      return { t: secondsToHms(Number(sec)), text: rest.join("\t") };
    });
}
function vttToSegments(vtt) {
  const segs = [];
  let curStart = null;
  let prevText = null;
  for (const line of vtt.split("\n")) {
    const m = line.match(/^(\d\d):(\d\d):(\d\d)\.\d+ --> /);
    if (m) {
      curStart = `${m[1]}:${m[2]}:${m[3]}`;
      continue;
    }
    const clean = line.replace(/<[^>]+>/g, "").trim();
    if (clean && curStart) {
      if (clean !== prevText) {
        segs.push({ t: curStart, text: clean });
        prevText = clean;
      }
      curStart = null;
    }
  }
  return segs;
}

function timeToSeconds(t) {
  const parts = t.split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function contextAround(segs, mmss, windowSec = 8) {
  const target = timeToSeconds(mmss);
  return segs.filter((s) => Math.abs(timeToSeconds(s.t) - target) <= windowSec).map((s) => `${s.t} ${s.text}`);
}

function extractTimestamps(text) {
  return [...new Set([...text.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)].map((m) => m[1]))];
}

async function main() {
  const args = process.argv.slice(2);
  const useProFlagIdx = args.indexOf("--pro");
  const usePro = useProFlagIdx !== -1;
  if (usePro) args.splice(useProFlagIdx, 1);
  const [videoUrl, focusOverride] = args;
  if (!videoUrl) {
    console.error('Usage: node scripts/fusion-video-parity.mjs <youtube_or_autodesk_url_or_local_video_file> ["focus prompt"] [--pro]');
    process.exit(1);
  }
  const MODEL = usePro ? PRO_MODEL : DEFAULT_MODEL;
  const focus = focusOverride || DEFAULT_FOCUS;
  const isYouTube = isYouTubeUrl(videoUrl);
  // Local recording from the parity harness: any non-URL arg that exists on
  // disk. Checked before the URL branches so a local path never reaches yt-dlp.
  const isUrl = /^https?:\/\//.test(videoUrl);
  const isLocalFile = !isUrl && existsSync(videoUrl);
  if (!isUrl && !isLocalFile) {
    console.error(`[fusion-video-parity] file not found: ${videoUrl}`);
    process.exit(1);
  }

  let downloadDir = null;
  let localVideoFile = null;
  let videoContentPart;
  if (isLocalFile) {
    console.error(`[fusion-video-parity] local file mode: reading ${videoUrl}`);
    localVideoFile = videoUrl;
    videoContentPart = { type: "video_url", video_url: { url: encodeDataUrl(videoUrl) } };
  } else if (isYouTube) {
    videoContentPart = { type: "video_url", video_url: { url: videoUrl } };
  } else {
    console.error(`[fusion-video-parity] downloading source video from ${videoUrl}`);
    downloadDir = mkdtempSync(path.join(tmpdir(), "fusion-video-dl-"));
    localVideoFile = downloadVideo(videoUrl, downloadDir);
    videoContentPart = { type: "video_url", video_url: { url: encodeDataUrl(localVideoFile) } };
  }

  console.error(`[fusion-video-parity] calling ${MODEL} for ${videoUrl}`);
  const result = await callGemini(videoContentPart, focus, MODEL);
  const content = result.choices[0].message.content;
  const usage = result.usage;

  let transcriptSegs = null;
  if (isYouTube) {
    const idMatch = videoUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    const videoId = idMatch ? idMatch[1] : null;
    if (videoId) {
      const capDir = mkdtempSync(path.join(tmpdir(), "fusion-video-cap-"));
      const vtt = fetchTranscript(videoId, capDir);
      if (vtt) transcriptSegs = vttToSegments(vtt);
      rmSync(capDir, { recursive: true, force: true });
    }
  } else if (localVideoFile) {
    console.error("[fusion-video-parity] transcribing with faster-whisper (local, offline)...");
    try {
      transcriptSegs = transcribeWithWhisper(localVideoFile);
    } catch (err) {
      console.error(`[fusion-video-parity] whisper transcription failed: ${err.message}`);
    }
  }
  if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });

  console.log("=".repeat(80));
  console.log(`GEMINI ANALYSIS (${MODEL}) - ${videoUrl}`);
  console.log(`cost: $${usage?.cost ?? "?"} | video_tokens: ${usage?.prompt_tokens_details?.video_tokens ?? "?"}`);
  console.log("=".repeat(80));
  console.log(content);

  if (transcriptSegs && transcriptSegs.length) {
    console.log("\n" + "=".repeat(80));
    console.log("TRANSCRIPT SPOT-CHECK (verify claims above against these real captions)");
    console.log("=".repeat(80));
    for (const ts of extractTimestamps(content)) {
      const ctx = contextAround(transcriptSegs, ts);
      console.log(`\n--- around ${ts} ---`);
      console.log(ctx.length ? ctx.join("\n") : "(no transcript segments found near this timestamp)");
    }
  } else {
    console.log("\n(No transcript available - verify claims manually.)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
