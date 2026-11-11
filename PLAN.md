# PipeCAD — Plan de desarrollo

CAD 3D para el navegador con el que se diseñan instalaciones con tubería de PVC de **Ø20, Ø32 y Ø40 mm**. Da las longitudes reales de corte y el despiece optimizado en barras de 3 m. Incluye una biblioteca ampliable de accesorios con modelos imprimibles en 3D generados con OpenSCAD.

---

## 1. Decisiones de diseño

| Tema | Decisión |
|---|---|
| Arquitectura | Páginas web estáticas sin compilación: `index.html` (PipeCAD) y `editor.html` (editor de accesorios), cada una con su HTML, CSS y JS. Los datos que no son código van en carpetas aparte: `modelos/` y `ejemplos/`. |
| Motor 3D | Three.js 0.160 desde CDN (`importmap`, versión fijada), con `OrbitControls` y `CSS2DRenderer`. Requiere internet al abrir. |
| Unidades y ejes | 1 unidad = 1 mm. **Eje Z vertical** (convención CAD). Interfaz en español. |
| Diámetros | Ø20, Ø32 y Ø40. Los cambios de Ø se resuelven con **manguito reductor** y **Te reducida**. |
| Cotas de accesorios | Valores orientativos de PVC presión encolar, **editables** y guardados en el proyecto. |
| Direcciones | Los tubos pueden ir en **cualquier dirección**. Al dibujar se ofrecen las 18 direcciones «limpias» (6 de ejes y 12 diagonales a 45° en los planos principales) o las del sistema de ejes de un tubo inclinado. Las uniones exigen los ángulos de un accesorio disponible: 90° y 45° en los de serie, cualquier ángulo en los personalizados. |
| Forma de dibujo | **Polilínea** con accesorios automáticos como modo principal. Además, colocación manual de accesorios (sueltos, en el extremo de un tubo o insertados en un tubo) y unión automática entre tubos. |
| Accesorios | Seis de serie (codo 90°, codo 45°, Te, Te reducida, manguito y reductor) y personalizados descritos en el lenguaje `.pcf`. Todos se activan o desactivan en una biblioteca. |
| Modelos 3D | Fuera del programa, en `modelos/`. Cada accesorio tiene su `.pcf`, un código **OpenSCAD** paramétrico y un STL por variante, que es un sólido único imprimible. Los STL se generan con OpenSCAD en el navegador (WebAssembly, motor Manifold). |
| Regla de corte | En una barra caben las piezas si `ΣL + kerf·(n−1) ≤ barra`: 2 mm por corte real y nada si la última pieza agota la barra. Se optimiza para usar el mínimo de barras. |
| Exportación | Proyecto `.json`, despiece `.csv`, impresión / PDF, captura PNG y STL de cada accesorio. |
| Snap | 10 mm por defecto, ajustable (1/5/10/50/100 mm), y medidas exactas por teclado. |
| Guardado de accesorios | **Servidor local** `servidor.mjs` (Node, sin dependencias, solo `127.0.0.1` por defecto) con una API para escribir en `modelos/`. Sin servidor: una carpeta elegida en Chrome o Edge, el navegador o un `.zip`. |
| Versiones | Repositorio en GitHub (https://github.com/Skymaker/PipeCAD), un commit por cambio y publicación en GitHub Pages. |

---

## 2. Modelo geométrico (núcleo del cálculo)

La instalación es un **grafo**:

- **Nodo** `{id, pos, fit?}`: punto 3D en el eje de la tubería. Si no tiene accesorio declarado (`fit`), su tipo se deduce de los tubos que llegan:
  - 1 tubo → extremo libre;
  - 2 tubos colineales del mismo Ø → manguito; de distinto Ø → reductor;
  - 2 tubos a 90° → codo 90°; con un giro de 45° (135° entre tubos) → codo 45°;
  - 3 tubos (2 colineales + 1 perpendicular) → Te, o Te reducida si la derivación es de otro Ø;
  - mismos ángulos y Ø que un accesorio personalizado de la biblioteca → ese accesorio (por ejemplo, cuatro tubos a 90° → «Cruz 90°»);
  - cualquier otra combinación → **nodo no válido** (en rojo).
- **Accesorio declarado** (`node.fit`): tiene tipo, variante, Ø exterior y sus bocas (dirección, Ø, Z, embocadura y ejes locales). Puede tener bocas libres y existir sin tubos. El proyecto guarda las medidas de los personalizados, así que se abre igual aunque falte la biblioteca.
- **Tramo** `{id, a, b, d}`: une dos nodos y tiene un Ø.
- **Grupo** `{id, name, nodes, segs}`: conjunto de piezas que se seleccionan, mueven y giran juntas.

**Longitudes**

- Medida a ejes: `Le = |B − A|`.
- Longitud real de corte: `Lr = Le − Z(accesorio A, boca) − Z(accesorio B, boca)`, donde `Z` es la distancia del centro del accesorio al tope de la embocadura. En un extremo libre, `Z = 0`.
- Validaciones:
  - `Lr` debe superar el tubo visto mínimo (10 mm, configurable);
  - si `Lr` supera la barra, se avisa y se ofrece dividir el tramo con manguitos;
  - un extremo suelto pegado a otro nodo parece unido pero no lo está, así que se avisa y se ofrece **Conectar**.

**Cotas por defecto (mm, editables)**

| Ø | Embocadura | Ø exterior | Z codo 90° | Z codo 45° | Z Te | Z manguito |
|---|---|---|---|---|---|---|
| 20 | 16 | 27 | 11 | 5 | 11 | 2 |
| 32 | 22 | 41 | 17 | 8 | 17 | 2 |
| 40 | 26 | 50 | 21 | 10 | 21 | 2 |

Los reductores (32→20, 40→20 y 40→32) y las Tes reducidas tienen su propia tabla de Z por boca, también editable.

---

## 3. Estructura del proyecto

```
index.html            PipeCAD: dibujo, cálculo, despiece, biblioteca, configuración y pruebas
editor.html           Editor de accesorios (formulario → .pcf + OpenSCAD → STL)
ra.html               Visor de realidad aumentada (Quest 3, Android, iPhone)
js/nucleo.js          Núcleo compartido: modelo, cálculo de accesorios, despiece, .pcf, STL y carpeta de modelos
servidor.mjs          Servidor local con API para guardar accesorios
iniciar-servidor.bat  / iniciar-servidor.sh   arranque con doble clic o desde la terminal
ejemplos/ejemplo.json Proyecto de ejemplo
modelos/
  catalogo.json       Lista de accesorios (de serie y personalizados) y plantillas
  pipecad.scad        Librería OpenSCAD común: accesorio_pipecad(bocas, variantes, variante, holgura)
  serie/              Los 6 de serie: .pcf, .scad y un STL por variante
  personalizados/     Accesorios propios (cruz90, codo30…)
  plantillas/         Plantillas del editor (.pcf)
```

---

## 4. Fases de desarrollo

Cada fase termina con algo que funciona y se puede comprobar en el navegador. Las pruebas del motor se acumulan fase a fase.

### Fase 0 — Andamiaje y repositorio
- `index.html` con `importmap` a Three.js y esta estructura: barra superior, menú lateral, visor 3D, panel con pestañas y barra de estado.
- CSS con variables (tema claro u oscuro según el sistema) y diseño adaptable.
- JS en módulos lógicos dentro del archivo: catálogo, modelo, motor de accesorios, representación, herramientas, interfaz, despiece, archivo y biblioteca.
- Repositorio en GitHub, publicación en GitHub Pages y un commit por cambio.
- ✅ Criterio: la página carga con el visor vacío y los paneles.

### Fase 1 — Escena y navegación
- Rejilla en mm, ejes de colores y órbita, desplazamiento y zoom.
- **Cubo de vistas** achaflanado, que se arrastra para orbitar. Tiene 6 caras, 12 planos de arista a 45° y 8 vértices isométricos, cada zona se resalta y se pulsa para ir a esa vista con animación. Incluye el interruptor isométrica / perspectiva y «encuadrar todo».
- **Gizmo de planos de trabajo**: tres planos XY, XZ e YZ que se cortan, cada uno con su cota editable. Fijan la rejilla, los puntos en el vacío y la orientación inicial de los accesorios.
- La barra de estado muestra X, Y, Z del punto que se marca.
- ✅ Criterio: navegación fluida y coordenadas correctas en los tres planos.

### Fase 2 — Modelo de datos y deshacer
- Nodos, tramos, accesorios declarados y grupos con IDs estables, independientes de la representación.
- **Deshacer y rehacer** con instantáneas del modelo (Ctrl+Z / Ctrl+Y), más simple y robusto que el patrón comando. Edición en vivo (arrastres) agrupada en un solo paso de deshacer.
- Serialización a JSON con versión de formato.
- ✅ Criterio: crear y borrar desde la consola, deshacer, rehacer y serializar sin pérdidas.

### Fase 3 — Motor de accesorios
- Clasificación automática de cada nodo (sección 2), incluidos los accesorios declarados y los personalizados.
- Orientación de cada accesorio a partir de las direcciones de sus bocas.
- Cálculo de `Lr` con las cotas Z.
- Detección de errores:
  - ángulos sin accesorio;
  - accesorio quitado de la biblioteca;
  - demasiadas conexiones;
  - `Lr` por debajo del mínimo o por encima de la barra;
  - extremos sueltos pegados a otro nodo.
- ✅ Criterio: casos con resultado conocido. Por ejemplo, un tramo de Ø20 de 1000 mm a ejes entre dos codos de 90° mide 978 mm de corte.

### Fase 4 — Representación 3D
- Tubos con su Ø exterior real, recortados a `Lr`.
- Accesorios:
  - los de serie, con forma procedural (cuerpo, embocaduras y esfera central);
  - los personalizados, con su STL de la carpeta `modelos/`, orientado según sus bocas, y una forma simple mientras se descarga.
- Colores por Ø, selección y paso del ratón resaltados, y nodos no válidos en rojo.
- **Rótulos** de cotas (a ejes y/o reales) o marcas de pieza, con interruptor (botón y tecla L).
- **Redibujado incremental** por firmas, que solo regenera lo que cambia.
- ✅ Criterio: el proyecto de ejemplo se ve bien ensamblado.

### Fase 5 — Dibujo por polilínea
- Trazado clic a clic sobre el plano de trabajo o desde un extremo existente, con los codos insertados solos en cada cambio de dirección. La longitud se puede escribir mientras se dibuja.
- **Direcciones libres**: desde un tubo inclinado se ofrecen las direcciones de su propio sistema de ejes. Las diagonales a 45° aplican el paso al avance en cada eje, para que los tramos simétricos se encuentren.
- **Dibujo en altura sin teclas modificadoras**: se ofrecen a la vez direcciones horizontales, verticales e inclinadas, y gana la más cercana al ratón. Mayús restringe a tramos que suben o bajan.
- **Puntos de referencia** activables por tipo y en bloque (botón / F3): extremos, mitad, tercios, cuartos y centros de accesorio.
- Empezar o terminar sobre un tubo lo parte e inserta una Te, o una Te reducida si cambia el Ø. Prolongar en línea fusiona los tramos.
- **Unión automática**: al pasar sobre otro tubo se propone el tramo perpendicular (o la perpendicular común si no son paralelos) y las Tes quedan giradas el ángulo necesario.
- Selector de Ø activo.
- ✅ Criterio: dibujar en 3D un circuito con codos, Tes y reducciones sin escribir ninguna cota.

### Fase 6 — Accesorios manuales, giros y uniones
- Herramienta **Accesorio**: se coloca suelto, en el extremo de un tubo o insertado en un tubo, que queda partido en dos sin duplicar piezas. Toma el Ø del tubo; el reductor cambia el Ø del tramo del lado menor.
- **Gizmo de giro** sobre los ejes propios del accesorio (los de sus bocas y su perpendicular). El paso angular se configura (1/5/15/45/90°) y también se puede escribir un giro exacto; además, teclas R/E/W. Los tubos que dejan de coincidir con una boca se separan y conservan su longitud real.
- **Unir tubos** alineados del mismo Ø en uno solo, quitando el manguito o cerrando el hueco.
- **Conectar** un extremo suelto pegado a un nodo: alarga el tubo o desplaza el accesorio a lo largo de su tubo.
- Borrar un accesorio deja sus tubos sueltos.
- ✅ Criterio: colocar, girar e insertar accesorios en tubos con cualquier dirección sin descuadrar las longitudes.

### Fase 7 — Selección múltiple y grupos
- Mayús+clic añade o quita piezas y Ctrl+A selecciona todo.
- Rectángulo con doble clic y arrastre: hacia la derecha selecciona lo que queda dentro; hacia la izquierda, lo que cruza.
- **Grupos** guardados en el proyecto (Ctrl+G / Ctrl+Mayús+G). Al pulsar un miembro se selecciona el grupo; con Ctrl+clic, una pieza suelta. Se desagrupan desde la lista de Propiedades.
- **Caja de grupo** con tamaño fijo en pantalla: flechas para mover por un eje, esfera para mover en el plano de trabajo y anillos para girar. Los tubos externos se separan conservando su longitud.
- **Duplicar** (Ctrl+D), **espejo** horizontal y vertical, y borrado múltiple.
- ✅ Criterio: mover, girar, duplicar y reflejar una estructura agrupada sin romper sus uniones internas.

### Fase 8 — Puntos de arrastre y propiedades
- Puntos de arrastre en los extremos y accesorios de lo seleccionado. Se arrastran a lo largo del eje del tramo con snap, y lo conectado detrás se desplaza en bloque; en circuitos cerrados se estira por el plano medio. Mientras se arrastra se ven la medida a ejes y la real, y no se puede pasar del mínimo físico.
- Panel de propiedades:
  - tramo: Ø, medida a ejes y longitud real editables, y qué extremo se mueve;
  - accesorio: tipo, bocas, Z, posición y giro exacto.
- ✅ Criterio: arrastrar un tramo entre dos codos, o escribir 1500 mm a ejes, da la longitud real esperada.

### Fase 9 — Despiece y optimización de corte
- Longitudes reales por Ø, redondeadas a mm.
- Tramos más largos que la barra: división automática con manguitos (barras enteras y un resto ≥ 300 mm).
- Empaquetado por **Best-Fit Decreasing** con vaciado de barras, aplicando la regla de corte de la sección 1.
- Resultados:
  - barras por Ø y mínimo teórico;
  - esquema gráfico de cada barra, con cortes y retal;
  - aprovechamiento;
  - accesorios por tipo y Ø;
  - **marcas de pieza**, que también se ven en el 3D.
- ✅ Criterio: casos verificados. 2 × 1499 mm caben en 1 barra (1499 + 2 + 1499 = 3000); 2 × 1500 mm necesitan 2 barras.

### Fase 10 — Guardar y exportar
- Proyecto `.json`: nuevo, abrir y guardar, con autoguardado en el navegador.
- Despiece `.csv` (separador `;`, coma decimal, UTF-8 con BOM para Excel en español).
- Impresión / PDF del despiece con la imagen de la vista, y captura PNG con cotas.
- ✅ Criterio: guardar, volver a abrir y obtener el mismo modelo y el mismo despiece.

### Fase 11 — Configuración y ajustes
- Pestaña **Configuración**, guardada en el proyecto:
  - barra, corte y tubo visto mínimo;
  - tabla de Z, embocaduras y Ø exteriores;
  - reductores y Tes reducidas;
  - nombre del proyecto y botón para restaurar los valores por defecto.
- Desde ahí también se ejecutan las **pruebas del motor**.
- **Ajustes** de la interfaz, guardados en el navegador: mostrar u ocultar «Ejemplo» y tamaño del cubo de vistas y del gizmo de planos (de 120 a 240 px).
- ✅ Criterio: cambiar una Z recalcula longitudes y despiece al instante.

### Fase 12 — Biblioteca y lenguaje `.pcf`
- Pestaña **Biblioteca**: cada accesorio (de serie o de la carpeta) se activa o desactiva con una casilla; un nudo que necesite uno desactivado se marca como no válido. Descarga del `.pcf` y del STL de cada variante.
- **Lenguaje `.pcf`**:
  - `ACCESORIO`, `NOMBRE` y `DESCRIPCION`;
  - `BOCA n x y z`;
  - `VARIANTE v DIAMETROS … Z … EMBOCADURA … [PASO …] EXTERIOR e`;
  - `MODELO v archivo.stl`.

  Los errores indican la línea. La pestaña incluye una guía y una plantilla descargable.
- Los personalizados se reconocen solos en un nudo con los mismos ángulos y Ø, y se colocan, giran e insertan como los de serie.
- «Cargar accesorio…» acepta `.pcf`, `.stl` y `.scad`. Con el servidor se copian a la carpeta; sin él, se guardan en el navegador y se pueden pasar a la carpeta más tarde.
- ✅ Criterio: un accesorio cargado desde `.pcf` calcula bien sus longitudes y el proyecto se abre igual sin la biblioteca.

### Fase 13 — Carpeta de modelos y STL imprimibles
- `modelos/catalogo.json` con el `.pcf`, el `.scad` y un STL por variante de cada accesorio, más las plantillas.
- **Librería OpenSCAD** `pipecad.scad`. Cada accesorio es un sólido único:
  - cuerpo de cada boca;
  - embocaduras taladradas al Ø del tubo más la holgura;
  - **paso interior** de boca a boca, unido en una cámara central si las bocas no están alineadas.

  Cada `.scad` usa la librería con `use <../pipecad.scad>`, y el Personalizador de OpenSCAD permite elegir variante, holgura y `$fn`.
- STL de los 6 accesorios de serie (18 variantes) generados con OpenSCAD.
- PipeCAD lee el catálogo y descarga los STL al dibujar, con una forma simple mientras tanto o si no hay carpeta. Sin servidor, permite elegir la carpeta a mano.
- ✅ Criterio: todas las variantes salen en una sola pieza, con la superficie cerrada y el paso abierto.

### Fase 14 — Editor de accesorios (`editor.html`)
- Formulario con:
  - identificador, nombre y descripción;
  - bocas, con dirección rápida ±X, ±Y, ±Z o un ángulo en planta;
  - variantes (Ø, Z, embocadura, paso y Ø exterior), holgura y resolución.

  Comprueba paredes de menos de 1,2 mm y bocas a menos de 30° entre sí, y muestra los ángulos entre bocas.
- Puntos de partida: **Nuevo** (desde cero), plantillas de `modelos/plantillas/`, «Abrir…» (`.pcf` / `.scad`) o «Editar de la biblioteca…».
- Genera el `.pcf` y el código **OpenSCAD**, que se puede editar a mano y volver a generar desde el formulario.
- Crea los STL con **OpenSCAD 2025.01 en WebAssembly** (motor Manifold, unos 0,2 s por pieza) en un hilo aparte, con una alternativa en la propia página. Muestra la vista 3D con las bocas y la información de la malla, y avisa si la pieza no sale en una sola.
- Descargas: `.scad` autónomo (con la librería dentro), `.stl`, `.pcf` y `.zip` con todo y un `LEEME.txt`.
- **Guardar en PipeCAD**: por el servidor local, en una carpeta elegida (Chrome / Edge) o en el navegador. PipeCAD lo recarga al momento por `BroadcastChannel` o por el evento de almacenamiento.
- ✅ Criterio: crear un accesorio en el editor, guardarlo e insertarlo en un tubo en PipeCAD con su STL y sus longitudes correctas.

### Fase 15 — Servidor local e instalación
- `servidor.mjs`:
  - sirve los archivos (sin acceso a archivos ocultos ni fuera de la carpeta);
  - `GET /api/estado`;
  - `POST /api/accesorios`, que escribe los archivos y actualiza el catálogo de forma atómica;
  - `DELETE /api/accesorios/<id>`;
  - opciones `--puerto` y `--red`.
- `iniciar-servidor.bat` y `iniciar-servidor.sh`, y `.gitattributes` para que los STL se traten como binarios.
- README con la instalación en un ordenador: descargar, instalar Node.js, arrancar y guardar accesorios, y alternativas con otros servidores.
- ✅ Criterio: guardar y borrar accesorios desde el editor y desde PipeCAD sin depender de GitHub.

### Fase 16 — Interfaz, ayuda, ejemplo y pruebas
- **Menú lateral** de comandos con iconos SVG, contraíble (iconos con tooltip) o expandido, con estados activo/desactivado según la selección.
- Ayuda rápida (botón «?» / F1, que se abre sola la primera vez), atajos de teclado y mensajes de error claros.
- **Proyecto de ejemplo** en `ejemplos/ejemplo.json`: estructura de Ø32 sobre una base de 600 × 600, con pórticos, tramos a 45° y refuerzos (31 tubos, 7 codos y 16 Tes, agrupados).
- **Pruebas integradas** (Configuración › Pruebas del motor, o `?test`). Sin servidor, las pruebas que dependen del ejemplo se omiten.
- Rendimiento con cientos de tramos.
- ✅ Criterio: con 624 tramos el arrastre baja de 36 a 4 ms por fotograma y la vista se mantiene a 60 fps.

### Bloque RA — Visor de realidad aumentada (`ra.html`)

Objetivo: ver el proyecto **a tamaño real** sobre el suelo, agarrarlo y que caiga con la gravedad. Debe funcionar en las **Meta Quest 3**, en **Android** y en **iPhone / iPad**.

| Dispositivo | Realidad aumentada | Física (gravedad) | Interacción |
|---|---|---|---|
| Meta Quest 3 (navegador de Quest) | WebXR `immersive-ar` sobre la imagen real | ✅ Rapier | Manos y mandos: agarrar, lanzar, dos manos |
| Android con ARCore (Chrome) | WebXR `immersive-ar` en la pantalla | ✅ Rapier | Táctil: tocar y arrastrar, girar con dos dedos, botones |
| iPhone / iPad (Safari) | AR Quick Look con `.usdz` generado en el navegador | ❌ La apoya el sistema en el suelo, sin física propia | La de Quick Look, con el escalado bloqueado (1:1) |
| Sin RA | Vista 3D con ratón o táctil | ✅ En pantalla | Órbita, zoom y arrastre |

Decisiones:
- **Escala** 1:1 fija. Conversión: mm con Z vertical → metros con Y vertical (× 0,001 y −90° sobre X).
- **Física** con Rapier (`@dimforge/rapier3d-compat`). La estructura es **un cuerpo rígido compuesto**: un cilindro por tubo y una bola por accesorio. La masa sale del PVC real (1,4 g/cm³, con la pared según el Ø).
- **Suelo**: `local-floor`, afinado con `hit-test` y `plane-detection`. Suelo físico fijo, plano que recoge sombras y rejilla que se puede ocultar.
- **Paso del proyecto a las gafas o al móvil**: enlace con el proyecto comprimido dentro (deflate + base64url) y **código QR** desde PipeCAD. Funciona en GitHub Pages sin servidor.
- **HTTPS**, obligatorio para WebXR:
  - GitHub Pages;
  - servidor local por USB con `adb reverse` (Quest y Android);
  - servidor local por wifi con `--https` y `mkcert` (también iPhone).

#### Fase 17 (R0) — Núcleo común
- `js/nucleo.js` con lo que comparten las páginas:
  - catálogo, modelo, motor de accesorios y despiece;
  - `.pcf`, STL, carpeta de modelos y ejemplo.
- Es un script clásico con una fábrica `crearNucleoPipeCAD(THREE, avisos)`, para que PipeCAD siga funcionando al abrirlo como archivo.
- ✅ Criterio: PipeCAD funciona igual y las pruebas del motor siguen pasando.

#### Fase 18 (R1) — Página `ra.html` (vista 3D)
- Carga el proyecto desde el enlace (`#p=`), desde un `.json` o desde el ejemplo.
- Construye la escena en metros con el núcleo: tubos recortados a su longitud real, accesorios de serie y STL de los personalizados.
- Diseño adaptable a móvil, geometría aligerada en los teléfonos y detección de capacidades (WebXR `immersive-ar` o Quick Look).
- ✅ Criterio: el ejemplo se ve igual que en PipeCAD y con las medidas correctas.

#### Fase 19 (R2) — Sesión de RA y suelo (Quest y Android)
- `immersive-ar` con `local-floor`, `hit-test`, `dom-overlay`, `hand-tracking` y `plane-detection` (estas cuatro, opcionales).
- Retícula de colocación: en la Quest se coloca con un pellizco y en Android tocando la pantalla.
- ✅ Criterio: la estructura queda apoyada en el suelo real a tamaño real.

#### Fase 20 (R3) — Física
- Rapier con gravedad de 9,81 m/s², paso fijo, suelo fijo y cuerpo compuesto con la masa real.
- ✅ Criterio: cae, se asienta sin temblar y vuelca si queda en mala postura.

#### Fase 21 (R4) — Agarre con las manos (Quest)
- Pellizco o puño cerca de la pieza, rayo con pellizco a distancia y agarre con dos manos para mover y girar, sin escalar.
- Mientras se agarra, la estructura sigue a la mano con un muelle amortiguado; al soltar conserva la velocidad de la mano.
- ✅ Criterio: coger, girar, dejar y lanzar suavemente, con las manos y con los mandos.

#### Fase 22 (R5) — Interacción táctil (Android y vista 3D)
- Tocar y arrastrar: un muelle levanta la estructura unos 20 cm y la lleva al punto del suelo bajo el dedo; al soltar, cae.
- Girar sobre el eje vertical con dos dedos.
- ✅ Criterio: en Android con ARCore se coloca, se arrastra, cae y se apoya.

#### Fase 23 (R6) — iPhone y iPad: AR Quick Look
- `.usdz` generado con `USDZExporter`, con el origen en la base y colores por Ø.
- Se abre con `<a rel="ar">` y la opción `#allowsContentScaling=0`.
- Antes de abrir, la página explica que en iOS no hay gravedad simulada.
- ✅ Criterio: en Safari de iOS se abre a tamaño real sobre el suelo.

#### Fase 24 (R7) — Menús
- Quest: panel en la muñeca, que aparece al mirar la palma.
- Teléfonos: barra superpuesta con `dom-overlay`.
- Opciones: Reiniciar, Gravedad sí/no, Fijar al suelo, Cotas, Rejilla, Colores por Ø y Salir.

#### Fase 25 (R8) — «Ver en RA» desde PipeCAD y HTTPS
- Botón en PipeCAD con el enlace y el QR.
- `servidor.mjs --https` con certificados de `mkcert`.
- README con los pasos para Quest, Android e iPhone.

#### Fase 26 (R9) — Opcional: entorno real como obstáculo
- En Quest 3, con `mesh-detection`, las mesas y paredes reales pasan a ser colisionadores.

Limitaciones previstas:
- En iOS no hay WebXR, así que no habrá gravedad ni agarre con física.
- Android necesita un teléfono compatible con ARCore.
- Las pruebas en Quest 3, Android e iPhone las tiene que hacer el usuario; en el ordenador se verifica con el emulador de WebXR y la vista móvil.

---

## 5. Estado

| Fase | Estado |
|---|---|
| 0 Andamiaje y repositorio | ✅ |
| 1 Escena y navegación | ✅ |
| 2 Modelo de datos y deshacer | ✅ |
| 3 Motor de accesorios | ✅ |
| 4 Representación 3D | ✅ |
| 5 Dibujo por polilínea | ✅ |
| 6 Accesorios manuales, giros y uniones | ✅ |
| 7 Selección múltiple y grupos | ✅ |
| 8 Puntos de arrastre y propiedades | ✅ |
| 9 Despiece y optimización | ✅ |
| 10 Guardar y exportar | ✅ |
| 11 Configuración y ajustes | ✅ |
| 12 Biblioteca y `.pcf` | ✅ |
| 13 Carpeta de modelos y STL imprimibles | ✅ (21 piezas de plantilla: una sola pieza, cerradas y con paso abierto; 18 de serie: una sola pieza) |
| 14 Editor de accesorios | ✅ |
| 15 Servidor local e instalación | ✅ |
| 16 Interfaz, ayuda, ejemplo y pruebas | ✅ **79/79 pruebas del motor** |
| 17 (R0) Núcleo común | ✅ `js/nucleo.js` (93 funciones y datos compartidos); PipeCAD, 79/79 pruebas |
| 18 (R1) Página ra.html | ✅ Vista 3D adaptable a móvil, proyecto por enlace `#p=` (el ejemplo ocupa 1 KB), `.json`, último proyecto o ejemplo; medidas, peso y formas para la física; detección de RA |
| 19 (R2) Sesión de RA y suelo | ✅ Programada y probada con una cámara y fotogramas simulados (mirada contra el suelo, plano «floor», prueba de impacto, giro hacia el usuario). **Falta probarla en Quest 3 y Android.** |
| 20 (R3) Física | ✅ Rapier 0.12 (WebAssembly desde CDN): cuerpo compuesto de 117 formas en el ejemplo, masa 3,67 kg repartida, suelo fijo, paso de 1/90 s. Probado: caída libre correcta (0,44 m y 2,92 m/s a los 0,3 s), desde 1 m se asienta derecha y en reposo, inclinada 80° vuelca y queda tumbada. Botones Soltar (50 cm) y Reiniciar en la vista 3D; en RA, quieta mientras se coloca y con gravedad al dejarla. |
| 21 (R4) Agarre con las manos | ✅ Pellizco (pulgar-índice, con histéresis) o gatillo/agarre del mando; de cerca (4 cm de la superficie) o con rayo a distancia (hasta 4 m); resaltado y vibración. Seguimiento con muelle amortiguado (τ según la masa), sin atravesar el suelo; al soltar conserva la velocidad (lanzar). Dos manos: mover y girar sin escalar. Probado con poses simuladas: subir 0,5 m, girar 90°, soltar, lanzar a 2,6 m/s y girar 90° con dos manos. **Falta probarlo en las Quest 3.** |
| 22 (R5) Manejo táctil | ✅ Se coge por el punto tocado: un muelle amortiguado (impulsos en ese punto, más el peso) lo sube 20 cm y lo lleva bajo el dedo, a 2,5 m/s como mucho; la estructura cuelga y se balancea, y al soltar cae. Dos dedos: giro en planta hacia un rumbo objetivo (sin inercia al parar). Vista 3D con ratón o dedo (fuera de la estructura, órbita normal) y RA de Android con los toques de pantalla de WebXR. Probado: sube 20 cm en 0,5 s, arrastre de 0,5 m, giro de 90° y arrastre real con el ratón. **Falta probarlo en Android.** |
| 23–26 (R6–R9) iOS, menús, QR y entorno | ⏳ Pendiente |

### Pendiente y limitaciones conocidas
- El guardado en una carpeta elegida (Chrome / Edge, sin servidor) no se ha probado en un navegador real.
- Los STL de serie usan las cotas por defecto. Si un proyecto las cambia en Configuración, PipeCAD avisa al descargarlos.
- En GitHub Pages la carpeta `modelos/` es de solo lectura: un accesorio nuevo se añade con el servidor local y un commit.
- La primera vez que se usa OpenSCAD en el editor se descargan unos 11 MB, que luego quedan en la caché del navegador.

---

## 6. Orden de entrega

| Bloque | Fases | Resultado |
|---|---|---|
| Base de cálculo | 0–4 | Visor con modelo y accesorios correctos |
| Edición interactiva | 5–8 | Dibujo, accesorios, grupos y arrastre |
| Producción | 9–11 | Despiece, exportación y configuración |
| Accesorios ampliables | 12–15 | Biblioteca, modelos 3D, editor OpenSCAD y servidor local |
| Cierre | 16 | Interfaz, ayuda, ejemplo, pruebas y rendimiento |
| Realidad aumentada | 17–26 | Visor RA a tamaño real en Quest 3, Android e iPhone |

Tras cada bloque se revisa en el navegador antes de seguir, y cada cambio se registra con un commit en GitHub.
