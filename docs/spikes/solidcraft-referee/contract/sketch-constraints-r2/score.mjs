// closed-form scoring of one built sketch extrusion, start-aware (see oracle.mjs): MATCH / TOL-MISS / MATCH-OTHER-SIDE / POSE / VOLUME
export const TOL = { planar: 1e-9, curved: 3e-4 };
import { classifyImg, expectedImage, imagesOf } from './oracle.mjs';
export function classify(cs, body, start = null) { return classifyImg(cs, body, start); }
export { expectedImage, imagesOf };
export const expectedBox = (cs, start) => expectedImage(cs, start).nearest.bbox;
