// Direct solidcraft probes of a spin (solid.revolve, no translator, no OCCT), used by contract/revolve-groove.json.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg-probes.mjs small    -> faces of a thin tube turned 0.2..5 degrees at several radii (flat faces below ~0.55 degree)
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg-probes.mjs sweep    -> 144 tubes, angle 0.6..360: which differ from the expected face count / volume
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg-probes.mjs bowtie  -> the engine's own bodies for a bow-tie outline spun 360 and 90 (no translator, so nothing is dropped)
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg-probes.mjs grid neg|pos -> cylinder-face count of a 2 mm thick wall, outer radius 3..400 x angle 1..90 (angle parameter sign neg = what the guard sends for a profile on +u)
import { createRequire } from 'node:module';
import path from 'node:path';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const run = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
const mode = process.argv[2];
const rev = (pts, ang) => [
  { command: 'sketch.create', params: { name: 'g', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
  { command: 'sketch.line', params: { points: pts, closed: true } }, { command: 'sketch.finish', params: {} },
  { command: 'solid.revolve', params: { axis: 'y', sketch: 'g', ...(ang === 360 ? {} : { angle: ang }), operation: 'new', body_name: 'b' } }];
if (mode === 'small') {
  for (const [r0, r1, h] of [[10, 20, 30], [1, 2, 3], [100, 110, 30], [50, 52, 100], [0, 20, 30], [5, 6, 1]]) {
    for (const a of [0.2, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.5, 2, 5]) {
      const r = run(rev([[r0, 0], [r1, 0], [r1, h], [r0, h]], -a));
      const b = r.ok ? r.measure.bodies[0] : null;
      const exact = Math.PI * (r1 * r1 - r0 * r0) * h * a / 360;
      console.log(JSON.stringify({ r0, r1, h, a, ok: r.ok, faces: b?.faces, ft: b?.face_types, dVol: b ? Math.abs(b.volume_mm3 - exact) / exact : null }));
    }
  }
} else if (mode === 'sweep') {
  const bad = []; let n = 0;
  for (const [r0, th, h] of [[2, 5, 10], [10, 10, 30], [30, 10, 30], [60, 5, 20], [100, 10, 30], [200, 20, 50], [0, 20, 30], [0, 100, 30]]) {
    for (const a of [0.6, 1, 2, 3, 5, 10, 20, 45, 90, 120, 179, 180, 181, 200, 270, 300, 359, 360]) {
      const r = run(rev([[r0, 0], [r0 + th, 0], [r0 + th, h], [r0, h]], a === 360 ? 360 : -a)); n++;
      const b = r.ok ? r.measure.bodies[0] : null;
      if (!b) { bad.push({ r0, th, h, a, refused: r.failed?.error?.slice(0, 100) }); continue; }
      const exact = Math.PI * ((r0 + th) ** 2 - r0 ** 2) * h * a / 360;
      const exCyl = r0 === 0 ? 1 : 2; const exFaces = a === 360 ? (r0 === 0 ? 3 : 4) : (r0 === 0 ? 5 : 6);
      const dV = Math.abs(b.volume_mm3 - exact) / exact;
      if (b.faces !== exFaces || (b.face_types.cylinder ?? 0) !== exCyl || dV > 3e-4) bad.push({ r0, th, h, a, faces: b.faces, exFaces, ft: b.face_types, dV: +dV.toExponential(2) });
    }
  }
  console.log('ran', n, 'mismatching', bad.length); for (const b of bad) console.log(JSON.stringify(b));
} else if (mode === 'grid') {
  const sgn = process.argv[3] === 'pos' ? 1 : -1;
  const angs = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60, 90]; const rads = [3, 5, 10, 20, 30, 50, 80, 120, 200, 400];
  console.log('rows: outer radius (wall 2 mm, 10 tall); cols angles', angs.join(' '));
  for (const r1 of rads) {
    let line = String(r1).padStart(4) + ' ';
    for (const a of angs) { const r = run(rev([[r1 - 2, 0], [r1, 0], [r1, 10], [r1 - 2, 10]], sgn * a)); const b = r.ok ? r.measure.bodies[0] : null; line += (b ? String(b.face_types.cylinder ?? 0) : 'X') + ' '; }
    console.log(line);
  }
} else if (mode === 'bowtie') {
  const bow = [[10, 0], [20, 30], [20, 0], [10, 30]];
  for (const a of [360, 90]) {
    const r = run(rev(bow, a === 360 ? 360 : -a));
    console.log('bow-tie', a, JSON.stringify(r.ok ? r.measure.bodies.map((b) => ({ name: b.name, volume: +b.volume_mm3.toFixed(4), faces: b.faces, types: b.face_types })) : r.failed));
  }
  console.log('closed form 360: left triangle', +(2 * Math.PI * ((10 + 10 + 15) / 3) * 75).toFixed(4), 'right triangle', +(2 * Math.PI * ((20 + 20 + 15) / 3) * 75).toFixed(4));
} else console.log('usage: rg-probes.mjs small | sweep | grid neg|pos | bowtie');
