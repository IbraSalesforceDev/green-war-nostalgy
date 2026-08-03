import * as THREE from 'three';
import type { MapaJuego } from '../../sim/mapa';
import type { CalidadRender } from '../renderizador';

/**
 * Decalcomanías de terreno: sangre, cráteres y marcas de quemado.
 *
 * Deliberadamente NO es un sistema de proyección de decals (esos leen la profundidad
 * de la escena y recortan contra ella; son unos cuantos milisegundos de más por
 * decal que un móvil no puede permitirse). En su lugar cada mancha es un parche de
 * geometría pequeño y barato: un abanico de pocos triángulos cuyos vértices ya están
 * a la altura real del terreno (`mapa.alturaEnMundo`) con un desplazamiento vertical
 * mínimo y `polygonOffset` para que no parpadee contra el suelo. Nada de sombras,
 * nada de normal maps: un `MeshBasicMaterial` con una textura generada por código.
 *
 * ── Aviso de la normal (ver vegetacion.ts) ──────────────────────────────────────
 * Como el material es `MeshBasicMaterial` (sin iluminación), la clase de error que
 * dejó siluetas negras en la vegetación —una normal de cara trasera invertida
 * recibiendo luz negativa— no puede ocurrir aquí: `MeshBasicMaterial` ignora la
 * normal por completo. Aun así los parches llevan la normal hacia arriba, por
 * higiene y por si el día de mañana pasan a un material con luz.
 *
 * ── Anillo de reutilización ─────────────────────────────────────────────────────
 * Un máximo de decalcomanías vivas por nivel de calidad; al superarlo, la más
 * antigua se recicla (se tira su geometría y se reconstruye en el sitio nuevo). En
 * calidad baja el sistema se queda directamente en cero: es jugabilidad la niebla
 * de guerra, no lo es una mancha de sangre.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearSistemaDecals(escena, mapa, calidad): SistemaDecals
 *     · raiz: THREE.Group con los parches vivos
 *     · agregar(tipo, opciones): crea (o recicla) una decalcomanía
 *     · actualizar(dt): desvanece y retira las que han cumplido su vida
 *     · liberar(): suelta geometrías, materiales y texturas
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type TipoDecal = 'sangre' | 'crater' | 'quemado';

export interface OpcionesDecal {
  x: number;
  z: number;
  /** Radio del parche en unidades de mundo. */
  radio: number;
  /** Orientación; si se omite se elige al azar para romper la repetición. */
  rotacion?: number;
}

export interface SistemaDecals {
  readonly raiz: THREE.Group;
  agregar(tipo: TipoDecal, opciones: OpcionesDecal): void;
  actualizar(dt: number): void;
  liberar(): void;
}

/** Segundos de vida (antes de empezar a desvanecerse) por tipo. */
const VIDA_POR_TIPO: Record<TipoDecal, number> = {
  sangre: 22,
  crater: 55,
  quemado: 46,
};

const SEGMENTOS = 10;
const DESPLAZAMIENTO_VERTICAL = 0.014;

// --- Texturas: manchas orgánicas, no discos perfectos --------------------------

const texturaCache = new Map<TipoDecal, THREE.DataTexture>();

function limitar01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function generarTexturaDecal(tipo: TipoDecal): THREE.DataTexture {
  const guardada = texturaCache.get(tipo);
  if (guardada) return guardada;

  const n = 64;
  const datos = new Uint8Array(n * n * 4);
  const centro = (n - 1) / 2;

  // Perturbación angular de la silueta: tres armónicos con fase fija por tipo, así
  // la mancha tiene lóbulos y entrantes en vez de un contorno de compás.
  const fase = tipo === 'sangre' ? 0.4 : tipo === 'crater' ? 2.1 : 4.6;

  const paleta: Record<TipoDecal, { nucleo: [number, number, number]; borde: [number, number, number]; brillo: [number, number, number] }> = {
    sangre: { nucleo: [58, 8, 8], borde: [28, 4, 4], brillo: [110, 18, 14] },
    crater: { nucleo: [46, 40, 32], borde: [70, 62, 48], brillo: [92, 82, 62] },
    quemado: { nucleo: [10, 8, 7], borde: [22, 16, 12], brillo: [156, 84, 28] },
  };
  const col = paleta[tipo];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = (i - centro) / centro;
      const dy = (j - centro) / centro;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      const radioEfectivo =
        1 +
        0.16 * Math.sin(ang * 3 + fase) +
        0.1 * Math.sin(ang * 5 + fase * 1.7) +
        0.07 * Math.sin(ang * 8 + fase * 2.3);

      const t = dist / Math.max(0.05, radioEfectivo);
      const cobertura = limitar01(1 - (t - 0.55) / 0.35);
      if (cobertura <= 0) continue;

      // Moteado interior: sin él, la mancha se lee como un adhesivo plano.
      const moteado =
        0.5 +
        0.5 * Math.sin(dx * 14 + fase * 3) * Math.sin(dy * 11 - fase * 2);
      const haciaBorde = limitar01(1 - t * 1.15);

      const r = col.nucleo[0] + (col.borde[0] - col.nucleo[0]) * (1 - haciaBorde) + moteado * 6;
      const g = col.nucleo[1] + (col.borde[1] - col.nucleo[1]) * (1 - haciaBorde) + moteado * 4;
      const b = col.nucleo[2] + (col.borde[2] - col.nucleo[2]) * (1 - haciaBorde) + moteado * 3;

      // Filo brillante justo en el borde exterior: costra reseca o rescoldo, según el tipo.
      const filo = limitar01(1 - Math.abs(t - 0.92) / 0.12) * cobertura;

      const k = (j * n + i) * 4;
      datos[k] = Math.min(255, Math.round(r + filo * (col.brillo[0] - r)));
      datos[k + 1] = Math.min(255, Math.round(g + filo * (col.brillo[1] - g)));
      datos[k + 2] = Math.min(255, Math.round(b + filo * (col.brillo[2] - b)));
      datos[k + 3] = Math.round(cobertura * 235);
    }
  }

  const textura = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.minFilter = THREE.LinearFilter;
  textura.magFilter = THREE.LinearFilter;
  textura.needsUpdate = true;
  texturaCache.set(tipo, textura);
  return textura;
}

// --- Ranura de decal ------------------------------------------------------------

interface Ranura {
  malla: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  activo: boolean;
  nacimiento: number;
  vida: number;
}

/** Construye el abanico de geometría, ceñido a la altura real del terreno. */
function construirGeometria(mapa: MapaJuego, x: number, z: number, radio: number, rotacion: number): THREE.BufferGeometry {
  const posiciones = new Float32Array((SEGMENTOS + 2) * 3);
  const uvs = new Float32Array((SEGMENTOS + 2) * 2);
  const indices: number[] = [];

  posiciones[0] = x;
  posiciones[1] = mapa.alturaEnMundo(x, z) + DESPLAZAMIENTO_VERTICAL;
  posiciones[2] = z;
  uvs[0] = 0.5;
  uvs[1] = 0.5;

  for (let s = 0; s <= SEGMENTOS; s++) {
    const ang = (s / SEGMENTOS) * Math.PI * 2 + rotacion;
    const px = x + Math.cos(ang) * radio;
    const pz = z + Math.sin(ang) * radio;
    const py = mapa.alturaEnMundo(px, pz) + DESPLAZAMIENTO_VERTICAL;
    const base = (s + 1) * 3;
    posiciones[base] = px;
    posiciones[base + 1] = py;
    posiciones[base + 2] = pz;
    const ub = (s + 1) * 2;
    uvs[ub] = 0.5 + Math.cos(ang) * 0.5;
    uvs[ub + 1] = 0.5 + Math.sin(ang) * 0.5;
    if (s > 0) indices.push(0, s, s + 1);
  }

  // Normal hacia arriba en todo el parche: es plana por construcción y el material
  // no la usa (MeshBasicMaterial no ilumina), pero se rellena correctamente por si
  // el día de mañana el material cambia.
  const normales = new Float32Array((SEGMENTOS + 2) * 3);
  for (let i = 1; i < normales.length; i += 3) normales[i] = 1;

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
  geometria.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometria.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
  geometria.setIndex(indices);
  return geometria;
}

function capacidadPara(calidad: CalidadRender): number {
  if (calidad.nivel === 'alto') return 40;
  if (calidad.nivel === 'medio') return 24;
  return 0;
}

export function crearSistemaDecals(escena: THREE.Scene, mapa: MapaJuego, calidad: CalidadRender): SistemaDecals {
  const raiz = new THREE.Group();
  raiz.name = 'efectos-decals';
  escena.add(raiz);

  const capacidad = capacidadPara(calidad);
  const ranuras: Ranura[] = [];
  let cursor = 0;
  let reloj = 0;

  for (let k = 0; k < capacidad; k++) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      opacity: 0,
    });
    const malla = new THREE.Mesh(new THREE.BufferGeometry(), material);
    malla.visible = false;
    malla.matrixAutoUpdate = false;
    raiz.add(malla);
    ranuras.push({ malla, material, activo: false, nacimiento: 0, vida: 1 });
  }

  return {
    raiz,

    agregar(tipo: TipoDecal, opciones: OpcionesDecal): void {
      if (capacidad === 0) return;
      const ranura = ranuras[cursor];
      cursor = (cursor + 1) % capacidad;

      ranura.malla.geometry.dispose();
      ranura.malla.geometry = construirGeometria(
        mapa,
        opciones.x,
        opciones.z,
        opciones.radio,
        opciones.rotacion ?? Math.random() * Math.PI * 2,
      );
      ranura.material.map = generarTexturaDecal(tipo);
      ranura.material.opacity = 1;
      ranura.material.needsUpdate = true;
      ranura.malla.visible = true;
      ranura.activo = true;
      ranura.nacimiento = reloj;
      ranura.vida = VIDA_POR_TIPO[tipo];
    },

    actualizar(dt: number): void {
      reloj += dt;
      for (const ranura of ranuras) {
        if (!ranura.activo) continue;
        const edad = reloj - ranura.nacimiento;
        if (edad >= ranura.vida) {
          ranura.activo = false;
          ranura.malla.visible = false;
          continue;
        }
        // Se desvanece en el último tercio de su vida: aparecer y desaparecer de
        // golpe delataría el reciclado del anillo.
        const inicioDesvanecido = ranura.vida * 0.66;
        if (edad > inicioDesvanecido) {
          const t = (edad - inicioDesvanecido) / (ranura.vida - inicioDesvanecido);
          ranura.material.opacity = 1 - t;
        }
      }
    },

    liberar(): void {
      for (const ranura of ranuras) {
        ranura.malla.geometry.dispose();
        ranura.material.dispose();
      }
      for (const textura of texturaCache.values()) textura.dispose();
      texturaCache.clear();
      raiz.clear();
      escena.remove(raiz);
    },
  };
}
