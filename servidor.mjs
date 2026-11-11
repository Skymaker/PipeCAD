#!/usr/bin/env node
// PipeCAD · servidor local
// Sirve la aplicación (index.html, editor.html, modelos/, ejemplos/…) y añade una pequeña API para
// guardar accesorios en la carpeta modelos/. Solo usa módulos de Node, sin instalar nada.
//
//   node servidor.mjs                 → http://localhost:8080 (solo este ordenador)
//   node servidor.mjs --puerto 9000   → otro puerto
//   node servidor.mjs --red           → también desde otros equipos de la red local (¡cualquiera podrá guardar!)
//   node servidor.mjs --https         → además, https://<IP del ordenador>:8443 para ver el visor RA en las gafas
//                                       y los móviles de la red local (solo lectura; necesita certificados de mkcert)
//      --puerto-https 9443  --cert certificados/pipecad.pem  --key certificados/pipecad-key.pem
//   node servidor.mjs --https --gafas → además, las gafas pueden guardar proyectos (PipeCAD VR, vr.html) con una clave
//                                       de 6 cifras que se muestra al arrancar y se escribe una vez en las gafas
//      --clave 123456                   clave fija en vez de una al azar
//
// Solo se puede guardar o borrar desde este mismo ordenador (o desde cualquiera con --red). Con --gafas, los equipos
// de la red que envíen la clave pueden guardar proyectos (nunca accesorios).
//
// API (JSON):
//   GET    /api/estado                  → { pipecad, escribir, version, https: { puerto, urls } }
//   POST   /api/accesorios              → guarda un accesorio: { id, nombre?, carpeta?, archivo?, pcf, scad?, stl: { variante: base64 } }
//   DELETE /api/accesorios/<id>         → borra un accesorio personalizado (sus archivos y su entrada del catálogo)
//   POST   /api/proyectos               → guarda un proyecto para verlo en otro dispositivo: proyectos/<id>.json → { id }
//   GET    /api/proyectos               → { proyectos: [{ id, nombre, fecha, bytes }] } (los más recientes primero)
//   PUT    /api/proyectos/<id>          → guarda o sustituye proyectos/<id>.json  (?origen=<cliente>  ?enviar=1 avisa a PipeCAD)
//   GET    /api/vivo/<id>               → eventos del servidor: { tipo: 'cambio', id, origen } cada vez que se guarda ese proyecto
//   GET    /api/vivo/_avisos            → eventos: { tipo: 'enviado', id, nombre } cuando las gafas envían un proyecto al ordenador
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
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
const RED = args.includes('--red');
const HOST = RED ? '0.0.0.0' : '127.0.0.1';
const HTTPS = args.includes('--https');
const PUERTO_HTTPS = +opt('--puerto-https', 8443);
const CERT = path.resolve(RAIZ, opt('--cert', 'certificados/pipecad.pem'));
const KEY = path.resolve(RAIZ, opt('--key', 'certificados/pipecad-key.pem'));
const PROYECTOS = path.join(RAIZ, 'proyectos');
// ¿Viene la petición de este mismo ordenador?
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const canWrite = req => RED || isLocal(req);
// Escritura de proyectos desde las gafas: solo con --gafas y la clave (cabecera X-PipeCAD-Clave)
const GAFAS = args.includes('--gafas');
const CLAVE = GAFAS ? String(opt('--clave', crypto.randomInt(0, 1e6))).padStart(6, '0') : '';
const fallos = new Map(); // intentos fallidos por dirección: tras 20, cinco minutos de espera
function claveOk(req) {
  if (!GAFAS) return false;
  const ip = req.socket.remoteAddress, f = fallos.get(ip);
  if (f && f.n >= 20 && Date.now() - f.t < 300000) return false;
  const dada = Buffer.from(String(req.headers['x-pipecad-clave'] || '')), buena = Buffer.from(CLAVE);
  if (!dada.length) return false;
  const ok = dada.length === buena.length && crypto.timingSafeEqual(dada, buena);
  if (ok) fallos.delete(ip); else fallos.set(ip, { n: (f && Date.now() - f.t < 300000 ? f.n : 0) + 1, t: Date.now() });
  return ok;
}
const canWriteProject = req => canWrite(req) || claveOk(req);
// Direcciones de este ordenador en la red local (para el enlace y el QR del visor RA)
function lanUrls() {
  if (!HTTPS) return [];
  // primero la red real (wifi o cable); al final los adaptadores virtuales (WSL, Hyper-V, VirtualBox, Docker…)
  const virtual = (name, ip) => /vEthernet|Hyper-V|WSL|VirtualBox|vbox|VMware|docker|br-|virbr|Bluetooth|Loopback/i.test(name) || /^192\.168\.56\./.test(ip);
  const score = (name, ip) => (virtual(name, ip) ? 10 : 0) + (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : 2);
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ url: `https://${a.address}:${PUERTO_HTTPS}/`, s: score(name, a.address) });
  return out.sort((a, b) => a.s - b.s).map(x => x.url);
}
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

async function guardarProyecto(req, res) {
  let j; try { j = JSON.parse(await leerCuerpo(req)); } catch (e) { return fallo(res, e.code || 400, e.code ? e.message : 'JSON no válido'); }
  if (j?.format !== 'pipecad' || !Array.isArray(j.nodes) || !Array.isArray(j.segments)) return fallo(res, 400, 'No es un proyecto de PipeCAD');
  const id = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
  await escribir(path.join(PROYECTOS, id + '.json'), JSON.stringify(j));
  console.log(`  proyecto compartido proyectos/${id}.json`);
  enviar(res, 201, { ok: true, id });
}

const PROY_ID = /^[a-z0-9]{6,40}$/;
async function listarProyectos(res) {
  const out = [];
  let files = []; try { files = await fs.readdir(PROYECTOS); } catch { /* aún no hay carpeta */ }
  for (const f of files) {
    const id = f.replace(/\.json$/, ''); if (!f.endsWith('.json') || !PROY_ID.test(id)) continue;
    try {
      const ruta = path.join(PROYECTOS, f), st = await fs.stat(ruta);
      let nombre = id; try { nombre = JSON.parse(await fs.readFile(ruta, 'utf8')).name || id; } catch { /* dañado: se lista con su id */ }
      out.push({ id, nombre, fecha: st.mtime.toISOString(), bytes: st.size });
    } catch { /* borrado mientras se listaba */ }
  }
  enviar(res, 200, { proyectos: out.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 200) });
}
// Edición compartida: clientes suscritos por proyecto (eventos del servidor)
const oyentes = new Map(); // canal → Set(res)
function emitir(canal, datos) { for (const r of oyentes.get(canal) || []) r.write(`data: ${JSON.stringify(datos)}\n\n`); }
function suscribir(req, res, canal) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': conectado\n\n');
  if (!oyentes.has(canal)) oyentes.set(canal, new Set());
  oyentes.get(canal).add(res);
  const latido = setInterval(() => res.write(': \n\n'), 25000);
  req.on('close', () => { clearInterval(latido); oyentes.get(canal)?.delete(res); if (!oyentes.get(canal)?.size) oyentes.delete(canal); });
}
async function sustituirProyecto(req, res, id, url) {
  let j; try { j = JSON.parse(await leerCuerpo(req)); } catch (e) { return fallo(res, e.code || 400, e.code ? e.message : 'JSON no válido'); }
  if (j?.format !== 'pipecad' || !Array.isArray(j.nodes) || !Array.isArray(j.segments)) return fallo(res, 400, 'No es un proyecto de PipeCAD');
  await escribir(path.join(PROYECTOS, id + '.json'), JSON.stringify(j));
  const origen = String(url.searchParams.get('origen') || '').slice(0, 32);
  emitir(id, { tipo: 'cambio', id, origen });
  if (url.searchParams.has('enviar')) { emitir('_avisos', { tipo: 'enviado', id, nombre: String(j.name || id) }); console.log(`  proyecto enviado desde las gafas: proyectos/${id}.json`); }
  enviar(res, 200, { ok: true, id });
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

async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/estado') return enviar(res, 200, { pipecad: true, escribir: canWrite(req), proyectos: canWriteProject(req), gafas: GAFAS, version: VERSION, https: HTTPS ? { puerto: PUERTO_HTTPS, urls: lanUrls() } : null });
    // proyectos: lista, guardado (también desde las gafas con la clave) y eventos en vivo
    if (url.pathname === '/api/proyectos' && req.method === 'GET') return await listarProyectos(res);
    const mp = /^\/api\/proyectos\/([a-z0-9]{6,40})$/.exec(url.pathname);
    if (mp && req.method === 'PUT') return canWriteProject(req) ? await sustituirProyecto(req, res, mp[1], url) : fallo(res, 403, GAFAS ? 'Clave incorrecta: escríbela en las gafas (la muestra el servidor al arrancar)' : 'El servidor no admite guardar desde otros equipos: arráncalo con --gafas');
    const mv = /^\/api\/vivo\/([a-z0-9]{6,40}|_avisos)$/.exec(url.pathname);
    if (mv && req.method === 'GET') return suscribir(req, res, mv[1]);
    if (url.pathname.startsWith('/api/') && req.method !== 'GET' && !canWrite(req)) return fallo(res, 403, 'Solo se puede guardar desde el ordenador donde está el servidor');
    if (url.pathname === '/api/accesorios' && req.method === 'POST') return await guardarAccesorio(req, res);
    if (url.pathname === '/api/proyectos' && req.method === 'POST') return await guardarProyecto(req, res);
    const m = /^\/api\/accesorios\/([a-z0-9_-]+)$/.exec(url.pathname);
    if (m && req.method === 'DELETE') return await borrarAccesorio(m[1], res);
    if (url.pathname.startsWith('/api/')) return fallo(res, 404, 'Operación desconocida');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fallo(res, 405, 'Método no permitido');
    await servirArchivo(req, res, url);
  } catch (e) { console.error(e); fallo(res, 500, String(e.message || e)); }
}
const servidor = http.createServer(atender);
servidor.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO} está ocupado: prueba con  node servidor.mjs --puerto 8081` : e.message);
  process.exit(1);
});
servidor.listen(PUERTO, HOST, () => {
  console.log(`PipeCAD funcionando en http://localhost:${PUERTO}/`);
  console.log(`  Editor de accesorios: http://localhost:${PUERTO}/editor.html`);
  console.log(`  Los accesorios se guardan en ${MODELOS}`);
  if (HOST === '0.0.0.0') console.log('  ⚠ Accesible desde la red local: cualquiera en la red puede guardar accesorios.');
  console.log(`  PipeCAD VR (vista previa y pruebas): http://localhost:${PUERTO}/vr.html`);
  if (GAFAS && !HTTPS) console.log(`  Clave para guardar desde otros equipos: ${CLAVE} (las gafas necesitan además --https)`);
  if (!HTTPS) console.log('  Pulsa Ctrl+C para parar el servidor.');
});

// HTTPS para el visor de realidad aumentada en gafas y móviles (WebXR solo funciona en páginas seguras)
if (HTTPS) {
  if (!existsSync(CERT) || !existsSync(KEY)) {
    console.error(`Faltan los certificados para --https:\n  ${CERT}\n  ${KEY}\nCréalos con mkcert (ver el README, «Ver el proyecto en realidad aumentada»):\n  mkcert -install\n  mkcert -cert-file certificados/pipecad.pem -key-file certificados/pipecad-key.pem localhost 127.0.0.1 <IP de este ordenador>`);
    process.exit(1);
  }
  const seguro = https.createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, atender);
  seguro.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO_HTTPS} está ocupado: prueba con --puerto-https 9443` : e.message); process.exit(1); });
  seguro.listen(PUERTO_HTTPS, '0.0.0.0', () => {
    console.log(`  Visor RA para gafas y móviles de la red local (solo lectura):`);
    for (const u of lanUrls()) console.log(`    ${u}ra.html`);
    console.log('  PipeCAD VR (diseñar dentro de las gafas):');
    for (const u of lanUrls()) console.log(`    ${u}vr.html`);
    console.log(GAFAS ? `  Las gafas pueden guardar proyectos con la clave  ${CLAVE}  (se escribe una vez en PipeCAD VR → Proyectos)` : '  Las gafas solo pueden leer: añade --gafas para que puedan guardar proyectos con una clave.');
    console.log('  Pulsa Ctrl+C para parar el servidor.');
  });
}
