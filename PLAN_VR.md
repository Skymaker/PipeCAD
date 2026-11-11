# PipeCAD VR — Plan del port a WebXR para gafas (Meta Quest 3)

Port de PipeCAD a realidad virtual y mixta con WebXR para **diseñar dentro de las gafas**. No se trata de verlo, como en el visor RA (`ra.html`), sino de dibujar tubos, colocar accesorios, estirar, agrupar, consultar el despiece y guardar, todo con las manos o los mandos. El proyecto se puede ver como **maqueta sobre la mesa** o a **tamaño real** en la habitación.

Objetivo principal: Meta Quest 3 (navegador de Quest). También deben funcionar las demás gafas WebXR con mandos o manos (Quest 2/Pro, Pico, Vision Pro con Safari).

---

## 1. Punto de partida

Lo que ya existe y se reutiliza:

| Pieza | Dónde | Uso en VR |
|---|---|---|
| Modelo, motor de accesorios, despiece, `.pcf`, STL, carpeta de modelos, enlaces | `js/nucleo.js` | Tal cual: el cálculo es el mismo en el ordenador y en las gafas |
| Deshacer y rehacer con instantáneas, `transact`, edición en vivo | `Model` del núcleo | Tal cual |
| Operaciones puras: insertar y girar accesorios, estirar tramos, unir, conectar, duplicar, espejo, grupos | núcleo | Tal cual, llamadas desde las herramientas VR |
| Sesión WebXR, suelo, retícula, entradas de manos y mandos, pellizco con histéresis, rayo, menú en la muñeca, física Rapier, muebles y paredes reales | `ra.html` | Se extraen a módulos compartidos (fase VR0) |
| Servidor local con HTTPS, proyectos compartidos y escritura solo local | `servidor.mjs` | Se amplía para abrir y guardar proyectos desde las gafas |

Lo que no sirve tal cual:
- **La interfaz HTML** (paneles, diálogos, campos de texto, tooltips) no se ve dentro de una sesión inmersiva. Hay que rehacerla en 3D.
- **Los rótulos con `CSS2DRenderer`**, que en VR pasan a ser texto 3D.
- **La precisión del ratón**: la mano tiembla unos milímetros, así que el dibujo exacto debe apoyarse en el snap, las direcciones permitidas y el teclado numérico.
- **Los diálogos de archivos**, que no existen dentro de la sesión: abrir y guardar se hace con el servidor, el navegador o un enlace.

---

## 2. Decisiones de diseño

| Tema | Decisión |
|---|---|
| Página | `vr.html`, nueva, con el núcleo y los módulos XR compartidos. PipeCAD (`index.html`) añade un botón «Abrir en VR» que lleva el proyecto actual. |
| Modos de sesión | `immersive-ar` (**realidad mixta**, con la habitación real de fondo) por defecto en las Quest 3; `immersive-vr` (fondo virtual) como opción y en las gafas sin passthrough. El mismo código para los dos. |
| Escala | Tres modos: **Maqueta** (1:10 por defecto, sobre una mesa o en el aire), **Tamaño real** (1:1, apoyada en el suelo) y **libre** (con las dos manos, de 1:50 a 1:1, con paradas en 1:20, 1:10, 1:5, 1:2 y 1:1). Las medidas siempre se muestran en mm reales. |
| Precisión | Todo punto que se crea o se mueve pasa por el **snap**: rejilla de 10 mm (1/5/10/50/100), direcciones permitidas, puntos de referencia del núcleo y otros tubos. Para la medida exacta, **teclado numérico** flotante. Se dibuja en la escala de maqueta: 1 cm de mano son 10 cm reales. |
| Interfaz 3D | Paneles propios dibujados en `CanvasTexture`, como el menú de la muñeca de `ra.html`: sin dependencias y con control total del tamaño de las zonas de toque. Texto nítido con **troika-three-text** (CDN, versión fijada) para los rótulos y las cotas. |
| Entrada | **Manos** (pellizco para seleccionar, tocar paneles con el índice, rayo desde la mano) y **mandos** (gatillo, agarre, joystick, botones A/B/X/Y). Mano dominante configurable (zurdos). |
| Menús | **Paleta en la mano no dominante**: herramientas, Ø, accesorio, snap y deshacer. **Panel de propiedades** flotante, que se puede anclar. **Despiece** en un panel grande que se puede colocar en la habitación. |
| Locomoción | Para tamaño real: **teletransporte** (rayo en arco) y **giro por pasos** (30°), con viñeta de comodidad opcional. En maqueta no hace falta: se mueve la maqueta. |
| Física | Opcional, la del visor RA: «Probar con gravedad» suelta una copia de la estructura sobre el suelo o la mesa reales. La edición nunca tiene física. |
| Archivos | Autoguardado en el navegador de las gafas. **Abrir y guardar** con el servidor local (`proyectos/`), con el enlace de PipeCAD (`#p=`) o con la lista de proyectos del navegador. Exportar CSV y PDF desde el ordenador. |
| Sincronización (opcional) | El ordenador y las gafas editan el mismo proyecto en vivo a través del servidor local (eventos del servidor), con «el último cambio gana» y deshacer local. |
| Rendimiento | 72 Hz como mínimo (90 Hz deseable) en las Quest 3: mallas unidas por Ø, `InstancedMesh` para tubos y accesorios de serie, foveated rendering, sombras simples y redibujado incremental con las firmas que ya usa PipeCAD. |
| Pruebas | Lógica de herramientas sin gráficos (poses y gestos simulados, como en `ra.html`). Emulador **IWER** de Meta en una página de desarrollo (`vr.html?emulador`), cuya carga debe autorizar el usuario. Pruebas finales en las Quest 3. |

---

## 3. Arquitectura

```
vr.html                 Página VR: escena, herramientas, paneles y sesión
js/nucleo.js            (existente) cálculo, modelo, deshacer, accesorios, despiece
js/xr/sesion.js         Sesión WebXR (ar/vr), espacios de referencia, suelo, planos y mallas de la sala
js/xr/entradas.js       Manos y mandos: poses, pellizco, gatillo, joystick, rayos y vibración (de ra.html)
js/xr/fisica.js         Rapier: cuerpo compuesto, suelo, entorno real y muelles de agarre (de ra.html)
js/xr/paneles.js        Kit de paneles en CanvasTexture: botones, interruptores, listas, teclado numérico, deslizadores
js/xr/texto.js          Texto 3D (troika) para cotas, rótulos y paneles
js/xr/escena.js         Construcción de la estructura en 3D compartida con ra.html (mallas, cotas, colores)
```

- `ra.html` pasa a usar `js/xr/*`, sin cambiar su comportamiento.
- Son scripts clásicos con fábricas, como el núcleo, para que funcionen también abiertos como archivo. Three.js se recibe como parámetro.
- **Sistema de coordenadas**: el proyecto sigue en mm con Z vertical. En la escena VR, el grupo «mundo del proyecto» aplica la escala (maqueta o real), el giro de Z a Y y la posición. Las herramientas trabajan siempre en coordenadas del proyecto: mano → mundo del proyecto → snap → núcleo.

---

## 4. Diseño de la interacción

| Acción | Manos | Mandos |
|---|---|---|
| Seleccionar | Pellizco apuntando con el rayo, o tocar la pieza con el índice (maqueta) | Gatillo con el rayo |
| Mover o girar la maqueta | Agarrar con las dos manos en el vacío: mover, girar y escalar | Botones de agarre de los dos mandos |
| Dibujar un tubo | Pellizcar y arrastrar desde un punto o extremo; soltar fija el punto; pellizco corto en el sitio termina | Gatillo; joystick arriba/abajo para la longitud por pasos |
| Longitud exacta | Mientras se dibuja, tocar la cota que flota sobre el tramo: aparece el teclado numérico | Botón A o X |
| Estirar un tramo | Pellizcar un punto de arrastre y deslizar a lo largo del eje | Gatillo sobre el punto |
| Girar un accesorio | Agarrarlo y girar la muñeca: gira por pasos (45° o el paso configurado) alrededor de sus ejes | Agarre y girar el mando |
| Deshacer / rehacer | Botones de la paleta | B / Y |
| Paleta | Mirar la palma de la mano no dominante | Botón del menú |
| Teletransporte (tamaño real) | Gesto de apuntar con la palma hacia abajo y pellizcar | Joystick adelante |

Retroalimentación:
- vista previa transparente del tramo o accesorio;
- color verde cuando engancha a un punto de referencia;
- cota viva sobre el tramo;
- clic de vibración en cada paso de snap;
- rojo para uniones no válidas, con su mensaje en el panel.

---

## 5. Fases

Cada fase termina con algo que se puede probar en las gafas (o en el emulador) y con sus pruebas de lógica.

### VR0 — Módulos XR compartidos
- Extraer de `ra.html` la sesión, las entradas, la física, el menú de la muñeca y la construcción de la estructura a `js/xr/*`, como se hizo con `js/nucleo.js`.
- `ra.html` los usa sin cambiar de comportamiento.
- ✅ Criterio: el visor RA funciona igual y sus pruebas con poses simuladas dan los mismos resultados.

### VR1 — Página `vr.html` y sesión
- Escena con el proyecto (desde el enlace `#p=`, el servidor `?proyecto=`, el último proyecto o el ejemplo), luces, suelo y sombras.
- «Entrar» en `immersive-ar` (passthrough) o `immersive-vr` (fondo neutro con suelo y horizonte).
- **Modos de escala**: Maqueta (aparece a la altura de la cintura, a 50 cm), Tamaño real (sobre el suelo, con la colocación de `ra.html`) y escala libre con dos manos, con paradas.
- Locomoción en tamaño real: teletransporte y giro por pasos, con viñeta opcional.
- ✅ Criterio: el ejemplo se ve como maqueta 1:10 y a tamaño real, se escala con las dos manos (las medidas siguen en mm reales) y se recorre a tamaño real sin mareo.

### VR2 — Kit de paneles 3D
- `js/xr/paneles.js`: botón, interruptor, grupo de opciones, lista con desplazamiento, deslizador, **teclado numérico** con coma decimal, y panel con título que se puede arrastrar y anclar.
- Toque con el índice (zona de 18 mm como mínimo y confirmación al atravesar el plano) y rayo con pellizco o gatillo.
- Texto nítido con troika. Tema claro u oscuro según el fondo.
- ✅ Criterio: escribir «1250,5» con el teclado numérico con las manos en menos de 5 s, sin pulsaciones dobles ni perdidas.

### VR3 — Paleta, selección y propiedades
- **Paleta** en la mano no dominante: herramientas (Seleccionar, Tubo, Accesorio), Ø activo, accesorio activo (incluidos los personalizados de la biblioteca), snap, puntos de referencia, Deshacer, Rehacer y Borrar.
- **Selección** con rayo o con toque, con resaltado. Selección múltiple con un segundo pellizco manteniendo el primero.
- **Panel de propiedades** del núcleo: tramo (Ø, medida a ejes y longitud real editables con el teclado) y accesorio (tipo, bocas, Z y giro exacto).
- ✅ Criterio: seleccionar un tramo del ejemplo y cambiarle la medida a ejes a 450 mm da la misma longitud real que PipeCAD en el ordenador.

### VR4 — Dibujo de tubos en 3D
- Polilínea con la mano o el mando:
  - el punto inicial engancha a extremos, tubos (crea Te), puntos de referencia o la rejilla del plano de trabajo;
  - la dirección se ajusta a las permitidas (18 limpias o las del tubo de partida);
  - la longitud se ajusta al snap.
- Codos automáticos al cambiar de dirección, Te al terminar sobre un tubo y unión automática perpendicular, todo con las funciones del núcleo.
- **Plano de trabajo** visible y cambiable desde la paleta (XY, XZ, YZ y su altura). En maqueta, una «regla» vertical para dibujar en altura.
- Cota viva sobre el tramo y longitud exacta con el teclado numérico.
- ✅ Criterio: dibujar en las gafas un marco cuadrado de 600 mm con 4 codos y una Te, y que en PipeCAD dé las mismas longitudes de corte y el mismo despiece que dibujado con el ratón.

### VR5 — Accesorios, estirado y uniones
- Colocar accesorios sueltos, en el extremo de un tubo o insertados en un tubo, con vista previa que engancha.
- **Girar con la muñeca**: el accesorio sigue al giro de la mano por pasos alrededor de sus propios ejes, con indicación del eje y del ángulo.
- **Puntos de arrastre** en extremos y accesorios: estirar a lo largo del eje con snap; lo conectado detrás se desplaza en bloque, como en PipeCAD.
- Unir tubos alineados, Conectar extremos sueltos y Borrar.
- ✅ Criterio: los mismos casos de las pruebas del motor de PipeCAD (insertar, girar, estirar, unir y conectar) hechos con gestos simulados dan los mismos resultados.

### VR6 — Grupos y operaciones de conjunto
- Agrupar y desagrupar, seleccionar el grupo al tocar un miembro, y caja de grupo para mover por eje, mover en el plano y girar, todo agarrando con la mano.
- Duplicar (la copia aparece en la mano y se suelta donde se quiera), espejo horizontal y vertical, y borrado múltiple.
- ✅ Criterio: duplicar un pórtico del ejemplo y colocarlo a 600 mm, sin romper uniones internas.

### VR7 — Cotas, errores y despiece
- Cotas en 3D (real, a ejes, ambas o marcas de pieza), de tamaño legible a cualquier escala y orientadas al usuario, con interruptor.
- Uniones no válidas y avisos (tubo visto mínimo, longitud mayor que la barra, extremo suelto pegado) en rojo o ámbar, con la lista en un panel; al tocar un aviso se resalta la pieza.
- **Panel de despiece**: barras por Ø con su esquema de cortes, aprovechamiento, accesorios por tipo y marcas de pieza. Se coloca en la habitación como una pizarra.
- ✅ Criterio: el despiece del ejemplo en las gafas coincide con el de PipeCAD (barras, cortes y marcas).

### VR8 — Abrir, guardar y compartir
- Autoguardado en el navegador de las gafas y lista de proyectos recientes.
- Con el servidor local, panel «Proyectos» para abrir y guardar en `proyectos/`. Nuevas rutas `GET /api/proyectos` (lista con nombre, fecha y tamaño) y `PUT /api/proyectos/<id>`. Escritura desde las gafas solo si el usuario lo autoriza al arrancar el servidor (`--gafas`, con una clave corta que se escribe una vez en las gafas).
- En PipeCAD, «Abrir en VR» (enlace y QR, como «Ver en RA»). En las gafas, «Enviar al ordenador»: guarda en el servidor y PipeCAD lo ofrece al momento.
- ✅ Criterio: empezar en el ordenador, seguir en las gafas, guardar y abrir el resultado en PipeCAD sin perder nada (mismo JSON).

### VR9 — Comodidad y accesibilidad
- Modo sentado (sube la maqueta y el suelo virtual), mano dominante, tamaño de los paneles y del texto, y alto contraste.
- Recordatorios: pausa automática al salir del límite de seguridad y aviso si el proyecto no cabe en la sala a tamaño real.
- Ayuda en VR: tarjetas con los gestos y vídeo corto de las acciones básicas, en una «pizarra» que se puede ocultar.
- ✅ Criterio: una persona que no conoce el programa dibuja un codo y un tramo de 1 m con la ayuda, sin explicaciones.

### VR10 — Rendimiento y pruebas
- `InstancedMesh` para tubos (cilindro unitario escalado) y accesorios de serie, mallas unidas para STL, foveated rendering (`renderer.xr.setFoveation`), sombras de contacto baratas y limitar los rótulos visibles por distancia.
- Medición en las Quest 3 con el contador de fotogramas del navegador.
- Batería de pruebas de lógica con gestos simulados (dibujo, estirado, giro, teclado numérico) y página de desarrollo con el emulador IWER.
- ✅ Criterio: 72 Hz estables con 600 tramos en maqueta y a tamaño real; las pruebas del motor (79) y las de VR, en verde.

### VR11 — Opcional: edición compartida en vivo
- El servidor local reenvía los cambios del proyecto (eventos del servidor, `GET /api/vivo/<id>`) entre PipeCAD en el ordenador y las gafas. Se aplican como transacciones del núcleo, con «el último cambio gana» y deshacer local.
- Avatar simple (cabeza y manos) del otro participante si hay dos gafas.
- ✅ Criterio: dibujar un tramo en el ordenador y verlo aparecer en las gafas en menos de 0,5 s, y al revés.

---

## 6. Riesgos y cómo se resuelven

| Riesgo | Medida |
|---|---|
| La mano no es precisa al milímetro | Snap obligatorio, direcciones permitidas, dibujo en maqueta (la mano mueve 1/10) y teclado numérico para la medida exacta |
| Texto ilegible en VR | troika (texto con campo de distancia), tamaño mínimo de unos 1,2° del campo visual, paneles a 0,5–0,7 m y orientados al usuario |
| Fatiga del brazo («gorilla arm») | Paneles bajos y anclables, maqueta a la altura de la cintura, modo sentado, gestos cortos |
| Mareo a tamaño real | Teletransporte y giro por pasos (sin desplazamiento continuo por defecto), viñeta y horizonte estable |
| Sin teclado ni archivos dentro de la sesión | Teclado numérico propio, nombres automáticos de proyecto (editables en el ordenador) y servidor local para abrir y guardar |
| Escritura desde la red | Escritura desde las gafas solo con `--gafas` y una clave; por defecto el servidor sigue aceptando escrituras solo desde el propio ordenador |
| Rendimiento con proyectos grandes | Instancias, mallas unidas, redibujado incremental y rótulos limitados por distancia |
| No poder probar sin gafas | Lógica separada de los gráficos y probada con gestos simulados, emulador IWER en una página de desarrollo y pruebas finales en las Quest 3 |
| Diferencias entre navegadores WebXR | Funciones opcionales con alternativas (sin manos → mandos, sin passthrough → fondo VR, sin planos → suelo de la sala) |

---

## 7. Orden de entrega

| Bloque | Fases | Resultado |
|---|---|---|
| Base | VR0–VR2 | Módulos XR compartidos, sesión con maqueta y tamaño real, kit de paneles con teclado numérico |
| Edición | VR3–VR6 | Seleccionar, dibujar, colocar y girar accesorios, estirar, unir y agrupar en las gafas |
| Producción | VR7–VR8 | Cotas, errores, despiece y proyectos entre el ordenador y las gafas |
| Pulido | VR9–VR10 | Comodidad, ayuda, rendimiento y pruebas |
| Opcional | VR11 | Edición compartida en vivo |

Tras cada bloque se prueba en las Meta Quest 3. Cada cambio se registra con un commit en GitHub, y el estado de cada fase se lleva en este archivo, como en [PLAN.md](PLAN.md).

## 8. Estado

| Fase | Estado |
|---|---|
| VR0–VR11 | ⏳ Pendiente |
