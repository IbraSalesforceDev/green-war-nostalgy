import { distanciaCuadrada } from '../core/math';
import { esObrero } from '../sim/ordenes';
import type { CamaraJuego } from '../render/camara';
import type { Mundo } from '../sim/mundo';
import { Bando, Clase, ENTIDAD_NULA, Entidad, Orden, indiceDe } from '../sim/tipos';

/**
 * Lógica pura de selección: qué entidad cae bajo un punto, qué entra en una caja,
 * qué prioridad gana cuando varias clases se solapan.
 *
 * Nada de esto toca el DOM ni Pointer Events: todo recibe coordenadas ya resueltas
 * (puntos de mundo o proyecciones de pantalla), lo que permite probarlo con un
 * `Mundo` real y una `CamaraJuego` real, sin lienzo ni navegador de por medio.
 */

// --- Selección puntual (clic/toque corto) ---

/** Tolerancia añadida al radio de la entidad, para que acertar no exija precisión de píxel. */
const TOLERANCIA_PUNTERO = 0.28;

/** Radio de búsqueda: cubre de sobra el edificio más grande del juego. */
const RADIO_BUSQUEDA_PUNTERO = 3.2;

/**
 * Entidad bajo un punto de mundo, con prioridad de unidades sobre edificios y,
 * dentro de cada clase, la más cercana al punto exacto.
 *
 * Depende de `mundo.consultarRadio`, que a su vez depende de que la rejilla
 * espacial esté fresca (`mundo.reconstruirEspacial()`). En la partida real eso ya
 * lo garantiza el orquestador de la simulación una vez por tick a 20 Hz, antes de
 * que el jugador pueda reaccionar; en una prueba aislada hay que llamarlo a mano
 * tras poblar el mundo.
 */
export function entidadBajoPuntero(mundo: Mundo, x: number, z: number): Entidad {
  let mejorUnidad = 0;
  let mejorDistUnidad = Infinity;
  let mejorEdificio = 0;
  let mejorDistEdificio = Infinity;

  mundo.consultarRadio(x, z, RADIO_BUSQUEDA_PUNTERO, (i) => {
    const clase = mundo.clase[i];
    if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) return;
    if (mundo.vida[i]! <= 0) return;

    const radioEfectivo = mundo.radio[i]! + TOLERANCIA_PUNTERO;
    const d = distanciaCuadrada(x, z, mundo.x[i]!, mundo.z[i]!);
    if (d > radioEfectivo * radioEfectivo) return;

    if (clase === Clase.UNIDAD) {
      if (d < mejorDistUnidad) {
        mejorDistUnidad = d;
        mejorUnidad = i;
      }
    } else if (d < mejorDistEdificio) {
      mejorDistEdificio = d;
      mejorEdificio = i;
    }
  });

  const indice = mejorUnidad !== 0 ? mejorUnidad : mejorEdificio;
  return indice !== 0 ? mundo.entidadDeIndice(indice) : ENTIDAD_NULA;
}

// --- Prioridad de un conjunto (caja de selección) ---

/**
 * Aplica las reglas de prioridad de la caja de selección sobre una lista de índices
 * ya filtrada por el rectángulo de pantalla:
 *   - si hay unidades propias y ajenas mezcladas, se descartan las ajenas;
 *   - si lo que queda mezcla unidades y edificios, se descartan los edificios.
 */
export function filtrarPrioridad(
  mundo: Mundo,
  indices: readonly number[],
  bandoJugador: Bando,
): number[] {
  if (indices.length <= 1) return indices.slice();

  const propias = indices.filter((i) => mundo.bando[i] === bandoJugador);
  const base = propias.length > 0 ? propias : indices.slice();

  const unidades = base.filter((i) => mundo.clase[i] === Clase.UNIDAD);
  return unidades.length > 0 ? unidades : base;
}

const proyeccionTmp = { x: 0, y: 0 };

/** Entidades (unidad o edificio, vivas) cuya proyección en pantalla cae dentro del rectángulo. */
export function seleccionEnCaja(
  mundo: Mundo,
  camara: CamaraJuego,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bandoJugador: Bando,
  anchoPantalla: number,
  altoPantalla: number,
): Entidad[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  const candidatos: number[] = [];
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    const clase = mundo.clase[i];
    if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) continue;
    if (mundo.vida[i]! <= 0) continue;

    const detras = !camara.aPantalla(
      mundo.x[i]!,
      mundo.alturaDe(i),
      mundo.z[i]!,
      anchoPantalla,
      altoPantalla,
      proyeccionTmp,
    );
    if (detras) continue;
    if (
      proyeccionTmp.x < minX ||
      proyeccionTmp.x > maxX ||
      proyeccionTmp.y < minY ||
      proyeccionTmp.y > maxY
    ) {
      continue;
    }
    candidatos.push(i);
  }

  return filtrarPrioridad(mundo, candidatos, bandoJugador).map((i) => mundo.entidadDeIndice(i));
}

// --- Doble clic / doble toque: todas las de un tipo ---

/** Todas las entidades del mismo bando+clase+tipo que `modelo`, visibles en pantalla. */
export function mismasEnPantalla(
  mundo: Mundo,
  camara: CamaraJuego,
  modelo: Entidad,
  anchoPantalla: number,
  altoPantalla: number,
): Entidad[] {
  if (!mundo.esValida(modelo)) return [];
  const m = indiceDe(modelo);
  const clase = mundo.clase[m];
  const tipo = mundo.tipo[m];
  const bando = mundo.bando[m];

  const resultado: Entidad[] = [];
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== clase || mundo.tipo[i] !== tipo || mundo.bando[i] !== bando) continue;
    if (mundo.vida[i]! <= 0) continue;
    const visible = camara.aPantalla(
      mundo.x[i]!,
      mundo.alturaDe(i),
      mundo.z[i]!,
      anchoPantalla,
      altoPantalla,
      proyeccionTmp,
    );
    if (!visible) continue;
    if (
      proyeccionTmp.x < 0 ||
      proyeccionTmp.x > anchoPantalla ||
      proyeccionTmp.y < 0 ||
      proyeccionTmp.y > altoPantalla
    ) {
      continue;
    }
    resultado.push(mundo.entidadDeIndice(i));
  }
  return resultado;
}

/** Todas las entidades del mismo bando+clase+tipo que `modelo`, en todo el mapa. */
export function mismasEnMapa(mundo: Mundo, modelo: Entidad): Entidad[] {
  if (!mundo.esValida(modelo)) return [];
  const m = indiceDe(modelo);
  const clase = mundo.clase[m];
  const tipo = mundo.tipo[m];
  const bando = mundo.bando[m];

  const resultado: Entidad[] = [];
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== clase || mundo.tipo[i] !== tipo || mundo.bando[i] !== bando) continue;
    if (mundo.vida[i]! <= 0) continue;
    resultado.push(mundo.entidadDeIndice(i));
  }
  return resultado;
}

// --- Obreros ociosos (tecla «,») ---

/** Índices de obreros vivos del bando dado que no tienen ninguna orden en curso. */
export function obrerosOciosos(mundo: Mundo, bando: Bando): number[] {
  const resultado: number[] = [];
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== Clase.UNIDAD) continue;
    if (mundo.bando[i] !== bando) continue;
    if (mundo.vida[i]! <= 0) continue;
    if (mundo.orden[i] !== Orden.NINGUNA) continue;
    if (!esObrero(mundo, i)) continue;
    resultado.push(i);
  }
  return resultado;
}
