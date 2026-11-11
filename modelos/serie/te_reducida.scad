// PipeCAD · Te reducida (teeReduced)
// Código generado por el editor de accesorios de PipeCAD. Medidas en milímetros.
// Origen: punto donde se cortan los ejes de todas las bocas. Cada boca apunta hacia fuera.
// Pieza imprimible: cuerpo + embocaduras taladradas (Ø tubo + holgura) + paso interior.
// Necesita ../pipecad.scad; «Descargar .scad» del editor la incluye dentro para abrirlo suelto.

/* [Fabricación] */
// Variante a generar
variante = "32-20"; // [32-20, 40-20, 40-32]
// Holgura radial de las embocaduras (mm)
holgura = 0.25; // [0:0.05:0.6]
// Resolución de los círculos (número de lados)
$fn = 64; // [24:8:192]

/* [Hidden] */
// Bocas: [nombre, dirección hacia fuera]
BOCAS = [
  ["A", [1, 0, 0]],
  ["B", [-1, 0, 0]],
  ["C", [0, 1, 0]]
];
// Variantes: [nombre, Ø exterior, por boca: [Ø tubo, Z (origen → tope), embocadura, Ø paso]]
VARIANTES = [
  ["32-20", 41, [[32, 17, 22, 27], [32, 17, 22, 27], [20, 19, 16, 16]]],
  ["40-20", 50, [[40, 21, 26, 34], [40, 21, 26, 34], [20, 23, 16, 16]]],
  ["40-32", 50, [[40, 21, 26, 34], [40, 21, 26, 34], [32, 22, 22, 27]]]
];

// Geometría: librería común de PipeCAD (modelos/pipecad.scad)
use <../pipecad.scad>

accesorio_pipecad(BOCAS, VARIANTES, variante, holgura);
