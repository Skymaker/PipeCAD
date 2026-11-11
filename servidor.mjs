#!/usr/bin/env node
// PipeCAD · servidor local
// Sirve la aplicación (index.html, editor.html, modelos/, ejemplos/…) y añade una pequeña API para
// guardar accesorios en la carpeta modelos/. Solo usa módulos de Node, sin instalar nada.
//
//   node servidor.mjs                 → http://localhost:8080 (solo este ordenador)
//   node servidor.mjs --puerto 9000   → otro puerto
//   node servidor.mjs --red           → también desde otros equipos de la red local (¡cualquiera podrá guardar!)
//
// API (JSON):
//   GET    /api/estado                  → { pipecad: true, escribir: true, version }
//   POST   /api/accesorios              → guarda un accesorio: { id, nombre?, carpeta?, archivo?, pcf, scad?, stl: { variante: base64 } }
//   DELETE /api/accesorios/<id>         → borra un accesorio personalizado (sus archivos y su entrada del catálogo)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(RAIZ, 'modelos');
const CATALOGO = path.join(MODELOS, 'catalogo.json');
const VERSION = 1;
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const PUERTO = +opt('--puerto', process.env.PORT || 8080);
const HOST = args.includes('--red') ? '0.0.0.0' : '127.0.0.1';
const MAX_BODY = 60 * 1024 * 1024;

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.pcf': 'text/plain; charset=utf-8', '.scad': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.stl': 'model/stl', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const ID_OK = /^[a-z0-9_-]{1,64}$/;
const VARIANTE_OK = /^[A-Za-z0-9_.-]{1,32}$/;

function enviar(res, code, body, tipo = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
  res.end(data);
}
const fallo = (res, code, msg) => enviar(res, code, { error: msg });

async function leerCuerpo(req) {
  const trozos = []; let n = 0;
  for await (const t of req) { n += t.length; if (n > MAX_BODY) throw Object.assign(new Error('Petición demasiado grande'), { code: 413 }); trozos.push(t); }
  return Buffer.concat(trozos).toString('utf8');
}
async function leerCatalogo() {
  try { const c = JSON.parse(await fs.readFile(CATALOGO, 'utf8')); c.accesorios ||= []; c.plantillas ||= []; return c; }
  catch { return { formato: 'pipecad-modelos', version: 1, accesorios: [], plantillas: [] }; }
}
async function escribir(ruta, datos) { // escritura atómica: archivo temporal y renombrado
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  const tmp = ruta + '.tmp-' + process.pid;
  await fs.writeFile(tmp, datos); await fs.rename(tmp, ruta);
}

async function guardarAccesorio(req, res) {
  let j; try { j = JSON.parse(await leerCuerpo(req)); } catch (e) { return fallo(res, e.code || 400, e.code ? e.message : 'JSON no válido'); }
  const carpeta = j.carpeta || 'personalizados';
  const id = carpeta === 'serie' ? String(j.id || '') : String(j.id || '').toLowerCase(); // los de serie conservan su id interno (teeReduced)
  const archivo = String(j.archivo || id).toLowerCase();
  if (!(carpeta === 'serie' ? /^[A-Za-z0-9_-]{1,64}$/ : ID_OK).test(id) || !ID_OK.test(archivo)) return fallo(res, 400, 'Identificador no válido (letras sin tildes, números, «-» y «_»)');
  if (!['personalizados', 'serie'].includes(carpeta)) return fallo(res, 400, 'Carpeta no válida');
  if (typeof j.pcf !== 'string' || !/^\s*ACCESORIO\s/im.test(j.pcf)) return fallo(res, 400, 'Falta el .pcf');
  const stl = j.stl || {};
  for (const v of Object.keys(stl)) if (!VARIANTE_OK.test(v)) return fallo(res, 400, `Nombre de variante no válido: ${v}`);
  const cat = await leerCatalogo();
  const previa = cat.accesorios.find(a => a.id === id);
  if (previa && previa.tipo !== (carpeta === 'serie' ? 'serie' : 'personalizado')) return fallo(res, 409, `«${id}» ya existe como accesorio de ${previa.tipo}`);
  const dir = path.join(MODELOS, carpeta), rel = f => `${carpeta}/${f}`;
  const entrada = { id, tipo: carpeta === 'serie' ? 'serie' : 'personalizado', nombre: String(j.nombre || id), pcf: rel(`${archivo}.pcf`), stl: {} };
  await escribir(path.join(dir, `${archivo}.pcf`), j.pcf);
  if (typeof j.scad === 'string' && j.scad.trim()) { await escribir(path.join(dir, `${archivo}.scad`), j.scad); entrada.scad = rel(`${archivo}.scad`); }
  for (const [v, b64] of Object.entries(stl)) {
    const f = `${archivo}_${v}.stl`; await escribir(path.join(dir, f), Buffer.from(String(b64), 'base64')); entrada.stl[v] = rel(f);
  }
  // STL de variantes que ya no existen: se borran
  if (previa) for (const [v, f] of Object.entries(previa.stl || {})) if (!entrada.stl[v]) await fs.rm(path.join(MODELOS, f), { force: true });
  cat.accesorios = cat.accesorios.filter(a => a.id !== id);
  cat.accesorios.push(entrada);
  await escribir(CATALOGO, JSON.stringify(cat, null, 2) + '\n');
  console.log(`  guardado ${entrada.pcf} (${Object.keys(entrada.stl).length} STL)`);
  enviar(res, previa ? 200 : 201, { ok: true, entrada, actualizado: !!previa });
}
async function borrarAccesorio(id, res) {
  const cat = await leerCatalogo(), e = cat.accesorios.find(a => a.id === id);
  if (!e) return fallo(res, 404, `No existe «${id}» en el catálogo`);
  if (e.tipo !== 'personalizado') return fallo(res, 403, 'Los accesorios de serie no se borran');
  for (const f of [e.pcf, e.scad, ...Object.values(e.stl || {})].filter(Boolean)) await fs.rm(path.join(MODELOS, f), { force: true });
  cat.accesorios = cat.accesorios.filter(a => a.id !== id);
  await escribir(CATALOGO, JSON.stringify(cat, null, 2) + '\n');
  console.log(`  borrado ${id}`);
  enviar(res, 200, { ok: true });
}

async function servirArchivo(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const ruta = path.normalize(path.join(RAIZ, rel));
  if (!ruta.startsWith(RAIZ + path.sep) && ruta !== RAIZ) return fallo(res, 403, 'Fuera de la carpeta del programa');
  if (path.relative(RAIZ, ruta).split(path.sep).some(p => p.startsWith('.'))) return fallo(res, 404, 'No encontrado'); // .git, etc.
  try {
    const st = await fs.stat(ruta);
    if (st.isDirectory()) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
    const datos = await fs.readFile(ruta);
    enviar(res, 200, req.method === 'HEAD' ? '' : datos, TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream');
  } catch { fallo(res, 404, 'No encontrado'); }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/estado') return enviar(res, 200, { pipecad: true, escribir: true, version: VERSION });
    if (url.pathname === '/api/accesorios' && req.method === 'POST') return await guardarAccesorio(req, res);
    const m = /^\/api\/accesorios\/([a-z0-9_-]+)$/.exec(url.pathname);
    if (m && req.method === 'DELETE') return await borrarAccesorio(m[1], res);
    if (url.pathname.startsWith('/api/')) return fallo(res, 404, 'Operación desconocida');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fallo(res, 405, 'Método no permitido');
    await servirArchivo(req, res, url);
  } catch (e) { console.error(e); fallo(res, 500, String(e.message || e)); }
});
servidor.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO} está ocupado: prueba con  node servidor.mjs --puerto 8081` : e.message);
  process.exit(1);
});
servidor.listen(PUERTO, HOST, () => {
  console.log(`PipeCAD funcionando en http://localhost:${PUERTO}/`);
  console.log(`  Editor de accesorios: http://localhost:${PUERTO}/editor.html`);
  console.log(`  Los accesorios se guardan en ${MODELOS}`);
  if (HOST === '0.0.0.0') console.log('  ⚠ Accesible desde la red local: cualquiera en la red puede guardar accesorios.');
  console.log('  Pulsa Ctrl+C para parar el servidor.');
});
