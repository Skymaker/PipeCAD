// PipeCAD · entradas de las gafas (compartido por ra.html y vr.html)
// Manos (pellizco del pulgar y el índice con histéresis, punta del índice, palma) y mandos (gatillo, agarre,
// joystick y botones), con su rayo y la vibración. Extraído del visor RA.
// Script clásico con fábrica. Uso:  const ent = crearEntradasXR(THREE, renderer, scene, { alDesconectar })
(function (global) {
'use strict';
const PINCH_ON = 0.02, PINCH_OFF = 0.032;
// Pellizco con histéresis: empieza por debajo de 20 mm y no se suelta hasta pasar de 32 mm
const pellizco = (dist, era) => (era ? dist < PINCH_OFF : dist < PINCH_ON);
// Flancos de un botón: { pulsa, suelta } respecto al fotograma anterior
const flanco = (ahora, antes) => ({ pulsa: ahora && !antes, suelta: !ahora && antes });
global.crearEntradasXR = function (THREE, renderer, scene, opts = {}) {
  const INPUTS = [0, 1].map(i => {
    const c = { id: 'xr' + i, ray: renderer.xr.getController(i), grip: renderer.xr.getControllerGrip(i), hand: renderer.xr.getHand(i), source: null, trigger: false, squeeze: false, was: false, pinch: false, frame: 0, hit: null, prev: {} };
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    c.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })); c.line.visible = false; c.ray.add(c.line);
    c.ray.addEventListener('connected', e => { c.source = e.data; });
    c.ray.addEventListener('disconnected', () => { c.source = null; c.trigger = c.squeeze = c.pinch = false; opts.alDesconectar?.(c); c.line.visible = false; });
    for (const [ev, k, v] of [['selectstart', 'trigger', true], ['selectend', 'trigger', false], ['squeezestart', 'squeeze', true], ['squeezeend', 'squeeze', false]]) c.ray.addEventListener(ev, () => { c[k] = v; });
    scene.add(c.ray, c.grip, c.hand);
    return c;
  });
  // Normal de la palma (hacia fuera de la palma) a partir de la muñeca y los metacarpianos del índice y el meñique
  function palmNormal(wrist, index, pinky, side) {
    const a = index.clone().sub(wrist), b = pinky.clone().sub(wrist);
    return (side === 'left' ? b.cross(a) : a.cross(b)).normalize();
  }
  const wp = o => o.getWorldPosition(new THREE.Vector3()), wq = o => o.getWorldQuaternion(new THREE.Quaternion());
  // Pose de agarre (en el mundo) y si está agarrando, para una mano o un mando (como en el visor RA)
  function readInput(c) {
    const src = c.source; if (!src || src.targetRayMode === 'screen') return null;
    if (src.hand) {
      const t = c.hand.joints?.['thumb-tip'], ix = c.hand.joints?.['index-finger-tip'], wr = c.hand.joints?.wrist;
      if (!t?.visible || !ix?.visible || !wr?.visible) return null;
      const pt = wp(t), pi = wp(ix), d = pt.distanceTo(pi);
      c.pinch = pellizco(d, c.pinch);
      return { p: pt.add(pi).multiplyScalar(0.5), q: wq(wr), grabbing: c.pinch };
    }
    const g = c.grip.visible ? c.grip : c.ray;
    return { p: wp(g), q: wq(g), grabbing: c.trigger || c.squeeze };
  }
  // Lectura completa para la edición en VR: punto de trabajo, rayo, punta del índice, palma, botones y joystick
  function leer(c) {
    const b = readInput(c); if (!b) return null;
    const src = c.source, mano = !!src.hand, o = wp(c.ray), d = new THREE.Vector3(0, 0, -1).applyQuaternion(wq(c.ray));
    const r = { c, id: c.id, lado: src.handedness, mano, p: b.p, q: b.q, o, d, apretando: mano ? c.pinch : c.trigger, agarre: mano ? false : c.squeeze, punta: o.clone(), palma: null, stick: { x: 0, y: 0 }, a: false, b: false, stickClic: false };
    if (mano) {
      const J = c.hand.joints, ix = J['index-finger-tip'], im = J['index-finger-metacarpal'], pm = J['pinky-finger-metacarpal'], mm = J['middle-finger-metacarpal'], w = J.wrist;
      r.punta = wp(ix);
      if (im?.visible && pm?.visible && mm?.visible) { const pw = wp(w); r.palma = { n: palmNormal(pw, wp(im), wp(pm), src.handedness), centro: pw.clone().lerp(wp(mm), 0.5) }; }
    } else {
      r.p = o.clone(); // con el mando se trabaja con su punta (origen del rayo), no con el centro de la empuñadura
      const gp = src.gamepad, ax = gp?.axes || [];
      r.stick = { x: ax[2] ?? ax[0] ?? 0, y: ax[3] ?? ax[1] ?? 0 };
      r.stickClic = !!gp?.buttons?.[3]?.pressed; r.a = !!gp?.buttons?.[4]?.pressed; r.b = !!gp?.buttons?.[5]?.pressed;
      r.gripPos = c.grip.visible ? wp(c.grip) : o.clone();
    }
    return r;
  }
  const inputByHand = side => INPUTS.find(c => c.source?.handedness === side && c.source.targetRayMode !== 'screen');
  const vibrar = (c, fuerza = 0.4, ms = 25) => { try { c?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(fuerza, ms); } catch { /* sin vibración */ } };
  return { INPUTS, readInput, leer, palmNormal, inputByHand, vibrar, PINCH_ON, PINCH_OFF };
};
global.crearEntradasXR.pellizco = pellizco;
global.crearEntradasXR.flanco = flanco;
global.crearEntradasXR.PINCH_ON = PINCH_ON; global.crearEntradasXR.PINCH_OFF = PINCH_OFF;
})(globalThis);
