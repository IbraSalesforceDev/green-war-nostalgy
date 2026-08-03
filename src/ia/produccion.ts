import { fichaEdificio } from '../sim/datos/edificios';
import { fichaUnidad } from '../sim/datos/unidades';
import { Mundo } from '../sim/mundo';
import { encolarUnidad } from '../sim/sistemas/produccion';
import { Bando, Clase, type EstadoBando, TipoEdificio, TipoUnidad } from '../sim/tipos';
import { FaseIA } from './fases';

/**
 * Producción de la IA.
 *
 * Dos decisiones separadas cada pensamiento: ¿hacen falta más campesinos? y, si no,
 * ¿qué mezcla de tropa toca según la fase de la partida? La población se comprueba
 * contra lo que ya vive en el mapa MÁS lo que ya está en cola, no solo contra lo
 * primero: si no, la IA seguiría encolando después de llenar la cola de gente que
 * nunca podría llegar a salir por falta de granjas, malgastando oro que hace falta
 * en otra parte.
 */

// --- Ajustes propios del módulo (no existían en constantes.ts) ---

/** Campesinos vivos que la IA intenta mantener antes de darse por satisfecha. */
export const OBJETIVO_OBREROS = 12;

/** Elementos como mucho en la cola del ayuntamiento antes de dejar de encolar. */
const TOPE_COLA_AYUNTAMIENTO = 2;

/** Elementos como mucho en la cola de un barracón antes de dejar de encolar. */
const TOPE_COLA_BARRACON = 2;

/**
 * Pesos [soldado, arquero, jinete, catapulta] por fase. No hace falta que sumen 100:
 * son proporciones relativas y `elegirTropa` las trata como tales.
 */
const MEZCLA_POR_FASE: Readonly<Record<FaseIA, readonly [number, number, number, number]>> = {
  [FaseIA.ARRANQUE]: [0, 0, 0, 0],
  [FaseIA.CRECIMIENTO]: [60, 40, 0, 0],
  [FaseIA.MILICIA]: [40, 35, 25, 0],
  [FaseIA.ASALTO]: [35, 25, 20, 20],
};

const TIPOS_TROPA: readonly TipoUnidad[] = [
  TipoUnidad.SOLDADO,
  TipoUnidad.ARQUERO,
  TipoUnidad.JINETE,
  TipoUnidad.CATAPULTA,
];

/**
 * Coste en oro de la tropa más barata que la fase actual esté dispuesta a entrenar,
 * o 0 si el barracón todavía no existe o ninguna tropa tiene peso en esta fase.
 *
 * Vive aquí porque las proporciones de tropa (`MEZCLA_POR_FASE`) son de este módulo,
 * pero la usa también `economia.ts`: sin ese uso cruzado, una granja adicional, un
 * aserradero o una torre —todos más baratos y evaluados en cuanto se pueden pagar—
 * seguirían ganándole al oro la carrera contra la tropa cada vez que el barracón
 * termina, exactamente el mismo problema que ya resolvió la reserva del campesino,
 * solo que entre dos módulos distintos en vez de dentro de uno solo.
 */
export function costeMinimoTropaDeseada(estado: EstadoBando, fase: FaseIA): number {
  if (!estado.edificiosDisponibles.has(TipoEdificio.BARRACON)) return 0;

  const pesos = MEZCLA_POR_FASE[fase];
  const entrena = fichaEdificio(TipoEdificio.BARRACON).entrena;
  let minimo = Infinity;
  for (let k = 0; k < TIPOS_TROPA.length; k++) {
    if (pesos[k]! <= 0) continue;
    if (!entrena.includes(TIPOS_TROPA[k]!)) continue;
    const coste = fichaUnidad(TIPOS_TROPA[k]!).coste.oro;
    if (coste < minimo) minimo = coste;
  }
  return Number.isFinite(minimo) ? minimo : 0;
}

export class ProduccionIA {
  private readonly barracones: number[] = [];

  paso(mundo: Mundo, bando: Bando, fase: FaseIA): void {
    const estado = mundo.estadoDe(bando);
    this.barracones.length = 0;

    let ayuntamiento = 0;
    let obrerosVivos = 0;
    let poblacionComprometida = estado.poblacion;

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.bando[i] !== bando) continue;
      if (mundo.vida[i] <= 0) continue;

      const clase = mundo.clase[i];
      if (clase === Clase.UNIDAD) {
        if (fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero) obrerosVivos++;
        continue;
      }
      if (clase !== Clase.EDIFICIO) continue;
      if (mundo.progresoObra[i] < 1) continue;

      const tipo = mundo.tipo[i] as TipoEdificio;
      if (tipo === TipoEdificio.AYUNTAMIENTO) {
        if (ayuntamiento === 0) ayuntamiento = i;
      } else if (tipo === TipoEdificio.BARRACON) {
        this.barracones.push(i);
      }

      const cola = mundo.colas.get(i);
      if (cola) {
        for (let q = 0; q < cola.length; q++) {
          poblacionComprometida += fichaUnidad(cola[q]!.tipoUnidad).coste.poblacion;
        }
      }
    }

    // El campesino cuesta oro puro y es el más barato de todo lo que se entrena: sin
    // un freno, se compra en cuanto el oro supera su coste, adelantándose siempre a
    // cualquier cosa más cara que necesite acumular durante más de un pensamiento
    // —el barracón primero, la tropa después—. El freno es el mismo en los dos
    // casos: no tocar el oro mientras no cubra el precio de lo que hay que priorizar
    // ahora mismo. En cuanto ya no hace falta priorizar nada, el freno se levanta
    // solo y el campesino vuelve a competir en igualdad de condiciones.
    let oroReservado = 0;
    if (fase !== FaseIA.ARRANQUE && !estado.edificiosDisponibles.has(TipoEdificio.BARRACON)) {
      oroReservado = fichaEdificio(TipoEdificio.BARRACON).coste.oro;
    }

    // La tropa se intenta ANTES que un campesino más. El objetivo de doce obreros
    // (`OBJETIVO_OBREROS`) es más alto que la población que suele haber libre en
    // este punto de la partida, así que si el campesino se probara primero se
    // quedaría con todo el cupo de población pensamiento tras pensamiento y a la
    // tropa nunca le tocaría sitio, por mucho que el barracón lleve rato en pie.
    const pesos = MEZCLA_POR_FASE[fase];
    for (let b = 0; b < this.barracones.length; b++) {
      poblacionComprometida = this.intentarTropa(
        mundo,
        estado,
        this.barracones[b]!,
        pesos,
        poblacionComprometida,
      );
    }

    // Con el barracón ya en pie, la misma competencia se repite con el oro: el
    // campesino sigue siendo más barato que cualquier tropa (500 el arquero, 600 el
    // soldado…) y seguiría ganándole la carrera al oro pensamiento tras pensamiento
    // si no se reserva también aquí lo que cuesta la tropa más barata de esta fase.
    if (oroReservado === 0) oroReservado = costeMinimoTropaDeseada(estado, fase);

    if (ayuntamiento !== 0) {
      poblacionComprometida = this.intentarCampesino(
        mundo,
        estado,
        ayuntamiento,
        obrerosVivos,
        poblacionComprometida,
        oroReservado,
      );
    }
  }

  private intentarCampesino(
    mundo: Mundo,
    estado: EstadoBando,
    ayuntamiento: number,
    obrerosVivos: number,
    poblacionComprometida: number,
    oroReservado: number,
  ): number {
    if (obrerosVivos >= OBJETIVO_OBREROS) return poblacionComprometida;

    const cola = mundo.colas.get(ayuntamiento);
    if (cola && cola.length >= TOPE_COLA_AYUNTAMIENTO) return poblacionComprometida;

    const ficha = fichaUnidad(TipoUnidad.CAMPESINO);
    if (poblacionComprometida + ficha.coste.poblacion > estado.poblacionMaxima) {
      return poblacionComprometida;
    }
    if (estado.oro < ficha.coste.oro || estado.madera < ficha.coste.madera) {
      return poblacionComprometida;
    }

    // La comprobación es contra lo que quedaría DESPUÉS de comprar, no contra lo que
    // hay ahora: con "oro >= reservado" a secas, el campesino se compra en el mismo
    // instante en que el oro toca el umbral de lo reservado, vaciándolo igual. Da
    // igual qué módulo se ejecute primero ese pensamiento si los dos protegen el
    // suelo de la misma forma: ninguno lo pisa nunca, lo alcance quien lo alcance.
    if (oroReservado > 0 && estado.oro - ficha.coste.oro < oroReservado) {
      return poblacionComprometida;
    }

    if (encolarUnidad(mundo, mundo.entidadDeIndice(ayuntamiento), TipoUnidad.CAMPESINO)) {
      return poblacionComprometida + ficha.coste.poblacion;
    }
    return poblacionComprometida;
  }

  private intentarTropa(
    mundo: Mundo,
    estado: EstadoBando,
    barracon: number,
    pesos: readonly [number, number, number, number],
    poblacionComprometida: number,
  ): number {
    const cola = mundo.colas.get(barracon);
    if (cola && cola.length >= TOPE_COLA_BARRACON) return poblacionComprometida;

    // Se pregunta a la ficha del edificio qué entrena de verdad, en vez de asumir que
    // un barracón siempre da las cuatro tropas: si el árbol tecnológico cambia algún
    // día, este módulo no tiene que enterarse para seguir siendo correcto.
    const entrena = fichaEdificio(mundo.tipo[barracon] as TipoEdificio).entrena;
    const tipo = this.elegirTropa(mundo, pesos, entrena);
    if (tipo === null) return poblacionComprometida;

    const ficha = fichaUnidad(tipo);
    if (poblacionComprometida + ficha.coste.poblacion > estado.poblacionMaxima) {
      return poblacionComprometida;
    }
    if (estado.oro < ficha.coste.oro || estado.madera < ficha.coste.madera) {
      return poblacionComprometida;
    }

    if (encolarUnidad(mundo, mundo.entidadDeIndice(barracon), tipo)) {
      return poblacionComprometida + ficha.coste.poblacion;
    }
    return poblacionComprometida;
  }

  /**
   * Sorteo determinista (usa `mundo.azar`) con las proporciones de la fase actual,
   * restringido a lo que el edificio realmente sabe entrenar.
   */
  private elegirTropa(
    mundo: Mundo,
    pesos: readonly [number, number, number, number],
    entrena: readonly TipoUnidad[],
  ): TipoUnidad | null {
    let total = 0;
    for (let k = 0; k < TIPOS_TROPA.length; k++) {
      if (pesos[k]! <= 0) continue;
      if (!entrena.includes(TIPOS_TROPA[k]!)) continue;
      total += pesos[k]!;
    }
    if (total <= 0) return null;

    let sorteo = mundo.azar.entero(1, total);
    for (let k = 0; k < TIPOS_TROPA.length; k++) {
      const peso = pesos[k]!;
      if (peso <= 0) continue;
      if (!entrena.includes(TIPOS_TROPA[k]!)) continue;
      if (sorteo <= peso) return TIPOS_TROPA[k]!;
      sorteo -= peso;
    }
    return null;
  }
}
