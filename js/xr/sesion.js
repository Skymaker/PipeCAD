// PipeCAD · sesión WebXR (compartido por ra.html y vr.html)
// Sesión de realidad mixta (immersive-ar) o virtual (immersive-vr), espacio de referencia con suelo, prueba de
// impacto, suelo y entorno de la sala (planos y mallas detectados) y locomoción (teletransporte y giro por pasos).
// Incluye la aritmética pura de la escala de la maqueta y del agarre con dos manos, que se prueba sin gafas.
// Script clásico con fábrica. Uso:  const ses = crearSesionXR(THREE, renderer)
(function (global) {
'use strict';
/* ---------------------------------------------------------------- escala de la maqueta (pura) */
const ESCALAS = [1 / 50, 1 / 20, 1 / 10, 1 / 5, 1 / 2, 1];           // paradas de la escala libre
const ESC_MIN = 1 / 50, ESC_MAX = 1;
// Limita la escala a 1:50 … 1:1 y la engancha a la parada más cercana si está a menos de un 8 %
function ajustarEscala(s, imantar = true) {
  s = Math.min(ESC_MAX, Math.max(ESC_MIN, s));
  if (imantar) for (const e of ESCALAS) if (Math.abs(Math.log(s / e)) < 0.08) return e;
  return s;
}
const nombreEscala = s => { const k = 1 / s; return '1:' + (Math.abs(k - Math.round(k)) < 0.05 ? Math.round(k) : k.toFixed(1).replace('.', ',')); };
// Agarre con dos manos: la maqueta se mueve con el punto medio, gira (solo alrededor de la vertical) con la
// recta entre las manos y se escala con su separación. ini = { a, b, pos, yaw, escala } al empezar; a, b = manos ahora.
// Devuelve { pos, yaw, escala } del mundo del proyecto. v(x, y, z) son vectores con .x .y .z
function agarreDosManos(ini, a, b, imantar = true) {
  const mid0 = { x: (ini.a.x + ini.b.x) / 2, y: (ini.a.y + ini.b.y) / 2, z: (ini.a.z + ini.b.z) / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const d0 = Math.hypot(ini.b.x - ini.a.x, ini.b.y - ini.a.y, ini.b.z - ini.a.z), d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const escala = ajustarEscala(ini.escala * (d0 > 1e-4 ? d / d0 : 1), imantar), k = escala / ini.escala;
  const ang0 = Math.atan2(ini.b.x - ini.a.x, ini.b.z - ini.a.z), ang = Math.atan2(b.x - a.x, b.z - a.z), dy = ang - ang0;
  // el punto de la maqueta que estaba en el punto medio sigue en el punto medio
  const rx = ini.pos.x - mid0.x, ry = ini.pos.y - mid0.y, rz = ini.pos.z - mid0.z, c = Math.cos(dy), s = Math.sin(dy);
  return { pos: { x: mid.x + k * (c * rx + s * rz), y: mid.y + k * ry, z: mid.z + k * (-s * rx + c * rz) }, yaw: ini.yaw + dy, escala };
}
// Agarre con una mano: la maqueta se desplaza con ella (sin girar ni escalar)
const agarreUnaMano = (ini, a) => ({ pos: { x: ini.pos.x + a.x - ini.a.x, y: ini.pos.y + a.y - ini.a.y, z: ini.pos.z + a.z - ini.a.z }, yaw: ini.yaw, escala: ini.escala });

/* ---------------------------------------------------------------- locomoción (pura) */
// «rig» = { x, z, yaw }: dónde está y hacia dónde mira el origen de la sala real dentro del mundo virtual.
// Teletransporte: la cabeza (en el mundo) pasa a estar sobre el destino, sin girar
const rigTrasTeleport = (rig, cabeza, destino) => ({ x: rig.x + destino.x - cabeza.x, z: rig.z + destino.z - cabeza.z, yaw: rig.yaw });
// Giro por pasos alrededor de la cabeza
function rigTrasGiro(rig, cabeza, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), dx = rig.x - cabeza.x, dz = rig.z - cabeza.z;
  return { x: cabeza.x + c * dx + s * dz, z: cabeza.z - s * dx + c * dz, yaw: rig.yaw + ang };
}
// Arco del teletransporte: puntos de una parábola desde o en dirección dir hasta el suelo; { puntos, destino }
function arcoTeleport(o, dir, sueloY = 0, v = 6.5, g = 9.8, n = 24, maxDist = 8) {
  const vy = dir.y * v, a = -g / 2, c = o.y - sueloY, disc = vy * vy - 4 * a * c;
  if (disc < 0 || c < 0) return { puntos: [], destino: null };
  const T = (-vy - Math.sqrt(disc)) / (2 * a), puntos = [];
  for (let i = 0; i <= n; i++) { const t = T * i / n; puntos.push({ x: o.x + dir.x * v * t, y: o.y + vy * t + a * t * t, z: o.z + dir.z * v * t }); }
  const fin = puntos[n], dist = Math.hypot(fin.x - o.x, fin.z - o.z);
  return { puntos, destino: dist > 0.3 && dist <= maxDist ? { x: fin.x, y: sueloY, z: fin.z } : null };
}

global.crearSesionXR = function (THREE, renderer, opts = {}) {
  const XR = { session: null, modo: '', refType: '', baseRef: null, hitSource: null, viewerSpace: null, floorY: null, isPhone: false, rig: { x: 0, z: 0, yaw: 0 } };
  const soporte = { ar: false, vr: false };
  async function detectar() {
    try { soporte.ar = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { soporte.ar = false; }
    try { soporte.vr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { soporte.vr = false; }
    return soporte;
  }
  // Abre la sesión. modo: 'immersive-ar' | 'immersive-vr'. «local-floor» si lo hay; si no, «local» y el suelo lo da la prueba de impacto
  async function entrar(modo, { domOverlay = null, features = ['local-floor', 'hit-test', 'hand-tracking', 'plane-detection', 'mesh-detection'] } = {}) {
    const init = { optionalFeatures: [...features] };
    if (domOverlay) { init.optionalFeatures.push('dom-overlay'); init.domOverlay = { root: domOverlay }; }
    const session = await navigator.xr.requestSession(modo, init);
    XR.session = session; XR.modo = modo; XR.rig = { x: 0, z: 0, yaw: 0 };
    try { await session.requestReferenceSpace('local-floor'); XR.refType = 'local-floor'; } catch { XR.refType = 'local'; }
    XR.floorY = XR.refType === 'local-floor' ? 0 : null;
    renderer.xr.setReferenceSpaceType(XR.refType);
    XR.isPhone = !!session.domOverlayState;
    try {
      XR.viewerSpace = await session.requestReferenceSpace('viewer');
      XR.hitSource = modo === 'immersive-ar' ? await session.requestHitTestSource?.({ space: XR.viewerSpace }) ?? null : null;
    } catch { XR.hitSource = null; }
    session.addEventListener('end', () => { XR.hitSource?.cancel?.(); XR.hitSource = null; XR.session = null; XR.baseRef = null; opts.alSalir?.(); });
    await renderer.xr.setSession(session);
    XR.baseRef = renderer.xr.getReferenceSpace();
    try { renderer.xr.setFoveation?.(opts.foveacion ?? 1); } catch { /* sin foveated rendering */ }
    return session;
  }
  const salir = () => XR.session?.end();
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  // Impacto horizontal (suelo o mesa) de la prueba de impacto, o null
  function floorFromHit(frame) {
    if (!XR.hitSource) return null;
    const refSpace = renderer.xr.getReferenceSpace();
    for (const hit of frame.getHitTestResults(XR.hitSource)) {
      const pose = hit.getPose(refSpace); if (!pose) continue;
      const { position: p, orientation: o } = pose.transform;
      _q.set(o.x, o.y, o.z, o.w); _v.set(0, 1, 0).applyQuaternion(_q);
      if (_v.y > 0.9) return new THREE.Vector3(p.x, p.y, p.z);
    }
    return null;
  }
  // Sin prueba de impacto: rayo de la mirada contra el plano del suelo (altura conocida)
  function floorFromGaze(floorY) {
    const cam = renderer.xr.getCamera(), o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    if (d.y > -0.05) d.y = -0.05;
    const t = Math.min((floorY - o.y) / d.y, 6);
    return t > 0 ? o.addScaledVector(d, t).setY(floorY) : null;
  }
  // Altura del suelo: «local-floor» la da (0) y, en las Quest 3, el plano detectado con la etiqueta «floor»
  function updateFloorFromPlanes(frame) {
    const planes = frame.detectedPlanes; if (!planes?.size) return;
    const refSpace = renderer.xr.getReferenceSpace();
    for (const plane of planes) {
      if (plane.semanticLabel !== 'floor' && plane.orientation !== 'horizontal') continue;
      const pose = frame.getPose(plane.planeSpace, refSpace); if (!pose) continue;
      const y = pose.transform.position.y;
      if (plane.semanticLabel === 'floor' || XR.floorY == null || y < XR.floorY) XR.floorY = y;
    }
  }
  // Entorno real: mallas de la sala (mesas, sofás, paredes…) o, si no hay, planos detectados (placas de 2 cm).
  // Devuelve { items, sig }: items = [{ label, vertices, indices }] o [{ label, hull }] en el mundo; sig cambia si cambia la sala
  function readEnvironment(frame, sig = '') {
    const ref = renderer.xr.getReferenceSpace(), items = [], M = new THREE.Matrix4(), p = new THREE.Vector3();
    const meshes = frame.detectedMeshes;
    if (meshes?.size) {
      const all = [...meshes], objs = all.filter(m => !['floor', 'global mesh'].includes(m.semanticLabel));
      for (const m of objs.length ? objs : all.filter(x => x.semanticLabel !== 'floor')) {
        const pose = frame.getPose(m.meshSpace, ref); if (!pose || !m.vertices?.length) continue;
        sig += '|' + m.semanticLabel + m.lastChangedTime;
        M.fromArray(pose.transform.matrix);
        const v = new Float32Array(m.vertices.length);
        for (let i = 0; i < v.length; i += 3) { p.set(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]).applyMatrix4(M); v[i] = p.x; v[i + 1] = p.y; v[i + 2] = p.z; }
        items.push({ label: m.semanticLabel, vertices: v, indices: new Uint32Array(m.indices) });
      }
    } else if (frame.detectedPlanes?.size) {
      for (const pl of frame.detectedPlanes) {
        if (pl.semanticLabel === 'floor' || !pl.polygon?.length) continue;
        const pose = frame.getPose(pl.planeSpace, ref); if (!pose) continue;
        M.fromArray(pose.transform.matrix);
        if (pl.orientation === 'horizontal' && XR.floorY != null && Math.abs(pose.transform.position.y - XR.floorY) < 0.05) continue; // es el suelo
        sig += '|' + (pl.semanticLabel || pl.orientation) + pl.lastChangedTime;
        const v = [];
        for (const q of pl.polygon) for (const y of [0, -0.02]) { p.set(q.x, y, q.z).applyMatrix4(M); v.push(p.x, p.y, p.z); }
        items.push({ label: pl.semanticLabel || pl.orientation, hull: new Float32Array(v), horizontal: pl.orientation === 'horizontal', y: pose.transform.position.y });
      }
    }
    return { items, sig };
  }
  // Mesa más cercana delante del usuario (plano horizontal por encima del suelo): altura o null
  function alturaMesa(frame, cabeza, maxDist = 1.5) {
    let best = null;
    const ref = renderer.xr.getReferenceSpace();
    for (const pl of frame.detectedPlanes || []) {
      if (pl.orientation !== 'horizontal' || pl.semanticLabel === 'floor' || pl.semanticLabel === 'ceiling') continue;
      const pose = frame.getPose(pl.planeSpace, ref); if (!pose) continue;
      const p = pose.transform.position, d = Math.hypot(p.x - cabeza.x, p.z - cabeza.z);
      if (p.y > (XR.floorY ?? 0) + 0.3 && p.y < cabeza.y - 0.2 && d < maxDist && (!best || d < best.d)) best = { d, y: p.y, x: p.x, z: p.z };
    }
    return best;
  }
  // Locomoción: aplica el «rig» como un espacio de referencia desplazado (los mandos y la cabeza lo siguen solos)
  function aplicarRig() {
    if (!XR.baseRef || typeof XRRigidTransform === 'undefined') return;
    const { x, z, yaw } = XR.rig, c = Math.cos(-yaw), s = Math.sin(-yaw);
    const pos = { x: -(c * x + s * z), y: 0, z: -(-s * x + c * z) }, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    renderer.xr.setReferenceSpace(XR.baseRef.getOffsetReferenceSpace(new XRRigidTransform(pos, { x: q.x, y: q.y, z: q.z, w: q.w })));
  }
  const cabeza = () => renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
  function teletransportar(destino) { XR.rig = rigTrasTeleport(XR.rig, cabeza(), destino); aplicarRig(); }
  function girar(ang) { XR.rig = rigTrasGiro(XR.rig, cabeza(), ang); aplicarRig(); }
  return { XR, soporte, detectar, entrar, salir, floorFromHit, floorFromGaze, updateFloorFromPlanes, readEnvironment, alturaMesa, aplicarRig, teletransportar, girar, cabeza };
};
Object.assign(global.crearSesionXR, { ESCALAS, ESC_MIN, ESC_MAX, ajustarEscala, nombreEscala, agarreDosManos, agarreUnaMano, rigTrasTeleport, rigTrasGiro, arcoTeleport });
})(globalThis);
