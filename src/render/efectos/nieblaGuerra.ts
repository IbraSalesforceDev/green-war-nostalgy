import * as THREE from 'three';
import { bus as busGlobal, BusEventos } from '../../core/events';
import { SUAVIZADO_NIEBLA } from '../../sim/constantes';
import type { MapaJuego } from '../../sim/mapa';
import { Bando, Vision } from '../../sim/tipos';

/**
 * Niebla de guerra.
 *
 * `mapa.vision[bando]` es un `Uint8Array` con un valor de `Vision` por casilla —el
 * estado *lógico*, que cambia a saltos en cuanto una unidad se mueve una casilla—.
 * Pintarlo tal cual produciría un dentado exacto de casilla y un parpadeo cada vez
 * que la visión avanza un paso. Este módulo resuelve las dos cosas:
 *
 *   1. Cada valor lógico se sube a una `DataTexture` del tamaño de la rejilla y se
 *      muestrea con filtrado bilineal (`LinearFilter`), así que el borde entre lo
 *      visible y lo oculto queda suave en vez de escalonado.
 *   2. La textura que de verdad se dibuja no es esa textura lógica: es una copia
 *      que se *persigue* hacia ella con velocidad `SUAVIZADO_NIEBLA` (unidades de
 *      opacidad por segundo), igual que la cámara persigue su objetivo. El salto
 *      lógico instantáneo se convierte así en una apertura o cierre progresivo, sin
 *      ningún coste extra en la simulación: toda la suavidad vive aquí, en el render.
 *
 * La niebla se aplica como una malla plana que cubre el mapa a ras de suelo, con
 * mezcla multiplicativa: donde la textura vale 1 (visible) no oscurece nada; donde
 * vale una fracción de RECORDADO u OCULTO, atenúa el color de debajo. No es una
 * malla 3D que sigue el relieve porque no hace falta —a la distancia y el ángulo de
 * la cámara de este juego, una capa plana ligeramente por encima del terreno más
 * alto ya lee correctamente como "no puedo ver ahí", que es todo lo que se le pide—.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearNieblaGuerra(escena, mapa, bando, bus?): NieblaGuerra
 *     · raiz: THREE.Object3D, la malla de niebla
 *     · actualizar(dt): sube la textura lógica y persigue la textura visible
 *     · fijarBando(bando): cambia de qué bando se pinta la niebla (para depurar)
 *     · liberar(): se da de baja del bus y suelta textura, geometría y material
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface NieblaGuerra {
  readonly raiz: THREE.Object3D;
  actualizar(dt: number): void;
  fijarBando(bando: Bando): void;
  liberar(): void;
}

/** Altura a la que flota la capa de niebla sobre el terreno más alto esperable. */
const ALTURA_CAPA = 6;

export function crearNieblaGuerra(
  escena: THREE.Scene,
  mapa: MapaJuego,
  bando: Bando,
  bus: BusEventos = busGlobal,
): NieblaGuerra {
  const ancho = mapa.ancho;
  const alto = mapa.alto;
  const n = ancho * alto;

  // Textura lógica: el valor de Vision normalizado a byte, subido tal cual cada vez
  // que cambia. Textura visible: la que de verdad se dibuja, persiguiendo a la
  // lógica con inercia. Dos búferes en vez de uno porque el GPU necesita leer el
  // estado anterior mientras la CPU escribe el nuevo objetivo.
  const datosLogicos = new Uint8Array(n);
  const datosVisibles = new Float32Array(n);
  // RGBA con el mismo valor repetido en los tres canales de color: con un formato
  // de un solo canal (RedFormat), el resto del sombreador estándar de Three
  // multiplica G y B por 0 al aplicar el mapa —pintaría todo el color de debajo
  // en rojo puro en vez de oscurecerlo por igual—. Repetir el valor a mano en los
  // tres canales es el precio de poder seguir usando `MeshBasicMaterial` con su
  // cadena de mapeo tonal y espacio de color de serie.
  const datosSubida = new Uint8Array(n * 4);

  datosLogicos.fill(0);
  datosVisibles.fill(0);
  for (let i = 0; i < n; i++) datosSubida[i * 4 + 3] = 255;

  const textura = new THREE.DataTexture(datosSubida, ancho, alto, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.magFilter = THREE.LinearFilter;
  textura.minFilter = THREE.LinearFilter;
  textura.wrapS = THREE.ClampToEdgeWrapping;
  textura.wrapT = THREE.ClampToEdgeWrapping;
  textura.generateMipmaps = false;
  textura.needsUpdate = true;

  const geometria = new THREE.PlaneGeometry(ancho, alto, 1, 1);
  geometria.rotateX(-Math.PI / 2);
  geometria.translate(ancho / 2, ALTURA_CAPA, alto / 2);

  // El propio mapa UV, invertido en V: la fila 0 de la textura es cz=0, y el plano
  // de Three coloca (0,0) de UV en la esquina "inferior" tal como se ve desde arriba.
  const uv = geometria.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: textura,
    transparent: true,
    depthWrite: false,
    // Multiplicativa: la niebla oscurece lo que hay debajo sin taparlo con un color
    // propio, así el terreno y las unidades memorizadas siguen reconociéndose.
    blending: THREE.MultiplyBlending,
    // La mezcla multiplicativa de Three exige alfa premultiplicado (si no, avisa
    // por consola en cada fotograma); con A siempre a 255 en esta textura,
    // premultiplicar no cambia ni un valor de color, así que es gratis.
    premultipliedAlpha: true,
    toneMapped: false,
  });

  const malla = new THREE.Mesh(geometria, material);
  malla.name = 'niebla-guerra';
  malla.renderOrder = 10;
  malla.frustumCulled = false;
  escena.add(malla);

  let bandoActual = bando;

  function volcarVisionLogica(): void {
    const vision = mapa.vision[bandoActual];
    if (!vision) return;
    for (let i = 0; i < n; i++) {
      // OCULTO=0 -> 0, RECORDADO=1 -> ~130, VISIBLE=2 -> 255. La franja intermedia
      // sigue oscureciendo bastante: lo memorizado no es tan honesto como lo visto.
      const v = vision[i] as Vision;
      datosLogicos[i] = v === Vision.VISIBLE ? 255 : v === Vision.RECORDADO ? 130 : 0;
    }
  }

  volcarVisionLogica();
  for (let i = 0; i < n; i++) datosVisibles[i] = datosLogicos[i];

  const bajaNiebla = bus.al('nieblaActualizada', () => {
    volcarVisionLogica();
  });

  return {
    raiz: malla,

    actualizar(dt: number): void {
      // Persigue el valor lógico con una exponencial: converge rápido al principio
      // y se posa suave al final, sin el rebote de un resorte ni el parón de un lerp
      // lineal que nunca termina de llegar.
      const factor = 1 - Math.exp(-SUAVIZADO_NIEBLA * dt);
      let cambioMaximo = 0;
      for (let i = 0; i < n; i++) {
        const objetivo = datosLogicos[i]!;
        const actual = datosVisibles[i]!;
        const nuevo = actual + (objetivo - actual) * factor;
        datosVisibles[i] = nuevo;
        const bruto = Math.round(nuevo);
        const base = i * 4;
        if (datosSubida[base] !== bruto) {
          datosSubida[base] = bruto;
          datosSubida[base + 1] = bruto;
          datosSubida[base + 2] = bruto;
          cambioMaximo = Math.max(cambioMaximo, Math.abs(objetivo - actual));
        }
      }
      // Solo se marca la textura como sucia si de verdad hubo un cambio perceptible:
      // subir 9.216 texels cada fotograma cuando la niebla lleva rato quieta sería
      // tirar ancho de banda de subida a la basura.
      if (cambioMaximo > 0.15) textura.needsUpdate = true;
    },

    fijarBando(nuevo: Bando): void {
      if (nuevo === bandoActual) return;
      bandoActual = nuevo;
      volcarVisionLogica();
      for (let i = 0; i < n; i++) {
        const valor = datosLogicos[i]!;
        datosVisibles[i] = valor;
        const base = i * 4;
        datosSubida[base] = valor;
        datosSubida[base + 1] = valor;
        datosSubida[base + 2] = valor;
      }
      textura.needsUpdate = true;
    },

    liberar(): void {
      bajaNiebla();
      escena.remove(malla);
      geometria.dispose();
      material.dispose();
      textura.dispose();
    },
  };
}
