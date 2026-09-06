// Shared types + search helpers for the in-app docs surfaces
// (/docs/moshion, /docs/reshape). Each docs set (lib/moshion-docs.ts,
// lib/reshape-docs.ts) provides its own `sections` array and thin wrappers
// over these functions.

export interface DocPage {
  title: string;
  body: string;
  code?: string;
}

export interface DocSection {
  slug: string;
  title: string;
  pages: DocPage[];
}

export interface DocSearchResult {
  sectionSlug: string;
  sectionTitle: string;
  pageIndex: number;
  pageTitle: string;
  snippet: string;
  matchStart: number;
  matchLength: number;
}

export function searchDocs(
  sections: DocSection[],
  query: string,
  limit = 30,
): DocSearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const primary = tokens[0];
  const results: DocSearchResult[] = [];

  for (const section of sections) {
    section.pages.forEach((page, pageIndex) => {
      const haystack = `${page.title}\n${page.body}\n${page.code ?? ''}`.toLowerCase();
      if (!tokens.every((t) => haystack.includes(t))) return;

      const sources: { text: string; weight: number }[] = [
        { text: page.title, weight: 0 },
        { text: page.body, weight: 1 },
        { text: page.code ?? '', weight: 2 },
      ];
      let best: { text: string; idx: number; weight: number } | null = null;
      for (const src of sources) {
        const idx = src.text.toLowerCase().indexOf(primary);
        if (idx >= 0 && (!best || src.weight < best.weight)) {
          best = { text: src.text, idx, weight: src.weight };
          if (src.weight === 0) break;
        }
      }
      if (!best) return;

      const radius = 60;
      const start = Math.max(0, best.idx - radius);
      const end = Math.min(best.text.length, best.idx + primary.length + radius);
      let snippet = best.text.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) snippet = '… ' + snippet;
      if (end < best.text.length) snippet = snippet + ' …';

      const lower = snippet.toLowerCase();
      const matchStart = lower.indexOf(primary);

      results.push({
        sectionSlug: section.slug,
        sectionTitle: section.title,
        pageIndex,
        pageTitle: page.title,
        snippet,
        matchStart: matchStart >= 0 ? matchStart : 0,
        matchLength: matchStart >= 0 ? primary.length : 0,
      });
    });
  }

  return results.slice(0, limit);
}

export function getSection(
  sections: DocSection[],
  slug: string,
): DocSection | undefined {
  return sections.find((s) => s.slug === slug);
}

export function getAllSectionSlugs(sections: DocSection[]): string[] {
  return sections.map((s) => s.slug);
}
