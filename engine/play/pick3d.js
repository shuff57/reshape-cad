// engine/play/pick3d.js
//
// Makes the 3D viewport pickable: click a face or edge of the padded solid
// and it highlights + reports which FreeCAD sub-element it is. Session-
// agnostic by design (per SPEC) — studio.js reads session.meshFaces() and
// hands the RESULT into rebuild(); this module never touches the bridge or
// the session, so it's testable (at least its pure parts) without a kernel.
//
// Out of scope for this slice (see SPEC): actually doing Pocket/Fillet with
// the selection, multi-select, hover pre-highlight, selecting vertices,
// keeping the selection across a recompute (rebuild() always clears it).

const FACE_COLOR = 0x5aa9e6;
const FACE_SELECT_COLOR = 0xffb454;
const EDGE_COLOR = 0x8b95a3;
const EDGE_SELECT_COLOR = 0xffb454;

// Pure: was pointerup close enough to pointerdown to count as a click rather
// than an orbit-drag? Both points are {x,y} in the same unit (client px, in
// practice) — no DOM, no three.js, so it's unit-testable on its own.
export function isClick(down, up, tol = 5) {
  if (!down || !up) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= tol;
}

export function initPick3d({ scene, THREE, getCamera, renderer, onSelect }) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 1.5 }; // world mm — edges are thin, give the ray some slack
  const pointerNDC = new THREE.Vector2();

  let group = null;
  let mode = 'face';
  let selected = null; // {kind, id, object, originalMaterial}
  let downPt = null;

  function notify(sel) { if (typeof onSelect === 'function') onSelect(sel); }

  function disposeGroup(g) {
    if (!g) return;
    g.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  function restoreSelected() {
    if (selected && selected.object) {
      const current = selected.object.material;
      selected.object.material = selected.originalMaterial;
      if (current && current !== selected.originalMaterial) current.dispose();
    }
    selected = null;
  }

  // studio.js passes the meshFaces() RESULT, not an object name — this
  // module never calls the session, so it stays testable/reusable without one.
  function rebuild(meshFacesResult) {
    if (group) { scene.remove(group); disposeGroup(group); }
    restoreSelected();
    group = new THREE.Group();

    const faces = (meshFacesResult && meshFacesResult.faces) || [];
    const edges = (meshFacesResult && meshFacesResult.edges) || [];

    for (const f of faces) {
      if (!f || !f.positions || f.positions.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(f.positions), 3));
      g.setIndex(f.indices);
      g.computeVertexNormals();
      // A small polygon offset pushes faces back in the depth buffer just
      // enough that edges drawn at the same surface (below) win the depth
      // test and stay visible instead of getting z-fought away.
      const m = new THREE.MeshStandardMaterial({
        color: FACE_COLOR, metalness: 0.1, roughness: 0.55,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData = { kind: 'face', id: f.id };
      group.add(mesh);
    }
    for (const e of edges) {
      if (!e || !e.points || e.points.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(e.points), 3));
      const m = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
      // `points` is one continuous polyline (consecutive tessellation
      // vertices), so Line (connects 0-1-2-3...) is correct — LineSegments
      // would wrongly pair them as independent 0-1, 2-3, ... segments.
      const line = new THREE.Line(g, m);
      line.userData = { kind: 'edge', id: e.id };
      group.add(line);
    }
    scene.add(group);
  }

  function pickTargets() {
    const targets = [];
    if (group) {
      group.traverse((obj) => {
        if (mode === 'face' && obj.isMesh) targets.push(obj);
        else if (mode === 'edge' && obj.isLine) targets.push(obj);
      });
    }
    return targets;
  }

  // raycaster.intersectObjects() already returns hits sorted nearest-first,
  // so hits[0] IS the "nearest hit" the SPEC asks for — no extra reduction.
  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, getCamera());
    const hits = raycaster.intersectObjects(pickTargets(), false);
    return hits.length ? hits[0].object : null;
  }

  function select(object) {
    restoreSelected();
    if (!object) { notify(null); return; }
    const { kind, id } = object.userData;
    const originalMaterial = object.material;
    const color = kind === 'face' ? FACE_SELECT_COLOR : EDGE_SELECT_COLOR;
    const highlightMaterial = kind === 'face'
      ? new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 })
      // linewidth beyond 1px is unsupported on most WebGL2 backends (a
      // long-standing three.js/ANGLE limitation) — color carries the
      // highlight; linewidth is set anyway as a harmless best-effort.
      : new THREE.LineBasicMaterial({ color, linewidth: 3 });
    object.material = highlightMaterial;
    selected = { kind, id, object, originalMaterial };
    notify({ kind, id });
  }

  function onPointerDown(evt) {
    if (evt.button !== 0) return; // left button only — right/middle drive OrbitControls pan/dolly
    downPt = { x: evt.clientX, y: evt.clientY };
  }
  function onPointerUp(evt) {
    if (evt.button !== 0 || !downPt) return;
    const wasClick = isClick(downPt, { x: evt.clientX, y: evt.clientY });
    downPt = null;
    if (!wasClick) return; // an orbit-drag, not a pick
    select(pickAt(evt.clientX, evt.clientY));
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  function setMode(m) {
    if (m !== 'face' && m !== 'edge') return;
    mode = m;
    restoreSelected();
    notify(null);
  }
  function clear() {
    restoreSelected();
    notify(null);
  }

  return { rebuild, clear, setMode };
}
