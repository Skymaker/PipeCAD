#!/bin/sh
# PipeCAD: arranca el servidor local (macOS / Linux). Abre http://localhost:8080/ en el navegador.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Falta Node.js: instálalo desde https://nodejs.org"; exit 1; }
( sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:8080/) || (command -v open >/dev/null && open http://localhost:8080/) ) >/dev/null 2>&1 &
exec node servidor.mjs "$@"
