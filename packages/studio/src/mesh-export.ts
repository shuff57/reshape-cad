// First-party STL, OBJ and 3MF writers.
//
// WHY THIS EXISTS. Save STL / Save 3MF / Save OBJ used to run through
// public/reshape/lib/jscad-io.min.js's vendored @jscad/{stl,3mf,obj}-serializer,
// behind public/reshape/runner.html. Both are deleted now (CLAUDE.md's
// "JSCAD is retired" section) -- the Save buttons could not go on depending
// on JSCAD's I/O half once the engine itself was gone.
//
// WHY NOT THE KERNEL. OpenCascade has its own STL writer (StlAPI_Writer), but
// it is not among the 89 symbols in the custom kernel build
// (scripts/occt-bindings.yml); adding it costs a ~9 minute rebuild and would
// still leave OBJ and 3MF unwritten. It is not needed regardless: every solid
// is already tessellated to triangles before it reaches the screen
// (lib/occt-mesh.ts for the JSCAD/regl path, lib/occt-three.ts for three.js),
// and all three formats are writable from a triangle soup alone.
//
// INPUT IS STRUCTURAL, NOT THREE.JS. `MeshInput` below is plain positions
// plus an optional index buffer -- not a THREE.BufferGeometry and not a JSCAD
// Geom3. lib/occt-three.ts documents why its own file avoids importing
// 'three' at runtime (so pulling it into a bundle is the caller's choice, not
// automatic); the same reasoning applies here one level up; importing either
// shape would make this module a compile-time dependency of whichever caller
// happened to be written first, when both -- occt-mesh.ts's ungrouped
// polygon soup and occt-three.ts's indexed BufferGeometry -- need to reach
// it. Structural input also means this file has nothing to mock to test: a
// plain Node script can hand it arrays and check the bytes.
//
// jszip IS a real dependency, because 3MF is a zip file with XML inside it.
// It is already used elsewhere in this repo (lib/export-zip.ts) for the same
// reason. STL and OBJ need nothing beyond what JavaScript ships with.

import JSZip from 'jszip';

/**
 * A triangle mesh, structurally: flat XYZ positions, and an optional flat
 * triangle index buffer (3 indices per triangle, into `positions` measured in
 * VERTICES not floats).
 *
 * When `indices` is omitted, every 3 positions form one triangle -- the shape
 * lib/occt-mesh.ts's Geom3 flattens to (see fromPolygonSoup below). When
 * present, it is the shape lib/occt-three.ts's BufferGeometry already carries
 * (`geometry.attributes.position.array`, `geometry.index.array`).
 *
 * `ArrayLike<number>` rather than `number[]` so a caller can hand in a
 * Float32Array / Uint32Array straight off a BufferGeometry without copying.
 */
export interface MeshInput {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
}

function triangleCount(mesh: MeshInput): number {
  return mesh.indices ? Math.floor(mesh.indices.length / 3) : Math.floor(mesh.positions.length / 9);
}

function vertexCount(mesh: MeshInput): number {
  return Math.floor(mesh.positions.length / 3);
}

function vertexAt(mesh: MeshInput, i: number): [number, number, number] {
  const p = mesh.positions;
  return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
}

/** The three vertex indices of triangle `t` (0-based), whether `mesh` carries
 *  an index buffer or is a flat soup. */
function triangleIndices(mesh: MeshInput, t: number): [number, number, number] {
  if (mesh.indices) {
    const ix = mesh.indices;
    return [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]];
  }
  return [t * 3, t * 3 + 1, t * 3 + 2];
}

type Vec3 = [number, number, number];
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The outward-facing normal of triangle `t`, from its own winding.
 *
 * "Outward" is inherited, not computed here: lib/occt-mesh.ts and
 * lib/occt-three.ts both already flip a REVERSED OCCT face's winding before
 * this module ever sees it (see their "THE ORIENTATION" trap notes). This
 * function trusts that and just reads it off with (b-a) x (c-a) --
 * recomputing orientation from scratch a third time would mean carrying that
 * trap's fix in a third place.
 */
function triangleNormal(mesh: MeshInput, t: number): Vec3 {
  const [ia, ib, ic] = triangleIndices(mesh, t);
  const a = vertexAt(mesh, ia), b = vertexAt(mesh, ib), c = vertexAt(mesh, ic);
  return normalize(cross(sub(b, a), sub(c, a)));
}

/**
 * Concatenates several triangle meshes into the single MeshInput
 * writeSTL/writeOBJ/write3MF expect, offsetting each mesh's own indices by
 * the running vertex count so winding and triangle membership survive the
 * merge.
 *
 * Exists for BrepViewportThree.tsx: a ModelDoc can have more than one
 * top-level shape (two boxes never combined into one solid), and that is
 * still one file to export -- the same flattening JSCAD's own Save STL does
 * to a `solids` array before serializing it.
 */
export function mergeMeshes(meshes: MeshInput[]): MeshInput {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const mesh of meshes) {
    const base = positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
    if (mesh.indices) {
      for (let i = 0; i < mesh.indices.length; i++) indices.push(mesh.indices[i] + base);
    } else {
      const n = mesh.positions.length / 3;
      for (let i = 0; i < n; i++) indices.push(base + i);
    }
  }
  return { positions, indices };
}

/**
 * Converts occt-mesh.ts's ungrouped Geom3 (`{ polygons: [{ vertices:
 * [[x,y,z] x3] }] }`) into a MeshInput. Takes the polygon shape structurally
 * -- an inline type, not an import of lib/occt-mesh.ts's `Geom3` -- for the
 * same reason this module avoids importing three.js: it should not become a
 * compile-time dependency of whichever caller happened to be written first.
 */
export function fromPolygonSoup(polygons: { vertices: ArrayLike<ArrayLike<number>> }[]): MeshInput {
  const positions: number[] = [];
  for (const poly of polygons) {
    for (let i = 0; i < poly.vertices.length; i++) {
      const v = poly.vertices[i];
      positions.push(v[0], v[1], v[2]);
    }
  }
  return { positions };
}

/**
 * Binary STL. Chosen over ASCII STL the way lib/occt-mesh.ts's table chooses
 * a deflection default: measured, not assumed. ASCII STL runs roughly 5x the
 * bytes for the same triangles (every float printed as decimal text with a
 * keyword on either side) and every slicer in real use reads binary, so
 * there is no compatibility reason to pay for the larger format.
 *
 * Layout, and this is the part a hand-rolled writer gets wrong: an 80-byte
 * header (content ignored by every reader; left zeroed here), a little-endian
 * uint32 triangle count, then exactly 50 bytes per triangle -- 12 floats
 * (normal + 3 vertices, 4 bytes each = 48) plus a uint16 "attribute byte
 * count" that real files leave 0. Getting the attribute bytes wrong, or
 * padding the header to a rounder number, produces a file some slicers
 * accept (they resync on the count) and others silently misread -- which is
 * exactly why the test suite asserts total byte length, not just "did it
 * parse".
 */
export function writeSTL(mesh: MeshInput): Uint8Array {
  const nTri = triangleCount(mesh);
  const buf = new ArrayBuffer(84 + 50 * nTri);
  const view = new DataView(buf);
  view.setUint32(80, nTri, true);

  let offset = 84;
  for (let t = 0; t < nTri; t++) {
    const [ia, ib, ic] = triangleIndices(mesh, t);
    const n = triangleNormal(mesh, t);
    view.setFloat32(offset, n[0], true); offset += 4;
    view.setFloat32(offset, n[1], true); offset += 4;
    view.setFloat32(offset, n[2], true); offset += 4;
    for (const vi of [ia, ib, ic]) {
      const v = vertexAt(mesh, vi);
      view.setFloat32(offset, v[0], true); offset += 4;
      view.setFloat32(offset, v[1], true); offset += 4;
      view.setFloat32(offset, v[2], true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2; // attribute byte count
  }
  return new Uint8Array(buf);
}

/**
 * Plain-text OBJ: `v` lines (one per vertex, in `positions` order) then `f`
 * lines (one per triangle). OBJ is 1-indexed, unlike every buffer this module
 * otherwise deals in -- the +1 below is the one place that matters, and the
 * classic OBJ bug is forgetting it (or applying it twice after already
 * converting elsewhere), which the test suite checks directly.
 */
export function writeOBJ(mesh: MeshInput): string {
  const lines: string[] = [];
  const nV = vertexCount(mesh);
  for (let i = 0; i < nV; i++) {
    const [x, y, z] = vertexAt(mesh, i);
    lines.push(`v ${x} ${y} ${z}`);
  }
  const nTri = triangleCount(mesh);
  for (let t = 0; t < nTri; t++) {
    const [ia, ib, ic] = triangleIndices(mesh, t);
    lines.push(`f ${ia + 1} ${ib + 1} ${ic + 1}`);
  }
  return lines.join('\n') + '\n';
}

const MODEL_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const MODEL_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** The one file inside a 3MF that actually holds geometry. 3MF vertex/
 *  triangle indices are 0-based, unlike OBJ's -- so, deliberately, no `+1`
 *  here. */
function build3mfModel(mesh: MeshInput): string {
  const nV = vertexCount(mesh);
  const vertexLines: string[] = new Array(nV);
  for (let i = 0; i < nV; i++) {
    const [x, y, z] = vertexAt(mesh, i);
    vertexLines[i] = `<vertex x="${x}" y="${y}" z="${z}"/>`;
  }

  const nTri = triangleCount(mesh);
  const triLines: string[] = new Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const [ia, ib, ic] = triangleIndices(mesh, t);
    triLines[t] = `<triangle v1="${ia}" v2="${ib}" v3="${ic}"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>${vertexLines.join('')}</vertices>
        <triangles>${triLines.join('')}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>
`;
}

/**
 * 3MF: a ZIP containing `[Content_Types].xml`, `_rels/.rels`, and the actual
 * geometry in `3D/3dmodel.model`. All three are required for a 3MF reader to
 * accept the file at all -- the first two are boilerplate declaring what
 * `3D/3dmodel.model` is, and every real 3MF file repeats them near-verbatim.
 *
 * Async, unlike the other two writers, because JSZip's `generateAsync` is;
 * that is the one place this module's laziness (no bundled zip writer of its
 * own) becomes visible in the API.
 */
export async function write3MF(mesh: MeshInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', MODEL_CONTENT_TYPES);
  zip.file('_rels/.rels', MODEL_RELS);
  zip.file('3D/3dmodel.model', build3mfModel(mesh));
  return zip.generateAsync({ type: 'uint8array' });
}
