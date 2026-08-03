import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bus } from '../../core/events';
import type { MapaEventos } from '../../core/events';
import { Clase, indiceDe } from '../../sim/tipos';
import type { Mundo } from '../../sim/mundo';
import type { CalidadRender } from '../renderizador';
import {
  EMISOR_ESTELA_FLECHA,
  EMISOR_ESTELA_MAGICA,
  EMISOR_ESTELA_ROCA,
  type SistemaParticulas,
} from './particulas';

/**
 * Proyectiles: flechas, lanzas, rocas de catapulta y hechizos.
 *
 * Suscrito al evento `proyectil` de la simulación. La simulación decide *quién*
 * dispara y *cuánto* daño hace —eso ya se resuelve internamente y en el instante en
 * que el proyectil alcanza el objetivo—; este módulo solo dibuja el vuelo: una
 * trayectoria balística con arco (mucho más alto para la roca de catapulta que para
 * una flecha), la rotación de la punta siguiendo la tangente de esa trayectoria, una
 * estela sutil de partículas y, al llegar, la llamada de vuelta que dispara el
 * efecto de impacto correspondiente.
 *
 * ── Por qué el vuelo se recalcula aquí en vez de leerlo de la simulación ───────
 * `combate.ts` ya simula sus propios proyectiles puertas adentro, pero de forma
 * invisible: solo le importa el instante en que aplicar el daño, no cómo se ve la
 * flecha en pantalla. Este módulo hace su propia simulación *cosmética*, en paralelo,
 * con la misma distancia y la misma velocidad, así que el impacto visual cae muy
 * cerca del tick en que la simulación ya aplicó el golpe.
 *
 * ── InstancedMesh por tipo ──────────────────────────────────────────────────────
 * Cada tipo de proyectil vive en su propio `InstancedMesh` con un anillo de
 * reutilización de tamaño fijo (mayor para flechas, que son las más frecuentes).
 * Encajar un proyectil nuevo es escribir una matriz en la ranura más antigua: cero
 * geometría nueva, cero material nuevo, un único `drawArrays` por tipo y fotograma.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearSistemaProyectiles(escena, mundo, calidad, particulas, alImpacto): SistemaProyectiles
 *     · raiz: THREE.Group con los `InstancedMesh` de cada tipo
 *     · actualizar(dt): avanza todos los proyectiles en vuelo
 *     · liberar(): se da de baja del bus y suelta geometrías y materiales
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type TipoProyectil = MapaEventos['proyectil']['tipo'];

export interface InfoImpactoProyectil {
  tipo: TipoProyectil;
  x: number;
  y: number;
  z: number;
  esEdificio: boolean;
}

export interface SistemaProyectiles {
  readonly raiz: THREE.Group;
  actualizar(dt: number): void;
  liberar(): void;
}

/** Altura de arco (en unidades de mundo) por cada casilla de distancia recorrida. */
const ARCO_POR_DISTANCIA: Record<TipoProyectil, number> = {
  flecha: 0.055,
  lanza: 0.075,
  roca: 0.55,
  hechizo: 0.025,
};
const ARCO_BASE: Record<TipoProyectil, number> = {
  flecha: 0.12,
  lanza: 0.16,
  roca: 1.1,
  hechizo: 0.04,
};

/** Vueltas por segundo de la roca al tumbar en el aire. */
const GIRO_ROCA = 3.4;

interface DefinicionTipo {
  geometria: THREE.BufferGeometry;
  material: THREE.Material;
  capacidad: number;
  estela: Parameters<SistemaParticulas['emitir']>[0];
}

function geometriaFlecha(): THREE.BufferGeometry {
  const asta = new THREE.CylinderGeometry(0.011, 0.014, 0.5, 6);
  asta.rotateX(Math.PI / 2);
  asta.translate(0, 0, 0.25);
  const punta = new THREE.ConeGeometry(0.024, 0.1, 6);
  punta.rotateX(Math.PI / 2);
  punta.translate(0, 0, 0.55);
  return mergeGeometries([asta, punta]);
}

function geometriaLanza(): THREE.BufferGeometry {
  const asta = new THREE.CylinderGeometry(0.018, 0.022, 0.82, 6);
  asta.rotateX(Math.PI / 2);
  asta.translate(0, 0, 0.41);
  const punta = new THREE.ConeGeometry(0.036, 0.2, 6);
  punta.rotateX(Math.PI / 2);
  punta.translate(0, 0, 0.92);
  return mergeGeometries([asta, punta]);
}

function definicionesPorCalidad(calidad: CalidadRender): Record<TipoProyectil, DefinicionTipo> {
  const factor = calidad.nivel === 'alto' ? 1 : calidad.nivel === 'medio' ? 0.7 : 0.4;
  const cap = (base: number): number => Math.max(4, Math.round(base * factor));

  return {
    flecha: {
      geometria: geometriaFlecha(),
      material: new THREE.MeshStandardMaterial({ color: 0x8a7658, roughness: 0.85, metalness: 0.05 }),
      capacidad: cap(56),
      estela: EMISOR_ESTELA_FLECHA,
    },
    lanza: {
      geometria: geometriaLanza(),
      material: new THREE.MeshStandardMaterial({ color: 0x746048, roughness: 0.82, metalness: 0.08 }),
      capacidad: cap(24),
      estela: EMISOR_ESTELA_FLECHA,
    },
    roca: {
      geometria: new THREE.DodecahedronGeometry(0.17, 0),
      material: new THREE.MeshStandardMaterial({ color: 0x726a5c, roughness: 0.96, metalness: 0 }),
      capacidad: cap(12),
      estela: EMISOR_ESTELA_ROCA,
    },
    hechizo: {
      geometria: new THREE.IcosahedronGeometry(0.1, 1),
      material: new THREE.MeshStandardMaterial({
        color: 0x9a6bff,
        emissive: 0x8850ff,
        emissiveIntensity: 1.6,
        roughness: 0.35,
        metalness: 0.1,
      }),
      capacidad: cap(16),
      estela: EMISOR_ESTELA_MAGICA,
    },
  };
}

interface RanuraTipo {
  activo: Uint8Array;
  origenX: Float32Array;
  origenY: Float32Array;
  origenZ: Float32Array;
  destinoX: Float32Array;
  destinoY: Float32Array;
  destinoZ: Float32Array;
  destinoEntidad: Int32Array;
  nacimiento: Float32Array;
  duracion: Float32Array;
  arco: Float32Array;
  yaw: Float32Array;
  esEdificio: Uint8Array;
  proximoTrail: Float32Array;
  cursor: number;
}

function crearRanuras(capacidad: number): RanuraTipo {
  return {
    activo: new Uint8Array(capacidad),
    origenX: new Float32Array(capacidad),
    origenY: new Float32Array(capacidad),
    origenZ: new Float32Array(capacidad),
    destinoX: new Float32Array(capacidad),
    destinoY: new Float32Array(capacidad),
    destinoZ: new Float32Array(capacidad),
    destinoEntidad: new Int32Array(capacidad),
    nacimiento: new Float32Array(capacidad),
    duracion: new Float32Array(capacidad),
    arco: new Float32Array(capacidad),
    yaw: new Float32Array(capacidad),
    esEdificio: new Uint8Array(capacidad),
    proximoTrail: new Float32Array(capacidad),
    cursor: 0,
  };
}

export function crearSistemaProyectiles(
  escena: THREE.Scene,
  mundo: Mundo,
  calidad: CalidadRender,
  particulas: SistemaParticulas,
  alImpacto: (info: InfoImpactoProyectil) => void,
): SistemaProyectiles {
  const raiz = new THREE.Group();
  raiz.name = 'efectos-proyectiles';
  escena.add(raiz);

  const definiciones = definicionesPorCalidad(calidad);
  const tipos: TipoProyectil[] = ['flecha', 'lanza', 'roca', 'hechizo'];

  const mallas: Record<TipoProyectil, THREE.InstancedMesh> = {} as never;
  const ranuras: Record<TipoProyectil, RanuraTipo> = {} as never;

  for (const tipo of tipos) {
    const def = definiciones[tipo];
    const malla = new THREE.InstancedMesh(def.geometria, def.material, def.capacidad);
    malla.name = `proyectil-${tipo}`;
    malla.castShadow = calidad.resolucionSombras > 0;
    malla.frustumCulled = false;
    malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Todas las instancias arrancan reducidas a nada; una ranura libre no debe
    // dejar un proyectil fantasma visible en el origen del mundo.
    const oculto = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < def.capacidad; k++) malla.setMatrixAt(k, oculto);
    malla.instanceMatrix.needsUpdate = true;
    raiz.add(malla);
    mallas[tipo] = malla;
    ranuras[tipo] = crearRanuras(def.capacidad);
  }

  // Temporales reutilizados: nunca se crea un Vector3/Quaternion dentro del bucle.
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _escala = new THREE.Vector3(1, 1, 1);
  const _mat = new THREE.Matrix4();
  const _matOculta = new THREE.Matrix4().makeScale(0, 0, 0);

  let reloj = 0;

  const bajaEvento = bus.al('proyectil', (datos) => {
    const def = definiciones[datos.tipo];
    const r = ranuras[datos.tipo];
    const slot = r.cursor;
    r.cursor = (r.cursor + 1) % def.capacidad;

    const destinoValido = mundo.esValida(datos.destino);
    const j = destinoValido ? indiceDe(datos.destino) : -1;
    const destX = destinoValido ? mundo.x[j] : datos.origenX;
    const destZ = destinoValido ? mundo.z[j] : datos.origenZ;
    const destY = destinoValido
      ? mundo.alturaDe(j) + mundo.radio[j] * 0.6 + 0.15
      : datos.origenY;
    const esEdificio = destinoValido && mundo.clase[j] === Clase.EDIFICIO;

    const distancia = Math.max(0.4, Math.hypot(destX - datos.origenX, destZ - datos.origenZ));

    r.activo[slot] = 1;
    r.origenX[slot] = datos.origenX;
    r.origenY[slot] = datos.origenY;
    r.origenZ[slot] = datos.origenZ;
    r.destinoX[slot] = destX;
    r.destinoY[slot] = destY;
    r.destinoZ[slot] = destZ;
    r.destinoEntidad[slot] = destinoValido ? j : -1;
    r.nacimiento[slot] = reloj;
    r.duracion[slot] = Math.max(0.08, distancia / Math.max(1, datos.velocidad));
    r.arco[slot] = ARCO_BASE[datos.tipo] + distancia * ARCO_POR_DISTANCIA[datos.tipo];
    r.yaw[slot] = Math.atan2(destX - datos.origenX, destZ - datos.origenZ);
    r.esEdificio[slot] = esEdificio ? 1 : 0;
    r.proximoTrail[slot] = 0;
  });

  /** Posición en el arco balístico para una fracción `t` del vuelo, en `_pos`. */
  function muestrearArco(r: RanuraTipo, slot: number, t: number): void {
    const ox = r.origenX[slot];
    const oz = r.origenZ[slot];
    _pos.x = ox + (r.destinoX[slot] - ox) * t;
    _pos.z = oz + (r.destinoZ[slot] - oz) * t;
    const oy = r.origenY[slot];
    _pos.y = oy + (r.destinoY[slot] - oy) * t + r.arco[slot] * 4 * t * (1 - t);
  }

  return {
    raiz,

    actualizar(dt: number): void {
      reloj += dt;

      for (const tipo of tipos) {
        const def = definiciones[tipo];
        const r = ranuras[tipo];
        const malla = mallas[tipo];
        let huboCambios = false;

        for (let slot = 0; slot < def.capacidad; slot++) {
          if (r.activo[slot] === 0) continue;
          huboCambios = true;

          // El proyectil persigue la posición viva del objetivo, igual que hace la
          // simulación por dentro: un blanco que se desplaza no deja la flecha
          // apuntando a un punto vacío.
          const entidadDestino = r.destinoEntidad[slot];
          if (entidadDestino >= 0 && mundo.activos[entidadDestino] === 1) {
            r.destinoX[slot] = mundo.x[entidadDestino];
            r.destinoZ[slot] = mundo.z[entidadDestino];
            r.destinoY[slot] = mundo.alturaDe(entidadDestino) + mundo.radio[entidadDestino] * 0.6 + 0.15;
          }

          const edad = reloj - r.nacimiento[slot];
          const duracion = r.duracion[slot];
          const t = Math.min(1, edad / duracion);

          if (t >= 1) {
            r.activo[slot] = 0;
            malla.setMatrixAt(slot, _matOculta);
            alImpacto({
              tipo,
              x: r.destinoX[slot],
              y: r.destinoY[slot],
              z: r.destinoZ[slot],
              esEdificio: r.esEdificio[slot] === 1,
            });
            continue;
          }

          muestrearArco(r, slot, t);
          const px = _pos.x;
          const py = _pos.y;
          const pz = _pos.z;

          // Cabeceo: se deriva de un segundo muestreo muy cercano en el tiempo, más
          // barato y más robusto que la derivada simbólica de la parábola.
          const t2 = Math.min(1, t + 0.02);
          muestrearArco(r, slot, t2);
          const horizontal = Math.hypot(_pos.x - px, _pos.z - pz) || 1e-4;
          const cabeceo = Math.atan2(_pos.y - py, horizontal);

          _euler.set(-cabeceo, r.yaw[slot], tipo === 'roca' ? edad * GIRO_ROCA : 0, 'YXZ');
          _quat.setFromEuler(_euler);
          _pos.set(px, py, pz);
          _mat.compose(_pos, _quat, _escala);
          malla.setMatrixAt(slot, _mat);

          // Estela sutil: un goteo de partículas a lo largo del recorrido, no un
          // chorro continuo que competiría visualmente con el impacto.
          r.proximoTrail[slot] = r.proximoTrail[slot] - dt;
          if (r.proximoTrail[slot] <= 0 && calidad.nivel !== 'bajo') {
            r.proximoTrail[slot] = 0.045;
            particulas.emitir(def.estela, {
              x: px,
              y: py,
              z: pz,
              cantidad: 1,
              velocidad: 0.15,
              dispersion: 0.3,
              vidaMin: 0.15,
              vidaMax: 0.3,
            });
          }
        }

        if (huboCambios) malla.instanceMatrix.needsUpdate = true;
      }
    },

    liberar(): void {
      bajaEvento();
      for (const tipo of tipos) {
        definiciones[tipo].geometria.dispose();
        definiciones[tipo].material.dispose();
      }
      raiz.clear();
      escena.remove(raiz);
    },
  };
}
