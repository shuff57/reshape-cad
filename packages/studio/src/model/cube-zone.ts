/**
 * ViewCube hit-zone partition (SPEC-mouse-parity.md Phase 1.5, todo 28).
 *
 * Pure geometry: each cube face is a side×side square partitioned into a
 * 3×3 grid — 4 corner cells, 4 edge cells, 1 face cell — so a click point
 * on ANY face resolves to exactly one of { face, edge, corner, none },
 * never two. Edge/corner ids are pairs/triples of CSS face keys
 * (NAV_CUBE_FACES keys in BrepViewportThree.tsx), sorted and '|'-joined;
 * the component resolves an id to a view direction by summing the face
 * dirs it names (see cubeZoneDirs), so this file never needs the DIR
 * constants and can never drift from the JSX's face assignment.
 */

export type CubeFaceKey = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

/** Corner-zone cell size in px; face side is 64 (NAV_CUBE_SIZE), so each
 *  face partitions as 16px corner | 32px edge band | 32px face centre. */
export const CUBE_ZONE_CELL = 16;

/** Which CSS face each in-plane side of a face borders. Derived from the
 *  face transforms' rotation (e.g. the bottom face is rotateX(-90), whose
 *  in-plane top edge points at -z = the back face, NOT top). */
const PLANE_NEIGHBORS: Record<CubeFaceKey, { top: CubeFaceKey; bottom: CubeFaceKey; left: CubeFaceKey; right: CubeFaceKey }> = {
  front: { top: 'top', bottom: 'bottom', left: 'left', right: 'right' },
  back: { top: 'top', bottom: 'bottom', left: 'right', right: 'left' },
  right: { top: 'top', bottom: 'bottom', left: 'front', right: 'back' },
  left: { top: 'top', bottom: 'bottom', left: 'back', right: 'front' },
  top: { top: 'front', bottom: 'back', left: 'left', right: 'right' },
  bottom: { top: 'back', bottom: 'front', left: 'left', right: 'right' },
};

export type CubeZone =
  | { kind: 'face'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'corner'; id: string }
  | { kind: 'none'; id: null };

/** Classifies a click point in a face's own plane ([0..side]², y down,
 *  x right as seen looking at that face) to its single hit zone. */
export function cubeZoneAt(face: CubeFaceKey, px: number, py: number, side = 64): CubeZone {
  if (px < 0 || py < 0 || px > side || py > side) return { kind: 'none', id: null };
  const c = CUBE_ZONE_CELL;
  const col = px < c ? 0 : px > side - c ? 2 : 1;
  const row = py < c ? 0 : py > side - c ? 2 : 1;
  const nb = PLANE_NEIGHBORS[face];
  if (col === 1 && row === 1) return { kind: 'face', id: `face:${face}` };
  if (col === 1 && row === 0) return { kind: 'edge', id: pair(face, nb.top) };
  if (col === 1 && row === 2) return { kind: 'edge', id: pair(face, nb.bottom) };
  if (col === 0 && row === 1) return { kind: 'edge', id: pair(face, nb.left) };
  if (col === 2 && row === 1) return { kind: 'edge', id: pair(face, nb.right) };
  const v = col === 0 ? nb.left : nb.right;
  const h = row === 0 ? nb.top : nb.bottom;
  return { kind: 'corner', id: triple(face, v, h) };
}

function pair(a: CubeFaceKey, b: CubeFaceKey): string {
  return [a, b].sort().join('|');
}

function triple(a: CubeFaceKey, b: CubeFaceKey, c: CubeFaceKey): string {
  return [a, b, c].sort().join('|');
}

/** The 12 unique cube edges, as 'a|b' ids (each cube edge shows up on two
 *  faces' planes; the id dedupes them). */
export function cubeEdgeIds(): string[] {
  const seen = new Set<string>();
  for (const face of Object.keys(PLANE_NEIGHBORS) as CubeFaceKey[]) {
    const nb = PLANE_NEIGHBORS[face];
    for (const side of [nb.top, nb.bottom, nb.left, nb.right] as CubeFaceKey[]) seen.add(pair(face, side));
  }
  return [...seen].sort();
}

/** The 8 unique cube corners, as 'a|b|c' triples. */
export function cubeCornerIds(): string[] {
  const seen = new Set<string>();
  for (const face of Object.keys(PLANE_NEIGHBORS) as CubeFaceKey[]) {
    const nb = PLANE_NEIGHBORS[face];
    for (const v of [nb.left, nb.right] as CubeFaceKey[]) {
      for (const h of [nb.top, nb.bottom] as CubeFaceKey[]) seen.add(triple(face, v, h));
    }
  }
  return [...seen].sort();
}

/** id → normalized view direction, from the face dirs the component
 *  already owns (NAV_CUBE_FACES). An edge view looks from the normalized
 *  sum of its two faces' dirs; a corner view from the sum of three. */
export function cubeZoneDirs(
  faceDirs: Record<CubeFaceKey, [number, number, number]>,
): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const dirOf = (id: string): [number, number, number] => {
    const parts = id.split('|') as CubeFaceKey[];
    const sum = parts.reduce(
      (acc, k) => [acc[0] + faceDirs[k][0], acc[1] + faceDirs[k][1], acc[2] + faceDirs[k][2]] as [number, number, number],
      [0, 0, 0] as [number, number, number],
    );
    const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    return [sum[0] / len, sum[1] / len, sum[2] / len];
  };
  for (const id of cubeEdgeIds()) out[id] = dirOf(id);
  for (const id of cubeCornerIds()) out[id] = dirOf(id);
  return out;
}