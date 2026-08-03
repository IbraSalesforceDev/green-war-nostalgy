import { distanciaCuadrada } from '../core/math';
import { fichaEdificio } from '../sim/datos/edificios';
import { buscarHuecoParaHuella } from '../sim/fabrica';
import { Mundo } from '../sim/mundo';
import { esObrero, ordenarConstruir, ordenarRecolectar } from '../sim/ordenes';
import {
  Bando,
  Clase,
  type EstadoBando,
  NUM_TIPOS_EDIFICIO,
  Orden,
  TipoEdificio,
  TipoRecurso,
  TipoYacimiento,
} from '../sim/tipos';
import { FaseIA } from './fases';
import { costeMinimoTropaDeseada } from './produccion';

/**
 * Economía de la IA.
 *
 * Dos responsabilidades y nada más: mandar a los obreros libres a recolectar, con el
 * mismo criterio de reparto que usa `SistemaRecoleccion` (preferir el yacimiento más
 * cerca y menos saturado), y decidir cuándo levantar la siguiente pieza económica
 * —granja, barracón, aserradero, torre—.
 *
 * Como mucho una construcción por pensamiento: con un solo obrero de sobra al mes la
 * decisión nunca se acumula, y como el hueco se busca con `mapa.cabeEdificio` en el
 * momento (a través de `buscarHuecoParaHuella`), nunca se ofrece la misma casilla dos
 * veces aunque la obra anterior siga a medias.
 */

// --- Ajustes propios del módulo (no existían en constantes.ts) ---

/** Radio en casillas en el que se buscan vetas y árboles alrededor de la propia base. */
const RADIO_BUSQUEDA_RECURSOS = 24;

/**
 * Radio de último recurso, cuando ni el tipo deseado ni el alternativo aparecen
 * dentro de `RADIO_BUSQUEDA_RECURSOS`. Sin este segundo intento, la primera veta
 * de oro que se agota dentro del radio normal deja a esos obreros varados en madera
 * para siempre —el resto de vetas de oro del mapa pueden estar perfectamente vivas,
 * solo que un poco más lejos de lo que la IA está dispuesta a caminar en el caso
 * común—, y la economía nunca vuelve a generar el oro que le hace falta al
 * ejército. Es mejor mandar al obrero a dar un paseo más largo que dejar secar el
 * único recurso que de verdad decide si hay tropa.
 */
const RADIO_BUSQUEDA_AMPLIADO = 48;

/** Igual que en recolección: penaliza el yacimiento que ya tiene gente encima. */
const PESO_OCUPACION = 3;

/** Por encima de esta ocupación, un yacimiento se descarta aunque le quede reserva. */
const OCUPACION_MAXIMA = 4;

/** Obreros de oro deseados por cada obrero de madera, en régimen normal. */
const RATIO_ORO_MADERA = 2;

/** Margen de población bajo el techo a partir del cual se decide levantar una granja. */
export const MARGEN_POBLACION_GRANJA = 4;

/** Granjas que la IA está dispuesta a mantener en pie a la vez. */
export const MAX_GRANJAS = 6;

/** Campesinos talando por debajo de los cuales no compensa un aserradero. */
export const OBREROS_MADERA_PARA_ASERRADERO = 3;

/** Torres que la IA se plantea mantener en pie a la vez. */
export const TORRES_OBJETIVO = 2;

/** Radio de búsqueda de hueco alrededor del ayuntamiento para cualquier edificio nuevo. */
const RADIO_BUSQUEDA_HUECO = 16;

export class EconomiaIA {
  private readonly idleObreros: number[] = [];
  private readonly enObraPorTipo = new Array<number>(NUM_TIPOS_EDIFICIO).fill(0);
  private readonly terminadosPorTipo = new Array<number>(NUM_TIPOS_EDIFICIO).fill(0);

  // Estado del visitante de búsqueda de yacimiento; evita crear un cierre por consulta.
  private buscadorMundo: Mundo | null = null;
  private buscadorBando: Bando = Bando.NEUTRAL;
  private buscadorTipo: TipoYacimiento = TipoYacimiento.MINA_ORO;
  private buscadorDesdeX = 0;
  private buscadorDesdeZ = 0;
  private mejorYacimiento = 0;
  private mejorPuntuacion = Infinity;
  private readonly visitanteYacimiento: (indice: number) => void;

  constructor() {
    this.visitanteYacimiento = (indice: number): void => this.evaluarYacimiento(indice);
  }

  paso(mundo: Mundo, bando: Bando, fase: FaseIA): void {
    this.idleObreros.length = 0;
    this.enObraPorTipo.fill(0);
    this.terminadosPorTipo.fill(0);

    let ayuntamiento = 0;
    let obrerosOro = 0;
    let obrerosMadera = 0;
    // Si nadie está mano sobre mano, se saca a este de la veta para construir: sin
    // esta válvula, una economía que ya ocupa a todo el mundo en recolectar no
    // podría levantar jamás la granja que le haría falta para poder crecer.
    let obreroOcupadoReasignable = 0;
    // Candidato aparte para el rebalanceo hacia el oro (ver más abajo): puede
    // coincidir con el anterior, así que se revalida antes de usarlo.
    let obreroMaderaReasignable = 0;

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.bando[i] !== bando) continue;
      if (mundo.vida[i] <= 0) continue;

      const clase = mundo.clase[i];
      if (clase === Clase.EDIFICIO) {
        const tipo = mundo.tipo[i] as TipoEdificio;
        if (mundo.progresoObra[i] < 1) {
          this.enObraPorTipo[tipo]!++;
        } else {
          this.terminadosPorTipo[tipo]!++;
          if (tipo === TipoEdificio.AYUNTAMIENTO && ayuntamiento === 0) ayuntamiento = i;
        }
        continue;
      }

      if (clase !== Clase.UNIDAD) continue;
      if (!esObrero(mundo, i)) continue;

      const orden = mundo.orden[i];
      if (orden === Orden.NINGUNA) {
        this.idleObreros.push(i);
      } else if (orden === Orden.RECOLECTAR || orden === Orden.DEVOLVER) {
        // El sistema de recolección ya fijó cargaTipo en cuanto asignó el yacimiento.
        if (mundo.cargaTipo[i] === TipoRecurso.MADERA) obrerosMadera++;
        else obrerosOro++;
        // Solo se ofrece como reasignable el que aún no ha recogido carga: sacarlo a
        // medio camino con las manos llenas tiraría el viaje que ya ha hecho.
        if (obreroOcupadoReasignable === 0 && mundo.cargaCantidad[i] <= 0) {
          obreroOcupadoReasignable = i;
        }
        if (
          obreroMaderaReasignable === 0 &&
          mundo.cargaTipo[i] === TipoRecurso.MADERA &&
          mundo.cargaCantidad[i] <= 0
        ) {
          obreroMaderaReasignable = i;
        }
      }
    }

    if (ayuntamiento === 0) return; // sin ayuntamiento en pie no hay nada que decidir.

    let siguiente = 0;
    const obreroParaObra = this.idleObreros.length > 0 ? this.idleObreros[0]! : obreroOcupadoReasignable;
    if (obreroParaObra !== 0) {
      const tipoAConstruir = this.decidirConstruccion(mundo, bando, fase, obrerosMadera);
      if (tipoAConstruir !== null) {
        this.construir(mundo, bando, obreroParaObra, tipoAConstruir, ayuntamiento);
        if (this.idleObreros.length > 0) siguiente = 1;
      }
    }

    for (let k = siguiente; k < this.idleObreros.length; k++) {
      const i = this.idleObreros[k]!;
      const deseado =
        obrerosMadera === 0 || obrerosOro >= obrerosMadera * RATIO_ORO_MADERA
          ? TipoYacimiento.ARBOL
          : TipoYacimiento.MINA_ORO;
      const asignado = this.asignarRecoleccion(mundo, bando, i, deseado);
      if (asignado === TipoYacimiento.ARBOL) obrerosMadera++;
      else if (asignado === TipoYacimiento.MINA_ORO) obrerosOro++;
    }

    // La reasignación de arriba solo alcanza a quien acaba de quedarse ocioso: si la
    // veta de oro más cercana se agotó una vez y la de repuesto quedó fuera del
    // radio de búsqueda de aquel momento, esos obreros se acomodan en la madera para
    // siempre, porque nadie vuelve a proponerles otra cosa. El resultado es una
    // economía que no vuelve a ver un gramo de oro nuevo aunque el mapa tenga vetas
    // de sobra un poco más lejos —justo lo que le impide a la IA pagar jamás la
    // siguiente tropa—. Aquí se corrige el desajuste una vez que ya se sabe seguro,
    // y no solo en el caso extremo de quedarse a cero: mientras la madera siga
    // claramente por encima de lo que pide `RATIO_ORO_MADERA`, cada pensamiento se
    // recupera un obrero más (el que no lleve carga a medias), buscando desde el
    // ayuntamiento y con el radio ampliado desde el principio. Frenarlo solo cuando
    // el oro llega a cero dejaba la economía coja en una proporción de 1 a 4 para
    // siempre en vez de volver a acercarse a la que de verdad hace falta.
    if (
      obrerosMadera > 1 &&
      obrerosOro < obrerosMadera * RATIO_ORO_MADERA &&
      obreroMaderaReasignable !== 0
    ) {
      const candidato = obreroMaderaReasignable;
      const sigueDisponible =
        mundo.orden[candidato] === Orden.RECOLECTAR || mundo.orden[candidato] === Orden.DEVOLVER;
      if (sigueDisponible && mundo.cargaTipo[candidato] === TipoRecurso.MADERA) {
        const y = this.buscarYacimiento(
          mundo,
          bando,
          mundo.x[ayuntamiento]!,
          mundo.z[ayuntamiento]!,
          TipoYacimiento.MINA_ORO,
          RADIO_BUSQUEDA_AMPLIADO,
        );
        if (y !== 0) {
          const entidad = mundo.entidadDeIndice(candidato);
          const yacimiento = mundo.entidadDeIndice(y);
          ordenarRecolectar(mundo, [entidad], yacimiento, bando);
        }
      }
    }
  }

  // --- Construcción ---

  private decidirConstruccion(
    mundo: Mundo,
    bando: Bando,
    fase: FaseIA,
    obrerosMadera: number,
  ): TipoEdificio | null {
    const estado = mundo.estadoDe(bando);

    // La granja no espera a ninguna fase: la población apretando es la primera crisis
    // que sufre cualquier economía, arranque o no. Pero solo la primera es de verdad
    // urgente: el ayuntamiento agota su propio cupo con los campesinos iniciales, así
    // que sin una granja no hay ni un obrero más que entrenar. Las siguientes
    // compiten con el barracón como cualquier otra obra, o la IA se pasaría toda la
    // partida ensanchando el límite de población sin levantar jamás un ejército.
    const granjasTotales =
      this.enObraPorTipo[TipoEdificio.GRANJA]! + this.terminadosPorTipo[TipoEdificio.GRANJA]!;

    if (
      granjasTotales === 0 &&
      estado.poblacionMaxima - estado.poblacion <= MARGEN_POBLACION_GRANJA &&
      this.puedePagar(estado, TipoEdificio.GRANJA)
    ) {
      return TipoEdificio.GRANJA;
    }

    if (fase === FaseIA.ARRANQUE) return null;

    // El barracón es una puerta, no una prioridad más en la cola: mientras no exista,
    // ninguna otra obra compite por el oro y la madera. Con las cuatro casillas
    // sueltas (barracón, segunda granja, aserradero, torre) evaluándose por "¿me lo
    // puedo permitir ya?", la obra más barata siempre se cuela delante y el barracón
    // —el más caro, el único que de verdad decide si hay ejército— no se paga jamás.
    // Una vez en pie, el resto de la economía vuelve a competir con libertad.
    const barraconListo = estado.edificiosDisponibles.has(TipoEdificio.BARRACON);
    if (!barraconListo) {
      if (
        this.enObraPorTipo[TipoEdificio.BARRACON] === 0 &&
        this.puedePagar(estado, TipoEdificio.BARRACON)
      ) {
        return TipoEdificio.BARRACON;
      }
      return null;
    }

    // El mismo principio, ahora entre módulos: con el barracón ya en pie, una
    // segunda granja, un aserradero o una torre son más baratos que cualquier tropa
    // y `puedePagar` los deja pasar en cuanto llega el oro justo, adelantándose al
    // soldado que debería salir del barracón. La comprobación es contra lo que
    // quedaría DESPUÉS de construir, no contra el oro actual: con "oro >= reserva" a
    // secas, la obra se paga en el mismo instante en que el oro toca el umbral,
    // vaciándolo igual que si no hubiera reserva. Da igual que `economia` se
    // ejecute antes que `produccion` ese mismo pensamiento si los dos protegen el
    // suelo de la misma forma: ninguno lo pisa nunca, lo alcance quien lo alcance.
    //
    // La segunda granja en adelante queda fuera de esta reserva a propósito: no
    // compite con la tropa, la HABILITA. Bloquearla igual que al aserradero o a la
    // torre encierra a la IA en el mismo techo de población para siempre —tres
    // arqueros y ni uno más, por mucho oro que se acumule— porque nunca llega a
    // construirse la granja que abriría sitio para el resto del ejército.
    if (
      granjasTotales > 0 &&
      granjasTotales < MAX_GRANJAS &&
      this.enObraPorTipo[TipoEdificio.GRANJA] === 0 &&
      estado.poblacionMaxima < estado.limitePoblacion &&
      estado.poblacionMaxima - estado.poblacion <= MARGEN_POBLACION_GRANJA &&
      this.puedePagar(estado, TipoEdificio.GRANJA)
    ) {
      return TipoEdificio.GRANJA;
    }

    const reservaTropa = costeMinimoTropaDeseada(estado, fase);

    if (
      this.terminadosPorTipo[TipoEdificio.ASERRADERO] === 0 &&
      this.enObraPorTipo[TipoEdificio.ASERRADERO] === 0 &&
      obrerosMadera >= OBREROS_MADERA_PARA_ASERRADERO &&
      this.puedePagarConReserva(estado, TipoEdificio.ASERRADERO, reservaTropa)
    ) {
      return TipoEdificio.ASERRADERO;
    }

    if (
      (fase === FaseIA.MILICIA || fase === FaseIA.ASALTO) &&
      this.enObraPorTipo[TipoEdificio.TORRE] === 0 &&
      this.terminadosPorTipo[TipoEdificio.TORRE]! < TORRES_OBJETIVO &&
      this.puedePagarConReserva(estado, TipoEdificio.TORRE, reservaTropa)
    ) {
      return TipoEdificio.TORRE;
    }

    return null;
  }

  private puedePagar(estado: EstadoBando, tipo: TipoEdificio): boolean {
    const coste = fichaEdificio(tipo).coste;
    return estado.oro >= coste.oro && estado.madera >= coste.madera;
  }

  /** Como `puedePagar`, pero exigiendo que sobre `reservaOro` de oro después de pagar. */
  private puedePagarConReserva(
    estado: EstadoBando,
    tipo: TipoEdificio,
    reservaOro: number,
  ): boolean {
    const coste = fichaEdificio(tipo).coste;
    return estado.oro - coste.oro >= reservaOro && estado.madera >= coste.madera;
  }

  private construir(
    mundo: Mundo,
    bando: Bando,
    obrero: number,
    tipo: TipoEdificio,
    ayuntamiento: number,
  ): void {
    const lado = fichaEdificio(tipo).huella;
    const sitio = buscarHuecoParaHuella(
      mundo.mapa,
      mundo.casillaX[ayuntamiento]!,
      mundo.casillaZ[ayuntamiento]!,
      lado,
      RADIO_BUSQUEDA_HUECO,
    );
    if (!sitio) return;
    ordenarConstruir(mundo, [mundo.entidadDeIndice(obrero)], tipo, sitio[0], sitio[1], bando);
  }

  // --- Recolección ---

  private asignarRecoleccion(
    mundo: Mundo,
    bando: Bando,
    i: number,
    deseado: TipoYacimiento,
  ): TipoYacimiento | null {
    const alternativo =
      deseado === TipoYacimiento.MINA_ORO ? TipoYacimiento.ARBOL : TipoYacimiento.MINA_ORO;

    let tipoFinal = deseado;
    let y = this.buscarYacimiento(mundo, bando, mundo.x[i]!, mundo.z[i]!, deseado, RADIO_BUSQUEDA_RECURSOS);
    if (y === 0) {
      tipoFinal = alternativo;
      y = this.buscarYacimiento(mundo, bando, mundo.x[i]!, mundo.z[i]!, tipoFinal, RADIO_BUSQUEDA_RECURSOS);
    }
    if (y === 0) {
      tipoFinal = deseado;
      y = this.buscarYacimiento(mundo, bando, mundo.x[i]!, mundo.z[i]!, deseado, RADIO_BUSQUEDA_AMPLIADO);
    }
    if (y === 0) {
      tipoFinal = alternativo;
      y = this.buscarYacimiento(mundo, bando, mundo.x[i]!, mundo.z[i]!, tipoFinal, RADIO_BUSQUEDA_AMPLIADO);
    }
    if (y === 0) return null;

    const entidad = mundo.entidadDeIndice(i);
    const yacimiento = mundo.entidadDeIndice(y);
    if (ordenarRecolectar(mundo, [entidad], yacimiento, bando) > 0) return tipoFinal;
    return null;
  }

  private buscarYacimiento(
    mundo: Mundo,
    bando: Bando,
    desdeX: number,
    desdeZ: number,
    tipo: TipoYacimiento,
    radio: number,
  ): number {
    this.buscadorMundo = mundo;
    this.buscadorBando = bando;
    this.buscadorTipo = tipo;
    this.buscadorDesdeX = desdeX;
    this.buscadorDesdeZ = desdeZ;
    this.mejorYacimiento = 0;
    this.mejorPuntuacion = Infinity;

    mundo.consultarRadio(desdeX, desdeZ, radio, this.visitanteYacimiento);
    return this.mejorYacimiento;
  }

  private evaluarYacimiento(j: number): void {
    const mundo = this.buscadorMundo!;
    if (mundo.clase[j] !== Clase.YACIMIENTO) return;
    if (mundo.tipo[j] !== this.buscadorTipo) return;
    if (mundo.reserva[j] <= 0) return;
    if (mundo.ocupacionYacimiento[j]! >= OCUPACION_MAXIMA) return;

    const cx = mundo.casillaX[j]!;
    const cz = mundo.casillaZ[j]!;
    // Sin trampas: un yacimiento solo cuenta si el propio bando lo ha visto alguna vez.
    if (!mundo.mapa.esExplorado(this.buscadorBando, cx, cz)) return;

    const distancia = Math.sqrt(
      distanciaCuadrada(this.buscadorDesdeX, this.buscadorDesdeZ, mundo.x[j]!, mundo.z[j]!),
    );
    const puntuacion = distancia + mundo.ocupacionYacimiento[j]! * PESO_OCUPACION;
    if (
      puntuacion < this.mejorPuntuacion ||
      (puntuacion === this.mejorPuntuacion && j < this.mejorYacimiento)
    ) {
      this.mejorPuntuacion = puntuacion;
      this.mejorYacimiento = j;
    }
  }
}
