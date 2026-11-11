// PipeCAD VR · texto 3D para cotas y rótulos
// Con troika-three-text (texto con campo de distancia, nítido a cualquier tamaño) si se ha podido cargar;
// si no (sin conexión), con una textura de canvas por rótulo. Los rótulos miran siempre al usuario y
// mantienen un tamaño angular legible (≈1,2° del campo visual como mínimo) a cualquier escala de la maqueta.
// Script clásico con fábrica. Uso:  const txt = crearTextoXR(THREE, troika | null)
(function (global) {
'use strict';
global.crearTextoXR = function (THREE, troika = null) {
  const conDOM = typeof document !== 'undefined';
  // Un rótulo: .obj (Object3D), .poner(texto, color)
  function etiqueta() {
    const e = { texto: null, color: null };
    if (troika?.Text) {
      const t = new troika.Text();
      t.fontSize = 1; t.anchorX = 'center'; t.anchorY = 'middle'; t.outlineWidth = 0.09; t.outlineColor = 0x10131a; t.outlineOpacity = 0.9; t.fontWeight = 'bold';
      t.material.depthTest = false; t.material.depthWrite = false; t.renderOrder = 25; t.frustumCulled = false;
      e.obj = t;
      e.poner = (texto, color = '#ffffff') => { if (texto !== e.texto || color !== e.color) { e.texto = texto; e.color = color; t.text = texto; t.color = color; t.sync(); } };
      e.liberar = () => t.dispose();
    } else {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.renderOrder = 25; m.frustumCulled = false;
      e.obj = m;
      e.poner = (texto, color = '#ffffff') => {
        if (texto === e.texto && color === e.color) return; e.texto = texto; e.color = color;
        if (!conDOM) return;
        const c = e.canvas ||= document.createElement('canvas'), g = c.getContext('2d'), H = 64;
        g.font = `700 ${H * 0.7}px system-ui, sans-serif`; const w = Math.ceil(g.measureText(texto).width + H * 0.6);
        c.width = w; c.height = H;
        g.fillStyle = 'rgba(16,19,26,.82)'; g.beginPath(); g.roundRect(0, 0, w, H, H * 0.28); g.fill();
        g.font = `700 ${H * 0.7}px system-ui, sans-serif`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(texto, w / 2, H * 0.54);
        mat.map?.dispose(); mat.map = new THREE.CanvasTexture(c); mat.map.colorSpace = THREE.SRGBColorSpace; mat.needsUpdate = true;
        m.scale.set(w / H * 1.25, 1.25, 1); e.aspecto = w / H;
      };
      e.liberar = () => { mat.map?.dispose(); mat.dispose(); };
    }
    return e;
  }
  // Conjunto de rótulos reutilizables dentro de un grupo de la escena (en metros, coordenadas del mundo)
  function rotulos(max = 80) {
    const grupo = new THREE.Group(); grupo.name = 'rotulos';
    const libres = [], usados = [];
    // lista = [{ pos: Vector3 (mundo), texto, color, alto? }] · cabeza y giro de la cámara · alto mínimo angular
    function poner(lista, cabeza, camQuat, { angulo = 0.021, minimo = 0.008, maximo = 0.16, alcance = 6 } = {}) {
      let items = lista.map(l => ({ l, d: l.pos.distanceTo(cabeza) })).filter(x => x.d < alcance || x.l.siempre);
      if (items.length > max) items = items.sort((a, b) => (b.l.siempre ? 1 : 0) - (a.l.siempre ? 1 : 0) || a.d - b.d).slice(0, max); // los más cercanos
      while (usados.length > items.length) { const e = usados.pop(); e.obj.visible = false; libres.push(e); }
      while (usados.length < items.length) { const e = libres.pop() || etiqueta(); if (!e.obj.parent) grupo.add(e.obj); e.obj.visible = true; usados.push(e); }
      items.forEach(({ l, d }, i) => {
        const e = usados[i], h = THREE.MathUtils.clamp(d * angulo * (l.grande ? 1.5 : 1), minimo, maximo);
        e.poner(l.texto, l.color);
        e.obj.position.copy(l.pos); e.obj.quaternion.copy(camQuat);
        if (troika?.Text) e.obj.scale.setScalar(h); else e.obj.scale.set((e.aspecto || 3) * h * 1.25, h * 1.25, 1);
      });
      return items.length;
    }
    const ocultar = () => poner([], new THREE.Vector3(), new THREE.Quaternion());
    return { grupo, poner, ocultar, get visibles() { return usados.length; } };
  }
  return { etiqueta, rotulos, troika: !!troika?.Text };
};
})(globalThis);
