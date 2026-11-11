// PipeCAD VR · pruebas de lógica con gestos simulados (sin gráficos ni gafas)
// Se ejecutan en vr.html?test (en el navegador) y con «node pruebas/vr.mjs» si está instalado three.
// Uso:  const resultados = pruebasVR(THREE, nucleo, { ejemplo })   → [{ name, ok, skipped, detail }]
(function (global) {
'use strict';
global.pruebasVR = function (THREE, N, extras = {}) {
  const { Model, analyze, computeCutlist, near, fmt, setSegmentLength, rotateFitting, placeFitting, fittingTemplate, joinSegments, connectLoose } = N;
  const S = global.crearSesionXR, E = global.crearEntradasXR;
  const results = [];
  const test = (name, fn) => { try { const r = fn(); results.push({ name, ok: r === true, detail: r === true ? '' : String(r) }); } catch (e) { results.push({ name, ok: !!e.skip, skipped: !!e.skip, detail: e.skip ? e.message : (e.stack || e.message) }); } };
  const eq = (got, exp, what, tol = 0.01) => near(got, exp, tol) ? true : `${what}: esperado ${exp}, obtenido ${fmt(got, 3)}`;
  const all = (...checks) => checks.find(c => c !== true) ?? true;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mano = (x, y, z, tol = 100) => ({ p: V(x, y, z), tol });                       // puntero directo (maqueta 1:10: 10 mm de mano)
  const rayo = (x, y, z = 0) => ({ o: V(x, y, z + 2000), d: V(0, 0, -1), tolAng: 0.03, tolMin: 5 }); // rayo vertical desde arriba
  const nuevo = (json) => { const m = new Model(); if (json) m.load(structuredClone(json)); const msgs = []; const ed = global.crearEditorVR(THREE, N, m, { estado: t => msgs.push(t) }); return { m, ed, msgs }; };
  const build = (nodes, segs) => { const m = new Model(), ids = {}; for (const k in nodes) ids[k] = m.addNode(nodes[k]); const sid = {}; for (const [a, b, d] of segs) sid[a + b] = m.addSegment(ids[a], ids[b], d); return { m, ids, sid }; };
  const cortes = m => { const an = analyze(m), c = computeCutlist(m, an); return JSON.stringify({ p: N.DIAMETERS.map(d => c.byD[d].pieces.map(p => p.L)), b: N.DIAMETERS.map(d => c.byD[d].bars.map(b => b.items.map(p => p.L))), f: c.fittings }); };
  const tubo = (ed, P, a, b) => { ed.drawPress(P(...a)); ed.drawRelease(P(...b)); };
  // Marco cuadrado de 600 mm con 4 codos y una Te, dibujado con gestos (pellizcar, arrastrar y soltar con algo de temblor)
  function marco(ed, P) {
    ed.setTool('draw');
    ed.drawPress(P(2, -3, 0)); ed.drawRelease(P(603, 4, 0));        // primer lado
    ed.drawPress(P(600, 2, 0)); ed.drawRelease(P(598, 597, 0));
    ed.drawPress(P(600, 600, 0)); ed.drawRelease(P(-3, 602, 0));
    ed.drawPress(P(0, 600, 0)); ed.drawRelease(P(2, 3, 0));         // cierra sobre el primer punto
    ed.drawPress(P(301, 2, 0)); ed.drawRelease(P(300, -302, 0));    // Te desde el punto medio de un lado
    ed.drawPress(P(300, -300, 0)); ed.drawRelease(P(300, -300, 0)); // pellizco corto en el sitio: termina
  }
  const marcoRef = () => build({ a: [0, 0, 0], b: [600, 0, 0], c: [600, 600, 0], d: [0, 600, 0], t: [300, 0, 0], e: [300, -300, 0] },
    [['a', 't', 20], ['t', 'b', 20], ['b', 'c', 20], ['c', 'd', 20], ['d', 'a', 20], ['t', 'e', 20]]).m;

  test('VR4 · marco de 600 mm con 4 codos y una Te dibujado con la mano: mismo despiece que con el ratón', () => {
    const { m, ed } = nuevo(); marco(ed, mano);
    const an = analyze(m), kinds = [...an.nodes.values()].map(n => n.kind).sort().join(',');
    return all(m.segments.size === 6 || `tramos: ${m.segments.size}`, kinds === 'elbow90,elbow90,elbow90,elbow90,end,tee' || 'accesorios: ' + kinds,
      cortes(m) === cortes(marcoRef()) || 'despiece distinto: ' + cortes(m), !ed.draw.start || 'no ha terminado el dibujo');
  });
  test('VR4 · el mismo marco dibujado con el rayo (mando o tamaño real) da el mismo resultado', () => {
    const { m, ed } = nuevo(); marco(ed, rayo);
    return all(m.segments.size === 6 || `tramos: ${m.segments.size}`, cortes(m) === cortes(marcoRef()) || 'despiece distinto');
  });
  test('VR4 · longitudes reales del marco: 578, 278 y 289 mm', () => {
    const { m, ed } = nuevo(); marco(ed, mano);
    const L = [...analyze(m).segs.values()].map(s => Math.round(s.Lr)).sort((a, b) => a - b).join(',');
    return L === '278,278,289,578,578,578' || 'longitudes: ' + L;
  });
  test('VR4 · la mano tiembla ±4 mm y el punto cae exacto en la rejilla de 10 mm', () => {
    const { m, ed } = nuevo(); ed.setTool('draw');
    tubo(ed, mano, [3.7, -2.2, 0], [246, 3.1, 1.5]);
    const ps = [...m.nodes.values()].map(n => n.pos.join(',')).sort().join(' | ');
    return ps === '0,0,0 | 250,0,0' || 'nodos: ' + ps;
  });
  test('VR4 · longitud exacta con el teclado numérico: 1250,5 mm a ejes', () => {
    const { m, ed } = nuevo(); ed.setTool('draw');
    ed.drawPress(mano(0, 0, 0)); ed.drawMove(mano(400, 20, 0));
    const ok = ed.typedLength(1250.5), s = [...analyze(m).segs.values()][0];
    return all(ok === true || 'no se aceptó', eq(s.Le, 1250.5, 'Le'));
  });
  test('VR4 · joystick: la longitud sube y baja por pasos de snap', () => {
    const { m, ed } = nuevo(); ed.setTool('draw');
    ed.drawPress(mano(0, 0, 0)); ed.drawMove(mano(302, 0, 0)); ed.drawStep(1); ed.drawStep(1); ed.drawStep(-1);
    const len = ed.draw.cand.len; ed.commitDraw(ed.draw.cand);
    return all(eq(len, 310, 'longitud por pasos'), eq([...analyze(m).segs.values()][0].Le, 310, 'Le'));
  });
  test('VR4 · dibujar hacia arriba: tramo vertical con codo automático', () => {
    const { m, ed } = nuevo(); ed.setTool('draw');
    tubo(ed, mano, [0, 0, 0], [500, 0, 0]); tubo(ed, mano, [500, 0, 0], [503, 2, 398]);
    const an = analyze(m), k = [...an.nodes.values()].map(n => n.kind).sort().join(',');
    return all(k === 'elbow90,end,end' || k, [...m.nodes.values()].some(n => n.pos[2] === 400) || 'no sube 400');
  });
  test('VR4 · unión automática: terminar sobre otro tubo crea una Te', () => {
    const { m, ed } = nuevo(); ed.setTool('draw');
    tubo(ed, mano, [0, 0, 0], [1000, 0, 0]); ed.drawFinish(true);
    tubo(ed, mano, [500, 400, 0], [500, 8, 0]);
    const k = [...analyze(m).nodes.values()].map(n => n.kind).sort().join(',');
    return k === 'end,end,end,tee' || 'accesorios: ' + k;
  });
  test('VR4 · unión no válida (tres tubos perpendiculares en un codo): en rojo, se avisa y no se dibuja', () => {
    const { m, ed, msgs } = nuevo(); ed.setTool('draw');
    tubo(ed, mano, [0, 500, 0], [0, 0, 0]); tubo(ed, mano, [0, 0, 0], [500, 0, 0]); ed.drawFinish(true);
    ed.setPlane('xy', -300); ed.drawPress(mano(0, 0, -300)); ed.drawMove(mano(2, 1, -4));
    const rojo = ed.previa.ok === false && ed.previa.cyls.some(c => c.tipo === 'bad'), antes = m.segments.size; ed.drawRelease(mano(2, 1, -4));
    return all(rojo || 'la vista previa no sale en rojo', m.segments.size === antes || 'se ha dibujado', msgs.some(t => t.startsWith('✘')) || 'no avisa');
  });
  test('VR4 · plano de trabajo XZ a 200 mm: el punto libre cae en ese plano', () => {
    const { ed } = nuevo(); ed.setPlane('xz', 200);
    const p = ed.planePoint(mano(123, 570, 348));
    return all(eq(p.x, 120, 'x'), eq(p.y, 200, 'y'), eq(p.z, 350, 'z'));
  });
  test('VR4 · regla vertical: con el plano XY el punto conserva la altura de la mano, por pasos', () => {
    const { ed } = nuevo(); ed.state.regla = true;
    const p = ed.planePoint(mano(101, 99, 347));
    return all(eq(p.x, 100, 'x'), eq(p.y, 100, 'y'), eq(p.z, 350, 'z'));
  });

  test('VR5 · insertar una Te en mitad de un tubo: lo parte en dos', () => {
    const { m, ed } = nuevo(); ed.setTool('draw'); tubo(ed, mano, [0, 0, 0], [1000, 0, 0]);
    ed.setTool('place'); ed.state.fit = 'tee'; ed.placeMove(mano(498, 6, 3));
    const id = ed.placeCommit(), an = analyze(m), n = an.nodes.get(id);
    return all(!!id || 'no se colocó', n.kind === 'tee' || n.kind, n.open.length === 1 || 'bocas libres: ' + n.open.length, m.segments.size === 2 || 'tramos', eq(n.pos.x, 500, 'x'));
  });
  test('VR5 · un codo no se puede insertar en mitad de un tubo recto', () => {
    const { m, ed } = nuevo(); ed.setTool('draw'); tubo(ed, mano, [0, 0, 0], [1000, 0, 0]);
    ed.setTool('place'); ed.state.fit = 'elbow90'; ed.placeMove(mano(500, 0, 0));
    return all(ed.place.ok === false || 'debería rechazarse', ed.placeCommit() === false || 'se colocó', m.segments.size === 1 || 'tramos');
  });
  test('VR5 · accesorio en el extremo de un tubo y tubo desde su boca libre', () => {
    const { m, ed } = nuevo(); ed.setTool('draw'); tubo(ed, mano, [0, 0, 0], [500, 0, 0]);
    ed.setTool('place'); ed.state.fit = 'elbow90'; ed.placeMove(mano(503, 2, 0)); const id = ed.placeCommit();
    const an = analyze(m), n = an.nodes.get(id), dir = n.open[0].dir;
    ed.setTool('draw'); const P = n.pos.clone(), Q = P.clone().addScaledVector(dir, 300);
    tubo(ed, mano, [P.x, P.y, P.z], [Q.x + 2, Q.y - 3, Q.z + 1]);
    const an2 = analyze(m);
    return all(n.kind === 'elbow90' || n.kind, an2.nodes.get(id).open.length === 0 || 'la boca sigue libre', m.segments.size === 2 || 'tramos: ' + m.segments.size, !an2.nodes.get(id).errors.length || 'errores');
  });
  test('VR5 · giro con la muñeca al colocar: 50° se queda en el paso de 45° sobre Z', () => {
    const { ed } = nuevo(); ed.setTool('place'); ed.state.fit = 'elbow90';
    const g = ed.placeTwist(new THREE.Quaternion().setFromAxisAngle(V(0.05, 0.02, 1).normalize(), THREE.MathUtils.degToRad(50)));
    ed.placeMove(mano(0, 0, 0));
    const d = ed.place.ports.map(p => p.dir);
    return all(g.i === 2 || 'eje ' + g.i, eq(THREE.MathUtils.radToDeg(g.ang), 45, 'ángulo'), eq(d[0].x, Math.SQRT1_2, 'boca A x', 1e-3), eq(d[0].y, Math.SQRT1_2, 'boca A y', 1e-3));
  });
  test('VR5 · girar un accesorio colocado con la muñeca = rotateFitting del núcleo', () => {
    const mk = () => { const t = build({ a: [-500, 0, 0], b: [0, 0, 0], c: [500, 0, 0], d: [0, 400, 0] }, [['a', 'b', 20], ['b', 'c', 20], ['b', 'd', 20]]); return t; };
    const t1 = mk(), ed = global.crearEditorVR(THREE, N, t1.m, {});
    ed.rotBegin(t1.ids.b);
    ed.rotMove(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), THREE.MathUtils.degToRad(97))); // sobre el eje del tramo principal
    const eje = ed.rot.ejes[ed.rot.i].axis.clone(), ang = ed.rot.ang; ed.rotEnd();
    const t2 = mk(); rotateFitting(t2.m, t2.ids.b, eje, ang);
    return all(eq(Math.abs(THREE.MathUtils.radToDeg(ang)), 90, 'ángulo'), JSON.stringify(t1.m.toJSON().nodes) === JSON.stringify(t2.m.toJSON().nodes) || 'resultado distinto del núcleo',
      t1.m.undoStack.length === 1 || 'debe ser un solo paso de deshacer');
  });
  test('VR5 · estirar con el punto de arrastre = setSegmentLength del núcleo (lo conectado se desplaza)', () => {
    const mk = () => build({ a: [0, -500, 0], b: [0, 0, 0], c: [1000, 0, 0], d: [1000, 500, 0] }, [['a', 'b', 20], ['b', 'c', 20], ['c', 'd', 20]]);
    const t1 = mk(), ed = global.crearEditorVR(THREE, N, t1.m, {});
    ed.select({ type: 'seg', id: t1.sid.bc });
    const h = ed.handles().find(x => x.nodeId === t1.ids.c);
    ed.stretchBegin(h.nodeId, h.segId, mano(h.pos.x, h.pos.y, h.pos.z));
    ed.stretchMove(mano(h.pos.x + 120, 7, 2)); ed.stretchMove(mano(h.pos.x + 203, -5, 4)); ed.stretchEnd();
    const t2 = mk(); setSegmentLength(t2.m, t2.sid.bc, 1200, t2.ids.c);
    return all(JSON.stringify(t1.m.toJSON().nodes) === JSON.stringify(t2.m.toJSON().nodes) || 'nodos distintos', eq(analyze(t1.m).segs.get(t1.sid.bc).Lr, 1178, 'Lr'), t1.m.undoStack.length === 1 || 'pasos de deshacer');
  });
  test('VR5 · estirar: no baja del mínimo (accesorios en contacto)', () => {
    const t = build({ a: [0, -500, 0], b: [0, 0, 0], c: [1000, 0, 0], d: [1000, 500, 0] }, [['a', 'b', 20], ['b', 'c', 20], ['c', 'd', 20]]);
    const ed = global.crearEditorVR(THREE, N, t.m, {});
    ed.stretchBegin(t.ids.c, t.sid.bc, mano(1000, 0, 0)); const r = ed.stretchMove(mano(5, 0, 0)); ed.stretchEnd();
    const g = analyze(t.m).segs.get(t.sid.bc);
    return all(r.atMin === true || 'no detecta el mínimo', eq(g.Le, 54, 'Le mínimo'), g.free >= -1e-6 || 'solape');
  });
  test('VR5 · arrastrar un accesorio: el eje es el del tubo que sigue el movimiento', () => {
    const t = build({ a: [0, -500, 0], b: [0, 0, 0], c: [1000, 0, 0] }, [['a', 'b', 20], ['b', 'c', 20]]);
    const ed = global.crearEditorVR(THREE, N, t.m, {});
    ed.stretchBegin(t.ids.b, null, mano(0, 0, 0)); ed.stretchMove(mano(3, 2, 0)); ed.stretchMove(mano(4, 152, 0)); ed.stretchEnd();
    const an = analyze(t.m);
    return all(eq(an.segs.get(t.sid.ab).Le, 650, 'Le ab'), eq(an.segs.get(t.sid.bc).Le, 1000, 'Le bc'));
  });
  test('VR5 · unir dos tubos alineados y conectar un extremo suelto, como el núcleo', () => {
    const mk = () => build({ a: [0, 0, 0], b: [500, 0, 0], c: [1000, 0, 0], d: [1000, 400, 0], e: [1000, 12, 0] }, [['a', 'b', 20], ['b', 'c', 20], ['d', 'e', 20]]);
    const t1 = mk(), ed = global.crearEditorVR(THREE, N, t1.m, {});
    const okJ = ed.joinFirst(t1.sid.ab), loose = ed.issues().find(i => i.loose?.segId === t1.sid.de)?.loose, okC = loose && ed.connect(loose);
    const t2 = mk(); joinSegments(t2.m, t2.sid.ab, t2.sid.bc); connectLoose(t2.m, t2.sid.de, t2.ids.e, t2.ids.c);
    return all(okJ === true || 'no une', okC === true || 'no conecta', JSON.stringify(t1.m.toJSON()) === JSON.stringify(t2.m.toJSON()) || 'resultado distinto del núcleo');
  });
  test('VR5 · borrar un accesorio deja sus tubos sueltos; deshacer lo recupera', () => {
    const t = build({ a: [-500, 0, 0], b: [0, 0, 0], c: [500, 0, 0], d: [0, 400, 0] }, [['a', 'b', 20], ['b', 'c', 20], ['b', 'd', 20]]);
    const ed = global.crearEditorVR(THREE, N, t.m, {}), antes = JSON.stringify(t.m.toJSON());
    ed.select(ed.pickAny(mano(2, 1, 0))); const sel = ed.state.selected; ed.deleteSelection();
    const k = [...analyze(t.m).nodes.values()].filter(n => n.kind === 'end').length; ed.undo();
    return all(sel?.type === 'node' || 'no selecciona el accesorio', k === 6 || 'extremos: ' + k, JSON.stringify(t.m.toJSON()) === antes || 'deshacer no restaura');
  });

  test('VR3 · seleccionar con el rayo y con la mano el mismo tubo', () => {
    const { ed } = nuevo(); marco(ed, mano); ed.setTool('select');
    const a = ed.pickAny(mano(150, 4, 3)), b = ed.pickAny(rayo(150, 2));
    return all(a?.type === 'seg' || 'mano: ' + JSON.stringify(a), JSON.stringify(a) === JSON.stringify(b) || 'rayo: ' + JSON.stringify(b), ed.pickAny(mano(300, 300, 0, 60)) === null || 'el vacío no selecciona');
  });
  test('VR3 · selección múltiple con un segundo pellizco y deselección', () => {
    const { ed } = nuevo(); marco(ed, mano);
    ed.select(ed.pickAny(mano(150, 0, 0))); ed.select(ed.pickAny(mano(600, 300, 0)), { add: true });
    const n = ed.state.multi.size; ed.select(ed.pickAny(mano(600, 300, 0)), { add: true });
    return all(n === 2 || 'seleccionados: ' + n, ed.state.multi.size === 1 || 'no deselecciona');
  });
  test('VR3 · cambiar la medida a ejes a 450 mm da la misma longitud real que el núcleo', () => {
    const src = extras.ejemplo; if (!src) throw Object.assign(new Error('omitida: sin proyecto de ejemplo'), { skip: true });
    const { m, ed } = nuevo(src), an = analyze(m);
    const g = [...an.segs.values()].find(s => an.nodes.get(s.a).isFitting && an.nodes.get(s.b).isFitting && s.Le > 100) || [...an.segs.values()][0];
    ed.select({ type: 'seg', id: g.id }, { single: true });
    const ok = ed.setSegLength(g.id, 450), pr = ed.props();
    const m2 = new Model(); m2.load(structuredClone(src)); const an2 = analyze(m2), A = an2.nodes.get(g.a), B = an2.nodes.get(g.b);
    setSegmentLength(m2, g.id, 450, (A.kind === 'end' && B.kind !== 'end') ? g.a : g.b);
    const ref = analyze(m2).segs.get(g.id);
    return all(ok === true || 'no se aplicó', eq(pr.Le, 450, 'Le'), eq(pr.Lr, ref.Lr, 'Lr'), eq(pr.Lr, 450 - g.zA - g.zB, 'Lr = Le − descuentos'));
  });
  test('VR3 · propiedades de un accesorio: tipo, bocas, Z y giro exacto', () => {
    const t = build({ a: [-500, 0, 0], b: [0, 0, 0], c: [500, 0, 0], d: [0, 400, 0] }, [['a', 'b', 40], ['b', 'c', 40], ['b', 'd', 32]]);
    const ed = global.crearEditorVR(THREE, N, t.m, {}); ed.select({ type: 'node', id: t.ids.b });
    const p = ed.props(), ok = ed.commitRotation(t.ids.b, p.ejes[0].axis, Math.PI / 2);
    return all(p.nombre === 'Te reducida 40×32' || p.nombre, p.bocas.length === 3 || 'bocas', p.bocas.map(b => b.z).sort().join() === '21,21,22' || 'Z: ' + p.bocas.map(b => b.z), ok === true || 'giro');
  });

  test('VR6 · duplicar un pórtico y soltarlo a 600 mm: uniones internas intactas', () => {
    const { m, ed } = nuevo(); marco(ed, mano); ed.setTool('select'); ed.selectAll(); ed.groupSelection();
    const antes = analyze(m), kinds = [...antes.nodes.values()].map(n => n.kind).sort().join(',');
    ed.dupBegin(mano(300, 300, 0)); ed.grpMove(mano(700, 304, 3)); ed.grpMove(mano(903, 298, -2)); ed.grpEnd();
    const an = analyze(m), g = m.groups.get(ed.state.group), xs = g.nodes.map(id => m.nodes.get(id).pos[0]);
    const kc = g.nodes.map(id => an.nodes.get(id).kind).sort().join(',');
    return all(m.segments.size === 12 || 'tramos: ' + m.segments.size, Math.min(...xs) === 600 && Math.max(...xs) === 1200 || 'la copia no está a 600 mm: ' + Math.min(...xs),
      kc === kinds || 'uniones de la copia: ' + kc, ![...an.nodes.values()].some(n => n.errors.length) || 'hay errores', m.undoStack.at(-1).label === 'Duplicar' || 'paso de deshacer');
  });
  test('VR6 · seleccionar un miembro selecciona el grupo; mover el grupo con la mano por la rejilla', () => {
    const { m, ed } = nuevo(); marco(ed, mano); ed.setTool('select'); ed.selectAll(); const gid = ed.groupSelection(); ed.select(null);
    ed.select(ed.pickAny(mano(150, 0, 0)));
    const sel = ed.state.group === gid;
    ed.grpBegin(gid, mano(0, 0, 0)); ed.grpMove(mano(96, -203, 48)); ed.grpEnd();
    const min = ['0', '1', '2'].map(k => Math.min(...[...m.nodes.values()].map(n => n.pos[k])));
    return all(sel || 'no selecciona el grupo', min.join() === '100,-500,50' || 'posición: ' + min.join());
  });
  test('VR6 · girar un grupo 90° con la muñeca y espejo horizontal', () => {
    const { m, ed } = nuevo(); marco(ed, mano); ed.setTool('select'); ed.selectAll(); const gid = ed.groupSelection();
    ed.grpBegin(gid, mano(300, 150, 0)); ed.grpMove(mano(300, 150, 0), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), THREE.MathUtils.degToRad(84))); ed.grpEnd();
    const an = analyze(m), ok1 = ![...an.nodes.values()].some(n => n.errors.length), ext = [...an.nodes.values()].find(n => n.kind === 'end').pos.clone();
    const ok2 = ed.mirrorSelection('h');
    return all(ok1 || 'errores tras girar', Math.abs(ext.x - 750) < 0.01 && Math.abs(ext.y - 150) < 0.01 || `extremo en ${ext.x},${ext.y}`, ok2 === true || 'espejo', cortes(m) === cortes(marcoRef()) || 'cambia el despiece');
  });
  test('VR6 · borrado múltiple y desagrupar', () => {
    const { m, ed } = nuevo(); marco(ed, mano); ed.setTool('select'); ed.selectAll(); ed.groupSelection();
    const a = ed.ungroupSelection(), g = m.groups.size; ed.selectAll(); ed.deleteSelection();
    return all(a === true && g === 0 || 'no desagrupa', m.segments.size === 0 || 'quedan tramos');
  });

  test('VR7 · avisos: unión no válida, tubo visto mínimo y extremo suelto, cada uno con su pieza', () => {
    const t = build({ a: [0, 0, 0], b: [500, 0, 0], c: [800, 300, 0], d: [535, 0, 0], e: [535, 500, 0], f: [530, 500, 400], g: [530, 505, 0] },
      [['a', 'b', 20], ['b', 'c', 32], ['b', 'd', 20], ['d', 'e', 20], ['f', 'g', 20]]);
    const ed = global.crearEditorVR(THREE, N, t.m, {}), is = ed.issues();
    return all(is.some(i => i.cls === 'err' && i.pick.type === 'node') || 'falta la unión no válida', is.some(i => i.cls === 'warn' && /Tubo visto/.test(i.t)) || is.some(i => /solapan/.test(i.t)) || 'falta el tubo visto',
      is.some(i => i.loose) || 'falta el extremo suelto');
  });
  test('VR7 · el despiece del ejemplo coincide con el del núcleo (barras, cortes y marcas)', () => {
    const src = extras.ejemplo; if (!src) throw Object.assign(new Error('omitida: sin proyecto de ejemplo'), { skip: true });
    const { m, ed } = nuevo(src), ref = computeCutlist(m, analyze(m)), cut = ed.state.cut;
    const f = c => JSON.stringify({ m: [...c.marks], b: N.DIAMETERS.map(d => c.byD[d].bars.map(b => [b.items.map(p => p.mark), b.cuts, Math.round(b.retal)])), f: c.fittings });
    return all(cut.marks.size > 0 || 'sin marcas', f(cut) === f(ref) || 'despiece distinto');
  });
  test('VR8 · el proyecto se guarda y se abre sin perder nada (mismo JSON)', () => {
    const { m, ed } = nuevo(); marco(ed, mano); ed.selectAll(); ed.groupSelection();
    const a = JSON.stringify(m.toJSON()), m2 = new Model(); m2.load(JSON.parse(a));
    return JSON.stringify(m2.toJSON()) === a || 'el JSON cambia al abrir';
  });

  /* ---------------- paneles y teclado numérico */
  const P = global.crearPanelesXR;
  const toque = (kit, p, zona, t, pasos = 6, jitter = 0) => { // el índice entra desde 30 mm, atraviesa el plano y sale; t en ms
    const W = p.mesh.scale.x, H = p.alto, x = zona.x + zona.w / 2 - W / 2, y = H / 2 - (zona.y + zona.h / 2);
    const zs = [0.03, 0.018, 0.008, 0.001, -0.004, -0.002, 0.001, -0.001, 0.006, 0.02, 0.03];
    for (const z of zs) { t += 1000 / 72; kit.actualizar([{ id: 'd', punta: V(x + jitter, y - jitter, z) }], t); }
    return t;
  };
  test('VR2 · teclado numérico: escribir «1250,5» con el índice en menos de 5 s, sin dobles ni perdidas', () => {
    const kit = P(THREE); let valor = null;
    const p = kit.teclado({ titulo: 'Longitud', alAceptar: v => { valor = v; } }); p.disponer();
    let t = 0;
    for (const k of ['1', '2', '5', '0', ',', '5']) { const z = p.zonas.find(z => z.texto === k); t = toque(kit, p, z, t, 6, 0.002); t += 180; p.disponer(); }
    const txt = kit.tecladoTexto(); t = toque(kit, p, p.zonas.find(z => z.texto === 'OK'), t);
    return all(txt === '1250,5' || 'texto: ' + txt, valor === 1250.5 || 'valor: ' + valor, t < 5000 || `tarda ${Math.round(t)} ms`, kit.pulsaciones === 7 || 'pulsaciones: ' + kit.pulsaciones, !kit.tecladoAbierto() || 'no se cierra');
  });
  test('VR2 · un dedo que tiembla sobre el plano no pulsa dos veces', () => {
    const kit = P(THREE); const p = kit.teclado({}); p.disponer();
    const z = p.zonas.find(z => z.texto === '7'), W = p.mesh.scale.x, H = p.alto, x = z.x + z.w / 2 - W / 2, y = H / 2 - (z.y + z.h / 2);
    let t = 0; for (const zz of [0.03, 0.001, -0.002, 0.003, -0.003, 0.004, -0.001, 0.005, -0.004, 0.03]) { t += 14; kit.actualizar([{ id: 'd', punta: V(x, y, zz) }], t); }
    return kit.tecladoTexto() === '7' || 'texto: ' + kit.tecladoTexto();
  });
  test('VR2 · entrar por detrás o por un lado del panel no pulsa', () => {
    const kit = P(THREE); const p = kit.teclado({}); p.disponer();
    let t = 0; for (const [x, z] of [[0.2, -0.01], [0.1, -0.003], [0, -0.003], [0, -0.001], [0, -0.02]]) { t += 14; kit.actualizar([{ id: 'd', punta: V(x, 0, z) }], t); }
    return kit.pulsaciones === 0 || 'pulsaciones: ' + kit.pulsaciones;
  });
  test('VR2 · rayo con pellizco: pulsa una vez por pellizco y el puntero queda ocupado', () => {
    const kit = P(THREE); let n = 0;
    const p = kit.panel({ id: 'x', titulo: 'Prueba', ancho: 0.2, construir: () => [[{ texto: 'A', accion: () => n++ }, { texto: 'B', accion: () => { n += 10; } }]] }).mostrar(); p.disponer();
    const z = p.zonas.find(z => z.texto === 'A'), x = z.x + z.w / 2 - p.mesh.scale.x / 2, y = p.alto / 2 - (z.y + z.h / 2), q = ap => ({ id: 'r', o: V(x, y, 0.5), d: V(0, 0, -1), apretando: ap });
    const r0 = kit.actualizar([q(false)], 0); kit.actualizar([q(true)], 200); kit.actualizar([q(true)], 220); kit.actualizar([q(false)], 400); kit.actualizar([q(true)], 600);
    const fuera = kit.actualizar([{ id: 'r', o: V(1, 1, 0.5), d: V(0, 0, -1), apretando: true }], 800);
    return all(n === 2 || 'pulsaciones: ' + n, r0.ocupados.has('r') || 'no ocupa el puntero', eq(r0.rayos.get('r'), 0.5, 'distancia'), !fuera.ocupados.has('r') || 'ocupa fuera del panel');
  });
  test('VR2 · zona de toque mínima de 18 mm, lista con desplazamiento y deslizador', () => {
    const kit = P(THREE); let v = 0, sel = null;
    const items = Array.from({ length: 20 }, (_, i) => ({ texto: 'Elemento ' + i, accion: () => { sel = i; } }));
    const p = kit.panel({ id: 'l', titulo: 'Lista', ancho: 0.16, construir: () => [{ h: 0.008, celdas: [{ texto: 'x', id: 'mini', accion: () => {} }, { t: 'hueco', w: 8 }] }, { t: 'lista', id: 'li', items, n: 5 }, { h: 0.02, celdas: [{ t: 'desliz', id: 's', min: 0, max: 100, paso: 5, valor: 50, accion: x => { v = x; } }] }] }).mostrar();
    p.disponer();
    const mini = p.zonas.find(z => z.id === 'mini'), cerca = p.zonaEn(mini.x + mini.w / 2, mini.y + mini.h + 0.002);
    p.pulsar(p.zonas.find(z => z.texto === '▼')); p.disponer(); p.pulsar(p.zonas.find(z => z.texto === 'Elemento 4'));
    const s = p.zonas.find(z => z.id === 's'); p.pulsar(s, s.x + s.w * 0.75);
    return all(cerca?.id === 'mini' || 'la zona mínima no se amplía', sel === 4 || 'lista: ' + sel, Math.abs(v - 75) <= 5 || 'deslizador: ' + v, p.zonas.filter(z => /^Elemento/.test(z.texto)).length === 5 || 'filas visibles');
  });
  test('VR2 · arrastrar un panel por el título con el rayo y anclarlo', () => {
    const kit = P(THREE); const p = kit.panel({ id: 'a', titulo: 'Panel', ancho: 0.2, construir: () => [[{ texto: 'A', accion: () => {} }]] }).mostrar(); p.disponer();
    const z = p.zonas.find(z => z.id === '#titulo'), x = z.x + z.w / 2 - p.mesh.scale.x / 2, y = p.alto / 2 - (z.y + z.h / 2);
    kit.actualizar([{ id: 'r', o: V(x, y, 0.5), d: V(0, 0, -1), apretando: false }], 0); kit.actualizar([{ id: 'r', o: V(x, y, 0.5), d: V(0, 0, -1), apretando: true }], 200);
    kit.actualizar([{ id: 'r', o: V(x + 0.3, y + 0.1, 0.5), d: V(0, 0, -1), apretando: true }], 300); kit.actualizar([{ id: 'r', o: V(x + 0.3, y + 0.1, 0.5), d: V(0, 0, -1), apretando: false }], 400);
    p.pulsar(p.zonas.find(z => z.id === '#anclar'));
    return all(eq(p.mesh.position.x, 0.3, 'x', 1e-6), eq(p.mesh.position.y, 0.1, 'y', 1e-6), p.anclado === true || 'no se ancla');
  });

  /* ---------------- sesión, escala y entradas */
  test('VR1 · escala libre con paradas en 1:20, 1:10, 1:5, 1:2 y 1:1 y límites 1:50 … 1:1', () => {
    return all(eq(S.ajustarEscala(0.104), 0.1, '1:10'), eq(S.ajustarEscala(0.19), 0.2, '1:5'), eq(S.ajustarEscala(0.3), 0.3, 'libre'), eq(S.ajustarEscala(3), 1, 'máximo'), eq(S.ajustarEscala(0.001), 0.02, 'mínimo'),
      S.nombreEscala(0.1) === '1:10' || S.nombreEscala(0.1), S.nombreEscala(1) === '1:1' || S.nombreEscala(1));
  });
  test('VR1 · dos manos: separar el doble pasa de 1:10 a 1:5 y el punto agarrado no se mueve', () => {
    const ini = { a: V(-0.1, 1, -0.4), b: V(0.1, 1, -0.4), pos: V(0.05, 0.9, -0.5), yaw: 0, escala: 0.1 };
    const r = S.agarreDosManos(ini, V(-0.2, 1, -0.4), V(0.2, 1, -0.4));
    const g = S.agarreDosManos(ini, V(0, 1, -0.5), V(0, 1, -0.3)); // gira 90° sin cambiar la separación
    return all(eq(r.escala, 0.2, 'escala'), eq(r.pos.x, 0.1, 'x'), eq(r.pos.y, 0.8, 'y'), eq(r.pos.z, -0.6, 'z'), eq(Math.abs(g.yaw), Math.PI / 2, 'giro'), eq(g.escala, 0.1, 'escala al girar'));
  });
  test('VR1 · las medidas siguen en mm reales a cualquier escala (mano → proyecto)', () => {
    const mundo = new THREE.Group(), res = [];
    for (const s of [0.1, 0.02, 1]) {
      mundo.position.set(0.3, 0.9, -0.5); mundo.rotation.set(0, 0.7, 0); mundo.scale.setScalar(s * 0.001); mundo.updateMatrixWorld(true);
      const giro = new THREE.Group(); giro.rotation.x = -Math.PI / 2; mundo.add(giro); mundo.updateMatrixWorld(true);
      const a = giro.worldToLocal(giro.localToWorld(V(0, 0, 0))), b = giro.worldToLocal(giro.localToWorld(V(600, 0, 0)).clone());
      const metros = giro.localToWorld(V(0, 0, 0)).distanceTo(giro.localToWorld(V(600, 0, 0)));
      res.push(eq(a.distanceTo(b), 600, 'mm a escala ' + s), eq(metros, 0.6 * s, 'metros a escala ' + s, 1e-6)); mundo.remove(giro);
    }
    return all(...res);
  });
  test('VR1 · teletransporte y giro por pasos de 30°: la cabeza queda sobre el destino', () => {
    const rig = { x: 0, z: 0, yaw: 0 }, cab = { x: 0.3, z: 0.2 };
    const t = S.rigTrasTeleport(rig, cab, { x: 2, z: -3 }), g = S.rigTrasGiro(t, { x: 2, z: -3 }, Math.PI / 6);
    const arco = S.arcoTeleport({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0.3, z: -0.954 }, 0);
    return all(eq(t.x, 1.7, 'x'), eq(t.z, -3.2, 'z'), eq(g.yaw, Math.PI / 6, 'giro'), eq(Math.hypot(g.x - 2, g.z + 3), Math.hypot(0.3, 0.2), 'distancia a la cabeza'),
      !!arco.destino && arco.destino.z < -1 || 'el arco no cae delante', eq(arco.puntos.at(-1).y, 0, 'el arco acaba en el suelo', 1e-6));
  });
  test('VR0 · pellizco con histéresis: empieza a 20 mm y no se suelta hasta 32 mm', () => {
    const p = E.pellizco;
    return all(p(0.019, false) === true || 'no empieza', p(0.025, false) === false || 'empieza antes de tiempo', p(0.03, true) === true || 'se suelta antes de tiempo', p(0.033, true) === false || 'no se suelta');
  });
  test('VR0 · giro por pasos de la muñeca: eje dominante y redondeo al paso', () => {
    const { ed } = nuevo();
    const g = ed.giroPorPasos(new THREE.Quaternion().setFromAxisAngle(V(0.1, 0.05, -1).normalize(), THREE.MathUtils.degToRad(100)), [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], 45);
    const h = ed.giroPorPasos(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), THREE.MathUtils.degToRad(15)), [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], 45);
    return all(g.i === 2 || 'eje ' + g.i, eq(THREE.MathUtils.radToDeg(g.ang), -90, 'ángulo'), h.ang === 0 || 'un giro pequeño no cuenta');
  });
  return results;
};
})(globalThis);
