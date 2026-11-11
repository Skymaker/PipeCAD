// PipeCAD · Codo 30° (codo30)
// Código generado por el editor de accesorios de PipeCAD. Medidas en milímetros.
// Origen: punto donde se cortan los ejes de todas las bocas. Cada boca apunta hacia fuera.
// Pieza imprimible: cuerpo + embocaduras taladradas (Ø tubo + holgura) + paso interior.

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

V = VARIANTES[search([variante], VARIANTES, 1, 0)[0]];
assert(V != undef, str("No existe la variante ", variante));
R = V[1] / 2;            // radio exterior
M = V[2];                // medidas de cada boca
N = len(BOCAS);
function unidad(v) = v / norm(v);
DIR = [for (b = BOCAS) unidad(b[1])];
// Hay bocas no alineadas (codos, Tes, cruces): núcleo esférico y cámara central
RAMIFICADO = N > 1 && max([for (i = [0:N-1]) for (j = [0:N-1]) 1 - abs(DIR[i] * DIR[j])]) > 1e-6;
PASO_MAX = max([for (m = M) m[3]]);   // Ø del paso más ancho

// Lleva el eje Z local a la dirección v
module orientar(v) rotate([0, acos(v.z), atan2(v.y, v.x)]) children();
// Cilindro a lo largo del eje Z local, entre dos distancias al origen
module tramo(r, desde, hasta) translate([0, 0, desde]) cylinder(r = r, h = hasta - desde);

difference() {
  union() {
    for (i = [0:N-1]) orientar(DIR[i]) {
      tramo(R * 0.94, RAMIFICADO ? 0 : -0.5, M[i][1] + 0.6);   // cuerpo de la boca
      tramo(R, M[i][1], M[i][1] + M[i][2]);                    // embocadura
    }
    if (RAMIFICADO) sphere(r = R * 0.97);                       // núcleo
  }
  for (i = [0:N-1]) orientar(DIR[i]) {
    tramo(M[i][0] / 2 + holgura, M[i][1], M[i][1] + M[i][2] + 1);   // taladro de la embocadura
    if (N > 1) tramo(M[i][3] / 2, RAMIFICADO ? 0 : -0.5, M[i][1] + 0.5); // paso interior
  }
  if (RAMIFICADO) sphere(r = PASO_MAX / 2 * 1.15);               // cámara central (radio algo mayor que el del paso más ancho)
}
