// PipeCAD · núcleo compartido (index.html, ra.html)
// Catálogo, modelo de datos (grafo de nodos y tramos) con deshacer, motor de accesorios, accesorios declarados,
// lenguaje .pcf, STL, operaciones de estirado, despiece, biblioteca, carpeta de modelos y proyecto de ejemplo.
// Es un script clásico (no un módulo) para que PipeCAD funcione también abierto como archivo, sin servidor.
// Uso:  const nucleo = crearNucleoPipeCAD(THREE, avisos);
//   avisos.stlLoaded(ruta)   se ha descargado un STL de la carpeta modelos (para redibujar)
//   avisos.modelsChanged()   se ha releído el catálogo de modelos (para refrescar la interfaz)
(function (global) {
'use strict';
global.crearNucleoPipeCAD = function (THREE, hooks = {}) {
/* =====================================================================
   CATÁLOGO
   ===================================================================== */
const DIAMETERS = [20, 32, 40];
// Cotas orientativas PVC presión encolar (mm). Z = centro del accesorio → tope de embocadura.
const DEFAULT_CONFIG = {
  barLength: 3000,   // longitud de barra
  kerf: 2,           // material perdido por corte
  minFree: 10,       // tubo visto mínimo entre accesorios
  fittings: {
    20: { socket: 16, od: 27, elbow90: 11, elbow45: 5,  tee: 11, coupling: 2 },
    32: { socket: 22, od: 41, elbow90: 17, elbow45: 8,  tee: 17, coupling: 2 },
    40: { socket: 26, od: 50, elbow90: 21, elbow45: 10, tee: 21, coupling: 2 },
  },
  reducers:   { '32-20': { big: 3, small: 10 }, '40-20': { big: 3, small: 14 }, '40-32': { big: 3, small: 6 } },
  teeReduced: { '32-20': { run: 17, branch: 19 }, '40-20': { run: 21, branch: 23 }, '40-32': { run: 21, branch: 22 } },
};
const KIND_NAMES = {
  end: 'Extremo libre', elbow90: 'Codo 90°', elbow45: 'Codo 45°', tee: 'Te 90°', teeReduced: 'Te reducida',
  coupling: 'Manguito', reducer: 'Manguito reductor', invalid: 'Unión no válida', isolated: 'Nodo aislado',
};
const BUILTIN_KINDS = ['elbow90', 'elbow45', 'tee', 'teeReduced', 'coupling', 'reducer'];
const FITTING_KINDS = [...BUILTIN_KINDS, 'custom'];
// Biblioteca de accesorios: los de serie se pueden quitar y volver a cargar; los personalizados se
// cargan desde archivos .pcf (+ .stl opcional) y se quitan individualmente.
// LIB.all: todos los personalizados conocidos · id → { def, source, origin: 'carpeta' | 'navegador', files?: entrada del catálogo, stl?: {variante: {name, b64}} }
// LIB.custom: los activos (los que reconoce el cálculo) · LIB.disabled: ids de serie o de la carpeta desactivados
const LIB = { disabled: new Set(), custom: new Map(), all: new Map() };
const builtinEnabled = k => !LIB.disabled.has(k);
const syncActive = () => { LIB.custom = new Map([...LIB.all].filter(([id]) => !LIB.disabled.has(id))); };
LIB.version = 0; LIB.geo = new Map(); // geometrías ya preparadas (por accesorio y variante)
// Geometría de un accesorio personalizado en su sistema local: su STL de la carpeta modelos (o del navegador)
// o, mientras se descarga o si no tiene, una forma simple de cilindros
function customGeometry(n) {
  const e = LIB.custom.get(n.defId);
  const path = e?.origin === 'carpeta' ? (e.files?.stl?.[n.variant] || e.files?.stl?.['*'] || null) : null;
  const key = `${n.defId}|${n.variant}|${LIB.version}|${e ? 'lib' : vkeyPorts(n)}|${path && MODELS.geo.has(path) ? 'stl' : ''}`;
  if (LIB.geo.has(key)) return LIB.geo.get(key);
  let g = null;
  if (path) { if (MODELS.geo.has(path)) g = MODELS.geo.get(path); else loadModelSTL(path); }
  else {
    const stl = e?.stl && (e.stl[n.variant] || e.stl['*']);
    if (stl) { try { g = parseSTL(b64ToBuf(stl.b64)); } catch { g = null; } }
  }
  if (!g) {
    let dirs, v = e?.def.variants.find(x => x.name === n.variant);
    if (e && v) dirs = e.def.ports.map(p => p.dir);
    else { // accesorio que ya no está en la biblioteca: medidas guardadas en el proyecto
      const ps = [...n.ports, ...n.open].filter(p => p.local);
      dirs = ps.map(p => p.local);
      v = { ds: ps.map(p => p.d), zs: ps.map(p => p.z), sockets: ps.map(p => p.socket), od: n.od || Math.max(...ps.map(p => p.d)) * 1.3 };
    }
    g = autoFittingGeometry(dirs, v);
  }
  LIB.geo.set(key, g); return g;
}
const vkeyPorts = n => [...n.ports, ...n.open].map(p => p.local ? vkey(p.local) + p.d + ':' + p.z : '').join(';');

/* =====================================================================
   UTILIDADES
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
const NF = {}; // formateadores cacheados (toLocaleString es muy lento en bucles)
const fmt = (x, dec = 1) => (NF[dec] ||= new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec })).format(Math.round(x * 10 ** dec) / 10 ** dec);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const near = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;
const r3 = x => Math.round(+x * 1000) / 1000;               // posiciones redondeadas a 0,001 mm
const NF_RAW = new Intl.NumberFormat('es-ES', { useGrouping: false, maximumFractionDigits: 1 });
const numStr = x => NF_RAW.format(Math.round(x * 10) / 10);
const parseNum = s => { s = String(s).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s); };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; /* sin almacenamiento o sin espacio */ } },
};

/* =====================================================================
   FASE 2 — MODELO DE DATOS (grafo de nodos y tramos) + DESHACER
   ===================================================================== */
class Model {
  constructor() {
    this.listeners = new Set();
    this.undoStack = []; this.redoStack = [];
    this.reset();
  }
  reset() {
    this.name = 'Proyecto sin título';
    this.nodes = new Map();     // id → {id, pos:[x,y,z]}
    this.segments = new Map();  // id → {id, a, b, d}
    this.groups = new Map();    // id → {id, name, nodes:[ids], segs:[ids]}
    this.nextId = 1;
    this.config = structuredClone(DEFAULT_CONFIG);
  }
  _id(prefix) { return prefix + (this.nextId++); }
  addNode(pos) { const id = this._id('n'); this.nodes.set(id, { id, pos: pos.slice(0, 3).map(r3) }); return id; }
  addSegment(a, b, d) {
    if (a === b) throw new Error('Un tramo no puede empezar y terminar en el mismo nodo');
    if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error('Nodo inexistente');
    if (!DIAMETERS.includes(d)) throw new Error('Diámetro no permitido: ' + d);
    const id = this._id('s'); this.segments.set(id, { id, a, b, d }); return id;
  }
  segmentsOf(nid) { const r = []; for (const s of this.segments.values()) if (s.a === nid || s.b === nid) r.push(s); return r; }
  removeSegment(id) {
    const s = this.segments.get(id); if (!s) return;
    this.segments.delete(id);
    // los nodos que quedan sin tubos desaparecen, salvo los accesorios declarados (quedan con bocas libres)
    for (const n of [s.a, s.b]) if (!this.segmentsOf(n).length && !this.nodes.get(n)?.fit) this.nodes.delete(n);
  }
  removeNode(id) { for (const s of this.segmentsOf(id)) this.removeSegment(s.id); this.nodes.delete(id); }
  moveNode(id, pos) { this.nodes.get(id).pos = pos.slice(0, 3).map(r3); }
  // Si el nodo une dos tramos alineados del mismo Ø, los convierte en uno solo (prolongación).
  mergeThrough(nid) {
    if (this.nodes.get(nid)?.fit) return false; // un accesorio colocado a propósito no se elimina
    const ss = this.segmentsOf(nid);
    if (ss.length !== 2 || ss[0].d !== ss[1].d) return false;
    const P = v3(this.nodes.get(nid).pos);
    const other = s => s.a === nid ? s.b : s.a;
    const u1 = v3(this.nodes.get(other(ss[0])).pos).sub(P).normalize();
    const u2 = v3(this.nodes.get(other(ss[1])).pos).sub(P).normalize();
    if (!near(u1.dot(u2), -1)) return false;
    const [s1, s2] = ss, o2 = other(s2);
    if (s1.a === nid) s1.a = o2; else s1.b = o2;
    this.segments.delete(s2.id); this.nodes.delete(nid);
    return true;
  }
  splitSegment(id, pos) {
    const s = this.segments.get(id); const n = this.addNode(pos);
    const oldB = s.b; s.b = n; const s2 = this.addSegment(n, oldB, s.d);
    const g = this.groupWithSeg(id); if (g) { g.nodes.push(n); g.segs.push(s2); } // el trozo nuevo sigue en su grupo
    return n;
  }
  // ---- grupos
  groupWithSeg(segId) { for (const g of this.groups.values()) if (g.segs.includes(segId)) return g; return null; }
  groupWithNode(nodeId) { for (const g of this.groups.values()) if (g.nodes.includes(nodeId)) return g; return null; }
  addGroup(nodes, segs, name) {
    // un elemento solo puede estar en un grupo: se saca de los grupos anteriores
    for (const g of this.groups.values()) { g.nodes = g.nodes.filter(n => !nodes.includes(n)); g.segs = g.segs.filter(s => !segs.includes(s)); }
    const id = this._id('g'); this.groups.set(id, { id, name: name || 'Grupo ' + (this.groups.size + 1), nodes: [...new Set(nodes)], segs: [...new Set(segs)] });
    this.cleanGroups(); return id;
  }
  cleanGroups() {
    for (const [id, g] of this.groups) {
      g.segs = g.segs.filter(s => this.segments.has(s));
      g.nodes = g.nodes.filter(n => this.nodes.has(n));
      if (!g.segs.length && !g.nodes.length) this.groups.delete(id);
    }
  }
  // ---- serialización
  toJSON() {
    return {
      format: 'pipecad', version: 1, name: this.name, nextId: this.nextId, config: this.config,
      nodes: [...this.nodes.values()], segments: [...this.segments.values()],
      ...(this.groups.size ? { groups: [...this.groups.values()] } : {}),
    };
  }
  load(json) {
    if (!json || json.format !== 'pipecad') throw new Error('El archivo no es un proyecto PipeCAD');
    if (json.version > 1) throw new Error('Versión de proyecto no soportada');
    const cfg = structuredClone(DEFAULT_CONFIG);
    const merge = (dst, src) => { for (const k in src) { if (src[k] && typeof src[k] === 'object' && dst[k] && typeof dst[k] === 'object') merge(dst[k], src[k]); else dst[k] = src[k]; } };
    if (json.config) merge(cfg, json.config);
    this.name = json.name || 'Proyecto sin título';
    this.config = cfg;
    this.nodes = new Map(json.nodes.map(n => [n.id, { id: n.id, pos: [...n.pos], ...(n.fit ? { fit: structuredClone(n.fit) } : {}) }]));
    this.segments = new Map(json.segments.map(s => [s.id, { id: s.id, a: s.a, b: s.b, d: s.d }]));
    this.groups = new Map((json.groups || []).map(g => [g.id, { id: g.id, name: g.name, nodes: [...g.nodes], segs: [...g.segs] }]));
    this.cleanGroups();
    this.nextId = json.nextId || 1;
  }
  // ---- historial (instantáneas)
  transact(label, fn) {
    const before = JSON.stringify(this.toJSON());
    let r;
    try { r = fn(); this.cleanGroups(); } catch (e) { this.load(JSON.parse(before)); throw e; }
    this.undoStack.push({ label, state: before });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.emit();
    return r;
  }
  _swap(from, to) {
    const e = from.pop(); if (!e) return null;
    to.push({ label: e.label, state: JSON.stringify(this.toJSON()) });
    this.load(JSON.parse(e.state)); this.emit(); return e.label;
  }
  undo() { return this._swap(this.undoStack, this.redoStack); }
  redo() { return this._swap(this.redoStack, this.undoStack); }
  // edición en vivo (arrastre): se modifica sin historial y al soltar se registra un único paso
  beginLive() { return JSON.stringify(this.toJSON()); }
  cancelLive(before) { this.load(JSON.parse(before)); this.emit(); }
  commitLive(before, label) {
    this.cleanGroups();
    this.undoStack.push({ label, state: before });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = []; this.emit();
  }
  on(fn) { this.listeners.add(fn); }
  emit(live = false) { for (const fn of this.listeners) fn(this, live); }
}

/* =====================================================================
   FASE 3 — MOTOR DE ACCESORIOS
   ===================================================================== */
// Direcciones permitidas: ejes (6) y diagonales a 45° en planos principales (12).
function isAllowedDir(v) {
  const c = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)].filter(x => x > 1e-4);
  if (c.length === 1) return true;
  if (c.length === 2) return near(c[0], c[1], 1e-3);
  return false;
}

// Clasifica un nudo: primero los accesorios de serie (si están cargados); si no hay ninguno que
// encaje, se busca en los personalizados de la biblioteca uno con el mismo número de bocas, ángulos y Ø.
function classifyNode(ports, cfg) {
  const r = classifyBuiltin(ports, cfg);
  const offBuiltin = BUILTIN_KINDS.includes(r.kind) && !builtinEnabled(r.kind);
  if (r.kind === 'invalid' || offBuiltin) {
    const c = matchCustom(ports);
    if (c) return c;
    if (offBuiltin) { ports.forEach(p => { p.z = 0; }); return { kind: 'invalid', errors: [`${KIND_NAMES[r.kind]} no está cargado en la biblioteca de accesorios`] }; }
  }
  return r;
}
// Busca un accesorio personalizado cuyas bocas coincidan (en número, Ø y ángulos entre ellas) con las del nudo
function matchCustom(ports) {
  if (ports.length < 2 || ports.some(p => !(p.len > 1e-6))) return null;
  for (const { def } of LIB.custom.values()) for (const v of def.variants) {
    if (v.ds.length !== ports.length) continue;
    const assign = new Array(ports.length).fill(-1), used = new Set();
    const ok = i => {
      if (i === ports.length) return true;
      for (let j = 0; j < def.ports.length; j++) {
        if (used.has(j) || v.ds[j] !== ports[i].d) continue;
        let fits = true;
        for (let k = 0; k < i && fits; k++) fits = near(ports[i].dir.dot(ports[k].dir), def.ports[j].dir.dot(def.ports[assign[k]].dir), 2e-3);
        if (!fits) continue;
        assign[i] = j; used.add(j);
        if (ok(i + 1)) return true;
        used.delete(j); assign[i] = -1;
      }
      return false;
    };
    if (!ok(0)) continue;
    ports.forEach((p, i) => { p.z = v.zs[assign[i]]; p.socket = v.sockets[assign[i]]; p.local = def.ports[assign[i]].dir; });
    return { kind: 'custom', defId: def.id, label: def.name, variant: v.name, od: v.od, errors: [] };
  }
  return null;
}
function classifyBuiltin(ports, cfg) {
  const F = cfg.fittings;
  const bad = msg => { ports.forEach(p => { p.z = 0; }); return { kind: 'invalid', errors: [msg] }; };
  const n = ports.length;
  if (n === 0) return { kind: 'isolated', errors: ['Nodo sin tubos'] };
  if (ports.some(p => p.len < 1e-6)) return bad('Tramo de longitud nula');
  if (n === 1) return { kind: 'end', errors: [] };

  if (n === 2) {
    const [p, q] = ports; const dot = p.dir.dot(q.dir);
    if (near(dot, -1)) { // alineados
      if (p.d === q.d) { p.z = q.z = F[p.d].coupling; return { kind: 'coupling', errors: [] }; }
      const [big, small] = p.d > q.d ? [p, q] : [q, p];
      const r = cfg.reducers[`${big.d}-${small.d}`];
      if (!r) return bad(`No hay reductor ${big.d}×${small.d}`);
      big.z = r.big; small.z = r.small;
      return { kind: 'reducer', variant: `${big.d}×${small.d}`, errors: [] };
    }
    const ang = Math.round(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(dot, -1, 1))));
    if (p.d !== q.d) return bad('Cambio de diámetro en un giro: no existen codos reducidos (usa codo + reductor)');
    if (near(dot, 0)) { p.z = q.z = F[p.d].elbow90; return { kind: 'elbow90', errors: [] }; }
    if (near(dot, -Math.SQRT1_2)) { p.z = q.z = F[p.d].elbow45; return { kind: 'elbow45', errors: [] }; }
    return bad(`Ángulo entre tubos de ${ang}°: solo se admiten giros de 90° o 45°`);
  }

  if (n === 3) {
    let run = null, branch = null;
    for (let i = 0; i < 3 && !run; i++) for (let j = i + 1; j < 3; j++) {
      if (near(ports[i].dir.dot(ports[j].dir), -1)) { run = [ports[i], ports[j]]; branch = ports[3 - i - j]; break; }
    }
    if (!run) return bad('Te: dos de los tubos deben estar alineados');
    if (!near(branch.dir.dot(run[0].dir), 0)) return bad('Te: la derivación debe ser perpendicular (no hay Te a 45°)');
    if (run[0].d !== run[1].d) return bad('Te: los dos tubos alineados deben tener el mismo diámetro');
    const D = run[0].d, d = branch.d;
    if (d === D) { ports.forEach(p => { p.z = F[D].tee; }); return { kind: 'tee', errors: [] }; }
    if (d > D) return bad('Te: la derivación no puede ser mayor que el tramo principal');
    const r = cfg.teeReduced[`${D}-${d}`];
    if (!r) return bad(`No hay Te reducida ${D}×${d}`);
    run[0].z = run[1].z = r.run; branch.z = r.branch; branch.role = 'branch';
    return { kind: 'teeReduced', variant: `${D}×${d}`, errors: [] };
  }
  return bad(`${n} tubos en un mismo punto: máximo 3 (Te)`);
}

function analyze(model) {
  const cfg = model.config;
  const adj = new Map([...model.nodes.keys()].map(k => [k, []]));
  for (const s of model.segments.values()) { adj.get(s.a)?.push(s); adj.get(s.b)?.push(s); }

  const nodes = new Map(), segs = new Map();
  for (const [id, n] of model.nodes) {
    const P = v3(n.pos);
    const ports = adj.get(id).map(s => {
      const other = model.nodes.get(s.a === id ? s.b : s.a);
      const dir = v3(other.pos).sub(P); const len = dir.length();
      if (len > 1e-6) dir.divideScalar(len);
      return { segId: s.id, d: s.d, dir, len, z: 0, socket: 0 };
    });
    const info = n.fit ? classifyExplicit(n.fit, ports, cfg) : classifyNode(ports, cfg);
    const isFitting = FITTING_KINDS.includes(info.kind);
    for (const p of ports) p.socket = !isFitting ? 0 : info.kind === 'custom' ? (p.socket || 0) : cfg.fittings[p.d].socket;
    const ds = n.fit ? n.fit.ports.map(p => p.d) : ports.map(p => p.d);
    const d = ds.length ? Math.max(...ds) : 20;
    nodes.set(id, { id, pos: P, ports, d, isFitting, open: [], explicit: false, ...info });
  }

  for (const s of model.segments.values()) {
    const A = nodes.get(s.a), B = nodes.get(s.b);
    const Le = A.pos.distanceTo(B.pos);
    const dir = B.pos.clone().sub(A.pos); if (Le > 1e-6) dir.divideScalar(Le);
    const pa = A.ports.find(p => p.segId === s.id), pb = B.ports.find(p => p.segId === s.id);
    const zA = pa.z, zB = pb.z;
    const Lr = Le - zA - zB;
    const free = Le - (zA + pa.socket) - (zB + pb.socket);
    const errors = [], warnings = [];
    if (Le < 1e-6) errors.push('Tramo de longitud nula');
    if (Le > 1e-6 && free < 0) errors.push(`Los accesorios se solapan ${fmt(-free)} mm: alarga el tramo`);
    else if (Le > 1e-6 && (A.isFitting || B.isFitting) && free < cfg.minFree) warnings.push(`Tubo visto de ${fmt(free)} mm (mínimo ${cfg.minFree} mm)`);
    if (Lr > cfg.barLength) warnings.push(`Longitud real mayor que la barra (${cfg.barLength} mm): necesitará un manguito`);
    segs.set(s.id, { id: s.id, a: s.a, b: s.b, d: s.d, Le, Lr, zA, zB, free, dir, kindA: A.kind, kindB: B.kind, errors, warnings });
  }

  // Extremos sueltos pegados a otro nodo (parecen conectados en 3D pero no lo están)
  const loose = [], F = cfg.fittings;
  for (const E of nodes.values()) {
    if (E.kind !== 'end' || E.explicit) continue;
    const p = E.ports[0], s = model.segments.get(p.segId), far = s.a === E.id ? s.b : s.a;
    let best = null;
    for (const N of nodes.values()) {
      if (N.id === E.id || N.id === far) continue;
      const dist = N.pos.distanceTo(E.pos);
      const tol = F[p.d].od / 2 + F[N.d].od / 2 + F[N.d].socket;
      if (dist < tol && (!best || dist < best.dist)) best = { nodeId: N.id, dist };
    }
    if (!best) continue;
    const item = { endId: E.id, segId: p.segId, ...best };
    loose.push(item);
    const g = segs.get(p.segId);
    g.loose = item;
    g.warnings.push(`Extremo suelto a ${fmt(best.dist)} mm de ${best.nodeId} (${kindLabel(nodes.get(best.nodeId)).toLowerCase()}): parece unido pero no está conectado`);
  }
  return { nodes, segs, loose };
}

/* =====================================================================
   ACCESORIOS DECLARADOS: bocas libres, orientación, inserción, giro y unión
   ===================================================================== */
// 18 direcciones permitidas: 6 de ejes + 12 diagonales a 45° en planos principales
const DIRS18 = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
  const nz = (x !== 0) + (y !== 0) + (z !== 0);
  if (nz === 1 || nz === 2) DIRS18.push(new THREE.Vector3(x, y, z).normalize());
}
const r6 = x => Math.round(x * 1e6) / 1e6;
const cleanDir = v => v.set(...[v.x, v.y, v.z].map(c => Math.abs(c) < 1e-6 ? 0 : c)).normalize();
const vkey = v => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
// Bocas de un accesorio declarado. Los personalizados guardan además su Z, embocadura, dirección local
// (la de su definición) y los datos del accesorio, para que el proyecto se entienda sin la biblioteca.
const PORT_EXTRA = ['z', 'socket', 'local'];
const fitPorts = fit => fit.ports.map(p => {
  const o = { dir: v3(p.dir).normalize(), d: p.d };
  for (const k of PORT_EXTRA) if (p[k] !== undefined) o[k] = k === 'local' ? v3(p[k]).normalize() : p[k];
  return o;
});
const FIT_META = ['type', 'name', 'variant', 'od'];
const storeFit = (ports, meta = {}) => {
  const fit = { ports: ports.map(p => {
    const o = { dir: p.dir.toArray().map(r6), d: p.d };
    for (const k of PORT_EXTRA) if (p[k] !== undefined) o[k] = k === 'local' ? (p[k].toArray ? p[k].toArray() : p[k]).map(r6) : p[k];
    return o;
  }) };
  for (const k of FIT_META) if (meta[k] !== undefined) fit[k] = meta[k];
  return fit;
};
const fitMeta = fit => Object.fromEntries(FIT_META.filter(k => fit?.[k] !== undefined).map(k => [k, fit[k]]));

// Plantillas de accesorio en su orientación de partida
function fittingTemplate(key, d) {
  if (key.startsWith('lib:')) { // personalizado de la biblioteca: lib:<id>:<variante>
    const [, id, vname] = key.split(':'), e = LIB.custom.get(id), v = e?.def.variants.find(x => x.name === vname);
    if (!v) return [];
    return e.def.ports.map((p, i) => ({ dir: p.dir.clone(), local: p.dir.clone(), d: v.ds[i], z: v.zs[i], socket: v.sockets[i] }));
  }
  const X = [1, 0, 0], NX = [-1, 0, 0], Y = [0, 1, 0], D45 = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const [k, B, S] = key.split('-'), big = +B, small = +S;
  const t = {
    elbow90: [{ dir: X, d }, { dir: Y, d }],
    elbow45: [{ dir: NX, d }, { dir: D45, d }],
    tee: [{ dir: X, d }, { dir: NX, d }, { dir: Y, d }],
    coupling: [{ dir: X, d }, { dir: NX, d }],
    red: [{ dir: X, d: big }, { dir: NX, d: small }],
    ter: [{ dir: X, d: big }, { dir: NX, d: big }, { dir: Y, d: small }],
  }[k] || [];
  return t.map(p => ({ dir: new THREE.Vector3(...p.dir).normalize(), d: p.d }));
}

// Accesorio declarado en un nodo: los tubos deben entrar por sus bocas; las demás quedan libres.
function classifyExplicit(fit, ports, cfg) {
  if (fit.type) { // accesorio personalizado: sus medidas van guardadas en el propio accesorio
    const tpl = fitPorts(fit), used = new Set(), errors = [];
    for (const p of ports) {
      const i = tpl.findIndex((t, k) => !used.has(k) && near(t.dir.dot(p.dir), 1));
      if (i < 0) { p.z = 0; errors.push('Un tubo no entra por ninguna boca del accesorio: gíralo o separa el tubo'); continue; }
      used.add(i); p.z = tpl[i].z || 0; p.socket = tpl[i].socket || 0; p.local = tpl[i].local;
      if (tpl[i].d !== p.d) errors.push(`Boca de Ø${tpl[i].d} con un tubo de Ø${p.d}`);
    }
    const open = tpl.filter((t, k) => !used.has(k)).map(t => ({ dir: t.dir, d: t.d, z: t.z || 0, socket: t.socket || 0, local: t.local }));
    return { kind: 'custom', defId: fit.type, label: fit.name || fit.type, variant: fit.variant, od: fit.od, errors, open, explicit: true };
  }
  const tpl = fitPorts(fit).map(p => ({ ...p, len: 1, z: 0 }));
  const info = classifyNode(tpl, cfg);
  if (!FITTING_KINDS.includes(info.kind)) { ports.forEach(p => { p.z = 0; }); return { kind: 'invalid', errors: ['Accesorio con bocas no válidas'], open: [], explicit: true }; }
  const used = new Set(), errors = [];
  for (const p of ports) {
    const i = tpl.findIndex((t, k) => !used.has(k) && near(t.dir.dot(p.dir), 1));
    if (i < 0) { p.z = 0; errors.push('Un tubo no entra por ninguna boca del accesorio: gíralo o separa el tubo'); continue; }
    used.add(i); p.z = tpl[i].z; if (tpl[i].role) p.role = tpl[i].role;
    if (tpl[i].d !== p.d) errors.push(`Boca de Ø${tpl[i].d} con un tubo de Ø${p.d}`);
  }
  const open = tpl.filter((t, k) => !used.has(k)).map(t => ({ dir: t.dir, d: t.d, z: t.z, socket: cfg.fittings[t.d].socket, role: t.role }));
  return { kind: info.kind, variant: info.variant, errors, open, explicit: true };
}
// Cota Z de cada boca de una plantilla
function portZs(ports, cfg) {
  if (ports.every(p => p.z !== undefined)) return ports.map(p => p.z); // personalizados: Z propia
  const f = ports.map(p => ({ dir: p.dir.clone(), d: p.d, len: 1, z: 0 })); classifyNode(f, cfg); return f.map(p => p.z);
}

// Todas las orientaciones de una plantilla que dejan sus bocas en direcciones permitidas
function orientations(tpl) {
  const out = new Map();
  const add = dirs => { if (dirs.every(isAllowedDir)) { const k = dirs.map(vkey).join(';'); if (!out.has(k)) out.set(k, dirs); } };
  const p0 = tpl[0].dir, i1 = tpl.findIndex(p => Math.abs(p.dir.dot(p0)) < 1 - 1e-6);
  if (i1 < 0) { // bocas alineadas (manguito, reductor): basta orientar el eje
    for (const a of DIRS18) { const q = new THREE.Quaternion().setFromUnitVectors(p0, a); add(tpl.map(p => cleanDir(p.dir.clone().applyQuaternion(q)))); }
  } else {
    const p1 = tpl[i1].dir, c = p0.dot(p1);
    const frame = (a, b) => { const e1 = a.clone().normalize(), e2 = b.clone().addScaledVector(e1, -b.dot(e1)).normalize(); return new THREE.Matrix4().makeBasis(e1, e2, e1.clone().cross(e2)); };
    const inv = frame(p0, p1).invert();
    for (const a of DIRS18) for (const b of DIRS18) {
      if (!near(a.dot(b), c)) continue;
      const M = frame(a, b).multiply(inv);
      add(tpl.map(p => cleanDir(p.dir.clone().transformDirection(M))));
    }
  }
  return [...out.values()];
}
// Orientación que encaja con las conexiones exigidas y se parece más a la preferida
//  1) primero se prueban las orientaciones «limpias» (bocas en ejes o diagonales a 45°);
//  2) si ninguna encaja (tubos en direcciones libres), se alinea la plantilla con las conexiones y se
//     gira alrededor de la primera en pasos de angStep buscando la más parecida a la preferida.
function chooseOrientation(tpl, cons, pref, relaxD = false, angStep = 15) {
  const fits = dirs => {
    const used = new Set(); let sameD = 0;
    for (const c of cons) {
      const i = dirs.findIndex((dd, k) => !used.has(k) && near(dd.dot(c.dir), 1) && (relaxD || tpl[k].d === c.d));
      if (i < 0) return false;
      used.add(i); if (tpl[i].d === c.d) sameD++;
    }
    return !(relaxD && cons.length && !sameD);
  };
  const score = dirs => dirs.reduce((s, dd, k) => s + dd.dot(pref[k]), 0);
  let best = null, bestScore = -Infinity;
  for (const dirs of orientations(tpl)) if (fits(dirs) && score(dirs) > bestScore) { bestScore = score(dirs); best = dirs; }
  if (!best && cons.length) for (const dirs of freeOrientations(tpl, cons, relaxD, angStep)) {
    if (fits(dirs) && score(dirs) > bestScore) { bestScore = score(dirs); best = dirs; }
  }
  return best && best.map((dir, k) => ({ ...tpl[k], dir }));
}
// Orientaciones libres: una boca alineada con la primera conexión y giro alrededor de ella
function freeOrientations(tpl, cons, relaxD, angStep) {
  const out = [], c0 = cons[0].dir;
  const c1 = cons.slice(1).find(c => Math.abs(c.dir.dot(c0)) < 1 - 1e-6)?.dir;
  for (let k = 0; k < tpl.length; k++) {
    if (!relaxD && tpl[k].d !== cons[0].d) continue;
    const q1 = new THREE.Quaternion().setFromUnitVectors(tpl[k].dir, c0);
    const base = tpl.map(p => p.dir.clone().applyQuaternion(q1));
    const angles = [];
    if (c1) { // el giro queda fijado por la segunda conexión
      const pc1 = c1.clone().addScaledVector(c0, -c1.dot(c0)).normalize();
      for (const b of base) {
        const pb = b.clone().addScaledVector(c0, -b.dot(c0)); if (pb.lengthSq() < 1e-9) continue; pb.normalize();
        angles.push(Math.atan2(pb.clone().cross(pc1).dot(c0), pb.dot(pc1)));
      }
    } else for (let a = 0; a < 360; a += angStep) angles.push(THREE.MathUtils.degToRad(a));
    for (const a of angles) {
      const q2 = new THREE.Quaternion().setFromAxisAngle(c0, a);
      out.push(base.map(d => cleanDir(d.clone().applyQuaternion(q2))));
    }
  }
  return out;
}
// Coloca un accesorio: en el espacio, sobre un nodo (lo sustituye) o dentro de un tubo (lo parte en dos).
function placeFitting(m, target, ports, meta = {}) {
  let nid;
  if (target.type === 'plane') nid = m.addNode(target.pos.toArray());
  else if (target.type === 'node') nid = target.id;
  else nid = m.splitSegment(target.id, target.pos.toArray());
  m.nodes.get(nid).fit = storeFit(ports, meta);
  if (target.type === 'seg') { // reductor dentro de un tubo: el tramo del lado de la boca menor cambia de Ø
    const P = v3(m.nodes.get(nid).pos);
    for (const s of m.segmentsOf(nid)) {
      const u = v3(m.nodes.get(s.a === nid ? s.b : s.a).pos).sub(P).normalize();
      const port = ports.find(p => near(p.dir.dot(u), 1));
      if (port && port.d !== s.d) s.d = port.d;
    }
  }
  return nid;
}
// Bocas actuales de un accesorio (declarado o deducido de sus tubos)
function currentPorts(m, an, nodeId) {
  const node = m.nodes.get(nodeId);
  if (node.fit) return fitPorts(node.fit);
  const n = an.nodes.get(nodeId), custom = n.kind === 'custom';
  return n.ports.map(p => ({ dir: p.dir.clone(), d: p.d, ...(custom ? { z: p.z, socket: p.socket, local: p.local?.clone() } : {}) }));
}
// Datos del accesorio que hay que conservar al convertir un nudo deducido en declarado
const nodeFitMeta = (m, an, nodeId) => {
  const node = m.nodes.get(nodeId), n = an.nodes.get(nodeId);
  return node.fit ? fitMeta(node.fit) : n.kind === 'custom' ? { type: n.defId, name: n.label, variant: n.variant, od: n.od } : {};
};
// Plan de giro: nuevas bocas y tubos que dejan de estar conectados
function planRotation(m, an, nodeId, axis, angle) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const ports = currentPorts(m, an, nodeId).map(p => ({ ...p, dir: cleanDir(p.dir.applyQuaternion(q)) }));
  const valid = ports.every(p => Number.isFinite(p.dir.x) && p.dir.lengthSq() > 0.5);
  const used = new Set(), detach = [];
  for (const p of an.nodes.get(nodeId).ports) {
    const i = ports.findIndex((t, k) => !used.has(k) && t.d === p.d && near(t.dir.dot(p.dir), 1));
    if (i >= 0) used.add(i); else detach.push(p);
  }
  return { ports, valid, detach };
}
// Direcciones útiles alrededor de un eje cualquiera u: el propio eje, sus perpendiculares
// (una horizontal y otra en el plano vertical) y las combinaciones a 45°.
function localDirs(u) {
  const e1 = u.clone().normalize();
  const e2 = Math.abs(e1.z) < 0.999 ? e1.clone().cross(new THREE.Vector3(0, 0, 1)).normalize() : new THREE.Vector3(1, 0, 0);
  const e3 = e1.clone().cross(e2).normalize();
  const out = [];
  for (const [a, b, c] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [0, 1, -1], [1, -1, 0], [1, 0, -1]])
    for (const s of [1, -1]) out.push(new THREE.Vector3().addScaledVector(e1, a * s).addScaledVector(e2, b * s).addScaledVector(e3, c * s).normalize());
  return out;
}
// Ejes propios de un accesorio para el gizmo: ejes de sus bocas (sin repetir los alineados) y la normal
function fittingAxes(m, an, nodeId) {
  const ports = currentPorts(m, an, nodeId), n = an.nodes.get(nodeId), axes = [];
  const name = p => { const c = n.ports.find(q => near(q.dir.dot(p.dir), 1)); return c ? `eje del tubo ${c.segId}` : 'eje de la boca libre'; };
  for (const p of ports) {
    const same = axes.find(a => Math.abs(a.axis.dot(p.dir)) > 1 - 1e-6);
    if (same) { same.name = same.name.startsWith('eje principal') ? same.name : 'eje principal (' + same.name.replace(/^eje (del |de la )/, '') + ')'; continue; }
    axes.push({ axis: p.dir.clone(), name: name(p) });
  }
  const p0 = ports[0]?.dir, p1 = ports.find(p => Math.abs(p.dir.dot(p0)) < 1 - 1e-6)?.dir;
  if (p0 && p1) axes.push({ axis: p0.clone().cross(p1).normalize(), name: 'perpendicular al accesorio' });
  return axes;
}
// Separa un tubo de un nodo: su extremo queda en el fondo de la embocadura (conserva su longitud real)
function detachPort(m, nodeId, pos, p) {
  const s = m.segments.get(p.segId);
  const nn = m.addNode(pos.clone().addScaledVector(p.dir, p.z).toArray());
  if (s.a === nodeId) s.a = nn; else s.b = nn;
  m.groupWithSeg(p.segId)?.nodes.push(nn); // el extremo nuevo pertenece al grupo de su tubo
  return nn;
}

/* ---------- grupos: aislar, transformar y duplicar (operaciones puras) ---------- */
// Separa los tubos de fuera del grupo que llegan a nodos del grupo (conservan su longitud real)
function isolateGroup(m, gid) {
  const g = m.groups.get(gid), segs = new Set(g.segs), an = analyze(m); let k = 0;
  for (const nid of g.nodes) {
    const n = an.nodes.get(nid); if (!n) continue;
    for (const p of n.ports) if (!segs.has(p.segId)) { detachPort(m, nid, n.pos, p); k++; }
  }
  return k;
}
// Aplica una matriz (giro + traslación) a unos nodos partiendo de sus posiciones originales;
// las bocas de los accesorios declarados giran con ellos.
function transformNodes(m, orig, M) {
  const L = new THREE.Matrix3().setFromMatrix4(M); // parte lineal: giro o simetría (espejo)
  for (const [id, o] of orig) {
    const n = m.nodes.get(id); if (!n) continue;
    n.pos = v3(o.pos).applyMatrix4(M).toArray().map(r3);
    if (o.fit) n.fit = storeFit(fitPorts(o.fit).map(p => ({ ...p, dir: cleanDir(p.dir.applyMatrix3(L)) })), fitMeta(o.fit));
  }
}
// Espejo de un grupo respecto a un plano que pasa por su centro y es perpendicular al eje dado
// ('z' = plano horizontal; 'x' o 'y' = planos verticales). Los tubos externos se separan antes.
function mirrorGroup(m, gid, axis) {
  const detached = isolateGroup(m, gid), g = m.groups.get(gid);
  const c = nodesBox(m, g.nodes).getCenter(new THREE.Vector3());
  const s = { x: 1, y: 1, z: 1 }; s[axis] = -1;
  const M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
    .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  transformNodes(m, snapshotNodes(m, g.nodes), M);
  return detached;
}
const snapshotNodes = (m, ids) => new Map(ids.filter(id => m.nodes.has(id)).map(id => { const n = m.nodes.get(id); return [id, { pos: [...n.pos], fit: n.fit && structuredClone(n.fit) }]; }));
// Copia nodos y tubos desplazados; devuelve los ids nuevos
function duplicateItems(m, nodeIds, segIds, offset) {
  const nodes = new Set(nodeIds);
  for (const sid of segIds) { const s = m.segments.get(sid); if (s) { nodes.add(s.a); nodes.add(s.b); } }
  const map = new Map();
  for (const id of nodes) {
    const n = m.nodes.get(id); if (!n) continue;
    const nid = m.addNode(v3(n.pos).add(offset).toArray());
    if (n.fit) m.nodes.get(nid).fit = structuredClone(n.fit);
    map.set(id, nid);
  }
  const segs = [];
  for (const sid of segIds) { const s = m.segments.get(sid); if (s && map.has(s.a) && map.has(s.b)) segs.push(m.addSegment(map.get(s.a), map.get(s.b), s.d)); }
  return { nodes: [...map.values()], segs };
}
// Caja que envuelve unos nodos (con margen de un accesorio)
function nodesBox(m, ids) {
  const b = new THREE.Box3();
  for (const id of ids) { const n = m.nodes.get(id); if (n) b.expandByPoint(v3(n.pos)); }
  return b.isEmpty() ? b : b.expandByScalar(40);
}
function rotateFitting(m, nodeId, axis, angle) {
  const an = analyze(m), n = an.nodes.get(nodeId);
  const plan = planRotation(m, an, nodeId, axis, angle);
  if (!plan.valid) throw new Error('Giro no válido');
  for (const p of plan.detach) detachPort(m, nodeId, n.pos, p);
  m.nodes.get(nodeId).fit = storeFit(plan.ports, nodeFitMeta(m, an, nodeId));
  return plan.detach.length;
}
// Borra un accesorio dejando sus tubos sueltos (con su longitud real)
function deleteFitting(m, nodeId) {
  const n = analyze(m).nodes.get(nodeId);
  for (const p of n.ports) detachPort(m, nodeId, n.pos, p);
  m.nodes.delete(nodeId);
}
// Unión de dos tubos alineados del mismo Ø en uno solo
function joinPlan(m, s, o) {
  if (s.d !== o.d) return null;
  const A = v3(m.nodes.get(s.a).pos), u = v3(m.nodes.get(s.b).pos).sub(A).normalize();
  const onLine = id => { const v = v3(m.nodes.get(id).pos).sub(A); return v.addScaledVector(u, -v.dot(u)).length() < 0.5; };
  if (!onLine(o.a) || !onLine(o.b)) return null;
  const t = id => v3(m.nodes.get(id).pos).sub(A).dot(u);
  const [s0, s1] = [s.a, s.b].sort((x, y) => t(x) - t(y)), [o0, o1] = [o.a, o.b].sort((x, y) => t(x) - t(y));
  let inner, far;
  if (t(o0) >= t(s1) - 0.5) { inner = [s1, o0]; far = [s0, o1]; }
  else if (t(o1) <= t(s0) + 0.5) { inner = [o1, s0]; far = [o0, s1]; }
  else return null; // se solapan
  const ids = [...new Set(inner)];
  for (const n of ids) {
    if (m.segmentsOf(n).some(g => g.id !== s.id && g.id !== o.id)) return null;  // hay otro tubo (p. ej. una Te)
    const f = m.nodes.get(n).fit; if (f && f.ports.length !== 2) return null;      // solo se quitan manguitos
  }
  return { inner: ids, far, gap: Math.max(0, t(inner[1]) - t(inner[0])), shared: ids.length === 1 };
}
// Conecta un extremo suelto de un tubo a un nodo cercano:
//  A) si el nodo está en la prolongación del tubo, el tubo se alarga/acorta hasta él;
//  B) si el nodo tiene un solo tubo, se desplaza a lo largo de ese tubo hasta el cruce con la prolongación.
function connectLoose(m, segId, endId, nodeId) {
  const s = m.segments.get(segId);
  if (!s || (s.a !== endId && s.b !== endId) || !m.nodes.has(nodeId)) throw new Error('El extremo ya no existe');
  const farId = s.a === endId ? s.b : s.a;
  const Fp = v3(m.nodes.get(farId).pos), Np = v3(m.nodes.get(nodeId).pos);
  const v = v3(m.nodes.get(endId).pos).sub(Fp).normalize();
  const reattach = () => { if (s.a === endId) s.a = nodeId; else s.b = nodeId; if (!m.segmentsOf(endId).length && !m.nodes.get(endId).fit) m.nodes.delete(endId); };
  let how = null;
  const w0 = Np.clone().sub(Fp), a = w0.dot(v);
  if (a > 1 && w0.clone().addScaledVector(v, -a).length() < 0.5) { reattach(); how = 'extend'; }
  else {
    const others = m.segmentsOf(nodeId);
    if (others.length === 1) {
      const s2 = others[0], G = v3(m.nodes.get(s2.a === nodeId ? s2.b : s2.a).pos), w = Np.clone().sub(G).normalize();
      const b = v.dot(w), D = 1 - b * b;
      if (D > 1e-6) {
        const r = Fp.clone().sub(G), d = v.dot(r), e = w.dot(r);
        const ta = (b * e - d) / D, tc = (e - b * d) / D;
        const X = Fp.clone().addScaledVector(v, ta), Y = G.clone().addScaledVector(w, tc);
        if (ta > 1 && tc > 1 && X.distanceTo(Y) < 0.5) { m.moveNode(nodeId, X.toArray()); reattach(); how = 'move'; }
      }
    }
  }
  if (!how) throw new Error('No se puede conectar automáticamente: el tubo no está alineado con ninguna boca de ese accesorio');
  const n = analyze(m).nodes.get(nodeId);
  if (n.errors.length) throw new Error('No se puede conectar: ' + n.errors[0]);
  return how;
}
function joinCandidates(m, segId) {
  const s = m.segments.get(segId), out = [];
  for (const o of m.segments.values()) { if (o.id === segId) continue; const p = joinPlan(m, s, o); if (p) out.push({ id: o.id, ...p }); }
  return out.sort((a, b) => a.gap - b.gap);
}
function joinSegments(m, sId, oId) {
  const s = m.segments.get(sId), o = m.segments.get(oId);
  const plan = s && o && joinPlan(m, s, o);
  if (!plan) throw new Error('Esos tubos no se pueden unir (deben estar alineados, tener el mismo Ø y no tener otra derivación entre ellos)');
  s.a = plan.far[0]; s.b = plan.far[1]; m.segments.delete(oId);
  for (const n of plan.inner) if (!m.segmentsOf(n).length) m.nodes.delete(n);
  return sId;
}

/* =====================================================================
   BIBLIOTECA: lenguaje .pcf (PipeCAD Fitting) y modelos STL
   =====================================================================
   Ejemplo:
     ACCESORIO cruz90
     NOMBRE "Cruz 90°"
     BOCA A  1 0 0
     BOCA B -1 0 0
     BOCA C  0 1 0
     BOCA D  0 -1 0
     VARIANTE 32 DIAMETROS 32 32 32 32 Z 17 17 17 17 EMBOCADURA 22 22 22 22 EXTERIOR 41
     MODELO 32 cruz90_32.stl
*/
const PCF_KEYS = { DIAMETROS: 'ds', 'DIÁMETROS': 'ds', Z: 'zs', EMBOCADURA: 'sockets', EXTERIOR: 'od', PASO: 'pass' };
function tokenizePCF(line) { const out = [], re = /"([^"]*)"|(\S+)/g; let m; while ((m = re.exec(line))) out.push(m[1] ?? m[2]); return out; }
function parsePCF(text) {
  const def = { id: '', name: '', desc: '', ports: [], variants: [], models: {} }, errs = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) return;
    const t = tokenizePCF(line), key = t[0].toUpperCase(), ln = i + 1;
    const num = (s, what) => { const v = parseNum(s); if (!isFinite(v)) errs.push(`Línea ${ln}: ${what} debe ser un número («${s ?? ''}»)`); return v; };
    switch (key) {
      case 'ACCESORIO':
        def.id = (t[1] || '').toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(def.id)) errs.push(`Línea ${ln}: el identificador del accesorio solo admite letras sin tildes, números, «-» y «_»`);
        break;
      case 'NOMBRE': def.name = t.slice(1).join(' '); break;
      case 'DESCRIPCION': case 'DESCRIPCIÓN': def.desc = t.slice(1).join(' '); break;
      case 'BOCA': {
        if (t.length !== 5) { errs.push(`Línea ${ln}: BOCA necesita un nombre y tres números: BOCA A 1 0 0`); break; }
        const v = new THREE.Vector3(num(t[2], 'X'), num(t[3], 'Y'), num(t[4], 'Z'));
        if (!(v.lengthSq() > 1e-12)) { errs.push(`Línea ${ln}: la dirección de la boca no puede ser 0 0 0`); break; }
        if (def.ports.some(p => p.name === t[1])) errs.push(`Línea ${ln}: la boca «${t[1]}» está repetida`);
        def.ports.push({ name: t[1], dir: v.normalize() }); break;
      }
      case 'VARIANTE': {
        const v = { name: t[1], ds: [], zs: [], sockets: [], pass: [], od: NaN, line: ln }; let cur = null;
        if (!t[1] || PCF_KEYS[t[1].toUpperCase()]) { errs.push(`Línea ${ln}: falta el nombre de la variante (VARIANTE 32 DIAMETROS …)`); break; }
        for (const tok of t.slice(2)) {
          const k = PCF_KEYS[tok.toUpperCase()];
          if (k) { cur = k; continue; }
          if (!cur) { errs.push(`Línea ${ln}: «${tok}» no va precedido de DIAMETROS, Z, EMBOCADURA, PASO o EXTERIOR`); continue; }
          const val = num(tok, cur === 'ds' ? 'el diámetro' : cur === 'zs' ? 'la Z' : cur === 'sockets' ? 'la embocadura' : cur === 'pass' ? 'el paso' : 'el diámetro exterior');
          if (cur === 'od') v.od = val; else v[cur].push(val);
        }
        def.variants.push(v); break;
      }
      case 'MODELO': if (t.length !== 3) errs.push(`Línea ${ln}: MODELO necesita la variante (o *) y el archivo: MODELO 32 pieza_32.stl`); else def.models[t[1]] = t[2]; break;
      default: errs.push(`Línea ${ln}: palabra clave desconocida «${t[0]}» (válidas: ACCESORIO, NOMBRE, DESCRIPCION, BOCA, VARIANTE, MODELO)`);
    }
  });
  if (!def.id) errs.push('Falta la línea ACCESORIO <identificador>');
  if (!def.name) def.name = def.id;
  if (!def.ports.length) errs.push('El accesorio necesita al menos una BOCA');
  if (!def.variants.length) errs.push('El accesorio necesita al menos una VARIANTE');
  const n = def.ports.length;
  for (const v of def.variants) {
    const where = `Variante «${v.name}» (línea ${v.line})`;
    for (const [k, label] of [['ds', 'DIAMETROS'], ['zs', 'Z'], ['sockets', 'EMBOCADURA']])
      if (v[k].length !== n) errs.push(`${where}: ${label} tiene ${v[k].length} valores y hay ${n} bocas`);
    if (v.ds.some(d => !DIAMETERS.includes(d))) errs.push(`${where}: los diámetros deben ser ${DIAMETERS.join(', ')}`);
    if (v.zs.some(z => z < 0)) errs.push(`${where}: la Z no puede ser negativa`);
    if (v.sockets.some(s => !(s > 0))) errs.push(`${where}: la embocadura debe ser mayor que 0`);
    if (!(v.od > Math.max(...v.ds))) errs.push(`${where}: EXTERIOR debe ser mayor que el mayor de los diámetros`);
    if (v.pass.length && v.pass.length !== n) errs.push(`${where}: PASO tiene ${v.pass.length} valores y hay ${n} bocas`);
    if (v.pass.some((p, k) => !(p > 0) || p >= v.ds[k])) errs.push(`${where}: cada PASO debe ser mayor que 0 y menor que el Ø de su boca`);
    if (!v.pass.length) delete v.pass;
  }
  const names = def.variants.map(v => v.name);
  if (new Set(names).size !== names.length) errs.push('Hay variantes con el mismo nombre');
  for (const k of Object.keys(def.models)) if (k !== '*' && !names.includes(k)) errs.push(`MODELO ${k}: no existe esa variante`);
  if (errs.length) throw new Error(errs.join('\n'));
  return def;
}
const fmtN = x => String(Math.round(x * 1e6) / 1e6);
function pcfFor(def) {
  const L = ['# PipeCAD · definición de accesorio (lenguaje .pcf)', '# Medidas en mm. Origen: punto donde se cortan los ejes de las bocas.', `ACCESORIO ${def.id}`, `NOMBRE "${def.name}"`];
  if (def.desc) L.push(`DESCRIPCION "${def.desc}"`);
  L.push('', '# BOCA <nombre> <x> <y> <z>   dirección hacia fuera de la boca');
  for (const p of def.ports) L.push(`BOCA ${p.name}  ${[p.dir.x, p.dir.y, p.dir.z].map(fmtN).join(' ')}`);
  L.push('', '# VARIANTE <nombre> DIAMETROS (Ø de tubo por boca) Z (centro → tope de embocadura) EMBOCADURA (profundidad) EXTERIOR (Ø exterior del cuerpo)');
  for (const v of def.variants) L.push(`VARIANTE ${v.name}  DIAMETROS ${v.ds.join(' ')}  Z ${v.zs.map(fmtN).join(' ')}  EMBOCADURA ${v.sockets.map(fmtN).join(' ')}${v.pass ? '  PASO ' + v.pass.map(fmtN).join(' ') : ''}  EXTERIOR ${fmtN(v.od)}`);
  const models = Object.entries(def.models || {});
  if (models.length) { L.push(''); for (const [k, f] of models) L.push(`MODELO ${k} ${f}`); }
  return L.join('\n') + '\n';
}
// Definiciones de los accesorios de serie, generadas con las cotas de la configuración del proyecto
function builtinDef(kind, cfg) {
  const F = cfg.fittings, S = Math.SQRT1_2, P = (name, x, y, z) => ({ name, dir: new THREE.Vector3(x, y, z).normalize() });
  const same = (n, key) => DIAMETERS.map(d => ({ name: String(d), ds: Array(n).fill(d), zs: Array(n).fill(F[d][key]), sockets: Array(n).fill(F[d].socket), od: F[d].od }));
  const defs = {
    elbow90: { ports: [P('A', 1, 0, 0), P('B', 0, 1, 0)], variants: same(2, 'elbow90') },
    elbow45: { ports: [P('A', -1, 0, 0), P('B', S, S, 0)], variants: same(2, 'elbow45') },
    tee: { ports: [P('A', 1, 0, 0), P('B', -1, 0, 0), P('C', 0, 1, 0)], variants: same(3, 'tee') },
    coupling: { ports: [P('A', 1, 0, 0), P('B', -1, 0, 0)], variants: same(2, 'coupling') },
    reducer: { ports: [P('A', 1, 0, 0), P('B', -1, 0, 0)], variants: Object.entries(cfg.reducers).map(([k, r]) => { const [B, s] = k.split('-').map(Number); return { name: k, ds: [B, s], zs: [r.big, r.small], sockets: [F[B].socket, F[s].socket], od: F[B].od }; }) },
    teeReduced: { ports: [P('A', 1, 0, 0), P('B', -1, 0, 0), P('C', 0, 1, 0)], variants: Object.entries(cfg.teeReduced).map(([k, r]) => { const [D, d] = k.split('-').map(Number); return { name: k, ds: [D, D, d], zs: [r.run, r.run, r.branch], sockets: [F[D].socket, F[D].socket, F[d].socket], od: F[D].od }; }) },
  };
  return { id: kind, name: KIND_NAMES[kind], desc: 'Accesorio de serie', models: {}, ...defs[kind] };
}

// ---- Forma simple de un accesorio (cuerpo de cada boca + embocadura + esfera central) para dibujarlo
// mientras llega su STL de la carpeta modelos o si no lo tiene. Los STL imprimibles los genera OpenSCAD
// en el editor de accesorios y se guardan en modelos/.
function autoFittingGeometry(dirs, v) {
  const R = v.od / 2, Y = new THREE.Vector3(0, 1, 0), geos = [];
  dirs.forEach((dir, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    const z = v.zs[i], s = v.sockets[i], rIn = v.ds[i] / 2;
    if (z > 0.01) { const g = new THREE.CylinderGeometry(R * 0.94, R * 0.94, z, 40, 1, false); g.translate(0, z / 2, 0); g.applyQuaternion(q); geos.push(g); }
    const prof = [[rIn, z], [R, z], [R, z + s], [rIn, z + s], [rIn, z]].map(([x, y]) => new THREE.Vector2(x, y));
    const ring = new THREE.LatheGeometry(prof, 48); ring.applyQuaternion(q); geos.push(ring);
  });
  if (dirs.some(a => dirs.some(b => Math.abs(a.dot(b)) < 1 - 1e-6))) geos.push(new THREE.SphereGeometry(R * 0.94, 32, 16));
  return mergePositions(geos);
}
function mergePositions(geos) {
  const arrs = geos.map(g => (g.index ? g.toNonIndexed() : g).getAttribute('position').array);
  const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3)); g.computeVertexNormals(); return g;
}
function parseSTL(buffer) {
  const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : -1;
  const pos = [];
  if (n >= 0 && u8.length === 84 + n * 50) { // binario
    for (let i = 0; i < n; i++) { const off = 84 + 50 * i + 12; for (let k = 0; k < 9; k++) pos.push(dv.getFloat32(off + 4 * k, true)); }
  } else { // ASCII
    const text = new TextDecoder().decode(u8), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m;
    while ((m = re.exec(text))) pos.push(+m[1], +m[2], +m[3]);
    if (pos.length % 9) throw new Error('STL ASCII incompleto');
  }
  if (!pos.length || pos.some(v => !Number.isFinite(v))) throw new Error('El archivo STL no contiene triángulos válidos');
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
const bufToB64 = buf => { const u8 = new Uint8Array(buf); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBuf = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
// Giro que lleva las direcciones locales de las bocas (definición) a las reales (modelo)
function localToWorldQuat(pairs) {
  const [p0] = pairs; if (!p0) return new THREE.Quaternion();
  const p1 = pairs.find(p => Math.abs(p.local.dot(p0.local)) < 1 - 1e-6);
  if (!p1) return new THREE.Quaternion().setFromUnitVectors(p0.local, p0.world);
  const basis = (a, b) => { const e1 = a.clone().normalize(), e2 = b.clone().addScaledVector(e1, -b.dot(e1)).normalize(); return new THREE.Matrix4().makeBasis(e1, e2, e1.clone().cross(e2)); };
  const M = basis(p0.world, p1.world).multiply(basis(p0.local, p1.local).invert());
  return new THREE.Quaternion().setFromRotationMatrix(M);
}

/* =====================================================================
   FASE 6 — OPERACIONES DE ESTIRADO (puras sobre un Model)
   ===================================================================== */
// Nodos que se desplazan al cambiar la longitud del tramo segId moviendo su extremo nodeId.
function movingSet(m, segId, nodeId) {
  const s = m.segments.get(segId); const other = s.a === nodeId ? s.b : s.a;
  const adj = new Map([...m.nodes.keys()].map(k => [k, []]));
  for (const g of m.segments.values()) { adj.get(g.a).push(g); adj.get(g.b).push(g); }
  const seen = new Set([nodeId]), stack = [nodeId];
  while (stack.length) {
    const n = stack.pop();
    for (const g of adj.get(n)) {
      if (g.id === segId) continue;
      const o = g.a === n ? g.b : g.a;
      if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
  }
  if (!seen.has(other)) return { nodes: [...seen], loop: false };
  // Circuito cerrado: se desplaza todo lo que queda del lado del extremo respecto al plano medio del tramo.
  const A = v3(m.nodes.get(other).pos), N = v3(m.nodes.get(nodeId).pos);
  const axis = N.clone().sub(A).normalize(), mid = A.clone().add(N).multiplyScalar(0.5);
  return { nodes: [...m.nodes.values()].filter(n => v3(n.pos).sub(mid).dot(axis) > 1e-6).map(n => n.id), loop: true };
}
function segAxis(m, segId, nodeId) {
  const s = m.segments.get(segId); const other = s.a === nodeId ? s.b : s.a;
  return v3(m.nodes.get(nodeId).pos).sub(v3(m.nodes.get(other).pos)).normalize();
}
// Medida a ejes mínima: los accesorios de ambos extremos se tocan.
const minAxisLength = g => Math.max(g.Le - g.free, 1);
// Ajuste de longitud a la rejilla: en diagonales a 45° se redondea el avance en cada eje (no la medida a ejes),
// para que los extremos caigan en la rejilla y los tramos simétricos se encuentren (250 + 250 → 353,553 a ejes).
function snapLen(t, dir, step, min = 1) {
  // en direcciones libres (accesorios girados) se redondea la medida a ejes
  const c = isAllowedDir(dir) ? Math.max(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)) : 1;
  return Math.max(min, Math.round(t * c / step)) * step / c;
}
function setSegmentLength(m, segId, newLe, moveNodeId) {
  const g = analyze(m).segs.get(segId);
  const min = minAxisLength(g);
  if (!(newLe >= min - 1e-6)) throw new Error(`La medida mínima a ejes de este tramo es ${fmt(min)} mm (real ${fmt(min - g.zA - g.zB)} mm)`);
  const axis = segAxis(m, segId, moveNodeId), delta = newLe - g.Le;
  for (const id of movingSet(m, segId, moveNodeId).nodes) {
    const p = m.nodes.get(id).pos;
    m.moveNode(id, [p[0] + axis.x * delta, p[1] + axis.y * delta, p[2] + axis.z * delta]);
  }
}

/* =====================================================================
   FASE 8 — DESPIECE Y OPTIMIZACIÓN DE CORTE
   ===================================================================== */
// Regla de corte: n piezas caben en una barra B si  ΣL + kerf·(n−1) ≤ B
// (cada corte resta kerf; la última pieza no necesita corte si agota la barra).
function packBars(pieces, B, k) {
  const fits = (bar, L) => bar.sum + L + k * bar.items.length <= B + 1e-9;
  const add = (bar, p) => { bar.items.push(p); bar.sum += p.L; };
  const bestFit = (list, p) => {
    let best = null, bestRest = Infinity;
    for (const b of list) {
      if (!fits(b, p.L)) continue;
      const rest = B - (b.sum + p.L + k * b.items.length);
      if (rest < bestRest) { bestRest = rest; best = b; }
    }
    return best;
  };
  // 1) Best-Fit Decreasing
  const bars = [];
  for (const p of [...pieces].sort((a, b) => b.L - a.L)) { const b = bestFit(bars, p); if (b) add(b, p); else bars.push({ items: [p], sum: p.L }); }
  // 2) Mejora: intentar vaciar barras recolocando sus piezas en las demás
  let improved = true;
  while (improved && bars.length > 1) {
    improved = false;
    for (const victim of [...bars].sort((a, b) => a.sum - b.sum)) {
      const others = bars.filter(b => b !== victim).map(b => ({ items: [...b.items], sum: b.sum, ref: b }));
      let ok = true;
      for (const p of [...victim.items].sort((a, b) => b.L - a.L)) { const t = bestFit(others, p); if (!t) { ok = false; break; } add(t, p); }
      if (ok) { for (const o of others) { o.ref.items = o.items; o.ref.sum = o.sum; } bars.splice(bars.indexOf(victim), 1); improved = true; break; }
    }
  }
  return bars.map(b => {
    const items = [...b.items].sort((x, y) => y.L - x.L), n = items.length;
    const R = B - b.sum - k * (n - 1);            // lo que queda tras separar las n piezas con n−1 cortes
    return { items, sum: b.sum, cuts: R < 1e-9 ? n - 1 : n, retal: Math.max(0, R - k) };
  }).sort((a, b) => b.sum - a.sum);
}

function computeCutlist(m, an) {
  const B = m.config.barLength, k = m.config.kerf;
  const res = { byD: {}, oversize: [], invalid: [], marks: new Map(), fittings: [] };
  for (const d of DIAMETERS) {
    const pieces = [];
    for (const s of an.segs.values()) {
      if (s.d !== d || s.Le < 1e-6) continue;
      const L = Math.round(s.Lr);
      if (s.errors.length || L <= 0) { res.invalid.push(s); continue; }
      pieces.push({ segId: s.id, d, L, Le: s.Le });
    }
    pieces.sort((a, b) => b.L - a.L || a.segId.localeCompare(b.segId, undefined, { numeric: true }));
    pieces.forEach((p, i) => { p.mark = `${d}-${String(i + 1).padStart(2, '0')}`; res.marks.set(p.segId, p.mark); });
    const fitting = pieces.filter(p => p.L <= B);
    res.oversize.push(...pieces.filter(p => p.L > B));
    const sum = fitting.reduce((x, p) => x + p.L, 0);
    const bars = packBars(fitting, B, k);
    res.byD[d] = { pieces, bars, sum, util: bars.length ? sum / (bars.length * B) : 0, lower: Math.ceil(sum / B) };
  }
  const fm = new Map();
  for (const n of an.nodes.values()) if (n.isFitting) {
    const name = n.kind === 'custom' ? `${n.label} ${n.variant || 'Ø' + n.d}` : KIND_NAMES[n.kind] + (n.variant ? ' ' + n.variant : ' Ø' + n.d);
    fm.set(name, (fm.get(name) || 0) + 1);
  }
  res.fittings = [...fm].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return res;
}

// Divide un tramo más largo que la barra con manguitos: barras enteras + un resto (mínimo minPiece).
function splitLongSegment(m, segId, minPiece = 300) {
  const g = analyze(m).segs.get(segId), B = m.config.barLength;
  if (!g || g.Lr <= B) return 0;
  const zc = m.config.fittings[g.d].coupling;
  let k = 1; while (g.Lr - 2 * zc * k - k * B > B) k++;
  const pieces = Array(k).fill(B);
  const last = g.Lr - 2 * zc * k - k * B;
  if (last < minPiece) pieces[k - 1] -= minPiece - last;
  const A = v3(m.nodes.get(g.a).pos);
  let c = g.zA, cur = segId;
  for (const p of pieces) {
    c += p + zc;
    const n = m.splitSegment(cur, A.clone().addScaledVector(g.dir, c).toArray());
    cur = [...m.segments.values()].find(s => s.a === n).id;
    c += zc;
  }
  return k;
}

/* =====================================================================
   CARPETA DE MODELOS (modelos/) Y PROYECTO DE EJEMPLO (ejemplos/)
   =====================================================================
   Los archivos 3D no forman parte del programa: están en modelos/, junto a esta página.
     catalogo.json   lista de accesorios (de serie y personalizados) con su .pcf, .scad y un STL por variante
     pipecad.scad    librería OpenSCAD común · serie/ · personalizados/ · plantillas/ (del editor)
   Se leen por HTTP (GitHub Pages o el servidor local servidor.mjs) o, si la página se abre como archivo,
   desde la carpeta que elija el usuario. Con el servidor local además se pueden guardar y borrar. */
const MODELS = { catalog: null, files: null, server: false, error: '', geo: new Map(), loading: new Set(), failed: new Set(), bad: [] };
async function readModelFile(rel, binary = false) {
  if (MODELS.files) {
    const f = MODELS.files.get(rel); if (!f) throw new Error(`No está ${rel} en la carpeta elegida`);
    return binary ? f.arrayBuffer() : f.text();
  }
  let r; try { r = await fetch('modelos/' + rel, { cache: 'no-cache' }); } catch { throw new Error(`no se puede leer modelos/${rel} (página abierta como archivo, sin servidor)`); }
  if (!r.ok) throw new Error(`modelos/${rel}: ${r.status === 404 ? 'no existe' : 'error ' + r.status}`);
  return binary ? r.arrayBuffer() : r.text();
}
function loadModelSTL(path) {
  if (MODELS.loading.has(path) || MODELS.failed.has(path)) return;
  MODELS.loading.add(path);
  readModelFile(path, true)
    .then(buf => { MODELS.geo.set(path, parseSTL(buf)); LIB.version++; LIB.geo.clear(); hooks.stlLoaded?.(path); })
    .catch(err => { MODELS.failed.add(path); console.warn('STL no disponible', path, err); })
    .finally(() => MODELS.loading.delete(path));
}
// Lee el catálogo y los .pcf de los personalizados; los del navegador (versiones anteriores) se mantienen
async function loadModels() {
  if (!MODELS.files && location.protocol.startsWith('http')) {
    try { const r = await fetch('api/estado', { cache: 'no-store' }); MODELS.server = r.ok && !!(await r.json()).pipecad; } catch { MODELS.server = false; }
  }
  let catalog = null, error = '';
  try { catalog = JSON.parse(await readModelFile('catalogo.json')); } catch (e) { error = e.message; }
  LIB.all.clear(); loadLib();
  MODELS.catalog = catalog; MODELS.error = error; MODELS.bad = []; MODELS.geo.clear(); MODELS.failed.clear();
  for (const a of catalog?.accesorios || []) {
    if (a.tipo !== 'personalizado') continue;
    try {
      const source = await readModelFile(a.pcf), def = parsePCF(source);
      if (BUILTIN_KINDS.includes(def.id)) throw new Error('usa el identificador de un accesorio de serie');
      LIB.all.set(def.id, { def, source, origin: 'carpeta', files: a });
    } catch (e) { MODELS.bad.push(`${a.id}: ${e.message.split('\n')[0]}`); }
  }
  syncActive(); LIB.version++; LIB.geo.clear();
  hooks.modelsChanged?.();
  return catalog;
}
const builtinModel = kind => MODELS.catalog?.accesorios?.find(a => a.id === kind && a.tipo === 'serie') || null;
// Proyecto de ejemplo: ejemplos/ejemplo.json
let EXAMPLE_JSON = null;
async function loadExampleJSON() {
  if (!EXAMPLE_JSON) {
    let r; try { r = await fetch('ejemplos/ejemplo.json', { cache: 'no-cache' }); } catch { throw new Error('no se puede leer ejemplos/ejemplo.json (página abierta como archivo, sin servidor)'); }
    if (!r.ok) throw new Error(`ejemplos/ejemplo.json: ${r.status === 404 ? 'no existe' : 'error ' + r.status}`);
    EXAMPLE_JSON = await r.json();
  }
  return EXAMPLE_JSON;
}
function buildExample(m) {
  if (!EXAMPLE_JSON) throw Object.assign(new Error('omitida: no se ha podido leer ejemplos/ejemplo.json (abre PipeCAD desde un servidor)'), { skip: true });
  m.reset(); m.load(structuredClone(EXAMPLE_JSON));
}


const kindLabel = n => n.kind === 'custom' ? `${n.label}${n.variant ? ' ' + n.variant : ''}` : KIND_NAMES[n.kind] + (n.variant ? ' ' + n.variant : '');

// ---------- biblioteca de accesorios (estado de la aplicación, guardado en el navegador)
function saveLib() {
  const nav = [...LIB.all.values()].filter(e => e.origin === 'navegador');
  const ok = store.set('pipecad-lib', JSON.stringify({ disabled: [...LIB.disabled], custom: nav.map(e => ({ source: e.source, stl: e.stl || {}, ...(e.scad ? { scad: e.scad } : {}) })) }));
  return ok;
}
function loadLib() {
  try {
    const j = JSON.parse(store.get('pipecad-lib') || '{}');
    LIB.disabled = new Set((j.disabled || []).filter(k => typeof k === 'string'));
    for (const c of j.custom || []) { try { const def = parsePCF(c.source); LIB.all.set(def.id, { def, source: c.source, origin: 'navegador', stl: c.stl || {}, ...(c.scad ? { scad: c.scad } : {}) }); } catch { /* definición dañada: se ignora */ } }
  } catch { /* sin biblioteca guardada */ }
}

  return { DIAMETERS, DEFAULT_CONFIG, KIND_NAMES, BUILTIN_KINDS, FITTING_KINDS, LIB, builtinEnabled, syncActive, customGeometry, vkeyPorts, $, $$, v3, NF, fmt, esc, near, r3, NF_RAW, numStr, parseNum, cssVar, store, Model, isAllowedDir, classifyNode, matchCustom, classifyBuiltin, analyze, DIRS18, r6, cleanDir, vkey, PORT_EXTRA, fitPorts, FIT_META, storeFit, fitMeta, fittingTemplate, classifyExplicit, portZs, orientations, chooseOrientation, freeOrientations, placeFitting, currentPorts, nodeFitMeta, planRotation, localDirs, fittingAxes, detachPort, isolateGroup, transformNodes, mirrorGroup, snapshotNodes, duplicateItems, nodesBox, rotateFitting, deleteFitting, joinPlan, connectLoose, joinCandidates, joinSegments, PCF_KEYS, tokenizePCF, parsePCF, fmtN, pcfFor, builtinDef, autoFittingGeometry, mergePositions, parseSTL, bufToB64, b64ToBuf, localToWorldQuat, movingSet, segAxis, minAxisLength, snapLen, setSegmentLength, packBars, computeCutlist, splitLongSegment, MODELS, readModelFile, loadModelSTL, loadModels, builtinModel, loadExampleJSON, buildExample, kindLabel, saveLib, loadLib };
};
})(globalThis);
