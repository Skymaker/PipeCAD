// PipeCAD · Codo 30° (codo30)
// Código generado por el editor de accesorios de PipeCAD. Medidas en milímetros.
// Origen: punto donde se cortan los ejes de todas las bocas. Cada boca apunta hacia fuera.
// Pieza imprimible: cuerpo + embocaduras taladradas (Ø tubo + holgura) + paso interior.
// Necesita ../pipecad.scad; «Descargar .scad» del editor la incluye dentro para abrirlo suelto.

/* [Fabricación] */
// Variante a generar
variante = "20"; // [20, 32, 40]
// Holgura radial de las embocaduras (mm)
holgura = 0.25; // [0:0.05:0.6]
// Resolución de los círculos (número de lados)
$fn = 64; // [24:8:192]

/* [Hidden] */
// Bocas: [nombre, dirección hacia fuera]
BOCAS = [
  ["A", [1, 0, 0]],
  ["B", [-0.866025, 0.5, 0]]
];
// Variantes: [nombre, Ø exterior, por boca: [Ø tubo, Z (origen → tope), embocadura, Ø paso]]
VARIANTES = [
  ["20", 27, [[20, 4, 16, 16], [20, 4, 16, 16]]],
  ["32", 41, [[32, 6, 22, 27], [32, 6, 22, 27]]],
  ["40", 50, [[40, 7, 26, 34], [40, 7, 26, 34]]]
];

// Geometría: librería común de PipeCAD (modelos/pipecad.scad)
use <../pipecad.scad>

accesorio_pipecad(BOCAS, VARIANTES, variante, holgura);
