import { distanciaCuadrada } from '../core/math';
import { Mundo } from '../sim/mundo';
import { esObrero, ordenarMover } from '../sim/ordenes';
import { Bando, Clase, Entidad, Orden, indiceDe } from '../sim/tipos';

/**
 * Exploración de la IA.
 *
 * Mantiene una o dos unidades recorriendo el mapa para que el bando descubra al
 * jugador con el tiempo en vez de operar a ciegas para siempre. Preferimos gastar
 * un campesino de sobra antes que uno de los primeros cinco (la economía no puede
 * permitirse perder manos todavía), y solo si no hay ninguno de sobra se recluta la
 * primera unidad militar libre que se encuentre.
 *
 * La elección de destino (`buscarPuntoInexplorado`) se exporta aparte porque
 * `combate.ts` también la necesita: si la IA no ha visto ni recuerda ni rastro del
 * enemigo, lo más honesto que puede hacer con una fuerza ya reunida es empujarla
 * hacia lo desconocido, no hacia una posición que su código jamás debería conocer.
 */

// --- Ajustes propios del módulo (no existían en constantes.ts) ---

/** Cuántos exploradores intenta mantener en marcha a la vez. */
export const OBJETIVO_EXPLORADORES = 2;

/** Campesinos vivos por encima de los cuales uno se considera "de sobra" para explorar. */
export const OBREROS_DE_RESERVA = 4;

/** Separación en casillas de la rejilla gruesa de puntos candidatos. */
const PASO_REJILLA = 8;

/**
 * Punto sin explorar más cercano a (desdeX, desdeZ), sobre una rejilla gruesa.
 *
 * Recorrer casilla a casilla las (hasta) 9216 del mapa por defecto cada vez que un
 * explorador necesita un destino nuevo sería tirar presupuesto de CPU a la basura;
 * una rejilla de paso 8 lo reduce a un puñado de comprobaciones y es más que
 * suficiente para dirigir a un explorador hacia la zona menos conocida.
 */
export function buscarPuntoInexplorado(
  mundo: Mundo,
  bando: Bando,
  desdeX: number,
  desdeZ: number,
): { x: number; z: number } | null {
  const mapa = mundo.mapa;
  const mitad = PASO_REJILLA >> 1;

  // Primera pasada: el algoritmo clásico, sin ningún coste añadido. Un bosque
  // cubre en torno a un tercio del mapa y buena parte de sus árboles caen justo
  // sobre algún punto de esta rejilla, así que descartar de entrada lo bloqueado
  // es lo que mantiene esta pasada barata y es correcto casi siempre: mientras
  // quede *algún* punto de muestreo libre sin explorar, ese es el frente real y no
  // hace falta mirar más lejos.
  let mejorX = 0;
  let mejorZ = 0;
  let mejorDistancia = Infinity;
  let encontrado = false;

  for (let cz = mitad; cz < mapa.alto; cz += PASO_REJILLA) {
    for (let cx = mitad; cx < mapa.ancho; cx += PASO_REJILLA) {
      if (mapa.esExplorado(bando, cx, cz)) continue;
      if (!mapa.transitable(cx, cz)) continue;

      const x = mapa.centroCasilla(cx);
      const z = mapa.centroCasilla(cz);
      const d = distanciaCuadrada(desdeX, desdeZ, x, z);
      if (d < mejorDistancia) {
        mejorDistancia = d;
        mejorX = x;
        mejorZ = z;
        encontrado = true;
      }
    }
  }

  if (encontrado) return { x: mejorX, z: mejorZ };

  // Segunda pasada, solo si la primera no encontró NADA: puede que todo lo que
  // queda por explorar tenga su punto de muestreo bloqueado por algo —el caso que
  // de verdad importa es el interior de una base enemiga, cuyo margen por
  // defecto (12 casillas) coincide justo con un punto de esta rejilla (4, 12,
  // 20…)—. Sin esta segunda pasada esas bolsas no se explorarían jamás, porque
  // nunca aparece un candidato transitable más cercano que las sustituya. Al
  // llegar aquí ya no hay ningún candidato barato con el que competir de forma
  // desleal, así que resolver cada bloqueo a su casilla libre más próxima no
  // vuelve a colapsar la exploración como lo hacía hacerlo en la primera pasada.
  let mejorCx = 0;
  let mejorCz = 0;

  for (let cz = mitad; cz < mapa.alto; cz += PASO_REJILLA) {
    for (let cx = mitad; cx < mapa.ancho; cx += PASO_REJILLA) {
      if (mapa.esExplorado(bando, cx, cz)) continue;
      // Si llegó transitable, la primera pasada ya lo habría cogido.

      const libre = mapa.casillaLibreMasCercana(cx, cz, mitad);
      if (!libre) continue;
      const [lx, lz] = libre;
      if (mapa.esExplorado(bando, lx, lz)) continue;

      const x = mapa.centroCasilla(lx);
      const z = mapa.centroCasilla(lz);
      const d = distanciaCuadrada(desdeX, desdeZ, x, z);
      if (d < mejorDistancia) {
        mejorDistancia = d;
        mejorCx = lx;
        mejorCz = lz;
        encontrado = true;
      }
    }
  }

  return encontrado ? { x: mapa.centroCasilla(mejorCx), z: mapa.centroCasilla(mejorCz) } : null;
}

export class ExploracionIA {
  /** Entidades (con generación) que la IA usa ahora mismo como exploradoras. */
  private readonly exploradores: Entidad[] = [];

  paso(mundo: Mundo, bando: Bando): void {
    // Primero se atiende a quien ya está en el mapa: al que llegó (orden vuelta a
    // NINGUNA) se le da destino nuevo antes de que economía o combate lo reclamen
    // como "libre" en este mismo pensamiento.
    for (let k = this.exploradores.length - 1; k >= 0; k--) {
      const entidad = this.exploradores[k]!;
      if (!mundo.esValida(entidad)) {
        this.exploradores.splice(k, 1);
        continue;
      }

      const i = indiceDe(entidad);
      if (mundo.orden[i] !== Orden.NINGUNA) continue; // sigue de camino, no tocar

      const destino = buscarPuntoInexplorado(mundo, bando, mundo.x[i], mundo.z[i]);
      if (!destino) {
        this.exploradores.splice(k, 1); // no queda nada por descubrir: se libera
        continue;
      }
      ordenarMover(mundo, [entidad], destino.x, destino.z, bando);
    }

    while (this.exploradores.length < OBJETIVO_EXPLORADORES) {
      const candidato = this.reclutar(mundo, bando);
      if (candidato === 0) return;

      const destino = buscarPuntoInexplorado(mundo, bando, mundo.x[candidato], mundo.z[candidato]);
      if (!destino) return; // mapa ya explorado del todo

      const entidad = mundo.entidadDeIndice(candidato);
      ordenarMover(mundo, [entidad], destino.x, destino.z, bando);
      this.exploradores.push(entidad);
    }
  }

  /** Un obrero de sobra si lo hay; si no, la primera unidad militar libre. */
  private reclutar(mundo: Mundo, bando: Bando): number {
    let obrerosVistos = 0;
    let obreroCandidato = 0;
    let militarCandidato = 0;

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.bando[i] !== bando) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (mundo.vida[i] <= 0) continue;
      if (mundo.orden[i] !== Orden.NINGUNA) continue;
      if (this.yaExplora(mundo.entidadDeIndice(i))) continue;

      if (esObrero(mundo, i)) {
        obrerosVistos++;
        if (obrerosVistos > OBREROS_DE_RESERVA && obreroCandidato === 0) obreroCandidato = i;
      } else if (mundo.danioMax[i] > 0 && militarCandidato === 0) {
        militarCandidato = i;
      }
    }

    return obreroCandidato || militarCandidato;
  }

  private yaExplora(entidad: Entidad): boolean {
    return this.exploradores.includes(entidad);
  }
}
