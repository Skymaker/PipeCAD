// PipeCAD · construcción de la estructura en 3D (compartido por ra.html y vr.html)
//   ensamblar()    una sola pieza de mallas unidas por material, en metros y apoyada en el suelo, más la lista de formas
//                  simples para la física (visor RA y «Probar con gravedad» en VR)
//   crearVista()   vista editable en mm del proyecto para VR: tubos y accesorios de serie con InstancedMesh (un cilindro
//                  unitario escalado), color por instancia para la selección y los avisos, y mallas sueltas para los STL
// Script clásico con fábrica. Uso:  const esc = crearEscenaXR(THREE, nucleo, { seg, mergeGeometries })
(function (global) {
'use strict';
global.crearEscenaXR = function (THREE, N, opts = {}) {
const { customGeometry, localToWorldQuat, fmt } = N;
const SEG = opts.seg || 32, MM = 0.001;
const PVC_DENSITY = 1400;                               // kg/m³
const WALL = { 20: 1.5, 32: 2.4, 40: 3.0 };             // pared del tubo PVC presión (mm), para el peso
const Y = new THREE.Vector3(0, 1, 0);
const SIN_PIEZA = ['end', 'invalid', 'isolated'];
// Cilindro en mm entre dos distancias a lo largo de dir, como geometría sin índice y solo con posición y normal
function cylGeo(origin, dir, from, to, r) {
  const g = new THREE.CylinderGeometry(r, r, to - from, SEG, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir));
  g.translate(...origin.clone().addScaledVector(dir, (from + to) / 2).toArray());
  return clean(g);
}
function ballGeo(c, r) { const g = new THREE.SphereGeometry(r, SEG, Math.round(SEG / 2)); g.translate(c.x, c.y, c.z); return clean(g); }
function clean(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); if (!n.attributes.normal) n.computeVertexNormals(); return n; }

// Geometrías por material (mm del proyecto), formas para la física, rótulos de longitud y masa
function geometria(model, an) {
  const F = model.config.fittings;
  const byMat = { tube20: [], tube32: [], tube40: [], fitting: [] }, shapes = [], labelsData = [];
  let mass = 0;
  // Tubos: del tope de una embocadura al de la otra (longitud real de corte)
  for (const s of an.segs.values()) {
    if (s.Le < 1e-6 || s.Lr <= 0) continue;
    const A = an.nodes.get(s.a).pos, r = s.d / 2;
    byMat['tube' + s.d]?.push(cylGeo(A, s.dir, s.zA, s.zA + s.Lr, r));
    const a = A.clone().addScaledVector(s.dir, s.zA), b = A.clone().addScaledVector(s.dir, s.zA + s.Lr);
    const t = WALL[s.d] ?? s.d * 0.075, m = PVC_DENSITY * Math.PI * (r * r - (r - t) * (r - t)) * s.Lr * 1e-9;
    shapes.push({ type: 'cyl', a, b, r, mass: m });
    mass += m;
    labelsData.push({ p: a.clone().add(b).multiplyScalar(0.5), r, text: fmt(s.Lr, 0) });
  }
  // Accesorios
  for (const n of an.nodes.values()) {
    if (SIN_PIEZA.includes(n.kind)) continue;
    const ports = [...n.ports, ...n.open], first = shapes.length;
    let rMax = 0, vol = 0;
    if (n.kind === 'custom') {
      const g = clean(customGeometry(n).clone());
      g.applyQuaternion(localToWorldQuat(ports.filter(p => p.local).map(p => ({ local: p.local, world: p.dir }))));
      g.translate(n.pos.x, n.pos.y, n.pos.z);
      byMat.fitting.push(g);
    }
    for (const p of ports) {
      const R = (F[p.d]?.od ?? n.od ?? p.d * 1.3) / 2; rMax = Math.max(rMax, R);
      if (n.kind !== 'custom') {
        if (p.z > 0) byMat.fitting.push(cylGeo(n.pos, p.dir, 0, p.z, R * 0.94));
        byMat.fitting.push(cylGeo(n.pos, p.dir, p.z, p.z + p.socket, R));
      }
      shapes.push({ type: 'cyl', a: n.pos.clone(), b: n.pos.clone().addScaledVector(p.dir, p.z + p.socket), r: R });
      vol += Math.PI * (R * R - (p.d / 2) ** 2) * p.socket + Math.PI * (R * 0.94) ** 2 * p.z * 0.35; // embocadura hueca + cuerpo
    }
    const branched = ports.some(a => ports.some(b => Math.abs(a.dir.dot(b.dir)) < 1 - 1e-6));
    if (branched) { if (n.kind !== 'custom') byMat.fitting.push(ballGeo(n.pos, rMax * 0.94)); shapes.push({ type: 'ball', c: n.pos.clone(), r: rMax * 0.94 }); vol += 4 / 3 * Math.PI * rMax ** 3 * 0.35; }
    const m = PVC_DENSITY * vol * 1e-9, k = shapes.length - first;
    for (let i = first; i < shapes.length; i++) shapes[i].mass = m / k; // la masa del accesorio, repartida entre sus formas
    mass += m;
  }
  return { byMat, shapes, labelsData, mass };
}
// Monta la estructura en «assembly» (metros, Y vertical, apoyada en el suelo y centrada en planta).
// Devuelve { size, mass, toWorld, shapes, labelsData, triangles } o null si no hay nada que dibujar.
function ensamblar(model, an, mats, assembly, mergeGeometries = opts.mergeGeometries) {
  for (const c of [...assembly.children]) { assembly.remove(c); c.geometry?.dispose(); }
  const { byMat, shapes, labelsData, mass } = geometria(model, an);
  // mm (Z vertical) → metros (Y vertical): giro de −90° sobre X y escala 0,001
  const toM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(MM, MM, MM));
  const box = new THREE.Box3();
  for (const [k, list] of Object.entries(byMat)) {
    if (!list.length) continue;
    const g = mergeGeometries(list, false); list.forEach(x => x.dispose());
    g.applyMatrix4(toM); g.computeBoundingBox(); box.union(g.boundingBox);
    const m = new THREE.Mesh(g, mats[k]); m.castShadow = true; m.receiveShadow = true; assembly.add(m);
  }
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Vector3(-c.x, -box.min.y, -c.z);
  for (const m of assembly.children) m.geometry.translate(shift.x, shift.y, shift.z);
  return {
    size: box.getSize(new THREE.Vector3()), mass, shapes, labelsData,
    toWorld: toM.clone().premultiply(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z)), // mm del proyecto → metros de la escena
    triangles: assembly.children.reduce((t, m) => t + m.geometry.attributes.position.count / 3, 0),
  };
}

/* ---------------------------------------------------------------- vista editable con instancias (VR) */
function crearVista(v = {}) {
  const segs = v.seg || 20;
  const grupo = new THREE.Group(); grupo.name = 'estructura';
  const cyl = new THREE.CylinderGeometry(1, 1, 1, segs, 1, false); cyl.translate(0, 0.5, 0); // de y = 0 a y = 1
  const bola = new THREE.SphereGeometry(1, segs, Math.round(segs / 2));
  const matT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const matF = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const matSTL = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  const col = { 20: new THREE.Color('#4f9fd6'), 32: new THREE.Color('#8e99a5'), 40: new THREE.Color('#d4954a'), fitting: new THREE.Color('#d9dde2'),
    sel: new THREE.Color('#ffd166'), hover: new THREE.Color('#9cc4ff'), err: new THREE.Color('#e5484d'), warn: new THREE.Color('#e8a33a'), gris: new THREE.Color('#b9bec5') };
  const capas = {};
  function capa(nombre, geo, mat, n) { // InstancedMesh con capacidad que crece a potencias de 2
    let m = capas[nombre];
    if (!m || m.userData.cap < n) {
      if (m) { grupo.remove(m); m.dispose(); }
      const cap = Math.max(64, 2 ** Math.ceil(Math.log2(n + 1)));
      m = capas[nombre] = new THREE.InstancedMesh(geo, mat, cap);
      m.userData.cap = cap; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.name = nombre;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); grupo.add(m);
    }
    return m;
  }
  const stl = new THREE.Group(); grupo.add(stl);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const stats = { tubos: 0, accesorios: 0, instancias: 0, triangulos: 0 };
  // est = { sel: Map|Set de 'seg:id' / 'node:id', hover: clave, avisos: Map clave → 'err' | 'warn', porDiametro: bool }
  function actualizar(model, an, est = {}) {
    const F = model.config.fittings, sel = est.sel || new Set(), avisos = est.avisos || new Map();
    const tinte = (key, base) => sel.has(key) ? col.sel : est.hover === key ? col.hover : avisos.get(key) === 'err' ? col.err : avisos.get(key) === 'warn' ? col.warn : base;
    // tubos
    const ts = [...an.segs.values()].filter(g => g.Le > 1e-6 && g.Lr > 0), T = capa('tubos', cyl, matT, ts.length);
    ts.forEach((g, i) => {
      q.setFromUnitVectors(Y, g.dir); p.copy(an.nodes.get(g.a).pos).addScaledVector(g.dir, g.zA);
      T.setMatrixAt(i, M.compose(p, q, s.set(g.d / 2, g.Lr, g.d / 2)));
      T.setColorAt(i, tinte('seg:' + g.id, est.porDiametro === false ? col.gris : col[g.d] || col.gris));
    });
    T.count = ts.length; T.userData.ids = ts.map(g => g.id);
    // accesorios de serie: cuerpo y embocadura de cada boca (cilindros) y bola central si ramifica
    const cs = [], bs = [];
    for (const k of [...stl.children]) stl.remove(k);
    let nAcc = 0;
    for (const n of an.nodes.values()) {
      const key = 'node:' + n.id;
      if (n.kind === 'invalid') { bs.push({ pos: n.pos, r: (F[n.d]?.od ?? n.d * 1.3) / 2 * 1.1, c: sel.has(key) ? col.sel : col.err }); continue; }
      if (SIN_PIEZA.includes(n.kind)) { if (sel.has(key) && n.kind === 'end') bs.push({ pos: n.pos, r: n.d * 0.75, c: col.sel }); continue; }
      nAcc++;
      const ports = [...n.ports, ...n.open], color = tinte(key, n.errors.length ? col.err : col.fitting);
      if (n.kind === 'custom') {
        const m = new THREE.Mesh(customGeometry(n), matSTL.clone()); m.material.color.copy(color);
        m.quaternion.copy(localToWorldQuat(ports.filter(x => x.local).map(x => ({ local: x.local, world: x.dir })))); m.position.copy(n.pos);
        m.castShadow = true; m.userData.nodeId = n.id; stl.add(m); continue;
      }
      let rMax = 0;
      for (const x of ports) {
        const R = (F[x.d]?.od ?? n.od ?? x.d * 1.3) / 2; rMax = Math.max(rMax, R);
        if (x.z > 0) cs.push({ pos: n.pos, dir: x.dir, from: 0, len: x.z, r: R * 0.94, c: color });
        cs.push({ pos: n.pos, dir: x.dir, from: x.z, len: x.socket, r: R, c: x.segId || !n.open.includes(x) ? color : c.copy(color).multiplyScalar(0.8).clone() });
      }
      if (ports.some(a => ports.some(b => Math.abs(a.dir.dot(b.dir)) < 1 - 1e-6))) bs.push({ pos: n.pos, r: rMax * 0.94, c: color });
    }
    const C = capa('accesorios', cyl, matF, cs.length);
    cs.forEach((x, i) => { q.setFromUnitVectors(Y, x.dir); p.copy(x.pos).addScaledVector(x.dir, x.from); C.setMatrixAt(i, M.compose(p, q, s.set(x.r, x.len, x.r))); C.setColorAt(i, x.c); });
    C.count = cs.length;
    const Bm = capa('bolas', bola, matF, bs.length);
    bs.forEach((x, i) => { Bm.setMatrixAt(i, M.compose(x.pos, q.identity(), s.setScalar(x.r))); Bm.setColorAt(i, x.c); });
    Bm.count = bs.length;
    for (const m of [T, C, Bm]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    stats.tubos = ts.length; stats.accesorios = nAcc; stats.instancias = ts.length + cs.length + bs.length;
    stats.triangulos = (ts.length + cs.length) * segs * 4 + bs.length * segs * (Math.round(segs / 2) - 1) * 2;
  }
  // Caja en mm de todo el proyecto (para colocar la maqueta y avisar si no cabe en la sala)
  function caja(an) {
    const b = new THREE.Box3();
    for (const n of an.nodes.values()) b.expandByPoint(n.pos);
    return b.isEmpty() ? b.set(new THREE.Vector3(-1000, -1000, -30), new THREE.Vector3(1000, 1000, 500)) : b.expandByScalar(30); // proyecto vacío: 2 × 2 m de mesa de trabajo
  }
  return { grupo, actualizar, caja, col, stats, matT, matF };
}
return { cylGeo, ballGeo, clean, geometria, ensamblar, crearVista, PVC_DENSITY, WALL, MM };
};
})(globalThis);
