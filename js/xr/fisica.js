// PipeCAD · física con Rapier (compartido por ra.html y vr.html). Extraído del visor RA.
// La estructura encolada es un único cuerpo rígido compuesto: un cilindro por tubo y por boca de accesorio y una
// bola en el centro de los que ramifican, con la masa del PVC repartida entre ellos. El suelo es fijo, en y = 0 del
// escenario. Paso fijo de 1/90 s. Incluye el agarre con manos o mandos (muelle amortiguado hacia la pose objetivo),
// el agarre por un punto (dedo o ratón) y el entorno real (muebles y paredes) como colisionadores fijos.
// Script clásico con fábrica. Uso:  const fis = crearFisicaXR(THREE, { importar, fuente, OPTS, stage, … })
//   importar()            → promesa del módulo Rapier
//   fuente()              → { shapes, toWorld } de la estructura actual (o null)
//   OPTS                  → { gravity, fixed, env }
//   stage                 → Object3D del escenario (para pasar el entorno real a sus coordenadas)
//   alSincronizar(p, q)   → nueva pose del cuerpo · alCrear() · resaltar(on) · pedirDibujo() · avisoFijada(donde) · alError(err)
(function (global) {
'use strict';
global.crearFisicaXR = function (THREE, opts = {}) {
const OPTS = opts.OPTS || { gravity: true, fixed: false, env: true };
const Y = new THREE.Vector3(0, 1, 0), MM = 0.001;
const requestRender = () => opts.pedirDibujo?.();
const PH = { R: null, world: null, body: null, loading: null, active: true, acc: 0, error: '', step: 1 / 90, local: null };
const ENV = { colliders: [], sig: '', count: 0, lastCheck: 0, announced: false };
function loadPhysics() {
  PH.loading ||= opts.importar()
    .then(async mod => { const R = mod.default ?? mod; await R.init(); PH.R = R; buildPhysics(); return R; })
    .catch(err => { PH.error = err.message; console.warn('Física no disponible', err); opts.alError?.(err); return null; });
  return PH.loading;
}
function buildPhysics() {
  const R = PH.R, current = opts.fuente?.(); if (!R || !current?.shapes) return;
  if (PH.world) { PH.world.free(); PH.world = PH.body = null; }
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PH.step;
  world.createCollider(R.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.05)); // suelo
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.15).setCanSleep(true));
  const M = current.toWorld, a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion();
  PH.local = [];
  for (const sh of current.shapes) {
    let desc;
    if (sh.type === 'cyl') {
      a.copy(sh.a).applyMatrix4(M); b.copy(sh.b).applyMatrix4(M);
      const len = a.distanceTo(b); if (len < 1e-4) continue;
      PH.local.push({ type: 'cyl', a: a.clone(), b: b.clone(), r: sh.r * MM });
      q.setFromUnitVectors(Y, b.clone().sub(a).normalize());
      desc = R.ColliderDesc.cylinder(len / 2, sh.r * MM).setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    } else {
      a.copy(sh.c).applyMatrix4(M);
      PH.local.push({ type: 'ball', c: a.clone(), r: sh.r * MM });
      desc = R.ColliderDesc.ball(sh.r * MM).setTranslation(a.x, a.y, a.z);
    }
    desc.setMass(Math.max(sh.mass ?? 0, 1e-4)).setFriction(0.7).setRestitution(0.05);
    world.createCollider(desc, body);
  }
  PH.world = world; PH.body = body; PH.acc = 0; ENV.colliders = []; ENV.count = 0; ENV.sig = '';
  resetPose(); applyPhysicsOpts();
  opts.alCrear?.();
}
function syncAssembly() {
  if (!PH.body) return;
  opts.alSincronizar?.(PH.body.translation(), PH.body.rotation());
}
// Avanza la simulación; devuelve true si la estructura se está moviendo
function physicsStep(dt) {
  if (!PH.world || !PH.active) return false;
  PH.acc = Math.min(PH.acc + dt, 0.1); // tras una pausa larga no se recupera de golpe
  let n = 0;
  while (PH.acc >= PH.step) { driveGrab(); PH.world.step(); PH.acc -= PH.step; n++; }
  if (n) syncAssembly();
  return GRAB.hands.size > 0 || !!TOUCH.point || !PH.body.isSleeping();
}
// Derecha, apoyada en el suelo en el centro del escenario y en reposo
function resetPose() {
  const B = PH.body; if (!B) { opts.alSincronizar?.({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }); return; }
  B.setTranslation({ x: 0, y: 0, z: 0 }, false); B.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
  B.setLinvel({ x: 0, y: 0, z: 0 }, false); B.setAngvel({ x: 0, y: 0, z: 0 }, false);
  B.sleep(); syncAssembly(); requestRender();
}
function applyPhysicsOpts() { // tras crear el cuerpo o cambiar una opción
  const B = PH.body, R = PH.R; if (!B || !R) return;
  PH.world.gravity = { x: 0, y: OPTS.gravity ? -9.81 : 0, z: 0 };
  B.setLinearDamping(OPTS.gravity ? 0.05 : 1.2); B.setAngularDamping(OPTS.gravity ? 0.15 : 1.2); // sin gravedad flota y se frena sola
  B.setBodyType(OPTS.fixed ? R.RigidBodyType.Fixed : R.RigidBodyType.Dynamic, true);
  if (!OPTS.fixed) B.wakeUp();
}
// La levanta (1 m por defecto) con una pequeña inclinación y la suelta
function drop(height = 1, tiltDeg = 8) {
  const B = PH.body; if (!B) return;
  const e = new THREE.Euler(THREE.MathUtils.degToRad(tiltDeg), Math.random() * 0.4 - 0.2, THREE.MathUtils.degToRad(tiltDeg * 0.6)), q = new THREE.Quaternion().setFromEuler(e);
  B.setTranslation({ x: 0, y: height, z: 0 }, false); B.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
  B.setLinvel({ x: 0, y: 0, z: 0 }, false); B.setAngvel({ x: 0, y: 0, z: 0 }, false);
  PH.active = true; B.wakeUp(); syncAssembly(); requestRender();
}
// Simulación sin dibujar (pruebas): devuelve el estado al cabo de «seconds»
function simulate(seconds) {
  const steps = Math.round(seconds / PH.step);
  for (let i = 0; i < steps; i++) { driveGrab(); PH.world.step(); }
  syncAssembly();
  const t = PH.body.translation(), q = PH.body.rotation(), up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  return { y: t.y, x: t.x, z: t.z, upY: up.y, sleeping: PH.body.isSleeping(), speed: Math.hypot(...Object.values(PH.body.linvel())), mass: PH.body.mass() };
}
// ---------------------------------------------------------------- agarre con manos o mandos
// Cada mano o mando que agarra guarda dónde estaba la estructura respecto a ella. Mientras agarra, la estructura
// sigue a la pose objetivo con un muelle amortiguado: se le fija la velocidad que la lleva hacia allí en un tiempo τ
// que crece con la masa. Como sigue siendo un cuerpo dinámico, no atraviesa el suelo. Al soltar conserva la velocidad.
// Con dos manos: se mueve con el punto medio y gira con la recta entre ellas, sin escalar (tamaño real).
const GRAB = { hands: new Map(), two: null };
const _p = new THREE.Vector3();
function bodyPose() {
  const t = PH.body.translation(), q = PH.body.rotation();
  return { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(q.x, q.y, q.z, q.w) };
}
// Distancia (m) de un punto del escenario a la superficie de la estructura (negativa si está dentro)
function distanceToStructure(pStage) {
  if (!PH.body || !PH.local) return Infinity;
  const { p, q } = bodyPose(), l = pStage.clone().sub(p).applyQuaternion(q.invert());
  let best = Infinity;
  for (const sh of PH.local) {
    let d;
    if (sh.type === 'cyl') {
      const ab = _p.copy(sh.b).sub(sh.a), t = THREE.MathUtils.clamp(l.clone().sub(sh.a).dot(ab) / ab.lengthSq(), 0, 1);
      d = l.distanceTo(sh.a.clone().addScaledVector(ab, t)) - sh.r;
    } else d = l.distanceTo(sh.c) - sh.r;
    if (d < best) best = d;
  }
  return best;
}
function anchorHand(h) { // posición y giro de la estructura respecto a la mano
  const { p, q } = bodyPose(), inv = h.pose.q.clone().invert();
  h.offP = p.sub(h.pose.p).applyQuaternion(inv); h.offQ = inv.multiply(q);
}
function startTwoHands() {
  const [a, b] = [...GRAB.hands.values()], { p, q } = bodyPose();
  GRAB.two = { mid: a.pose.p.clone().add(b.pose.p).multiplyScalar(0.5), dir: b.pose.p.clone().sub(a.pose.p).normalize(), p, q, a, b };
}
// pose = { p: Vector3, q: Quaternion } en el sistema del escenario
function beginGrab(id, pose) {
  if (!PH.body || GRAB.hands.has(id)) return false;
  if (OPTS.fixed) { opts.avisoFijada?.('menu'); return false; }
  const h = { pose: { p: pose.p.clone(), q: pose.q.clone() } };
  anchorHand(h); GRAB.hands.set(id, h);
  if (GRAB.hands.size === 2) startTwoHands();
  PH.active = true; PH.body.wakeUp(); opts.resaltar?.(true); requestRender();
  return true;
}
function moveGrab(id, pose) { const h = GRAB.hands.get(id); if (h) { h.pose.p.copy(pose.p); h.pose.q.copy(pose.q); } }
function endGrab(id) {
  if (!GRAB.hands.delete(id)) return;
  GRAB.two = null;
  for (const h of GRAB.hands.values()) anchorHand(h); // la que queda vuelve a anclarse donde está: sin saltos
  if (!GRAB.hands.size) { opts.resaltar?.(false); PH.body?.wakeUp(); }
}
function grabTarget() {
  if (GRAB.two && GRAB.hands.size === 2) {
    const { a, b } = GRAB.two, mid = a.pose.p.clone().add(b.pose.p).multiplyScalar(0.5), dir = b.pose.p.clone().sub(a.pose.p);
    if (dir.lengthSq() < 1e-6) return null;
    const dq = new THREE.Quaternion().setFromUnitVectors(GRAB.two.dir, dir.normalize());
    return { p: GRAB.two.p.clone().sub(GRAB.two.mid).applyQuaternion(dq).add(mid), q: dq.multiply(GRAB.two.q) };
  }
  const h = GRAB.hands.values().next().value; if (!h) return null;
  return { p: h.offP.clone().applyQuaternion(h.pose.q).add(h.pose.p), q: h.pose.q.clone().multiply(h.offQ) };
}
function driveGrab() {
  if (TOUCH.point) { drivePoint(); return; }
  if (!GRAB.hands.size || !PH.body) return;
  const T = grabTarget(); if (!T) return;
  const { p, q } = bodyPose(), tau = THREE.MathUtils.clamp(0.035 + 0.01 * PH.body.mass(), 0.035, 0.15);
  const v = T.p.sub(p).divideScalar(tau); if (v.length() > 8) v.setLength(8);
  const dq = T.q.multiply(q.invert()); if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
  const ang = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
  const w = new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(ang / tau); if (w.length() > 14) w.setLength(14);
  PH.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true); PH.body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
}
// ---------------------------------------------------------------- agarre por un punto (dedo o ratón)
// Un muelle lleva el punto tocado a 20 cm por encima de donde estaba y, después, bajo el dedo (sobre un plano
// horizontal a esa altura). Como tira de un solo punto, la estructura cuelga de él y se balancea; al soltar, cae.
// Con un segundo dedo, girar los dos dedos gira la estructura alrededor de la vertical.
const LIFT = 0.2, OMEGA = 11, ZETA = 0.8;
const TOUCH = { point: null, primary: null, angle: null, yawTarget: null };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
function bodyYaw() { const x = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyPose().q); return Math.atan2(-x.z, x.x); }
function rayPlaneY(ray, y) { // corte de un rayo (escenario) con el plano horizontal y; a 8 m como mucho
  if (Math.abs(ray.d.y) < 1e-4) return null;
  const t = (y - ray.o.y) / ray.d.y;
  return t > 0 ? ray.o.clone().addScaledVector(ray.d, Math.min(t, 8)) : null;
}
function beginPointGrab(id, hitStage) {
  if (!PH.body || TOUCH.point || GRAB.hands.size) return false;
  if (OPTS.fixed) { opts.avisoFijada?.('opciones'); return false; }
  const { p, q } = bodyPose();
  TOUCH.point = { id, local: hitStage.clone().sub(p).applyQuaternion(q.invert()), height: hitStage.y + LIFT, target: hitStage.clone().setY(hitStage.y + LIFT), aim: hitStage.clone(), prev: null };
  TOUCH.primary = id; TOUCH.angle = null; TOUCH.yawTarget = null;
  PH.active = true; PH.body.setAngularDamping(1.8); PH.body.wakeUp(); opts.resaltar?.(true);
  return true;
}
function endPointGrab() {
  if (!TOUCH.point) return;
  TOUCH.point = null; TOUCH.primary = null; TOUCH.angle = null; TOUCH.yawTarget = null;
  PH.body?.setAngularDamping(0.15); PH.body?.wakeUp(); opts.resaltar?.(false);
}
// Rayos de los dedos (sistema del escenario): el primero mueve; dos dedos giran
function updatePointers(rays) {
  if (!TOUCH.point) return;
  const main = rays.get(TOUCH.primary);
  if (main) { const t = rayPlaneY(main, TOUCH.point.height); if (t) TOUCH.point.target.copy(t); }
  const two = [...rays.values()].slice(0, 2);
  if (two.length === 2) {
    const a = rayPlaneY(two[0], TOUCH.point.height), b = rayPlaneY(two[1], TOUCH.point.height);
    if (a && b) {
      const ang = Math.atan2(-(b.z - a.z), b.x - a.x); // ángulo en planta (giro positivo = antihorario visto desde arriba)
      if (TOUCH.angle == null) TOUCH.yawTarget = bodyYaw(); else TOUCH.yawTarget += wrapAngle(ang - TOUCH.angle);
      TOUCH.angle = ang;
    }
  } else if (TOUCH.angle != null) { TOUCH.angle = null; TOUCH.yawTarget = null; const av = PH.body.angvel(); PH.body.setAngvel({ x: av.x, y: av.y * 0.2, z: av.z }, true); }
}
// Muelle amortiguado en el punto cogido (impulsos en ese punto) más el peso, para que cuelgue de él
function drivePoint() {
  const B = PH.body, P = TOUCH.point; if (!B || !P) return;
  const { p, q } = bodyPose(), w = P.local.clone().applyQuaternion(q).add(p), m = B.mass(), dt = PH.step;
  const v = P.prev ? w.clone().sub(P.prev).divideScalar(dt) : new THREE.Vector3(); P.prev = w.clone();
  // el punto al que tira el muelle persigue al dedo a 2,5 m/s como mucho: un salto del dedo no la lanza
  const step = P.target.clone().sub(P.aim), maxStep = 2.5 * dt; if (step.length() > maxStep) step.setLength(maxStep); P.aim.add(step);
  const F = P.aim.clone().sub(w).multiplyScalar(m * OMEGA * OMEGA).addScaledVector(v, -2 * ZETA * OMEGA * m);
  F.y += m * 9.81;
  const lim = m * 60; if (F.length() > lim) F.setLength(lim);
  B.applyImpulseAtPoint({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, { x: w.x, y: w.y, z: w.z }, true);
  if (TOUCH.yawTarget != null) { const av = B.angvel(), wy = THREE.MathUtils.clamp(wrapAngle(TOUCH.yawTarget - bodyYaw()) / 0.12, -8, 8); B.setAngvel({ x: av.x * 0.9, y: wy, z: av.z * 0.9 }, true); }
}
// ---------------------------------------------------------------- entorno real: muebles y paredes como obstáculo
function clearEnv() { if (PH.world) for (const c of ENV.colliders) PH.world.removeCollider(c, false); ENV.colliders = []; ENV.count = 0; }
// items: [{ label, vertices: Float32Array (mundo), indices: Uint32Array }] o [{ label, hull: Float32Array (mundo) }]
function setEnvironment(items) {
  clearEnv();
  const R = PH.R, stage = opts.stage; if (!R || !PH.world || !OPTS.env) return 0;
  const inv = new THREE.Matrix4(), p = new THREE.Vector3();
  if (stage) { stage.updateMatrixWorld(true); inv.copy(stage.matrixWorld).invert(); }
  for (const it of items) {
    const src = it.vertices || it.hull, v = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) { p.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(inv); v[i] = p.x; v[i + 1] = p.y; v[i + 2] = p.z; }
    const desc = it.indices ? R.ColliderDesc.trimesh(v, it.indices) : R.ColliderDesc.convexHull(v);
    if (!desc) continue;
    desc.setFriction(0.7).setRestitution(0.05);
    ENV.colliders.push(PH.world.createCollider(desc));
  }
  ENV.count = ENV.colliders.length;
  if (ENV.count) PH.body?.wakeUp();
  return ENV.count;
}
return { PH, GRAB, TOUCH, ENV, loadPhysics, buildPhysics, syncAssembly, physicsStep, resetPose, applyPhysicsOpts, drop, simulate, bodyPose, distanceToStructure,
  beginGrab, moveGrab, endGrab, driveGrab, beginPointGrab, endPointGrab, updatePointers, drivePoint, rayPlaneY, bodyYaw, wrapAngle, clearEnv, setEnvironment };
};
})(globalThis);
