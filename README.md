# PipeCAD
CAD con tuberías de PVC

Programa de CAD 3D en un único archivo HTML para diseñar instalaciones con tubería de PVC de **Ø20, Ø32 y Ø40 mm** y obtener el despiece optimizado en barras de 3 m.

## Uso

Abre `index.html` en un navegador moderno (necesita conexión a internet para cargar Three.js desde el CDN). Pulsa **?** o **F1** para ver la ayuda.

Enlace: https://skymaker.github.io/PipeCAD/

## Funciones

- **Dibujo 3D por polilínea**: los codos de 90° y 45° se insertan solos al cambiar de dirección; empezar o terminar sobre un tubo crea una Te (o Te reducida).
- **Accesorios**: codo 90°, codo 45°, Te, Te reducida, manguito y manguito reductor. Se pueden colocar sueltos, en el extremo de un tubo o insertados en un tubo (lo parten en dos), y girar con un gizmo de anillos; los tubos que dejan de encajar se separan.
- **Unir tubos** alineados en uno solo, quitando el manguito o cerrando el hueco.
- **Rótulos** de cotas o marcas de pieza que se pueden ocultar con un interruptor.
- **Puntos de arrastre** para alargar y acortar tubos; lo conectado detrás se desplaza en bloque.
- **Medidas a eje**: la longitud real de corte se calcula descontando la cota Z de cada accesorio (centro → tope de embocadura). Las cotas son editables.
- **Despiece**: barras de 3000 mm, 2 mm por corte, optimizado para usar el mínimo de barras; división automática de tramos largos con manguitos.
- **Exportación**: proyecto `.json`, despiece `.csv`, impresión / PDF y captura PNG.

## Desarrollo

El plan de fases y el estado del proyecto están en [PLAN.md](PLAN.md). Las pruebas del motor de cálculo se ejecutan desde la pestaña **Pruebas** o abriendo `index.html?test`.

## Licencia

GPL v3 — ver [LICENSE](LICENSE).
