# PipeCAD — Plan de desarrollo

CAD 3D para el navegador con el que se diseñan instalaciones con tubería de PVC de **Ø20, Ø32 y Ø40 mm**. Da las longitudes reales de corte y el despiece optimizado en barras de 3 m. Incluye:
- una biblioteca ampliable de accesorios, con modelos imprimibles en 3D generados con OpenSCAD;
- un visor de **realidad aumentada** para ver el proyecto a tamaño real, cogerlo y dejarlo caer, en unas Meta Quest 3, en un Android o en un iPhone.

---

## 1. Decisiones de diseño

| Tema | Decisión |
|---|---|
| Arquitectura | Páginas web estáticas sin compilación: `index.html` (PipeCAD), `editor.html` (editor de accesorios) y `ra.html` (visor de realidad aumentada). Comparten el **núcleo de cálculo** `js/nucleo.js`: un script clásico con la fábrica `crearNucleoPipeCAD(THREE, avisos)`, para que PipeCAD funcione también abierto como archivo. Lo que no es código va en carpetas aparte: `modelos/` y `ejemplos/`. |
| Motor 3D | Three.js 0.160 desde CDN (`importmap`, versión fijada), con `OrbitControls`, `CSS2DRenderer`, `BufferGeometryUtils` y `USDZExporter`. Requiere internet al abrir. |
| Unidades y ejes | En PipeCAD, 1 unidad = 1 mm y **eje Z vertical** (convención CAD). En el visor RA, metros y Y vertical, como WebXR: × 0,001 y −90° sobre X. Escala 1:1 fija. Interfaz en español. |
| Diámetros | Ø20, Ø32 y Ø40. Los cambios de Ø se resuelven con **manguito reductor** y **Te reducida**. |
| Cotas de accesorios | Valores orientativos de PVC presión encolar, **editables** y guardados en el proyecto. |
| Direcciones | Los tubos pueden ir en **cualquier dirección**. Al dibujar se ofrecen las 18 direcciones «limpias» (6 de ejes y 12 diagonales a 45° en los planos principales) o las del sistema de ejes de un tubo inclinado. Las uniones exigen los ángulos de un accesorio disponible: 90° y 45° en los de serie, cualquier ángulo en los personalizados. |
| Forma de dibujo | **Polilínea** con accesorios automáticos como modo principal. Además, colocación manual de accesorios (sueltos, en el extremo de un tubo o insertados en un tubo) y unión automática entre tubos. |
| Accesorios | Seis de serie (codo 90°, codo 45°, Te, Te reducida, manguito y reductor) y personalizados descritos en el lenguaje `.pcf`. Todos se activan o desactivan en una biblioteca. |
| Modelos 3D | Fuera del programa, en `modelos/`. Cada accesorio tiene su `.pcf`, un código **OpenSCAD** paramétrico y un STL por variante, que es un sólido único imprimible. Los STL se generan con OpenSCAD en el navegador (WebAssembly, motor Manifold). |
| Regla de corte | En una barra caben las piezas si `ΣL + kerf·(n−1) ≤ barra`: 2 mm por corte real y nada si la última pieza agota la barra. Se optimiza para usar el mínimo de barras. |
| Exportación | Proyecto `.json`, despiece `.csv`, impresión / PDF, captura PNG, STL de cada accesorio y `.usdz` para el iPhone. |
| Snap | 10 mm por defecto, ajustable (1/5/10/50/100 mm), y medidas exactas por teclado. |
| Realidad aumentada | **WebXR** `immersive-ar` en las Quest 3 y en Android (Chrome con ARCore); en iPhone y iPad, **AR Quick Look** con un `.usdz` generado en el navegador. Sin RA, una vista 3D con ratón o táctil. |
| Física | **Rapier** 0.12 (`@dimforge/rapier3d-compat`, WebAssembly desde CDN). La estructura encolada es **un cuerpo rígido compuesto**: un cilindro por tubo y por boca, y una bola en los nudos que ramifican. Su masa sale del PVC real (1,4 g/cm³, con la pared según el Ø). Paso fijo de 1/90 s. |
| Manejo | **Muelles amortiguados**, para que la estructura siga a la mano o al dedo sin atravesar el suelo y conserve la velocidad al soltarla: pose completa con las manos, un solo punto (cuelga de él) con el dedo o el ratón. |
| Compartir el proyecto | Enlace al visor con el proyecto comprimido dentro (deflate + base64url, `#p=`), que no pasa por ningún servidor, y **código QR**. Con servidor local, el proyecto se guarda en `proyectos/` y el enlace lleva solo su identificador. |
| Servidor local | `servidor.mjs` (Node, sin dependencias). Sirve el programa y tiene una API para guardar accesorios y proyectos, que **solo acepta escrituras desde el propio ordenador** (salvo `--red`). Con `--https` y certificados de mkcert, atiende también a las gafas y los móviles de la red, ya que WebXR solo funciona en páginas seguras. |
| Versiones | Repositorio en GitHub (https://github.com/Skymaker/PipeCAD), un commit por cambio y publicación en GitHub Pages (HTTPS, suficiente para el visor RA). |

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
index.html            PipeCAD: dibujo, cálculo, despiece, biblioteca, configuración, pruebas y «Ver en RA»
editor.html           Editor de accesorios (formulario → .pcf + OpenSCAD → STL)
ra.html               Visor de realidad aumentada (Meta Quest 3, Android, iPhone y vista 3D)
js/nucleo.js          Núcleo compartido: modelo, motor de accesorios, despiece, .pcf, STL, carpeta de modelos y enlaces
servidor.mjs          Servidor local: archivos, API de accesorios y proyectos, HTTPS para gafas y móviles
iniciar-servidor.bat  / iniciar-servidor.sh   arranque con doble clic o desde la terminal
ejemplos/ejemplo.json Proyecto de ejemplo
modelos/
  catalogo.json       Lista de accesorios (de serie y personalizados) y plantillas
  pipecad.scad        Librería OpenSCAD común: accesorio_pipecad(bocas, variantes, variante, holgura)
  serie/              Los 6 de serie: .pcf, .scad y un STL por variante
  personalizados/     Accesorios propios (cruz90, codo30…)
  plantillas/         Plantillas del editor (.pcf)
proyectos/            Proyectos compartidos con «Ver en RA» por el servidor local (no se sube a GitHub)
certificados/         Certificados de mkcert para --https (no se sube a GitHub)
```

### Visor RA por dispositivo

| Dispositivo | Realidad aumentada | Gravedad | Manejo |
|---|---|---|---|
| Meta Quest 3 (navegador de Quest) | WebXR `immersive-ar` sobre la imagen real | ✅ | Manos y mandos: coger de cerca o con rayo, dos manos, lanzar; menú en la muñeca; muebles y paredes reales como obstáculo |
| Android con ARCore (Chrome) | WebXR `immersive-ar` en la pantalla | ✅ | Tocar y arrastrar (cuelga del dedo), girar con dos dedos, botones superpuestos |
| iPhone / iPad (Safari) | AR Quick Look con `.usdz` | ❌ La apoya el sistema en el suelo | El de Quick Look, sin escalado (siempre 1:1) |
| Cualquier otro | Vista 3D | ✅ En pantalla | Ratón o dedo: arrastrar, girar con dos dedos, orbitar |

---

## 4. Fases de desarrollo

Cada fase termina con algo que funciona y se puede comprobar en el navegador; las de realidad aumentada, además, en los dispositivos. Las pruebas del motor se acumulan fase a fase.

### Fase 0 — Andamiaje, núcleo común y repositorio
- `index.html` con `importmap` a Three.js y esta estructura: barra superior, menú lateral, visor 3D, panel con pestañas y barra de estado.
- CSS con variables (tema claro u oscuro según el sistema) y diseño adaptable.
- **Núcleo común** `js/nucleo.js`: catálogo, modelo, motor de accesorios, despiece, `.pcf`, STL, carpeta de modelos y enlaces. Lo comparten PipeCAD y el visor RA. Es un script clásico, así que funciona también con la página abierta como archivo.
- En cada página, la interfaz en módulos lógicos: representación, herramientas, paneles, archivo y biblioteca.
- Repositorio en GitHub, publicación en GitHub Pages y un commit por cambio.
- ✅ Criterio: la página carga con el visor vacío y los paneles, y el núcleo funciona igual desde las dos páginas.

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
  - opciones `--puerto` y `--red`;
  - solo acepta escrituras desde el propio ordenador, salvo con `--red`.
- `iniciar-servidor.bat` y `iniciar-servidor.sh`, y `.gitattributes` para que los STL se traten como binarios.
- README con la instalación en un ordenador: descargar, instalar Node.js, arrancar y guardar accesorios, y alternativas con otros servidores.
- ✅ Criterio: guardar y borrar accesorios desde el editor y desde PipeCAD sin depender de GitHub.

### Fase 16 — Visor RA: el proyecto a tamaño real (`ra.html`)
- Abre el proyecto desde:
  - el enlace (`#p=`, comprimido) o el identificador del servidor (`?proyecto=`);
  - un `.json`;
  - el último proyecto de PipeCAD en ese navegador;
  - el ejemplo (`?ejemplo`).
- Construye la escena con el núcleo, en metros:
  - tubos recortados a su longitud real;
  - accesorios de serie y STL de los personalizados;
  - mallas unidas por material para que sea ligera en gafas y teléfonos;
  - estructura apoyada en el suelo y centrada.
- Escenario que se mueve junto, con la estructura: suelo que recoge las sombras, rejilla de 10 cm y luz con la sombra ajustada al tamaño.
- Datos del proyecto: tubos, accesorios, ancho × fondo × alto y peso aproximado del PVC.
- Formas para la física: un cilindro por tubo y por boca, y una bola por nudo ramificado, con su masa.
- Diseño adaptable a móvil (botones grandes, encuadre también en pantalla vertical) y geometría aligerada en los teléfonos.
- Detecta lo que permite cada dispositivo (WebXR o Quick Look) y lo explica.
- ✅ Criterio: el ejemplo mide 0,641 × 0,341 × 0,641 m, pesa unos 3,7 kg y se ve igual que en PipeCAD.

### Fase 17 — Sesión de realidad aumentada y suelo
- Sesión WebXR `immersive-ar` con las funciones opcionales:
  - `local-floor`, para la altura del suelo;
  - `hit-test`, `dom-overlay` y `hand-tracking`;
  - `plane-detection` y `mesh-detection`.

  Si no hay `local-floor`, se usa `local` y el suelo lo da la prueba de impacto.
- Retícula de colocación, con la estructura en transparente y su huella en el suelo, girada hacia el usuario. El suelo se busca así, por orden:
  - **prueba de impacto**, aceptando solo superficies horizontales;
  - **plano de suelo** detectado por la Quest 3;
  - **mirada contra el suelo**, si no hay ninguno de los dos.
- Colocación con un pellizco en las gafas o un toque (o «Colocar aquí») en el teléfono.
- En Android, interfaz superpuesta con «Colocar aquí», «Recolocar», «Opciones» y «Salir».
- ✅ Criterio: con una cámara simulada a 1,6 m mirando 35° hacia abajo, la estructura queda a 2,29 m delante; se descartan las superficies inclinadas y queda mirando al usuario.

### Fase 18 — Física
- Rapier con gravedad de 9,81 m/s², suelo fijo en el escenario y cuerpo compuesto con la masa real.
- Paso fijo de 1/90 s y reposo automático cuando la estructura se queda quieta.
- Vista 3D: «Soltar» (la levanta 50 cm) y «Reiniciar». En RA está quieta mientras se coloca y tiene gravedad al dejarla.
- ✅ Criterio:
  - caída libre correcta: 0,44 m y 2,92 m/s a los 0,3 s;
  - desde 1 m se asienta derecha y en reposo;
  - inclinada 80°, vuelca y queda tumbada.

### Fase 19 — Agarre con las manos y los mandos (Quest)
- **Manos**: pellizco del pulgar y el índice, con histéresis. **Mandos**: gatillo o botón de agarre, con vibración.
- De cerca (a menos de 4 cm de la superficie) o con un **rayo** a distancia (hasta 4 m). La estructura se resalta al acercarse, apuntarla o cogerla.
- Sigue a la mano con un muelle amortiguado (más lento cuanto más pesa) y no atraviesa el suelo. Al soltarla conserva la velocidad, así que cae o sale lanzada.
- **Dos manos**: se mueve con el punto medio y gira con la línea entre ellas, sin escalar. Al soltar una, la otra se reengancha sin saltos.
- ✅ Criterio con poses simuladas:
  - subir 0,5 m y girar 90°;
  - soltar y que se asiente;
  - lanzar a 2,6 m/s y que aterrice a 1,9 m;
  - girar 90° con dos manos.

### Fase 20 — Manejo táctil y con ratón
- Se coge por el **punto tocado**: un muelle (impulsos en ese punto más el peso) lo sube 20 cm y lo lleva bajo el dedo, a 2,5 m/s como mucho. La estructura cuelga y se balancea, y al soltar cae.
- **Dos dedos**: giro en planta hacia un rumbo objetivo, sin inercia al parar.
- Funciona en la vista 3D con ratón o dedo (tocando fuera de la estructura se orbita) y en la RA de Android con los toques de pantalla de WebXR.
- ✅ Criterio:
  - sube 20 cm en 0,5 s;
  - arrastre de 0,5 m y giro de 90°;
  - con el ratón real, arrastrar la estructura no mueve la cámara.

### Fase 21 — iPhone y iPad: AR Quick Look
- `.usdz` generado en el navegador con `USDZExporter`:
  - vértices fusionados, en metros, con Y vertical y la base en y = 0;
  - anclado a un plano horizontal.

  Se prepara al abrir el proyecto, porque iOS solo abre Quick Look como respuesta inmediata a un toque.
- Hoja que explica que en iOS no hay gravedad, con la imagen de la vista como enlace `rel="ar"` y `#allowsContentScaling=0`.
- ✅ Criterio: el ejemplo se genera en 0,18 s (3,2 MB), mide 0,641 × 0,341 × 0,641 m y el archivo tiene la estructura que pide Quick Look.

### Fase 22 — Menús y opciones
- Opciones:
  - **Gravedad** (sin ella, flota y se frena sola);
  - **Fijar al suelo** (ni cae ni se coge);
  - **Cotas** (etiquetas con la longitud real, visibles también en RA);
  - **Rejilla**;
  - **Colores por Ø** (o gris PVC);
  - **Muebles y paredes** (solo en RA);
  - **Reiniciar**.
- Dónde está el menú:
  - vista 3D: botón «Opciones»;
  - Android: «Opciones» en la interfaz superpuesta;
  - **Quest**: menú en la muñeca izquierda, que aparece al mirar la palma (o con el botón X del mando). Se pulsa tocándolo con el índice de la otra mano o apuntando y pellizcando; incluye «Recolocar» y «Salir».
- ✅ Criterio: cada opción hace su efecto y los menús se mantienen sincronizados. Cada zona del menú de la muñeca corresponde a su opción, y la palma se detecta en las dos manos.

### Fase 23 — «Ver en RA»: enlace, código QR y HTTPS
- Botón **Ver en RA** en PipeCAD con el enlace, un **código QR** (qrcode-generator 1.4.4), «Copiar» y «Abrir aquí».
  - El proyecto va comprimido en el enlace.
  - Con servidor local, se guarda en `proyectos/<id>.json` y el QR queda sencillo.
  - Si el ordenador tiene varias redes, se elige la dirección; primero va la wifi o el cable reales, delante de los adaptadores virtuales.
- `servidor.mjs`:
  - `--https`, con certificados de mkcert, para las gafas y los móviles de la red;
  - `POST /api/proyectos`;
  - `/api/estado` con las direcciones de la red;
  - escritura solo desde el propio ordenador (salvo `--red`).
- README con tres opciones: GitHub Pages, servidor HTTPS con mkcert (cómo instalar el certificado en Android, iPhone y Quest) y `adb reverse` por cable USB.
- ✅ Criterio: con un certificado de prueba, el servidor responde por HTTPS, rechaza escrituras desde la red y el visor abre el proyecto por su identificador.

### Fase 24 — Muebles y paredes reales como obstáculo (Quest 3)
- Con `mesh-detection`, las mallas de los objetos de la sala (o, si no hay, la de toda la sala) pasan a ser colisionadores fijos. Sin mallas, los planos detectados se convierten en placas de 2 cm.
- Se excluye el suelo, que ya pone el escenario. Se relee cada 0,5 s y solo se rehace si cambia la sala o se recoloca la estructura.
- ✅ Criterio:
  - sobre una mesa simulada con el tablero a 0,70 m, queda apoyada a 0,70 m;
  - lanzada contra una pared, se detiene;
  - se filtran el suelo y la malla global.

### Fase 25 — Interfaz, ayuda, ejemplo y pruebas
- **Menú lateral** de comandos con iconos SVG, contraíble (iconos con tooltip) o expandido, con estados activo/desactivado según la selección.
- Ayuda rápida (botón «?» / F1, que se abre sola la primera vez), atajos de teclado y mensajes de error claros. Botón «Ver en RA» en el menú lateral.
- **Proyecto de ejemplo** en `ejemplos/ejemplo.json`: estructura de Ø32 sobre una base de 600 × 600, con pórticos, tramos a 45° y refuerzos (31 tubos, 7 codos y 16 Tes, agrupados).
- **Pruebas integradas** (Configuración › Pruebas del motor, o `?test`). Sin servidor, las pruebas que dependen del ejemplo se omiten.
- Rendimiento con cientos de tramos.
- ✅ Criterio: con 624 tramos el arrastre baja de 36 a 4 ms por fotograma y la vista se mantiene a 60 fps.

---

## 5. Estado

| Fase | Estado |
|---|---|
| 0 Andamiaje, núcleo común y repositorio | ✅ |
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
| 13 Carpeta de modelos y STL imprimibles | ✅ 21 piezas de plantilla (una sola pieza, cerradas y con paso abierto) y 18 de serie (una sola pieza) |
| 14 Editor de accesorios | ✅ |
| 15 Servidor local e instalación | ✅ |
| 16 Visor RA: tamaño real | ✅ |
| 17 Sesión de RA y suelo | ✅ Probada con cámara y fotogramas simulados |
| 18 Física | ✅ |
| 19 Agarre con manos y mandos | ✅ Probado con poses simuladas |
| 20 Manejo táctil y con ratón | ✅ |
| 21 iPhone y iPad (Quick Look) | ✅ Probado simulando iOS |
| 22 Menús y opciones | ✅ |
| 23 «Ver en RA», QR y HTTPS | ✅ Probado con un certificado de prueba |
| 24 Muebles y paredes reales | ✅ Probado con una sala simulada |
| 25 Interfaz, ayuda, ejemplo y pruebas | ✅ **79/79 pruebas del motor** |

### Pendiente y limitaciones conocidas
- **Pruebas en dispositivos reales** del visor RA:
  - Meta Quest 3: colocación, agarre, menú de la muñeca, y muebles y paredes;
  - Android con ARCore: colocación y manejo táctil;
  - iPhone / iPad: Quick Look;
  - código QR de «Ver en RA».

  En el ordenador se ha comprobado con cámaras, poses, toques y salas simulados. Cargar el emulador de WebXR de Meta (IWER) no fue posible.
- En iOS no hay WebXR: en iPhone y iPad no hay gravedad ni se puede coger la estructura.
- El navegador de las Quest no permite instalar certificados: con el servidor local por HTTPS puede hacer falta aceptar el aviso de seguridad, o usar GitHub Pages o el cable USB.
- La física trata la estructura como rígida: no se dobla ni se rompe.
- El guardado en una carpeta elegida (Chrome / Edge, sin servidor) no se ha probado en un navegador real.
- Los STL de serie usan las cotas por defecto. Si un proyecto las cambia en Configuración, PipeCAD avisa al descargarlos.
- En GitHub Pages la carpeta `modelos/` es de solo lectura: un accesorio nuevo se añade con el servidor local y un commit.
- La primera vez que se usa OpenSCAD en el editor se descargan unos 11 MB, que luego quedan en la caché del navegador.

---

## 6. Orden de entrega

| Bloque | Fases | Resultado |
|---|---|---|
| Base de cálculo | 0–4 | Núcleo, visor con modelo y accesorios correctos |
| Edición interactiva | 5–8 | Dibujo, accesorios, grupos y arrastre |
| Producción | 9–11 | Despiece, exportación y configuración |
| Accesorios ampliables | 12–15 | Biblioteca, modelos 3D, editor OpenSCAD y servidor local |
| Realidad aumentada | 16–24 | Visor a tamaño real con física en Quest 3, Android e iPhone, compartido con un QR |
| Cierre | 25 | Interfaz, ayuda, ejemplo, pruebas y rendimiento |

Tras cada bloque se revisa en el navegador (y, en el de realidad aumentada, en los dispositivos) antes de seguir. Cada cambio se registra con un commit en GitHub.
