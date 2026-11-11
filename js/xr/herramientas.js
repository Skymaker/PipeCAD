// PipeCAD VR · lógica de las herramientas de edición (sin gráficos)
// Todo trabaja en coordenadas del proyecto (mm, Z vertical): mano → mundo del proyecto → snap → núcleo.
// La entrada es un «puntero», que puede ser
//   directo  { p, tol }                 punto 3D de la mano (pellizco) y tolerancia de enganche en mm del proyecto
//   rayo     { o, d, tolAng, tolMin }   origen y dirección del rayo; la tolerancia crece con la distancia
// La salida para los gráficos es «previa»: cilindros, puntos y una cota que la página dibuja en transparente.
// Es un script clásico con una fábrica, como el núcleo. Uso:  const ed = crearEditorVR(THREE, nucleo, model, avisos)
//   avisos.cambio(live)   el modelo ha cambiado (ya está analizado)
//   avisos.estado(msg)    mensaje para el usuario
//   avisos.paso()         la medida ha saltado un paso de snap (clic de vibración)
//   avisos.seleccion()    ha cambiado la selección
(function (global) {
'use strict';
global.crearEditorVR = function (THREE, N, model, avisos = {}) {
const { analyze, computeCutlist, classifyNode, near, fmt, v3, vkey, DIRS18, localDirs, snapLen, cleanDir, fittingTemplate, chooseOrientation,
  portZs, placeFitting, planRotation, rotateFitting, fittingAxes, deleteFitting, segAxis, movingSet, minAxisLength, setSegmentLength,
  isolateGroup, snapshotNodes, transformNodes, nodesBox, duplicateItems, mirrorGroup, joinCandidates, joinSegments, joinPlan, connectLoose,
  splitLongSegment, kindLabel, LIB, DIAMETERS, KIND_NAMES } = N;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AXES = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const PLANES = { xy: { axis: 'z', name: 'XY (planta)' }, xz: { axis: 'y', name: 'XZ (alzado)' }, yz: { axis: 'x', name: 'YZ (perfil)' } };
const PLANE_BASE = {
  xy: new THREE.Quaternion(),
  xz: new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2),
  yz: new THREE.Quaternion().setFromAxisAngle(V(1, 1, 1).normalize(), 2 * Math.PI / 3),
};
const SNAPS = [1, 5, 10, 50, 100];
const state = {
  tool: 'select', d: 20, fit: 'elbow90', snap: 10, angStep: 45, wp: 'xy', planeOff: { xy: 0, xz: 0, yz: 0 }, regla: false,
  mover: 'libre',                                    // mover grupos: 'libre' | 'plano' (de trabajo) | 'eje' (el dominante)
  osnap: { on: true, end: true, mid: true, third: false, quarter: false, fit: true },
  selected: null, multi: new Map(), group: null, moveEnd: null, cut: null,
};
let analysis = analyze(model), snapCache = null;
state.cut = computeCutlist(model, analysis);
const status = msg => avisos.estado?.(msg);
const previa = { cyls: [], dots: [], cota: null, msg: '', ok: true };
function clearPrev() { previa.cyls = []; previa.dots = []; previa.cota = null; previa.msg = ''; previa.ok = true; return previa; }
const pCyl = (a, dir, len, r, tipo = 'ghost') => previa.cyls.push({ a: a.clone(), dir: dir.clone(), len, r, tipo });
const pDot = (pos, r, tipo = 'ghost') => previa.dots.push({ pos: pos.clone(), r, tipo });

/* ---------------------------------------------------------------- puntero */
const esRayo = q => !!q.d;
function distPunto(q, P) { // distancia del puntero a un punto y tolerancia de enganche allí
  if (!esRayo(q)) return { dist: q.p.distanceTo(P), tol: q.tol, s: 0 };
  const v = P.clone().sub(q.o), s = v.dot(q.d); if (s <= 0) return { dist: Infinity, tol: 0, s };
  return { dist: v.addScaledVector(q.d, -s).length(), tol: Math.max(q.tolMin || 0, s * q.tolAng), s };
}
function paramRecta(q, S, n) { // punto de la recta S + t·n más cercano al puntero: { t, dist, tol }
  if (!esRayo(q)) { const t = q.p.clone().sub(S).dot(n); return { t, dist: q.p.distanceTo(S.clone().addScaledVector(n, t)), tol: q.tol, s: 0 }; }
  const b = n.dot(q.d), D = 1 - b * b; if (D < 1e-6) return null;
  const w0 = S.clone().sub(q.o), dd = n.dot(w0), e = q.d.dot(w0), t = (b * e - dd) / D, s = (e - b * dd) / D;
  if (s <= 0) return null;
  return { t, dist: S.clone().addScaledVector(n, t).distanceTo(q.o.clone().addScaledVector(q.d, s)), tol: Math.max(q.tolMin || 0, s * q.tolAng), s };
}
function distTramo(q, g) { // distancia del puntero al eje de un tramo (acotado a sus extremos)
  const A = analysis.nodes.get(g.a).pos;
  let t;
  if (!esRayo(q)) t = q.p.clone().sub(A).dot(g.dir);
  else { const r = paramRecta(q, A, g.dir); t = r ? r.t : 0; }
  t = THREE.MathUtils.clamp(t, 0, g.Le);
  return { ...distPunto(q, A.clone().addScaledVector(g.dir, t)), t };
}
const grid = x => Math.round(x / state.snap) * state.snap;
function planePoint(q) { // punto del plano de trabajo (o libre en altura con la regla) ajustado a la rejilla
  const ax = PLANES[state.wp].axis, off = state.planeOff[state.wp]; let p;
  if (!esRayo(q)) { p = q.p.clone(); p[ax] = state.regla ? off + grid(p[ax] - off) : off; }
  else {
    if (Math.abs(q.d[ax]) < 1e-4) return null;
    const t = (off - q.o[ax]) / q.d[ax]; if (t <= 0 || t > (q.max || 1e5)) return null;
    p = q.o.clone().addScaledVector(q.d, t); p[ax] = off;
  }
  for (const k of ['x', 'y', 'z']) if (k !== ax) p[k] = grid(p[k]);
  return p;
}
function nearestSeg(q, excl = null, extra = 0) {
  let best = null, bs = Infinity;
  for (const g of analysis.segs.values()) {
    if (g.Le < 1e-6 || excl?.has(g.id)) continue;
    const r = distTramo(q, g), gap = r.dist - g.d / 2;
    if (gap > r.tol + extra) continue;
    const score = esRayo(q) ? r.s + Math.max(0, gap) * 4 : gap;
    if (score < bs) { bs = score; best = { g, t: r.t, gap }; }
  }
  return best;
}
// Lo que hay bajo el puntero: accesorio, extremo o tubo (para seleccionar, borrar, estirar o girar)
function pickAny(q) {
  const F = model.config.fittings; let best = null, bs = Infinity;
  for (const n of analysis.nodes.values()) {
    if (n.kind === 'isolated' && !n.explicit) continue;
    const fit = n.isFitting || n.explicit, R = fit ? (F[n.d]?.od ?? n.d * 1.3) / 2 + (F[n.d]?.socket ?? 0) * 0.5 : n.d / 2;
    const r = distPunto(q, n.pos), gap = r.dist - R; if (gap > r.tol) continue;
    const score = (esRayo(q) ? r.s + Math.max(0, gap) * 4 : gap) - (fit ? 0 : -n.d * 0.25); // a igual distancia manda el accesorio
    if (score < bs) { bs = score; best = { type: 'node', id: n.id }; }
  }
  const s = nearestSeg(q);
  if (s) { const score = esRayo(q) ? distTramo(q, s.g).s + Math.max(0, s.gap) * 4 : s.gap; if (score < bs - 1e-9) best = { type: 'seg', id: s.g.id }; }
  return best;
}

/* ---------------------------------------------------------------- dibujo de tubos (polilínea con accesorios automáticos) */
const draw = { start: null, hover: null, cand: null, fijo: null, just: false, lastLen: null };
function existingPorts(t) {
  if (t.type === 'node') return analysis.nodes.get(t.id).ports.map(p => ({ dir: p.dir.clone(), d: p.d, len: p.len, z: 0 }));
  if (t.type === 'seg') { const g = analysis.segs.get(t.id); return [{ dir: g.dir.clone(), d: g.d, len: 1, z: 0 }, { dir: g.dir.clone().negate(), d: g.d, len: 1, z: 0 }]; }
  return [];
}
// ¿Qué accesorio resultaría al añadir un tubo en dirección dir en el destino t?
function trial(t, dir, d) {
  if (t.type === 'node') {
    const node = analysis.nodes.get(t.id);
    if (node.explicit) {
      const op = node.open.find(o => near(o.dir.dot(dir), 1));
      if (!op) return { ok: false, msg: 'El accesorio no tiene una boca libre en esa dirección' };
      if (op.d !== d) return { ok: false, msg: `La boca del accesorio es de Ø${op.d}` };
      return { ok: true, kind: node.kind, z: op.z, msg: '' };
    }
  }
  const ports = existingPorts(t), np = { dir, d, len: 1, z: 0 }; ports.push(np);
  const info = classifyNode(ports, model.config), ok = info.kind !== 'invalid';
  const extend = ok && t.type === 'node' && ports.length === 2 && info.kind === 'coupling';
  return { ok, kind: extend ? 'extend' : info.kind, z: extend ? 0 : np.z, msg: info.errors?.[0] || '' };
}
const nodeTarget = id => ({ type: 'node', id, pos: analysis.nodes.get(id).pos.clone() });
function targetAt(p) {
  for (const n of analysis.nodes.values()) if (n.pos.distanceTo(p) < 0.5) return nodeTarget(n.id);
  for (const g of analysis.segs.values()) {
    const A = analysis.nodes.get(g.a).pos, v = p.clone().sub(A), t = v.dot(g.dir);
    if (t > 0.5 && t < g.Le - 0.5 && v.addScaledVector(g.dir, -t).length() < 0.5) return { type: 'seg', id: g.id, pos: A.clone().addScaledVector(g.dir, t) };
  }
  return { type: 'plane', pos: p };
}
// Puntos de referencia: extremos, mitad, tercios, cuartos y centros de accesorio
function snapPoints() {
  if (snapCache) return snapCache;
  const o = state.osnap, pts = [];
  if (o.on) {
    for (const n of analysis.nodes.values()) {
      const fit = n.isFitting || n.explicit;
      if (fit ? o.fit : o.end) pts.push({ type: 'node', id: n.id, pos: n.pos, label: fit ? 'Centro de ' + kindLabel(n).toLowerCase() : 'Extremo', pri: 0 });
    }
    const fr = [];
    if (o.mid) fr.push([1 / 2, 'Punto medio', 1]);
    if (o.third) fr.push([1 / 3, 'Tercio', 2], [2 / 3, 'Tercio', 2]);
    if (o.quarter) fr.push([1 / 4, 'Cuarto', 3], [3 / 4, 'Cuarto', 3]);
    for (const g of analysis.segs.values()) {
      if (g.Le < 1e-6) continue;
      const A = analysis.nodes.get(g.a).pos;
      for (const [f, label, pri] of fr) pts.push({ type: 'seg', id: g.id, pos: A.clone().addScaledVector(g.dir, g.Le * f), label: `${label} de ${g.id}`, pri });
    }
  }
  return (snapCache = pts);
}
function nearestSnap(q) {
  let best = null, bd = Infinity;
  for (const p of snapPoints()) {
    const r = distPunto(q, p.pos); if (r.dist > r.tol) continue;
    const d = r.dist / r.tol + p.pri * 0.15; // a igual distancia mandan los extremos
    if (d < bd) { bd = d; best = p; }
  }
  return best && { type: best.type, id: best.id, pos: best.pos.clone(), label: best.label };
}
function pickTarget(q) {
  const sp = nearestSnap(q); if (sp) return sp;
  const s = nearestSeg(q);
  if (s) {
    const g = s.g, A = analysis.nodes.get(g.a).pos, t = snapLen(s.t, g.dir, state.snap, 0);
    if (t > 0.5 && t < g.Le - 0.5) return { type: 'seg', id: g.id, pos: A.clone().addScaledVector(g.dir, t) };
    return nodeTarget(t <= 0.5 ? g.a : g.b);
  }
  const p = planePoint(q); return p ? targetAt(p) : null;
}
// Nodos y tubos existentes que la recta S + t·n atraviesa (para conectar con precisión)
function magnetTargets(start, S, n) {
  const out = [];
  for (const node of analysis.nodes.values()) {
    if (start.type === 'node' && node.id === start.id) continue;
    const v = node.pos.clone().sub(S), t = v.dot(n);
    if (t > 1 && v.addScaledVector(n, -t).length() < 0.5) out.push({ type: 'node', id: node.id, pos: node.pos.clone(), t });
  }
  for (const g of analysis.segs.values()) {
    if (start.type === 'seg' && g.id === start.id) continue;
    if (start.type === 'node' && (g.a === start.id || g.b === start.id)) continue;
    const A = analysis.nodes.get(g.a).pos, u = g.dir, b = n.dot(u), D = 1 - b * b;
    if (D < 1e-6) continue;
    const w0 = S.clone().sub(A), dd = n.dot(w0), e = u.dot(w0), t = (b * e - dd) / D, s = (e - b * dd) / D;
    if (t <= 1 || s <= 0.5 || s >= g.Le - 0.5) continue;
    const P1 = S.clone().addScaledVector(n, t), P2 = A.clone().addScaledVector(u, s);
    if (P1.distanceTo(P2) < 0.5) out.push({ type: 'seg', id: g.id, pos: P2, t });
  }
  return out;
}
const dedupeDirs = list => { const m = new Map(); for (const v of list) m.set(vkey(v), v); return [...m.values()]; };
function candidateDirs(start) {
  if (start.type === 'node') {
    const n = analysis.nodes.get(start.id);
    if (n.explicit) return n.open.map(o => o.dir.clone());
    return dedupeDirs([...DIRS18, ...n.ports.flatMap(p => localDirs(p.dir))]);
  }
  if (start.type === 'seg') return dedupeDirs([...DIRS18, ...localDirs(analysis.segs.get(start.id).dir)]);
  return DIRS18;
}
// Unión entre el punto de partida y otro tubo: tramo perpendicular a ese tubo (y al de partida si se arranca de un tubo)
function connectionBetween(an, start, segIdB) {
  const B = an.segs.get(segIdB), Bp = an.nodes.get(B.a).pos;
  let P = start.pos.clone(), startT = start, Q = null;
  if (start.type === 'seg') {
    const A = an.segs.get(start.id), Ap = an.nodes.get(A.a).pos;
    if (Math.abs(A.dir.dot(B.dir)) < 1 - 1e-6) {
      const b = A.dir.dot(B.dir), D = 1 - b * b, w0 = Ap.clone().sub(Bp), dd = A.dir.dot(w0), e = B.dir.dot(w0);
      const ta = (b * e - dd) / D, tb = (e - b * dd) / D;
      if (ta <= 0.5 || ta >= A.Le - 0.5 || tb <= 0.5 || tb >= B.Le - 0.5) return null;
      P = Ap.clone().addScaledVector(A.dir, ta); Q = Bp.clone().addScaledVector(B.dir, tb);
      startT = { type: 'seg', id: A.id, pos: P };
    }
  }
  if (!Q) {
    const tb = P.clone().sub(Bp).dot(B.dir);
    if (tb <= 0.5 || tb >= B.Le - 0.5) return null;
    Q = Bp.clone().addScaledVector(B.dir, tb);
  }
  const v = Q.clone().sub(P), len = v.length();
  if (len < 1) return null;
  return { start: startT, dir: v.divideScalar(len), len, end: { type: 'seg', id: B.id, pos: Q } };
}
function autoConnect(q, d) {
  const excl = new Set();
  if (draw.start.type === 'seg') excl.add(draw.start.id);
  if (draw.start.type === 'node') model.segmentsOf(draw.start.id).forEach(s => excl.add(s.id));
  const B = nearestSeg(q, excl, -0.4 * (esRayo(q) ? 0 : q.tol)); if (!B) return null; // hay que acercarse más que para enganchar
  const c = connectionBetween(analysis, draw.start, B.g.id); if (!c) return null;
  const trS = trial(c.start, c.dir, d), trE = trial(c.end, c.dir.clone().negate(), d);
  if (!trS.ok || !trE.ok) return null;
  return { ...c, ok: true, d, zA: trS.z, zB: trE.z, auto: B.g.id };
}
function drawMove(q) {
  draw.q = q; clearPrev();
  const d = state.d, F = model.config.fittings, dotR = F[d].od / 2 * 0.9;
  if (!draw.start) {
    const t = draw.hover = pickTarget(q);
    if (t) {
      pDot(t.pos, dotR, t.type === 'plane' ? 'ghost' : 'snap');
      previa.msg = t.label ? t.label + (t.type === 'seg' ? ' · derivar con una Te' : '')
        : t.type === 'node' ? 'Empezar desde ' + kindLabel(analysis.nodes.get(t.id)).toLowerCase() : t.type === 'seg' ? 'Derivar con una Te desde este tubo' : '';
      if (state.regla && t.type === 'plane') previa.regla = { pos: t.pos.clone(), eje: PLANES[state.wp].axis, base: state.planeOff[state.wp] };
    }
    return previa;
  }
  const S = draw.start.pos;
  pDot(S, dotR, 'snap');
  const ac = autoConnect(q, d);
  if (ac) {
    draw.cand = ac;
    pCyl(ac.start.pos, ac.dir, ac.len, d / 2); pDot(ac.start.pos, dotR, 'snap'); pDot(ac.end.pos, dotR, 'snap');
    previa.cota = { pos: ac.start.pos.clone().addScaledVector(ac.dir, ac.len / 2), texto: fmt(ac.len - ac.zA - ac.zB), sub: 'ejes ' + fmt(ac.len) };
    previa.msg = `Unión con ${ac.auto} · ejes ${fmt(ac.len)} · real ${fmt(ac.len - ac.zA - ac.zB)}`;
    return previa;
  }
  let best = null;
  const startNode = draw.start.type === 'node' ? analysis.nodes.get(draw.start.id) : null;
  for (const n of candidateDirs(draw.start)) {
    const dd = startNode?.explicit ? (startNode.open.find(o => near(o.dir.dot(n), 1))?.d ?? d) : d; // desde una boca libre, su Ø
    const tr = trial(draw.start, n, dd); if (!tr.ok) continue;
    const r = paramRecta(q, S, n); if (!r || r.t <= 0) continue;
    // con el rayo no se distingue la profundidad: a igual distancia mandan las direcciones que se ven de frente
    const dist = r.dist + (esRayo(q) ? Math.abs(n.dot(q.d)) * r.tol * 0.5 : 0);
    if (!best || dist < best.dist) best = { n, t: r.t, dist, tr, dd };
  }
  if (!best) { draw.cand = null; previa.ok = false; previa.msg = startNode?.explicit && !startNode.open.length ? 'El accesorio no tiene bocas libres' : 'Ninguna dirección válida desde aquí'; return previa; }
  const dUse = best.dd;
  let len = snapLen(best.t, best.n, state.snap);
  if (draw.fijo) { // longitud fijada por pasos (joystick): se mantiene mientras no cambie la dirección ni se aleje la mano
    if (draw.fijo.key === vkey(best.n) && Math.abs(best.t - draw.fijo.t0) < state.snap * 4) len = draw.fijo.len; else draw.fijo = null;
  }
  let end = { type: 'plane', pos: S.clone().addScaledVector(best.n, len) };
  const mags = magnetTargets(draw.start, S, best.n);
  let mag = mags.find(c => Math.abs(c.t - len) < 0.5);
  if (!mag && !draw.fijo) { let bp = 1; for (const c of mags) { const r = distPunto(q, c.pos), k = r.dist / r.tol; if (k < bp) { bp = k; mag = c; } } }
  if (mag) { end = mag; len = mag.t; }
  const endTr = end.type === 'plane' ? { ok: true, z: 0 } : trial(end, best.n.clone().negate(), dUse);
  draw.cand = { dir: best.n.clone(), len, end, ok: endTr.ok, msg: endTr.msg, d: dUse, t: best.t };
  pCyl(S, best.n, len, dUse / 2, endTr.ok ? 'ghost' : 'bad');
  pDot(end.pos, dotR, end.type === 'plane' ? 'ghost' : 'snap');
  const Lr = len - best.tr.z - endTr.z;
  previa.ok = endTr.ok;
  previa.cota = { pos: S.clone().addScaledVector(best.n, len / 2), texto: fmt(len), sub: 'real ' + fmt(Lr) };
  previa.msg = `Ø${dUse} · ejes ${fmt(len)} · real ${fmt(Lr)}${end.type !== 'plane' ? ' · conecta' : ''}${endTr.ok ? '' : ' · ✘ ' + endTr.msg}`;
  if (draw.lastLen !== null && Math.abs(len - draw.lastLen) > 1e-6) avisos.paso?.();
  draw.lastLen = len;
  return previa;
}
function addTube(st, en, d) {
  const free = t => t.type === 'node' && model.segmentsOf(t.id).length === 1 && !model.nodes.get(t.id).fit;
  const freeA = free(st), freeB = free(en);
  const resolve = t => t.type === 'plane' ? model.addNode(t.pos.toArray()) : t.type === 'node' ? t.id : model.splitSegment(t.id, t.pos.toArray());
  const a = resolve(st), b = resolve(en);
  model.addSegment(a, b, d);
  if (freeA) model.mergeThrough(a);
  if (freeB) model.mergeThrough(b);
  return b;
}
function commitDraw(c) {
  if (!c) return false;
  if (!c.ok) { status('✘ ' + c.msg); return false; }
  try {
    const d = c.d || state.d;
    const b = model.transact(c.auto ? 'Unir tubos con Tes' : 'Dibujar tubo', () => addTube(c.start || draw.start, c.end, d));
    if (d !== state.d) state.d = d;
    draw.fijo = null; draw.lastLen = null;
    if (c.end.type !== 'plane' || !model.nodes.has(b)) drawFinish(false, 'Tubo conectado');
    else { draw.start = { type: 'node', id: b, pos: v3(model.nodes.get(b).pos) }; draw.cand = null; if (draw.q) drawMove(draw.q); }
    return true;
  } catch (err) { status('✘ ' + err.message); return false; }
}
// Apretar (pellizco o gatillo): fija el punto inicial. Soltar: fija el siguiente punto; soltar sobre el punto de partida termina.
function drawPress(q) {
  drawMove(q); draw.just = false;
  if (!draw.start && draw.hover) { draw.start = draw.hover; draw.just = true; draw.lastLen = null; status('Arrastra o apunta en la dirección del tubo y suelta para fijar el punto'); drawMove(q); }
}
function drawRelease(q) {
  if (!draw.start) return;
  drawMove(q);
  const r = distPunto(q, draw.start.pos), c = draw.cand, enSitio = !c || (!c.auto && (r.dist < r.tol * 0.6 || c.len < state.snap * 0.5));
  if (enSitio) { if (!draw.just) drawFinish(); draw.just = false; return; }
  draw.just = false; commitDraw(c);
}
function drawStep(k) { // joystick: alarga o acorta por pasos de snap manteniendo la dirección
  const c = draw.cand; if (!draw.start || !c || c.auto) return;
  const cm = N.isAllowedDir(c.dir) ? Math.max(Math.abs(c.dir.x), Math.abs(c.dir.y), Math.abs(c.dir.z)) : 1; // en diagonal, el paso es el del avance por eje
  const len = snapLen(Math.max(state.snap / cm, c.len + k * state.snap / cm), c.dir, state.snap);
  draw.fijo = { key: vkey(c.dir), len, t0: c.t ?? c.len }; avisos.paso?.();
  if (draw.q) drawMove(draw.q);
}
function typedLength(v) { // longitud exacta a ejes con el teclado numérico (negativa = sentido contrario)
  const c = draw.cand;
  if (!draw.start || !c) { status('Indica primero la dirección del tubo'); return false; }
  const dir = c.dir.clone(), d = c.d || state.d;
  if (v < 0) { dir.negate(); v = -v; const tr = trial(draw.start, dir, d); if (!tr.ok) { status('✘ Dirección contraria no válida: ' + tr.msg); return false; } }
  if (!(v > 0)) return false;
  const S = draw.start.pos;
  const en = magnetTargets(draw.start, S, dir).find(x => Math.abs(x.t - v) < 0.5) || { type: 'plane', pos: S.clone().addScaledVector(dir, v) };
  const tr = en.type === 'plane' ? { ok: true } : trial(en, dir.clone().negate(), d);
  return commitDraw({ dir, len: v, end: en, ok: tr.ok, msg: tr.msg, d });
}
function drawFinish(silent, msg) {
  const was = !!draw.start;
  draw.start = null; draw.cand = null; draw.fijo = null; draw.lastLen = null; clearPrev();
  if (was && !silent) status(msg || 'Tramo terminado');
}

/* ---------------------------------------------------------------- giro por pasos con la muñeca */
// Giro de la mano (cuaternión, en ejes del proyecto) → eje que más gira de entre los dados y ángulo por pasos
function giroPorPasos(qDelta, ejes, pasoDeg) {
  const q = qDelta.w < 0 ? new THREE.Quaternion(-qDelta.x, -qDelta.y, -qDelta.z, -qDelta.w) : qDelta;
  let best = { i: -1, ang: 0 };
  ejes.forEach((a, i) => { const ang = 2 * Math.atan2(q.x * a.x + q.y * a.y + q.z * a.z, q.w); if (Math.abs(ang) > Math.abs(best.ang)) best = { i, ang }; });
  const st = THREE.MathUtils.degToRad(pasoDeg);
  return { i: best.i, bruto: best.ang, ang: Math.round(best.ang / st) * st };
}

/* ---------------------------------------------------------------- colocación de accesorios */
const placeRot = new THREE.Quaternion(), place = { target: null, ports: null, ok: false, msg: '', rot0: null, giro: null };
function libMeta(key) {
  if (!key?.startsWith('lib:')) return null;
  const [, id, vname] = key.split(':'), e = LIB.custom.get(id), v = e?.def.variants.find(x => x.name === vname);
  return v ? { type: id, name: e.def.name, variant: v.name, od: v.od } : null;
}
// Lista de accesorios que se pueden colocar: [clave, nombre]
function fitList() {
  const out = [];
  const on = k => N.builtinEnabled(k);
  if (on('elbow90')) out.push(['elbow90', 'Codo 90°']);
  if (on('elbow45')) out.push(['elbow45', 'Codo 45°']);
  if (on('tee')) out.push(['tee', 'Te 90°']);
  if (on('coupling')) out.push(['coupling', 'Manguito']);
  if (on('reducer')) for (const k of Object.keys(model.config.reducers)) out.push(['red-' + k, 'Reductor ' + k.replace('-', '×')]);
  if (on('teeReduced')) for (const k of Object.keys(model.config.teeReduced)) out.push(['ter-' + k, 'Te reducida ' + k.replace('-', '×')]);
  for (const { def } of LIB.custom.values()) for (const v of def.variants) out.push([`lib:${def.id}:${v.name}`, `${def.name} ${v.name}`]);
  return out;
}
const fitName = key => fitList().find(f => f[0] === key)?.[1] || key;
function placeMove(q) {
  clearPrev();
  const t = pickTarget(q); place.target = t;
  if (!t) return previa;
  const F = model.config.fittings, cfg = model.config;
  let dAuto = state.d;
  if (t.type === 'seg') dAuto = analysis.segs.get(t.id).d;
  else if (t.type === 'node') { const ds = new Set(analysis.nodes.get(t.id).ports.map(p => p.d)); if (ds.size === 1) dAuto = [...ds][0]; }
  const tpl = fittingTemplate(state.fit, dAuto);
  if (!tpl.length) { place.ok = false; place.msg = 'Ese accesorio no está en la biblioteca'; previa.ok = false; previa.msg = place.msg; return previa; }
  const base = PLANE_BASE[state.wp];
  const pref = tpl.map(p => cleanDir(p.dir.clone().applyQuaternion(base).applyQuaternion(placeRot)));
  let ports = null, where = '', msg = '';
  if (t.type === 'plane') ports = pref.map((dir, k) => ({ ...tpl[k], dir }));
  else if (t.type === 'seg') {
    const g = analysis.segs.get(t.id);
    where = ' · se inserta en el tubo';
    if (!tpl.some((p, i) => tpl.some((p2, j) => i < j && near(p.dir.dot(p2.dir), -1)))) msg = 'Un codo no se puede insertar en mitad de un tubo recto';
    else { ports = chooseOrientation(tpl, [{ dir: g.dir, d: g.d }, { dir: g.dir.clone().negate(), d: g.d }], pref, state.fit.startsWith('red')); if (!ports) msg = `No encaja en un tubo de Ø${g.d}`; }
  } else {
    const n = analysis.nodes.get(t.id);
    where = n.kind === 'end' ? ' · en el extremo del tubo' : n.isFitting || n.explicit ? ' · sustituye a ' + kindLabel(n).toLowerCase() : '';
    ports = chooseOrientation(tpl, n.ports.map(p => ({ dir: p.dir, d: p.d })), pref);
    if (!ports) msg = 'No encaja con los tubos de este punto';
  }
  place.ports = ports; place.ok = !!ports; place.msg = msg;
  const show = ports || pref.map((dir, k) => ({ ...tpl[k], dir }));
  const zs = portZs(show, cfg), od = libMeta(state.fit)?.od, tipo = place.ok ? (t.type === 'plane' ? 'ghost' : 'snap') : 'bad';
  show.forEach((p, i) => pCyl(t.pos, p.dir, zs[i] + (p.socket ?? F[p.d].socket), (od || F[p.d].od) / 2, tipo));
  pDot(t.pos, (od || Math.max(...show.map(p => F[p.d].od))) / 2, tipo);
  previa.ok = place.ok;
  previa.msg = fitName(state.fit) + (/^(red|ter|lib)/.test(state.fit) ? '' : ' Ø' + dAuto) + where + (place.ok ? '' : ' · ✘ ' + msg)
    + (place.giro?.ang ? ` · giro ${fmt(THREE.MathUtils.radToDeg(place.giro.ang))}° sobre ${'XYZ'[place.giro.i]}` : '');
  return previa;
}
function placeCommit() {
  if (!place.target) return false;
  if (!place.ok) { status('✘ ' + (place.msg || 'No se puede colocar aquí')); return false; }
  const id = model.transact('Colocar accesorio', () => placeFitting(model, place.target, place.ports, libMeta(state.fit) || {}));
  status(place.target.type === 'seg' ? 'Accesorio insertado: el tubo queda partido en dos' : 'Accesorio colocado · dibuja tubos desde sus bocas libres o gíralo con la muñeca');
  place.rot0 = null; place.giro = null;
  return id;
}
function placeRotate(axisName, deg) { placeRot.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[axisName], THREE.MathUtils.degToRad(deg))); }
// Mientras se sujeta el accesorio que se va a colocar, el giro de la muñeca lo gira por pasos sobre X, Y o Z
function placeTwist(qDelta) {
  place.rot0 ||= placeRot.clone();
  const g = giroPorPasos(qDelta, [AXES.x, AXES.y, AXES.z], state.angStep);
  const cambio = !place.giro || place.giro.i !== g.i || place.giro.ang !== g.ang;
  place.giro = g;
  placeRot.copy(place.rot0); if (g.ang) placeRot.premultiply(new THREE.Quaternion().setFromAxisAngle([AXES.x, AXES.y, AXES.z][g.i], g.ang));
  if (cambio && g.ang) avisos.paso?.();
  return g;
}
function placeTwistEnd() { place.rot0 = null; place.giro = null; }

/* ---------------------------------------------------------------- giro de un accesorio ya colocado */
let rot = null;
function rotBegin(nodeId) {
  const n = analysis.nodes.get(nodeId); if (!n || !(n.isFitting || n.explicit)) return false;
  rot = { nodeId, ejes: fittingAxes(model, analysis, nodeId), i: -1, ang: 0, plan: null };
  return rot.ejes.length > 0;
}
function rotPreview(nodeId, axis, angle) {
  clearPrev();
  const n = analysis.nodes.get(nodeId), F = model.config.fittings;
  const plan = planRotation(model, analysis, nodeId, axis, angle), zs = portZs(plan.ports, model.config);
  plan.ports.forEach((p, i) => pCyl(n.pos, p.dir, zs[i] + (p.socket ?? F[p.d].socket), (F[p.d]?.od ?? p.d * 1.3) / 2 * 1.05, plan.valid ? 'ghost' : 'bad'));
  for (const p of plan.detach) pCyl(n.pos.clone().addScaledVector(p.dir, p.z), p.dir, Math.min(p.len - p.z, 150), p.d / 2 * 1.3, 'bad');
  previa.eje = { pos: n.pos.clone(), dir: axis.clone() };
  return plan;
}
function rotMove(qDelta) {
  if (!rot) return null;
  const g = giroPorPasos(qDelta, rot.ejes.map(e => e.axis), state.angStep);
  if (g.i !== rot.i || g.ang !== rot.ang) { if (g.ang) avisos.paso?.(); rot.i = g.i; rot.ang = g.ang; }
  if (!rot.ang) { clearPrev(); previa.msg = `Gira la muñeca: pasos de ${state.angStep}°`; rot.plan = null; return rot; }
  rot.plan = rotPreview(rot.nodeId, rot.ejes[rot.i].axis, rot.ang);
  const k = rot.plan.detach.length;
  previa.msg = `Giro ${fmt(THREE.MathUtils.radToDeg(rot.ang))}° sobre el ${rot.ejes[rot.i].name}` + (k ? ` · se separa${k > 1 ? 'n' : ''} ${k} tubo${k > 1 ? 's' : ''}` : '');
  return rot;
}
function commitRotation(nodeId, axis, angle) {
  try {
    const k = model.transact('Girar accesorio', () => rotateFitting(model, nodeId, axis, angle));
    status(`Accesorio girado ${fmt(THREE.MathUtils.radToDeg(angle))}°` + (k ? ` · ${k} tubo${k > 1 ? 's' : ''} separado${k > 1 ? 's' : ''}` : ''));
    return true;
  } catch (err) { status('✘ ' + err.message); return false; }
}
function rotEnd(cancel = false) {
  const r = rot; rot = null; clearPrev();
  if (!r || cancel || !r.ang) return false;
  return commitRotation(r.nodeId, r.ejes[r.i].axis, r.ang);
}

/* ---------------------------------------------------------------- puntos de arrastre: estirar un tramo */
let drag = null;
// Asas de la selección: los dos extremos del tramo seleccionado, o el nodo seleccionado
function handles() {
  const s = state.selected, out = [];
  if (state.group || state.multi.size > 1 || !s) return out;
  if (s.type === 'seg') {
    const g = analysis.segs.get(s.id); if (!g || g.Le < 1e-6) return out;
    const A = analysis.nodes.get(g.a).pos, k = Math.min(g.Le * 0.25, Math.max(g.zA, g.zB) + model.config.fittings[g.d].socket + 15);
    out.push({ nodeId: g.a, segId: g.id, pos: A.clone().addScaledVector(g.dir, k), r: g.d * 0.6 });
    out.push({ nodeId: g.b, segId: g.id, pos: A.clone().addScaledVector(g.dir, g.Le - k), r: g.d * 0.6 });
  }
  return out;
}
function pickHandle(q) {
  let best = null, bd = Infinity;
  for (const h of handles()) { const r = distPunto(q, h.pos), gap = r.dist - h.r; if (gap < r.tol && gap < bd) { bd = gap; best = h; } }
  return best;
}
function stretchBegin(nodeId, segId, q) {
  const n = analysis.nodes.get(nodeId); if (!n || !n.ports.length) return false;
  drag = { nodeId, segId: null, q0: q, N0: n.pos.clone(), cands: n.ports.map(p => ({ segId: p.segId, axis: segAxis(model, p.segId, nodeId) })) };
  for (const c of drag.cands) c.t0 = paramRecta(q, drag.N0, c.axis)?.t ?? null;
  if (segId) stretchLock(segId);
  return true;
}
function stretchLock(segId) {
  const c = drag.cands.find(x => x.segId === segId), g = analysis.segs.get(segId);
  if (!c || c.t0 === null) { drag = null; return false; }
  Object.assign(drag, { segId, axis: c.axis, t0: c.t0, Le0: g.Le, lastLe: g.Le, min: minAxisLength(g),
    set: movingSet(model, segId, drag.nodeId).nodes.map(id => [id, [...model.nodes.get(id).pos]]), before: model.beginLive() });
  return true;
}
function stretchMove(q) {
  if (!drag) return null;
  if (!drag.segId) { // sin tramo elegido (se arrastra un accesorio): el eje es el del tubo que mejor sigue el movimiento
    let best = null;
    for (const c of drag.cands) { if (c.t0 === null) continue; const r = paramRecta(q, drag.N0, c.axis); if (!r) continue; const dt = Math.abs(r.t - c.t0); if (!best || dt > best.dt) best = { c, dt }; }
    if (!best || best.dt < Math.max(state.snap * 0.6, 2)) return { pendiente: true };
    if (!stretchLock(best.c.segId)) return null;
  }
  const r = paramRecta(q, drag.N0, drag.axis); if (!r) return { Le: drag.lastLe };
  let Le = snapLen(drag.Le0 + r.t - drag.t0, drag.axis, state.snap, 0);
  const atMin = Le <= drag.min; if (atMin) Le = drag.min;
  if (Math.abs(Le - drag.lastLe) > 1e-9) {
    drag.lastLe = Le; const delta = Le - drag.Le0;
    for (const [id, p] of drag.set) model.moveNode(id, [p[0] + drag.axis.x * delta, p[1] + drag.axis.y * delta, p[2] + drag.axis.z * delta]);
    model.emit(true); avisos.paso?.();
  }
  const g = analysis.segs.get(drag.segId);
  clearPrev();
  if (g) { previa.cota = { pos: analysis.nodes.get(g.a).pos.clone().addScaledVector(g.dir, g.Le / 2), texto: fmt(g.Le), sub: 'real ' + fmt(g.Lr) }; previa.msg = `ejes ${fmt(g.Le)} · real ${fmt(g.Lr)}${atMin ? ' · mínimo: accesorios en contacto' : ''}`; }
  return { Le, atMin, segId: drag.segId };
}
function stretchEnd(cancel = false) {
  const d = drag; drag = null; clearPrev();
  if (!d || !d.segId) return false;
  if (cancel || Math.abs(d.lastLe - d.Le0) < 1e-9) { model.cancelLive(d.before); return false; }
  model.commitLive(d.before, 'Estirar tubo'); status(`Tramo ${d.segId}: ${fmt(d.Le0)} → ${fmt(d.lastLe)} mm a ejes`);
  return true;
}

/* ---------------------------------------------------------------- selección, grupos y operaciones de conjunto */
const selKey = p => p.type + ':' + p.id;
const groupOfPick = p => p.type === 'seg' ? model.groupWithSeg(p.id) : model.groupWithNode(p.id);
const groupPicks = g => [...g.segs.map(id => ({ type: 'seg', id })), ...g.nodes.filter(id => { const n = analysis.nodes.get(id); return n && (n.isFitting || n.explicit); }).map(id => ({ type: 'node', id }))];
function setSelection(picks, primary = null, group = null) {
  state.multi = new Map(picks.map(p => [selKey(p), p]));
  state.selected = primary || (picks.length === 1 ? picks[0] : null); state.group = group;
  avisos.seleccion?.();
}
// Seleccionar: al tocar un miembro de un grupo se selecciona el grupo; add = selección múltiple
function select(pick, { add = false, single = false } = {}) {
  if (!pick) { setSelection([]); return; }
  const g = !single && groupOfPick(pick);
  if (add) {
    const picks = g ? groupPicks(g) : [pick], m = new Map(state.multi);
    const all = picks.every(p => m.has(selKey(p)));
    for (const p of picks) { if (all) m.delete(selKey(p)); else m.set(selKey(p), p); }
    setSelection([...m.values()]); return;
  }
  if (g) setSelection(groupPicks(g), null, g.id); else setSelection([pick], pick);
}
function selectedIds() {
  const segs = [], nodes = [];
  for (const p of state.multi.values()) (p.type === 'seg' ? segs : nodes).push(p.id);
  return { segs, nodes };
}
function selectedGroups() {
  const ids = new Set(state.group ? [state.group] : []);
  for (const p of state.multi.values()) { const g = groupOfPick(p); if (g) ids.add(g.id); }
  return [...ids].filter(id => model.groups.has(id));
}
function selectAll() {
  setSelection([...[...analysis.segs.keys()].map(id => ({ type: 'seg', id })), ...[...analysis.nodes.values()].filter(n => n.isFitting || n.explicit).map(n => ({ type: 'node', id: n.id }))]);
  status(`${state.multi.size} elementos seleccionados`);
}
function groupSelection() {
  const { segs, nodes } = selectedIds();
  if (segs.length + nodes.length < 2) { status('Selecciona al menos dos elementos para agrupar'); return null; }
  const all = new Set(nodes); for (const id of segs) { const s = model.segments.get(id); all.add(s.a); all.add(s.b); }
  const gid = model.transact('Agrupar', () => model.addGroup([...all], segs));
  const g = model.groups.get(gid); setSelection(groupPicks(g), null, gid);
  status(`${g.name} creado: ${g.segs.length} tubos · agárralo para moverlo o girarlo`);
  return gid;
}
function ungroupSelection(ids = selectedGroups()) {
  if (!ids.length) { status('Selecciona un grupo (o una pieza de él) para desagruparlo'); return false; }
  const names = ids.map(id => model.groups.get(id).name), picks = [...state.multi.values()];
  model.transact(ids.length > 1 ? 'Desagrupar grupos' : 'Desagrupar', () => { for (const id of ids) model.groups.delete(id); });
  setSelection(picks); status(`${names.join(', ')} desagrupado${ids.length > 1 ? 's' : ''}`);
  return true;
}
const oneGroup = () => state.group || (selectedGroups().length === 1 ? selectedGroups()[0] : null);
// Espejo del grupo: 'h' = plano horizontal (invierte Z); 'v' = plano vertical de frente al usuario (X o Y según hacia dónde mira)
function mirrorSelection(kind, viewDir = V(0, -1, 0)) {
  const gid = oneGroup(); if (!gid) { status('Selecciona un grupo para aplicarle el espejo'); return false; }
  let axis = 'z';
  if (kind === 'v') { const right = V(0, 0, 1).cross(viewDir); axis = Math.abs(right.x) >= Math.abs(right.y) ? 'x' : 'y'; }
  const k = model.transact(kind === 'h' ? 'Espejo horizontal' : 'Espejo vertical', () => mirrorGroup(model, gid, axis));
  const g = model.groups.get(gid); setSelection(groupPicks(g), null, gid);
  status(`${g.name}: espejo ${kind === 'h' ? 'horizontal (invierte Z)' : 'vertical (invierte ' + axis.toUpperCase() + ')'}` + (k ? ` · ${k} tubo${k > 1 ? 's' : ''} externo${k > 1 ? 's' : ''} separado${k > 1 ? 's' : ''}` : ''));
  return true;
}
function deleteSelection() {
  if (state.multi.size > 1) {
    const { segs, nodes } = selectedIds();
    model.transact('Borrar selección', () => {
      for (const id of segs) if (model.segments.has(id)) model.removeSegment(id);
      for (const id of nodes) { if (!model.nodes.has(id)) continue; const n = analyze(model).nodes.get(id); if (n.ports.length) deleteFitting(model, id); else model.nodes.delete(id); }
    });
    status(`${segs.length} tubo${segs.length === 1 ? '' : 's'} y los accesorios seleccionados borrados`);
    setSelection([]); return true;
  }
  const s = state.selected; if (!s) { status('No hay nada seleccionado'); return false; }
  const n = s.type === 'node' && analysis.nodes.get(s.id), isEnd = n && n.kind === 'end' && !n.explicit;
  model.transact('Borrar', () => {
    let touched = [];
    if (s.type === 'seg') { const g = model.segments.get(s.id); touched = [g.a, g.b]; model.removeSegment(s.id); }
    else if (isEnd) { touched = model.segmentsOf(s.id).map(g => g.a === s.id ? g.b : g.a); model.removeNode(s.id); }
    else if (n.ports.length) deleteFitting(model, s.id); else model.nodes.delete(s.id);
    for (const id of touched) if (model.nodes.has(id)) model.mergeThrough(id);
  });
  setSelection([]);
  status(s.type === 'seg' || isEnd ? 'Tubo borrado' : 'Accesorio borrado; sus tubos quedan sueltos');
  return true;
}
// ---- mover, girar y duplicar grupos agarrándolos con la mano
let grp = null;
function grpCenter(ids) { return nodesBox(model, ids).getCenter(V(0, 0, 0)); }
function grpAnchor(q, center) { // punto de agarre: la mano o, con rayo, el corte con el plano paralelo al de trabajo que pasa por el centro
  if (!esRayo(q)) return q.p.clone();
  const ax = PLANES[state.wp].axis; if (Math.abs(q.d[ax]) < 1e-4) return null;
  const t = (center[ax] - q.o[ax]) / q.d[ax]; return t > 0 ? q.o.clone().addScaledVector(q.d, t) : null;
}
function grpBegin(gid, q) {
  const g0 = model.groups.get(gid); if (!g0) return false;
  const before = model.beginLive(), detached = isolateGroup(model, gid), g = model.groups.get(gid);
  const center = grpCenter(g.nodes), p0 = grpAnchor(q, center);
  if (!p0) { model.cancelLive(before); return false; }
  grp = { gid, before, detached, orig: snapshotNodes(model, g.nodes), center, p0, changed: false, label: 'Mover grupo', dv: V(0, 0, 0), ang: 0, eje: -1 };
  if (detached) model.emit(true);
  return true;
}
function grpMove(q, qDelta = null) {
  const o = grp; if (!o) return null;
  const p = grpAnchor(q, o.center); if (!p) return o;
  const dv = p.sub(o.p0); for (const k of ['x', 'y', 'z']) dv[k] = grid(dv[k]);
  if (state.mover === 'plano' || esRayo(q)) dv[PLANES[state.wp].axis] = 0;
  else if (state.mover === 'eje') { const m = Math.max(Math.abs(dv.x), Math.abs(dv.y), Math.abs(dv.z)); for (const k of ['x', 'y', 'z']) if (Math.abs(dv[k]) < m) dv[k] = 0; }
  let ang = 0, eje = -1;
  if (qDelta) { const g = giroPorPasos(qDelta, [AXES.x, AXES.y, AXES.z], state.angStep); ang = g.ang; eje = g.i; }
  if (dv.equals(o.dv) && ang === o.ang && eje === o.eje) return o;
  o.dv = dv; o.ang = ang; o.eje = eje; o.changed = dv.lengthSq() > 0 || ang !== 0;
  const c = o.center, M = new THREE.Matrix4().makeTranslation(dv.x, dv.y, dv.z);
  if (ang) M.multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)).multiply(new THREE.Matrix4().makeRotationAxis([AXES.x, AXES.y, AXES.z][eje], ang)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  transformNodes(model, o.orig, M); model.emit(true); avisos.paso?.();
  clearPrev();
  const parts = ['x', 'y', 'z'].filter(k => dv[k]).map(k => `Δ${k.toUpperCase()} ${dv[k] > 0 ? '+' : '−'}${fmt(Math.abs(dv[k]))}`);
  previa.msg = (parts.join(' · ') || 'Sin desplazamiento') + (ang ? ` · giro ${fmt(THREE.MathUtils.radToDeg(ang))}° sobre ${'XYZ'[eje]}` : '');
  previa.cota = { pos: c.clone().add(dv), texto: parts.join(' ') || '0', sub: ang ? fmt(THREE.MathUtils.radToDeg(ang)) + '°' : '' };
  return o;
}
function grpEnd(cancel = false) {
  const o = grp; grp = null; clearPrev();
  if (!o) return false;
  if (cancel || !o.changed) { model.cancelLive(o.before); if (o.copia && !cancel) status('La copia no se ha movido: duplicado cancelado'); return false; }
  model.commitLive(o.before, o.label);
  status((o.copia ? 'Copia colocada' : o.ang ? 'Grupo girado' : 'Grupo movido') + (o.detached ? ` · ${o.detached} tubo${o.detached > 1 ? 's' : ''} separado${o.detached > 1 ? 's' : ''}` : ''));
  return true;
}
// Duplicar: la copia queda agrupada y «en la mano»; se suelta donde se quiera (grpMove / grpEnd)
function dupBegin(q) {
  const { segs, nodes } = selectedIds();
  if (!segs.length && !nodes.length) { status('Selecciona lo que quieres duplicar'); return false; }
  const src = state.group && model.groups.get(state.group), before = model.beginLive();
  const r = duplicateItems(model, nodes, segs, V(0, 0, 0));
  const gid = model.addGroup(r.nodes, r.segs, src ? `${src.name} (copia)` : `Copia ${model.groups.size + 1}`), g = model.groups.get(gid);
  const center = grpCenter(g.nodes), p0 = grpAnchor(q, center);
  if (!p0) { model.cancelLive(before); return false; }
  grp = { gid, before, detached: 0, orig: snapshotNodes(model, g.nodes), center, p0, changed: false, label: 'Duplicar', copia: true, dv: V(0, 0, 0), ang: 0, eje: -1 };
  model.emit(true); setSelection(groupPicks(g), null, gid);
  status('Copia en la mano: muévela y pellizca para soltarla');
  return gid;
}
function duplicateAt(offset) { // duplicar con un desplazamiento exacto (sin gestos)
  const { segs, nodes } = selectedIds();
  if (!segs.length && !nodes.length) { status('Selecciona lo que quieres duplicar'); return null; }
  const src = state.group && model.groups.get(state.group);
  const gid = model.transact('Duplicar', () => { const r = duplicateItems(model, nodes, segs, offset); return model.addGroup(r.nodes, r.segs, src ? `${src.name} (copia)` : `Copia ${model.groups.size + 1}`); });
  const g = model.groups.get(gid); setSelection(groupPicks(g), null, gid);
  return gid;
}

/* ---------------------------------------------------------------- propiedades y órdenes sobre la selección */
function setSegD(id, d) { model.transact('Cambiar diámetro', () => { model.segments.get(id).d = d; }); status(`Tramo ${id} cambiado a Ø${d}`); }
function moveEndOf(g) {
  const A = analysis.nodes.get(g.a), B = analysis.nodes.get(g.b);
  if (!state.moveEnd || state.moveEnd.seg !== g.id) state.moveEnd = { seg: g.id, end: (A.kind === 'end' && B.kind !== 'end') ? 'a' : 'b' };
  return state.moveEnd.end;
}
function setSegLength(id, value, real = false) { // medida a ejes (o longitud real) de un tramo
  const g = analysis.segs.get(id); if (!g || !isFinite(value)) { status('✘ Valor no válido'); return false; }
  const Le = real ? value + g.zA + g.zB : value;
  try {
    model.transact('Cambiar medida', () => setSegmentLength(model, id, Le, moveEndOf(g) === 'a' ? g.a : g.b));
    const ng = analysis.segs.get(id); status(`Tramo ${id}: ejes ${fmt(ng.Le)} mm · real ${fmt(ng.Lr)} mm`);
    return true;
  } catch (err) { status('✘ ' + err.message); return false; }
}
function joinFirst(segId) {
  const js = joinCandidates(model, segId); if (!js.length) { status('No hay ningún tubo alineado con el que unirlo'); return false; }
  try { model.transact('Unir tubos', () => joinSegments(model, segId, js[0].id)); select({ type: 'seg', id: segId }, { single: true }); status(`Tubos unidos en ${segId}`); return true; }
  catch (err) { status('✘ ' + err.message); return false; }
}
function joinNode(nodeId) {
  const ss = model.segmentsOf(nodeId); if (ss.length !== 2 || !joinPlan(model, ss[0], ss[1])) { status('Ese accesorio no une dos tubos alineados'); return false; }
  try { const id = model.transact('Unir tubos', () => joinSegments(model, ss[0].id, ss[1].id)); select({ type: 'seg', id }); status('Manguito quitado: tubos unidos'); return true; }
  catch (err) { status('✘ ' + err.message); return false; }
}
function connect(item) {
  try {
    const how = model.transact('Conectar extremo', () => connectLoose(model, item.segId, item.endId, item.nodeId));
    select({ type: 'seg', id: item.segId });
    status(`${item.segId} conectado a ${item.nodeId}` + (how === 'move' ? ' (el accesorio se ha desplazado hasta el cruce)' : ''));
    return true;
  } catch (err) { status('✘ ' + err.message); return false; }
}
function splitLong(ids) {
  const k = model.transact('Dividir tramos largos', () => ids.reduce((x, id) => x + splitLongSegment(model, id), 0));
  status(`${k} manguito${k === 1 ? '' : 's'} añadido${k === 1 ? '' : 's'}`); return k;
}
const dirName = v => { const ax = [['X', v.x], ['Y', v.y], ['Z', v.z]].filter(([, c]) => Math.abs(c) > 1e-3); return ax.map(([k, c]) => (c > 0 ? '+' : '−') + k).join(''); };
// Datos de la selección para el panel de propiedades
function props() {
  if (state.group || state.multi.size > 1) {
    const { segs, nodes } = selectedIds(), g = state.group && model.groups.get(state.group);
    return { tipo: 'multi', nombre: g ? g.name : `${state.multi.size} elementos`, segs: segs.length, nodes: nodes.length, grupo: !!g, grupos: selectedGroups().length };
  }
  const s = state.selected; if (!s) return { tipo: 'nada', grupos: [...model.groups.values()].map(g => ({ id: g.id, name: g.name, n: g.segs.length })) };
  if (s.type === 'seg') {
    const g = analysis.segs.get(s.id); if (!g) return { tipo: 'nada', grupos: [] };
    const A = analysis.nodes.get(g.a), B = analysis.nodes.get(g.b);
    return { tipo: 'seg', id: g.id, d: g.d, Le: g.Le, Lr: g.Lr, zA: g.zA, zB: g.zB, free: g.free, min: minAxisLength(g), dir: dirName(g.dir), extA: kindLabel(A), extB: kindLabel(B),
      mueve: moveEndOf(g), marca: state.cut?.marks.get(g.id) || '—', errors: g.errors, warnings: g.warnings, loose: g.loose || null, largo: g.Lr > model.config.barLength, unir: joinCandidates(model, g.id) };
  }
  const n = analysis.nodes.get(s.id); if (!n) return { tipo: 'nada', grupos: [] };
  const ss = model.segmentsOf(n.id), isFit = n.isFitting || n.explicit;
  return { tipo: 'node', id: n.id, nombre: kindLabel(n), pos: n.pos, esAccesorio: isFit, errors: n.errors,
    bocas: [...n.ports.map(p => ({ tramo: p.segId, d: p.d, z: p.z, socket: p.socket, dir: dirName(p.dir) })), ...n.open.map(p => ({ tramo: 'libre', d: p.d, z: p.z, socket: p.socket, dir: dirName(p.dir) }))],
    ejes: isFit ? fittingAxes(model, analysis, n.id) : [], unir: ss.length === 2 && !!joinPlan(model, ss[0], ss[1]) };
}
// Errores y avisos del proyecto, cada uno con la pieza a la que se refiere
function issues() {
  const out = [];
  for (const s of analysis.segs.values()) for (const t of s.errors) out.push({ cls: 'err', t, pick: { type: 'seg', id: s.id } });
  for (const n of analysis.nodes.values()) for (const t of n.errors) out.push({ cls: 'err', t, pick: { type: 'node', id: n.id } });
  for (const s of analysis.segs.values()) for (const t of s.warnings) out.push({ cls: 'warn', t, pick: { type: 'seg', id: s.id }, loose: s.loose && t.startsWith('Extremo suelto') ? s.loose : null });
  return out;
}
function setTool(t) { drawFinish(true); stretchEnd(true); rotEnd(true); if (grp) grpEnd(true); placeTwistEnd(); state.tool = t; clearPrev(); avisos.seleccion?.(); }
function setSnap(v) { state.snap = v; }
function setPlane(key, off) { if (PLANES[key]) state.wp = key; if (off !== undefined && isFinite(off)) state.planeOff[state.wp] = off; }
function undo() { const l = model.undo(); status(l ? `Deshecho: ${l}` : 'Nada que deshacer'); return l; }
function redo() { const l = model.redo(); status(l ? `Rehecho: ${l}` : 'Nada que rehacer'); return l; }

model.on((m, live) => {
  analysis = analyze(model); snapCache = null;
  if (!live) state.cut = computeCutlist(model, analysis);
  const exists = p => p.type === 'seg' ? analysis.segs.has(p.id) : analysis.nodes.has(p.id);
  if (state.selected && !exists(state.selected)) state.selected = null;
  for (const [k, p] of state.multi) if (!exists(p)) state.multi.delete(k);
  if (state.group) { const g = model.groups.get(state.group); if (!g) state.group = null; else state.multi = new Map(groupPicks(g).map(p => [selKey(p), p])); }
  if (!live) {
    if (draw.start?.type === 'node' && !model.nodes.has(draw.start.id)) drawFinish(true);
    if (draw.start?.type === 'seg' && !model.segments.has(draw.start.id)) drawFinish(true);
  }
  avisos.cambio?.(live);
});

return {
  state, previa, PLANES, SNAPS, AXES, get analysis() { return analysis; }, get draw() { return draw; }, get place() { return place; }, get rot() { return rot; },
  get drag() { return drag; }, get grp() { return grp; }, placeRot,
  distPunto, paramRecta, distTramo, planePoint, nearestSeg, pickAny, pickTarget, nearestSnap, snapPoints, targetAt, trial, connectionBetween,
  drawMove, drawPress, drawRelease, drawStep, typedLength, drawFinish, commitDraw,
  giroPorPasos, fitList, fitName, placeMove, placeCommit, placeRotate, placeTwist, placeTwistEnd,
  rotBegin, rotMove, rotEnd, commitRotation, handles, pickHandle, stretchBegin, stretchMove, stretchEnd,
  select, setSelection, selectedIds, selectedGroups, selectAll, groupSelection, ungroupSelection, oneGroup, mirrorSelection, deleteSelection,
  grpBegin, grpMove, grpEnd, dupBegin, duplicateAt, setSegD, setSegLength, joinFirst, joinNode, connect, splitLong, props, issues, dirName,
  setTool, setSnap, setPlane, undo, redo, clearPrev, groupPicks,
};
};
})(globalThis);
