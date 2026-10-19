// sweep spec for a fuzz json: FUZZ=primitives-r4/fuzz-seed1.json   (ids fz<seed>-p#### planar, fz<seed>-c#### curved)
import { readFileSync } from 'node:fs';
import path from 'node:path';
const file = process.env.FUZZ; if (!file) throw new Error('FUZZ unset');
export default JSON.parse(readFileSync(path.resolve(file), 'utf8')).cases.map((c) => ({ ...c, occt: true }));
