// PipeCAD · librería OpenSCAD de accesorios
// La usan todos los .scad de modelos/serie y modelos/personalizados con:  use <../pipecad.scad>
// Medidas en milímetros. Origen: punto donde se cortan los ejes de todas las bocas.
// Pieza imprimible: cuerpo + embocaduras taladradas (Ø tubo + holgura) + paso interior que une las bocas.
//
// accesorio_pipecad(bocas, variantes, variante, holgura)
//   bocas      [[nombre, [x, y, z]], …]          dirección de cada boca, hacia fuera (no hace falta que sea unitaria)
//   variantes  [[nombre, Ø exterior, [[Ø tubo, Z, embocadura, Ø paso], … una por boca]], …]
//              Z: del origen al tope (fondo) de la embocadura · embocadura: lo que entra el tubo
//   variante   nombre de la variante a generar, p. ej. "32"
//   holgura    holgura radial de las embocaduras (mm)
// La resolución la marca $fn, que se hereda de quien llama.

function pipecad_unidad(v) = v / norm(v);

// Lleva el eje Z local a la dirección v
module pipecad_orientar(v) rotate([0, acos(v.z), atan2(v.y, v.x)]) children();

// Cilindro a lo largo del eje Z local, entre dos distancias al origen
module pipecad_tramo(r, desde, hasta) translate([0, 0, desde]) cylinder(r = r, h = hasta - desde);

module accesorio_pipecad(bocas, variantes, variante, holgura = 0.25) {
  V = variantes[search([variante], variantes, 1, 0)[0]];
  assert(V != undef, str("No existe la variante ", variante));
  R = V[1] / 2;            // radio exterior
  M = V[2];                // medidas de cada boca
  N = len(bocas);
  assert(len(M) == N, str("La variante ", variante, " no tiene medidas para todas las bocas"));
  DIR = [for (b = bocas) pipecad_unidad(b[1])];
  // Hay bocas no alineadas (codos, Tes, cruces): núcleo esférico y cámara central
  RAMIFICADO = N > 1 && max([for (i = [0:N-1]) for (j = [0:N-1]) 1 - abs(DIR[i] * DIR[j])]) > 1e-6;
  PASO_MAX = max([for (m = M) m[3]]);   // Ø del paso más ancho

  difference() {
    union() {
      for (i = [0:N-1]) pipecad_orientar(DIR[i]) {
        pipecad_tramo(R * 0.94, RAMIFICADO ? 0 : -0.5, M[i][1] + 0.6);   // cuerpo de la boca
        pipecad_tramo(R, M[i][1], M[i][1] + M[i][2]);                    // embocadura
      }
      if (RAMIFICADO) sphere(r = R * 0.97);                               // núcleo
    }
    for (i = [0:N-1]) pipecad_orientar(DIR[i]) {
      pipecad_tramo(M[i][0] / 2 + holgura, M[i][1], M[i][1] + M[i][2] + 1);       // taladro de la embocadura
      if (N > 1) pipecad_tramo(M[i][3] / 2, RAMIFICADO ? 0 : -0.5, M[i][1] + 0.5); // paso interior
    }
    if (RAMIFICADO) sphere(r = PASO_MAX / 2 * 1.15);   // cámara central (algo mayor que el paso más ancho)
  }
}
