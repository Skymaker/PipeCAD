#!/usr/bin/env node
// PipeCAD VR · pruebas de lógica con gestos simulados, sin navegador ni gafas.
//   node pruebas/vr.mjs            (necesita three:  npm install --no-save three@0.160.0, o NODE_PATH apuntando a él)
// Son las mismas que se ven en vr.html?test. Los módulos son scripts clásicos: se cargan tal cual en globalThis.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let THREE;
try { THREE = require('three'); }
catch { console.error('Falta three. Instálalo con:  npm install --no-save three@0.160.0'); process.exit(2); }
for (const f of ['js/nucleo.js', 'js/xr/entradas.js', 'js/xr/sesion.js', 'js/xr/paneles.js', 'js/xr/herramientas.js', 'js/xr/pruebas.js'])
  vm.runInThisContext(readFileSync(path.join(RAIZ, f), 'utf8'), { filename: f });
const N = globalThis.crearNucleoPipeCAD(THREE, {});
const ejemplo = JSON.parse(readFileSync(path.join(RAIZ, 'ejemplos/ejemplo.json'), 'utf8'));
const res = globalThis.pruebasVR(THREE, N, { ejemplo });
let mal = 0;
for (const r of res) {
  if (!r.ok) mal++;
  console.log(`${r.ok ? (r.skipped ? '–' : '✔') : '✘'} ${r.name}${r.detail ? '\n    ' + r.detail.split('\n').slice(0, 6).join('\n    ') : ''}`);
}
console.log(`\n${res.length - mal} de ${res.length} pruebas de VR en verde`);
process.exit(mal ? 1 : 0);
