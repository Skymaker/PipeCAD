# PipeCAD
CAD con tuberías de PVC

Programa de CAD 3D para el navegador con el que se diseñan instalaciones con tubería de PVC de **Ø20, Ø32 y Ø40 mm** y se obtiene el despiece optimizado en barras de 3 m.

## Uso

- **En línea**: https://skymaker.github.io/PipeCAD/ (solo lectura de la carpeta de modelos: los accesorios nuevos se guardan en el navegador o se descargan).
- **En tu ordenador**: ver [Instalación en un ordenador](#instalación-en-un-ordenador). Así puedes guardar accesorios nuevos en la carpeta `modelos/` sin depender de GitHub.

Pulsa **?** o **F1** para ver la ayuda. Se necesita conexión a internet para cargar Three.js (y OpenSCAD en el editor) desde el CDN.

## Instalación en un ordenador

PipeCAD son páginas web estáticas más la carpeta `modelos/`. Para que el programa lea esa carpeta y el editor de accesorios pueda **guardar** en ella, hay que abrirlo desde un servidor web. Si abres `index.html` con doble clic, el navegador no deja leer la carpeta y solo se ven formas simples, aunque se puede dibujar y calcular igual.

### 1. Descargar el programa

- Con Git:

  ```bash
  git clone https://github.com/Skymaker/PipeCAD.git
  ```

- Sin Git: en GitHub, **Code › Download ZIP**, y descomprímelo donde quieras (por ejemplo, `Documentos\PipeCAD`).

### 2. Instalar Node.js (una sola vez)

Descarga la versión **LTS** de https://nodejs.org e instálala con las opciones por defecto. Para comprobarlo, abre una terminal y escribe:

```bash
node -v
```

Debe mostrar `v18` o superior. No hay que instalar nada más: el servidor de PipeCAD solo usa lo que trae Node.

### 3. Arrancar el servidor

- **Windows**: doble clic en `iniciar-servidor.bat`. Se abre una ventana negra (el servidor) y el navegador con PipeCAD.
- **macOS / Linux**: en una terminal, dentro de la carpeta de PipeCAD:

  ```bash
  sh iniciar-servidor.sh
  ```

- **A mano**, en cualquier sistema:

  ```bash
  node servidor.mjs
  ```

Después abre http://localhost:8080/ (PipeCAD) o http://localhost:8080/editor.html (Editor de accesorios). Mientras trabajes, deja abierta la ventana del servidor; para pararlo, pulsa `Ctrl+C` o ciérrala.

Opciones:

| Opción | Para qué |
|---|---|
| `--puerto 9000` | Usar otro puerto si el 8080 está ocupado (`node servidor.mjs --puerto 9000`). |
| `--red` | Permitir el acceso desde otros equipos de la red local (http://IP-del-ordenador:8080/). Cualquiera en la red podría guardar o borrar accesorios: úsalo solo en una red de confianza. |

Por defecto el servidor solo atiende a este ordenador (`127.0.0.1`).

### 4. Crear y guardar accesorios

1. Abre el **Editor de accesorios** (botón en la pestaña **Biblioteca** de PipeCAD o http://localhost:8080/editor.html).
2. Empieza con **Nuevo** (desde cero), con una **plantilla** o con **Editar de la biblioteca…**.
3. Pulsa **Guardar en PipeCAD**. OpenSCAD genera los STL de todas las variantes y el servidor guarda el `.pcf`, el `.scad` y los `.stl` en `modelos/personalizados/`, además de añadir el accesorio a `modelos/catalogo.json`. Si PipeCAD está abierto en otra pestaña, lo carga al momento.

Para llevarte tus accesorios a otro ordenador, copia la carpeta `modelos/` (o súbela a tu propio repositorio).

### Otros servidores web

Cualquier servidor de archivos estáticos sirve para **usar** PipeCAD y leer la carpeta `modelos/`. Por ejemplo:

```bash
python -m http.server 8080
```

Pero solo `servidor.mjs` permite **guardar** accesorios desde el editor. Sin él, el editor ofrece estas alternativas:

- en Chrome o Edge, elegir la carpeta `modelos` y escribir directamente en ella;
- guardarlos en el navegador;
- **Descargar .zip**, que incluye un `LEEME.txt` con los pasos para copiarlos a la carpeta.

## Ver el proyecto en realidad aumentada

El visor [`ra.html`](ra.html) muestra el proyecto a tamaño real sobre el suelo. Funciona en las **Meta Quest 3**, en teléfonos **Android** con ARCore (Chrome) y en **iPhone / iPad** (Safari, con AR Quick Look y sin gravedad). La realidad aumentada en el navegador solo funciona en páginas **HTTPS** (o en `localhost`).

En PipeCAD, el botón **Ver en RA** del menú lateral muestra un **código QR** y un enlace al visor con el proyecto dentro. Escanéalo con la cámara del móvil o con las gafas, o copia el enlace y ábrelo en ellos.

### Opción A: GitHub Pages (lo más sencillo)

Abre PipeCAD en https://skymaker.github.io/PipeCAD/, dibuja o abre tu proyecto y pulsa **Ver en RA**. El enlace lleva el proyecto comprimido dentro, no se guarda en ningún servidor y funciona en cualquier dispositivo con internet. Los accesorios personalizados que solo estén en tu carpeta `modelos/` se ven con su forma simple.

### Opción B: servidor local con HTTPS (en tu red, sin GitHub)

1. Instala **mkcert** (https://github.com/FiloSottile/mkcert/releases). En Windows también vale `winget install FiloSottile.mkcert`.
2. Averigua la IP de tu ordenador en la wifi. En Windows, con `ipconfig`: la «Dirección IPv4» del adaptador wifi o Ethernet, por ejemplo `192.168.1.20`.
3. Crea los certificados, dentro de la carpeta de PipeCAD:

   ```bash
   mkcert -install
   ```

   ```bash
   mkcert -cert-file certificados/pipecad.pem -key-file certificados/pipecad-key.pem localhost 127.0.0.1 192.168.1.20
   ```

   Si la carpeta `certificados` no existe, créala antes. Esa carpeta no se sube a GitHub (está en `.gitignore`).
4. Arranca el servidor con HTTPS:

   ```bash
   node servidor.mjs --https
   ```

   En Windows también puedes usar `iniciar-servidor.bat --https`. El servidor muestra la dirección del visor para la red, por ejemplo `https://192.168.1.20:8443/ra.html`. Desde las gafas y los móviles solo se puede **ver**; guardar y borrar solo se puede desde este ordenador.
5. En PipeCAD (http://localhost:8080/), pulsa **Ver en RA**:
   - el proyecto se guarda en `proyectos/` y el código QR apunta a él;
   - si el ordenador tiene varias redes, elige en el diálogo la de la misma wifi que las gafas o el móvil.
6. Haz que cada dispositivo confíe en el certificado. El certificado raíz de mkcert es el archivo `rootCA.pem` de la carpeta que muestra `mkcert -CAROOT`.
   - **Android**: copia `rootCA.pem` al teléfono e instálalo en *Ajustes › Seguridad › Más ajustes de seguridad › Cifrado y credenciales › Instalar un certificado › Certificado de CA*.
   - **iPhone / iPad**: envíate `rootCA.pem` (por ejemplo, por correo o AirDrop). Instala el perfil en *Ajustes › General › VPN y gestión de dispositivos* y actívalo en *Ajustes › General › Información › Ajustes de confianza de certificados*.
   - **Meta Quest 3**: el navegador no permite instalar certificados. Si aparece el aviso de conexión no privada, pulsa *Avanzado › Continuar*. Si así no arranca la realidad aumentada, usa la opción C.

### Opción C: por cable USB con adb (Quest 3 y Android)

Con el modo desarrollador activado y el cable conectado:

```bash
adb reverse tcp:8080 tcp:8080
```

Después, en las gafas o el teléfono, abre `http://localhost:8080/ra.html` y elige el proyecto, o pega el enlace de **Ver en RA**. Para el dispositivo es `localhost`, así que no hace falta HTTPS.

## Funciones

- **Dibujo 3D por polilínea**: los codos de 90° y 45° se insertan solos al cambiar de dirección; empezar o terminar sobre un tubo crea una Te (o Te reducida).
- **Accesorios**: codo 90°, codo 45°, Te, Te reducida, manguito y manguito reductor. Se pueden colocar sueltos, en el extremo de un tubo o insertados en un tubo (lo parten en dos), y girar con un gizmo de anillos; los tubos que dejan de encajar se separan.
- **Unir tubos** alineados en uno solo, quitando el manguito o cerrando el hueco, o unir dos tubos con un tramo perpendicular y Tes giradas automáticamente.
- **Puntos de referencia** (extremos, mitad, tercios, cuartos, centros de accesorio) activables, y dibujo en altura sin teclas modificadoras.
- **Giro libre** de los accesorios sobre sus propios ejes (pasos configurables o ángulo exacto).
- **Selección múltiple** (Mayús+clic, rectángulo con doble clic) y **grupos** que se mueven y giran en conjunto con una caja manipuladora; duplicado de grupos y selecciones.
- **Biblioteca de accesorios** que se activan y desactivan uno a uno, con un lenguaje sencillo (`.pcf`) para describir accesorios propios.
- **Modelos 3D fuera del programa**, en la carpeta [`modelos/`](modelos/):
  - `catalogo.json`: la lista de accesorios;
  - `serie/` y `personalizados/`: el `.pcf`, el `.scad` y un STL por variante de cada accesorio;
  - `plantillas/`: las plantillas del editor;
  - `pipecad.scad`: la librería OpenSCAD común.
- **Editor de accesorios** ([`editor.html`](editor.html)): crea y edita accesorios con un formulario, desde cero o desde plantillas. Genera código **OpenSCAD** paramétrico (descargable) y, con él, los STL imprimibles en el propio navegador; los guarda en la carpeta `modelos/`.
- **Visor de realidad aumentada** ([`ra.html`](ra.html); ver [cómo usarlo](#ver-el-proyecto-en-realidad-aumentada)): muestra el proyecto a tamaño real (medidas y peso aproximado), con vista 3D adaptable al móvil. Se abre con el botón **Ver en RA** de PipeCAD (código QR), con un proyecto `.json` o con el último proyecto de PipeCAD de este navegador. Con unas **Meta Quest 3** o un **Android con ARCore** (Chrome), «Ver en RA» la coloca sobre el suelo real: en las gafas, mirando al suelo y pellizcando; en el teléfono, tocando la pantalla o «Colocar aquí». Necesita HTTPS: prueba con https://skymaker.github.io/PipeCAD/ra.html?ejemplo. Tiene **gravedad** (motor de física Rapier): en la vista 3D, «Soltar» la deja caer y «Reiniciar» la vuelve a poner derecha. En las Quest 3 se **agarra** pellizcando (o con el gatillo o el botón de agarre del mando), de cerca o apuntando con el rayo; con dos manos se gira, y al soltarla cae o se lanza. En la vista 3D y en Android se **arrastra con el ratón o el dedo** (cuelga del punto cogido) y se gira con dos dedos. **Opciones**: gravedad, fijar al suelo, cotas, rejilla y colores por Ø; en las Quest aparecen en la muñeca izquierda al mirar la palma (o con el botón X del mando). En **iPhone y iPad** (Safari), «Ver en RA» la abre con AR Quick Look a tamaño real sobre el suelo; ahí se mueve y gira con los dedos, pero sin gravedad (ver [PLAN.md](PLAN.md)).
- **Proyecto de ejemplo** en [`ejemplos/ejemplo.json`](ejemplos/ejemplo.json) (botón «Ejemplo»).
- **Ajustes** de la interfaz: botón «Ejemplo» visible u oculto y tamaño de los gizmos de navegación.
- **Cubo de vistas** para orbitar y saltar a caras, aristas o vértices, con interruptor isométrica / perspectiva.
- **Rótulos** de cotas o marcas de pieza que se pueden ocultar con un interruptor.
- **Puntos de arrastre** para alargar y acortar tubos; lo conectado detrás se desplaza en bloque.
- **Medidas a eje**: la longitud real de corte se calcula descontando la cota Z de cada accesorio (centro → tope de embocadura). Las cotas son editables.
- **Despiece**: barras de 3000 mm, 2 mm por corte, optimizado para usar el mínimo de barras; división automática de tramos largos con manguitos.
- **Exportación**: proyecto `.json`, despiece `.csv`, impresión / PDF y captura PNG.

## Desarrollo

El plan de fases y el estado del proyecto están en [PLAN.md](PLAN.md). El cálculo (modelo, accesorios, despiece, `.pcf`, STL y carpeta de modelos) está en [`js/nucleo.js`](js/nucleo.js), compartido por PipeCAD y el visor RA. Las pruebas del motor de cálculo se ejecutan desde la pestaña **Configuración** (sección «Pruebas del motor») o abriendo `index.html?test` desde un servidor; sin servidor, las pruebas del proyecto de ejemplo se omiten.

## Licencia

GPL v3 — ver [LICENSE](LICENSE).
