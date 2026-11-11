// script2model.mjs: the oracle model (oracle-com.mjs, box z 0..H, frame 'centred') of a "box + holes with counterbore / countersink along z + hollow" script
export function modelOfScript(src) {
  const b = src.match(/box\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/); if (!b) return null;
  const [W, D, H] = b.slice(1, 4).map(Number);
  const hw = src.match(/hollow\(b,\s*\{\s*wall:\s*([\d.]+),\s*open:\s*'(\w+)'/); if (!hw) return null;
  const t = Number(hw[1]); const open = hw[2]; if (!['top', 'bottom'].includes(open)) return null;
  const holes = [];
  for (const m of src.matchAll(/hole\(b,\s*\{([^\n]*)\}\);?/g)) {
    const s = m[1]; if (/deep:\s*[\d.]+\s*[,}]/.test(s.replace(/counterbore:\s*\{[^}]*\}/, '')) || /along/.test(s)) return null;
    const r = Number(s.match(/across:\s*([\d.]+)/)[1]) / 2;
    const at = s.match(/at:\s*\[([-\d.]+),\s*([-\d.]+)\]/); const c = at ? [Number(at[1]), Number(at[2])] : [0, 0];
    const cb = s.match(/counterbore:\s*\{\s*across:\s*([\d.]+),\s*deep:\s*([\d.]+)/); const cs = s.match(/countersink:\s*\{\s*across:\s*([\d.]+),\s*angle:\s*([\d.]+)/);
    if (cb) holes.push({ type: 'cyl', axis: 'z', c, r, range: [-1, H + 1] }, { type: 'cyl', axis: 'z', c, r: Number(cb[1]) / 2, range: [H - Number(cb[2]), H + 1] });
    else if (cs) { const Rm = Number(cs[1]) / 2, ang = Number(cs[2]); const dep = (Rm - r) / Math.tan(ang / 360 * Math.PI); holes.push({ type: 'cone', c, rb: r, zb: H - dep, rt: Rm, zt: H, r, range: [-1, H + 1] }); }
    else holes.push({ type: 'cyl', axis: 'z', c, r, range: [-1, H + 1] });
  }
  const opens = [open === 'top' ? { axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] } : { axis: 'z', dir: -1, coord: 0, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] }];
  return { t, mode: 'rect', boxes: [[-W / 2, W / 2, -D / 2, D / 2, 0, H]], cuts: [], opens, holes, rbosses: [] };
}
