// PipeCAD VR · kit de paneles 3D dibujados en CanvasTexture (sin dependencias)
// Botones, interruptores, grupos de opciones, listas con desplazamiento, deslizadores, teclado numérico y
// paneles con título que se pueden arrastrar, anclar y cerrar. Se manejan tocándolos con el índice
// (se confirma al atravesar el plano; zona de toque mínima de 18 mm) o con el rayo y pellizco o gatillo.
// La disposición y la detección de toques no dependen del DOM: se prueban sin gráficos.
// Script clásico con fábrica. Uso:  const kit = crearPanelesXR(THREE, { px, tema })
//   const p = kit.panel({ id, titulo, ancho, construir: () => [fila, fila, …] })      fila = [celda, …] o { h, celdas }
//   celda = { t: 'boton' | 'texto' | 'desliz' | 'hueco', texto, sub, w, on, off, color, accion, … }
//   kit.actualizar(punteros, ahora)   punteros = [{ id, o, d, apretando, punta }] en coordenadas del mundo
(function (global) {
'use strict';
global.crearPanelesXR = function (THREE, opts = {}) {
const PX = opts.px || 2600;                 // píxeles de textura por metro
const MIN_TOQUE = 0.018;                    // zona de toque mínima (m)
const M = 0.004, TIT = 0.026, FILA = 0.026; // margen, alto del título y alto de fila por defecto (m)
const TEMAS = {
  oscuro: { fondo: 'rgba(20,23,28,.92)', borde: 'rgba(255,255,255,.22)', texto: '#ffffff', tenue: '#aab3be', boton: 'rgba(255,255,255,.13)', hover: 'rgba(255,255,255,.26)', on: '#2f6fde', onTexto: '#ffffff', err: '#f0616a', warn: '#e8a33a', ok: '#4cbf7d', titulo: 'rgba(255,255,255,.08)' },
  claro: { fondo: 'rgba(250,251,252,.95)', borde: 'rgba(0,0,0,.25)', texto: '#1c2128', tenue: '#59636f', boton: 'rgba(0,0,0,.08)', hover: 'rgba(0,0,0,.18)', on: '#2f6fde', onTexto: '#ffffff', err: '#d4373c', warn: '#b06f00', ok: '#2b8a53', titulo: 'rgba(0,0,0,.06)' },
  contraste: { fondo: '#000000', borde: '#ffffff', texto: '#ffffff', tenue: '#ffffff', boton: '#1b1b1b', hover: '#555555', on: '#ffd400', onTexto: '#000000', err: '#ff5c5c', warn: '#ffd400', ok: '#5cff8f', titulo: '#222222' },
};
const kit = { paneles: [], tema: TEMAS[opts.tema] || TEMAS.oscuro, temaNombre: opts.tema || 'oscuro', escalaTexto: 1, escala: 1, grupo: new THREE.Group(), pulsaciones: 0, alPulsar: null };
kit.grupo.name = 'paneles';
const conDOM = typeof document !== 'undefined';

function Panel(def) {
  const p = this;
  Object.assign(p, { id: def.id, titulo: def.titulo || '', ancho: def.ancho || 0.2, construir: def.construir, cerrable: def.cerrable !== false, anclable: def.anclable !== false,
    arrastrable: def.arrastrable !== false, anclado: !!def.anclado, visible: false, sucio: true, zonas: [], alto: 0.1, scroll: {}, hover: null, alCerrar: def.alCerrar || null, sinTitulo: !!def.sinTitulo, inerte: !!def.inerte });
  p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  p.mesh.renderOrder = 30; p.mesh.visible = false; p.mesh.userData.panel = p;
  if (conDOM) { p.canvas = document.createElement('canvas'); p.tex = new THREE.CanvasTexture(p.canvas); p.tex.colorSpace = THREE.SRGBColorSpace; p.tex.anisotropy = 4; p.mesh.material.map = p.tex; }
  kit.grupo.add(p.mesh); kit.paneles.push(p);
}
Panel.prototype = {
  mostrar(v = true) { if (this.visible !== v) { this.visible = v; this.mesh.visible = v; this.sucio = true; if (!v) { this.hover = null; this.alCerrar?.(); } } return this; },
  alternar() { return this.mostrar(!this.visible); },
  refrescar() { this.sucio = true; },
  // Calcula las zonas (en metros desde la esquina superior izquierda) a partir de las filas
  disponer() {
    const p = this, e = kit.escala, W = p.ancho * e, zonas = [];
    let y = M * e;
    if (!p.sinTitulo) {
      const h = TIT * e; let x1 = W - M * e;
      if (p.cerrable) { zonas.push({ t: 'boton', id: '#cerrar', texto: '✕', x: x1 - h, y, w: h, h, accion: () => p.mostrar(false), plano: true }); x1 -= h + M * e; }
      if (p.anclable) { zonas.push({ t: 'boton', id: '#anclar', texto: p.anclado ? 'Fijo' : 'Fijar', on: p.anclado, x: x1 - h * 1.7, y, w: h * 1.7, h, accion: () => { p.anclado = !p.anclado; p.sucio = true; }, plano: true }); x1 -= h * 1.7 + M * e; }
      zonas.push({ t: 'titulo', id: '#titulo', texto: p.titulo, x: M * e, y, w: x1 - M * e, h });
      y += h + M * e;
    }
    const filas = (p.construir?.(p) || []).flatMap(f => p.expandir(f));
    for (const f of filas) {
      const celdas = Array.isArray(f) ? f : f.celdas, h = (Array.isArray(f) ? FILA : f.h || FILA) * e;
      const total = celdas.reduce((s, c) => s + (c.w || 1), 0), util = W - M * e * (celdas.length + 1);
      let x = M * e;
      for (const c of celdas) { const w = util * (c.w || 1) / total; if (c.t !== 'hueco') zonas.push({ ...c, t: c.t || 'boton', x, y, w, h }); x += w + M * e; }
      y += h + M * e;
    }
    p.zonas = zonas; p.alto = y; p.mesh.scale.set(W, y, 1);
    return zonas;
  },
  // Una fila { t: 'lista', id, items, n, h } se convierte en n filas más la de desplazamiento
  expandir(f) {
    if (Array.isArray(f) || f.t !== 'lista') return [f];
    const p = this, n = f.n || 6, max = Math.max(0, f.items.length - n);
    const off = p.scroll[f.id] = Math.min(max, Math.max(0, p.scroll[f.id] || 0));
    const out = f.items.slice(off, off + n).map(it => ({ h: f.h || FILA, celdas: Array.isArray(it) ? it : [{ t: it.accion ? 'boton' : 'texto', izq: true, ...it }] }));
    if (!f.items.length && f.vacio) out.push({ h: f.h || FILA, celdas: [{ t: 'texto', texto: f.vacio, tenue: true }] });
    if (max > 0) out.push({ h: FILA * 0.9, celdas: [
      { texto: '▲', off: off === 0, accion: () => { p.scroll[f.id] = off - Math.max(1, n - 1); p.sucio = true; } },
      { t: 'texto', texto: `${off + 1}–${Math.min(off + n, f.items.length)} de ${f.items.length}`, tenue: true, w: 2 },
      { texto: '▼', off: off >= max, accion: () => { p.scroll[f.id] = off + Math.max(1, n - 1); p.sucio = true; } }] });
    return out;
  },
  // Zona pulsable en (x, y) metros desde la esquina superior izquierda; si no cae en ninguna, la más cercana dentro de su zona mínima
  zonaEn(x, y) {
    let best = null, bd = Infinity;
    for (const z of this.zonas) {
      if (z.t === 'texto' && !z.accion) continue;
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
      const mx = Math.max(0, MIN_TOQUE - z.w) / 2, my = Math.max(0, MIN_TOQUE - z.h) / 2;
      if (x >= z.x - mx && x <= z.x + z.w + mx && y >= z.y - my && y <= z.y + z.h + my) { const d = Math.hypot(x - z.x - z.w / 2, y - z.y - z.h / 2); if (d < bd) { bd = d; best = z; } }
    }
    return best;
  },
  // Punto del mundo → { x, y, z }: x, y en metros desde la esquina superior izquierda y z la distancia delante del panel
  local(pw) {
    this.mesh.updateMatrixWorld(true);
    const l = this.mesh.worldToLocal(pw.clone());
    return { x: (l.x + 0.5) * this.mesh.scale.x, y: (0.5 - l.y) * this.mesh.scale.y, z: l.z, dentro: Math.abs(l.x) <= 0.5 && Math.abs(l.y) <= 0.5 };
  },
  rayo(o, d) { // corte de un rayo del mundo con el panel: { x, y, dist, dentro } o null
    this.mesh.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld), c = new THREE.Vector3().setFromMatrixPosition(this.mesh.matrixWorld);
    const den = d.dot(n); if (Math.abs(den) < 1e-5) return null;
    const t = c.clone().sub(o).dot(n) / den; if (t <= 0 || t > 6) return null;
    const l = this.local(o.clone().addScaledVector(d, t));
    return l.dentro ? { x: l.x, y: l.y, dist: t } : null;
  },
  pulsar(z, x) { // ejecuta la zona (x: posición del toque, para los deslizadores)
    if (!z || z.off) return false;
    if (z.t === 'desliz') { this.deslizar(z, x); return true; }
    if (z.t === 'titulo' || !z.accion) return false;
    kit.pulsaciones++; z.accion(z); this.sucio = true; kit.alPulsar?.(this, z);
    return true;
  },
  deslizar(z, x) {
    const k = THREE.MathUtils.clamp((x - z.x - z.h / 2) / (z.w - z.h), 0, 1), paso = z.paso || 1;
    const v = THREE.MathUtils.clamp(Math.round((z.min + k * (z.max - z.min)) / paso) * paso, z.min, z.max);
    if (v !== z.valor) { z.valor = v; z.accion?.(v); this.sucio = true; }
  },
  // Coloca el panel delante de la cabeza, mirándola
  frente(cabeza, dir, dist = 0.55, lado = 0, alto = -0.12) {
    const f = new THREE.Vector3(dir.x, 0, dir.z); if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0));
    this.mesh.position.copy(cabeza).addScaledVector(f, dist).addScaledVector(r, lado).add(new THREE.Vector3(0, alto, 0));
    this.mirar(cabeza); return this;
  },
  mirar(cabeza) { this.mesh.lookAt(cabeza); return this; },
  dibujar() {
    const p = this; if (!p.sucio) return;
    p.disponer(); p.sucio = false;
    if (!p.canvas) return;
    const W = Math.round(p.mesh.scale.x * PX), H = Math.round(p.alto * PX), c = p.canvas, T = kit.tema;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; p.tex.dispose(); }
    const g = c.getContext('2d'), k = PX, fs = FILA * kit.escala * k * 0.42 * kit.escalaTexto;
    g.clearRect(0, 0, W, H);
    g.fillStyle = T.fondo; g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, 0.008 * k); g.fill();
    g.strokeStyle = T.borde; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'middle';
    for (const z of p.zonas) {
      const x = z.x * k, y = z.y * k, w = z.w * k, h = z.h * k, hov = p.hover === z.id && z.id != null;
      if (z.t === 'titulo') { g.fillStyle = T.titulo; g.beginPath(); g.roundRect(x, y, w, h, 0.005 * k); g.fill(); texto(g, z.texto, x + 0.004 * k, y, w - 0.008 * k, h, fs, T.texto, true, 700); continue; }
      if (z.t === 'desliz') {
        const f = (z.valor - z.min) / (z.max - z.min || 1), cx = x + h / 2 + f * (w - h);
        g.fillStyle = T.boton; g.beginPath(); g.roundRect(x, y + h * 0.38, w, h * 0.24, h * 0.12); g.fill();
        g.fillStyle = T.on; g.beginPath(); g.roundRect(x, y + h * 0.38, cx - x, h * 0.24, h * 0.12); g.fill();
        g.beginPath(); g.arc(cx, y + h / 2, h * 0.36, 0, Math.PI * 2); g.fill(); continue;
      }
      if (z.t !== 'texto' || z.accion || z.fondo) {
        g.fillStyle = z.fondo || (z.on ? T.on : z.color || (hov && !z.off ? T.hover : T.boton));
        g.globalAlpha = z.off ? 0.4 : 1; g.beginPath(); g.roundRect(x, y, w, h, 0.004 * k); g.fill(); g.globalAlpha = 1;
      }
      if (z.barra) { // esquema de cortes de una barra: [{ L, c, t }] + retal
        let bx = x; const tot = z.barra.reduce((s, b) => s + b.L, 0) || 1;
        for (const b of z.barra) { const bw = w * b.L / tot; g.fillStyle = b.c; g.fillRect(bx + 1, y + 1, Math.max(1, bw - 2), h - 2); if (b.t && bw > fs * 2.2) texto(g, b.t, bx, y, bw, h, fs * 0.8, '#fff', false, 600); bx += bw; }
        continue;
      }
      const col = z.off ? T.tenue : z.on ? T.onTexto : z.err ? T.err : z.warn ? T.warn : z.ok ? T.ok : z.tenue ? T.tenue : T.texto;
      const pad = 0.003 * k, size = fs * (z.grande ? 1.5 : z.chico ? 0.82 : 1);
      if (z.sub) { texto(g, z.texto, x + pad, y, w - 2 * pad, h * 0.6, size, col, z.izq, z.t === 'texto' ? 500 : 600); texto(g, z.sub, x + pad, y + h * 0.52, w - 2 * pad, h * 0.44, size * 0.74, z.on ? T.onTexto : T.tenue, z.izq, 400); }
      else texto(g, z.texto ?? '', x + pad, y, w - 2 * pad, h, size, col, z.izq, z.t === 'texto' && !z.accion ? 500 : 600, z.lineas);
    }
    p.tex.needsUpdate = true;
  },
};
// Texto centrado (o a la izquierda) que se encoge si no cabe; con «lineas» se parte en varias
function texto(g, s, x, y, w, h, size, color, izq, peso = 600, lineas = 1) {
  s = String(s); g.fillStyle = color; g.textAlign = izq ? 'left' : 'center';
  const font = z => { g.font = `${peso} ${z}px system-ui, "Segoe UI", Roboto, sans-serif`; };
  font(size);
  let rows = [s];
  if (lineas > 1 && g.measureText(s).width > w) { // reparto de palabras en líneas
    rows = []; let cur = '';
    for (const word of s.split(' ')) { const t = cur ? cur + ' ' + word : word; if (g.measureText(t).width > w && cur) { rows.push(cur); cur = word; } else cur = t; }
    rows.push(cur); if (rows.length > lineas) { rows = rows.slice(0, lineas); rows[lineas - 1] += '…'; }
  }
  const mw = Math.max(...rows.map(r => g.measureText(r).width));
  let z = size; if (mw > w) { z = Math.max(size * 0.55, size * w / mw); font(z); }
  const lh = z * 1.15, y0 = y + h / 2 - (rows.length - 1) * lh / 2;
  rows.forEach((r, i) => g.fillText(r, izq ? x : x + w / 2, y0 + i * lh + z * 0.04, izq ? w : undefined));
}

kit.panel = def => new Panel(def);
kit.porId = id => kit.paneles.find(p => p.id === id);
kit.setTema = nombre => { kit.tema = TEMAS[nombre] || TEMAS.oscuro; kit.temaNombre = nombre; for (const p of kit.paneles) p.sucio = true; };
kit.setEscala = (e, texto = kit.escalaTexto) => { kit.escala = e; kit.escalaTexto = texto; for (const p of kit.paneles) p.sucio = true; };
kit.refrescar = () => { for (const p of kit.paneles) p.sucio = true; };
kit.dibujar = () => { for (const p of kit.paneles) if (p.visible) p.dibujar(); };

/* ---------------------------------------------------------------- interacción */
// Estado por puntero: toque armado (hay que retirar el dedo 12 mm para volver a pulsar), arrastre de panel o de deslizador
const est = new Map();
const ARMAR = 0.012, CONFIRMA = 0.002, CERCA = 0.06, PAUSA = 140;
// punteros: [{ id, o, d, apretando, punta }] · devuelve { ocupados: Set(id), rayos: Map(id → distancia) }
kit.actualizar = (punteros, ahora = 0) => {
  const ocupados = new Set(), rayos = new Map(), visibles = kit.paneles.filter(p => p.visible && !p.inerte);
  for (const p of kit.paneles) if (p.visible && p.inerte && p.sucio) p.disponer();
  for (const p of visibles) { if (p.sucio) p.disponer(); p._hover = null; }
  for (const q of punteros) {
    let e = est.get(q.id); if (!e) est.set(q.id, e = { armado: new Map(), ultima: -1e9, era: false, arrastre: null });
    // 1) arrastre en curso (panel por el título o deslizador)
    if (e.arrastre) {
      const a = e.arrastre;
      if (!q.apretando || !a.panel.visible || !q.o) e.arrastre = null;
      else {
        ocupados.add(q.id);
        if (a.tipo === 'panel') { a.panel.mesh.position.copy(q.o).addScaledVector(q.d, a.dist).add(a.off); if (q.cabeza) a.panel.mirar(q.cabeza); rayos.set(q.id, a.dist); }
        else { const h = a.panel.rayo(q.o, q.d); if (h) { a.panel.deslizar(a.zona, h.x); rayos.set(q.id, h.dist); } }
        e.era = q.apretando; continue;
      }
    }
    // 2) toque con la punta del índice
    let tocando = false;
    if (q.punta) for (const p of visibles) {
      const l = p.local(q.punta), arm = e.armado.get(p) ?? false;
      if (!l.dentro || Math.abs(l.z) > CERCA) { if (l.z > ARMAR || !l.dentro) e.armado.set(p, l.z > ARMAR); continue; }
      ocupados.add(q.id); tocando = true;
      const z = p.zonaEn(l.x, l.y);
      if (l.z > ARMAR) { e.armado.set(p, true); p._hover = z?.id ?? null; }
      else if (l.z <= CONFIRMA && arm && ahora - e.ultima > PAUSA) { // ha atravesado el plano: pulsación
        e.armado.set(p, false); e.ultima = ahora;
        if (p.pulsar(z, l.x)) q.vibra?.(0.4, 25);
      } else if (arm) p._hover = z?.id ?? null;
    }
    // 3) rayo con pellizco o gatillo
    if (!tocando && q.o && q.d) {
      let best = null;
      for (const p of visibles) { const h = p.rayo(q.o, q.d); if (h && (!best || h.dist < best.h.dist)) best = { p, h }; }
      if (best) {
        const { p, h } = best, z = p.zonaEn(h.x, h.y);
        ocupados.add(q.id); rayos.set(q.id, h.dist); p._hover = z?.id ?? null;
        if (q.apretando && !e.era && ahora - e.ultima > PAUSA) {
          e.ultima = ahora;
          if (z?.t === 'titulo' && p.arrastrable) { const pt = q.o.clone().addScaledVector(q.d, h.dist); e.arrastre = { tipo: 'panel', panel: p, dist: h.dist, off: p.mesh.position.clone().sub(pt) }; }
          else if (z?.t === 'desliz' && !z.off) { e.arrastre = { tipo: 'desliz', panel: p, zona: z }; p.deslizar(z, h.x); }
          else if (p.pulsar(z, h.x)) q.vibra?.(0.4, 25);
        }
      }
    }
    e.era = !!q.apretando;
  }
  for (const p of visibles) if (p._hover !== p.hover) { p.hover = p._hover; p.sucio = true; }
  return { ocupados, rayos };
};

/* ---------------------------------------------------------------- teclado numérico */
// Panel flotante para escribir una medida: dígitos, coma decimal, signo, borrar y aceptar
const tk = { txt: '', titulo: '', unidad: 'mm', alAceptar: null, alCancelar: null, negativo: true };
const valorTeclado = () => { const v = parseFloat(tk.txt.replace(',', '.')); return isFinite(v) ? v : NaN; };
function tecla(k) {
  if (k === 'ok') { const v = valorTeclado(), f = tk.alAceptar; if (!isFinite(v)) return; cerrarTeclado(); f?.(v); return; }
  if (k === 'x') { const f = tk.alCancelar; cerrarTeclado(); f?.(); return; }
  if (k === 'c') tk.txt = '';
  else if (k === '<') tk.txt = tk.txt.slice(0, -1);
  else if (k === '±') { if (tk.negativo) tk.txt = tk.txt.startsWith('-') ? tk.txt.slice(1) : '-' + tk.txt; }
  else if (k === ',') { if (!tk.txt.includes(',')) tk.txt += tk.txt === '' || tk.txt === '-' ? '0,' : ','; }
  else if (tk.txt.replace(/[-,]/g, '').length < 8) tk.txt = (tk.txt === '0' ? '' : tk.txt === '-0' ? '-' : tk.txt) + k;
}
function cerrarTeclado() { tk.alAceptar = tk.alCancelar = null; kit.tecladoPanel.visible = true; kit.tecladoPanel.alCerrar = null; kit.tecladoPanel.mostrar(false); }
const B = (texto, k = texto, extra = {}) => ({ texto, accion: () => tecla(k), grande: true, ...extra });
kit.tecladoPanel = kit.panel({ id: 'teclado', titulo: 'Medida', ancho: 0.15, anclable: false, cerrable: false, construir: p => {
  p.titulo = tk.titulo;
  return [
    { h: 0.03, celdas: [{ t: 'texto', texto: (tk.txt || '0') + ' ' + tk.unidad, grande: true, fondo: kit.tema.boton }] },
    { h: 0.032, celdas: [B('7'), B('8'), B('9'), B('⌫', '<')] },
    { h: 0.032, celdas: [B('4'), B('5'), B('6'), B('±', '±', { off: !tk.negativo })] },
    { h: 0.032, celdas: [B('1'), B('2'), B('3'), B('C', 'c')] },
    { h: 0.032, celdas: [B('0'), B(','), B('OK', 'ok', { w: 2, on: true, grande: false })] },
    { h: 0.024, celdas: [B('Cancelar', 'x', { grande: false })] },
  ];
} });
kit.teclado = ({ titulo = 'Medida', valor = '', unidad = 'mm', negativo = true, alAceptar, alCancelar } = {}) => {
  Object.assign(tk, { titulo, unidad, negativo, alAceptar, alCancelar, txt: valor === '' || valor == null ? '' : String(valor).replace('.', ',') });
  const p = kit.tecladoPanel; p.visible = false; p.mostrar(true); p.alCerrar = () => { const f = tk.alCancelar; tk.alAceptar = tk.alCancelar = null; f?.(); };
  return p;
};
kit.tecladoTexto = () => tk.txt;
kit.tecladoAbierto = () => kit.tecladoPanel.visible;
kit.tecla = k => { tecla(k); kit.tecladoPanel.sucio = true; };
kit.TEMAS = TEMAS; kit.MIN_TOQUE = MIN_TOQUE;
return kit;
};
})(globalThis);
