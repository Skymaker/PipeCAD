# PipeCAD — Plan de desarrollo

CAD 3D en un único archivo `index.html` (HTML + CSS + JS) para diseñar instalaciones con tubería de PVC de **Ø20, Ø32 y Ø40 mm**, con despiece optimizado en barras de 3 m.

---

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Motor 3D | Three.js desde CDN (versión fijada, `importmap` + `OrbitControls`). Requiere internet al abrir. |
| Cotas de accesorios | Valores por defecto de catálogo PVC presión encolar, **editables** en una tabla de configuración. |
| Direcciones | Ejes X/Y/Z y diagonales a 45° en los planos principales (18 direcciones: 6 de ejes + 12 diagonales; se excluyen las diagonales espaciales tipo (1,1,1)). |
| Diámetros | Se permiten cambios de diámetro mediante **manguito reductor** y **T reducida**. |
| Forma de dibujo | **Ambos**: polilínea con accesorios automáticos (modo principal) + colocación manual de accesorios y conexión de tubos. |
| Regla de corte | Cada pieza consume `L + 2 mm`, salvo que agote exactamente la barra (consumo = `min(L+2, resto)`). Optimización para mínimo de barras. |
| Exportación | Proyecto JSON (guardar/abrir), despiece CSV, impresión/PDF del despiece, captura PNG. |
| Snap de arrastre | 10 mm por defecto, ajustable (1/5/10/50/100 mm) + introducción numérica exacta. |

### Supuestos adicionales (corregibles)
- Unidades internas: 1 unidad = 1 mm. Eje **Z vertical** (convención CAD).
- Interfaz en español. Colores por diámetro: Ø20 gris claro, Ø32 gris medio, Ø40 gris oscuro (o colores distintivos opcionales).
- Un tramo cuya longitud real supere 3000 mm se avisa y se ofrece **dividir automáticamente con un manguito de unión** (accesorio recto). Se añade el manguito al catálogo por necesidad física.
- La T es de 90° (no se incluye Y/T a 45°).
- Autoguardado en `localStorage` del último proyecto.

---

## 2. Modelo geométrico (núcleo del cálculo)

La instalación es un **grafo**:
- **Nodo**: punto 3D en el eje de la tubería. Su tipo se deduce de las conexiones:
  - 1 tubo → extremo libre
  - 2 tubos colineales, mismo Ø → nodo interno sin accesorio (se fusiona) o manguito si se ha partido
  - 2 tubos colineales, distinto Ø → manguito reductor
  - 2 tubos a 90° → codo 90° · a 45° de giro (135° entre tubos) → codo 45°
  - 3 tubos (2 colineales + 1 perpendicular) → T (o T reducida si la derivación es de otro Ø)
  - Cualquier otra combinación → **nodo inválido** (marcado en rojo).
- **Tramo (segmento)**: une dos nodos, tiene diámetro.

**Longitudes**
- Medida a ejes: `Le = |B − A|`
- Longitud real de corte: `Lr = Le − Z(accesorio A, boca) − Z(accesorio B, boca)`
  - `Z` = distancia del centro del accesorio al tope de la embocadura (donde llega el tubo). Extremo libre: `Z = 0`.
- Validaciones: `Lr > 0` (y mínimo configurable, p. ej. 10 mm de tubo visto entre accesorios); `Lr ≤ 3000` o aviso de manguito.

**Cotas por defecto (mm, editables)** — valores orientativos:

| Ø | Embocadura | Z codo 90° | Z codo 45° | Z T (todas las bocas) | Z manguito |
|---|---|---|---|---|---|
| 20 | 16 | 11 | 5 | 11 | 2 |
| 32 | 22 | 17 | 8 | 17 | 2 |
| 40 | 26 | 21 | 10 | 21 | 2 |

Reductores (32→20, 40→20, 40→32): Z por boca en una tabla aparte, también editable.

---

## 3. Fases de desarrollo

Cada fase termina con algo funcional y verificable en el navegador.

### Fase 0 — Andamiaje
- `index.html` con `importmap` a Three.js (versión fijada) y estructura: barra de herramientas superior, visor 3D central, panel lateral (propiedades / despiece / configuración), barra de estado.
- CSS con variables (tema claro/oscuro), layout responsive básico.
- Organización del JS en módulos lógicos dentro del archivo: `Catalog`, `Model`, `FittingEngine`, `Renderer`, `Tools`, `UI`, `Cutlist`, `IO`.
- ✅ Criterio: la página carga, muestra el visor vacío y los paneles.

### Fase 1 — Escena y navegación
- Rejilla en mm (con subdivisiones según zoom), ejes coloreados, plano de trabajo.
- Cámara perspectiva/ortográfica conmutables; órbita, pan, zoom (OrbitControls).
- Vistas predefinidas: planta, alzado, perfil, isométrica; "encuadrar todo".
- Indicador de coordenadas del cursor en la barra de estado.
- ✅ Criterio: navegación fluida y lectura de coordenadas correcta.

### Fase 2 — Modelo de datos y deshacer
- Clases `Node`, `Segment`, `Project` con IDs estables; independientes del render.
- Patrón comando para **deshacer/rehacer** (Ctrl+Z / Ctrl+Y).
- Serialización a JSON (versión de formato incluida).
- Eventos de cambio del modelo → re-render incremental.
- ✅ Criterio: crear/borrar nodos y tramos por consola, deshacer/rehacer y serializar.

### Fase 3 — Motor de accesorios
- Clasificación automática de cada nodo (tabla de la sección 2) a partir de las direcciones y diámetros de sus tramos.
- Orientación del accesorio (matriz de rotación desde las direcciones de sus bocas).
- Cálculo de `Lr` de cada tramo con las cotas Z del catálogo.
- Detección de errores: ángulos no permitidos, más de 3 conexiones, `Lr ≤ mínimo`, `Lr > 3000`.
- ✅ Criterio: batería de casos de prueba con resultados numéricos conocidos (p. ej. tramo Ø20 de 1000 mm a ejes entre dos codos 90° → 978 mm).

### Fase 4 — Representación 3D
- Tubos: cilindros del diámetro exterior real, recortados a `Lr` (empiezan donde termina la embocadura).
- Accesorios procedurales: codos (cuerpo curvo + 2 embocaduras), T, manguitos, reductores; algo más gruesos que el tubo.
- Colores por diámetro, resaltado de selección y hover, nodos inválidos en rojo.
- Etiquetas de cota opcionales (a ejes y/o real) sobre cada tramo.
- ✅ Criterio: un circuito de ejemplo se ve correctamente ensamblado.

### Fase 5 — Herramientas de dibujo
- **Polilínea**: clic a clic sobre el plano de trabajo o partiendo de un extremo existente; la dirección se ajusta a las 18 permitidas; los codos se insertan solos en cada cambio de dirección. Longitud por teclado durante el trazado. Cambio de cota vertical (tecla/modificador) y cambio de plano de trabajo.
- Selector de diámetro activo (20/32/40).
- **Derivación en T**: iniciar o terminar en mitad de un tramo lo parte e inserta una T (o T reducida si cambia el Ø).
- **Colocación manual** de accesorios (codo 90, codo 45, T, manguito, reductor) con rotación en pasos de 45/90°, y conexión de tubos entre sus bocas.
- Selección (clic, ventana), borrar, mover nodos con snap.
- ✅ Criterio: dibujar en 3D un circuito con codos, T y reducción sin tocar ninguna cota.

### Fase 6 — Puntos de arrastre (alargar / contraer)
- Manejadores visibles en extremos libres y nodos de accesorio del elemento seleccionado.
- Arrastre restringido al eje del tramo: alarga/acorta con el snap configurado; los accesorios y el resto de la red conectada se desplazan rígidamente cuando corresponde.
- Indicador en vivo durante el arrastre: medida a ejes y longitud real.
- Bloqueo al llegar al mínimo físico (accesorios en contacto).
- ✅ Criterio: arrastrar un tramo entre dos codos actualiza geometría y longitudes en tiempo real.

### Fase 7 — Panel de propiedades
- Tramo: Ø, medida a ejes (editable), longitud real (editable → recalcula a ejes), nodos extremos.
- Accesorio: tipo, Ø de cada boca, Z aplicadas, posición.
- Edición numérica exacta con validación y deshacer.
- ✅ Criterio: introducir 1500 mm a ejes produce la longitud real esperada.

### Fase 8 — Despiece y optimización de corte
- Recopilar todas las `Lr` por diámetro (redondeo a mm entero, configurable).
- Tramos > 3000 mm: aviso y división con manguito.
- Algoritmo de empaquetado: First-Fit Decreasing + mejora local (best-fit / intercambio) con la regla de corte `consumo = min(L+2, resto)`.
- Resultados: nº de barras por Ø, esquema gráfico de cada barra (piezas, cortes, sobrante), aprovechamiento %, lista de retales, tabla de accesorios por tipo y Ø, identificación de cada pieza (etiqueta que se ve también en el 3D).
- ✅ Criterio: casos de prueba verificados, p. ej.: 2 × 1499 mm → 1 barra (1501 + 1499 = 3000); 2 × 1500 mm → 2 barras (tras el primer corte quedan 1498 mm).

### Fase 9 — Guardar y exportar
- Guardar/abrir proyecto `.json`; nuevo proyecto; autoguardado en `localStorage`.
- Despiece a `.csv` (separador `;`, compatible con Excel en español).
- Hoja de impresión del despiece (CSS `@media print`) → imprimir o guardar como PDF.
- Captura PNG del visor.
- ✅ Criterio: guardar, recargar y obtener el mismo modelo y despiece.

### Fase 10 — Configuración
- Tabla editable de cotas Z y embocaduras por accesorio y Ø (incluidos reductores), con botón "restaurar valores por defecto"; se guarda dentro del proyecto.
- Longitud de barra (3000) y grosor de corte (2) editables.
- Paso de snap, unidades de visualización, mostrar/ocultar cotas.
- ✅ Criterio: cambiar una Z recalcula longitudes y despiece al instante.

### Fase 11 — Pruebas, ejemplo y pulido
- Proyecto de ejemplo precargable.
- Pruebas integradas (`?test` en la URL) del motor de accesorios y del despiece.
- Atajos de teclado, ayuda rápida, mensajes de error claros.
- Revisión de rendimiento con cientos de tramos.

---

## 4. Estado

| Fase | Estado |
|---|---|
| 0–4 | ✅ Hechas (`index.html`). Deshacer implementado con instantáneas del modelo en vez de comandos (más simple y robusto). 16/16 pruebas del motor superadas. |
| 5–7 | ✅ Hechas. Dibujo por polilínea (codos automáticos, Te al empezar/terminar sobre un tubo, prolongación en línea fusiona tramos, imán a nodos/tubos sobre la línea, longitud por teclado), accesorios sueltos con tramos cortos en sus bocas (giro R/E/W), arrastre de extremos y accesorios a lo largo del eje (lo conectado detrás se desplaza en bloque; en circuitos cerrados se estira por el plano medio), panel editable (Ø, medida a ejes, longitud real, extremo que se mueve). 21/21 pruebas. |
| 8–10 | ✅ Hechas. Despiece por Ø con regla `ΣL + kerf·(n−1) ≤ barra` (Best-Fit Decreasing + vaciado de barras), marcas de pieza (también como cotas en 3D), esquema gráfico de barras con cortes y retal, mínimo teórico, división automática de tramos > barra con manguitos (barras enteras + resto ≥ 300 mm). Exportación CSV (`;`, coma decimal, UTF-8 con BOM), impresión/PDF con imagen de la vista, PNG con cotas. Configuración editable dentro del proyecto (barra, corte, tubo visto mínimo, cotas Z, embocaduras, Ø exterior, reductores, Tes reducidas, nombre). 31/31 pruebas. |
| 11 | ✅ Hecha. Redibujado incremental por firmas (solo se regenera lo que cambia) y formateadores numéricos cacheados: con 624 tramos el arrastre pasa de 36 a 4 ms por fotograma, un cambio completo de 88 a 37 ms, y la vista se mantiene a 60 fps. Ayuda rápida (botón «?» / F1, se abre sola la primera vez). Proyecto de ejemplo y pruebas integradas (pestaña Pruebas o `?test`). |

## 5. Orden y entregas

Fases 0–4 → visor con modelo y accesorios correctos (base de cálculo).
Fases 5–7 → edición interactiva completa.
Fases 8–10 → despiece, exportación y configuración.
Fase 11 → cierre.

Tras cada bloque se revisa contigo en el navegador antes de seguir.
