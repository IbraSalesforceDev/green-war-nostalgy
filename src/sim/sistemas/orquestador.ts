import { BusEventos, bus as busGlobal } from '../../core/events';
import { registrarFrenoMovimiento } from '../ordenes';
import { Mundo } from '../mundo';
import type { BuscadorRutas } from '../rutas/contrato';
import { BANDOS_JUGABLES, Bando, Clase, NUM_BANDOS } from '../tipos';
import { SistemaCombate } from './combate';
import { SistemaConstruccion, registrarInvalidadorDeRutas } from './construccion';
import { SistemaMovimiento } from './movimiento';
import { SistemaNiebla } from './niebla';
import { SistemaProduccion } from './produccion';
import { SistemaRecoleccion } from './recoleccion';

/**
 * Orquestador de la simulación.
 *
 * Es el único punto de entrada del juego: `new Simulacion(mundo, buscador)` y luego
 * `paso(dt)` una vez por tick. Nadie de fuera llama a un sistema concreto.
 *
 * El orden de los sistemas dentro del tick no es negociable, y esta es la razón de cada
 * escalón:
 *
 *  1. `archivarTransformaciones` — guarda las posiciones del tick anterior para que el
 *     render interpole. Tiene que ser lo primero, antes de que nada se mueva.
 *  2. cronómetros de estado — las animaciones necesitan saber cuánto lleva cada entidad
 *     haciendo lo que hace.
 *  3. rejilla espacial — todas las consultas de proximidad que vienen después dependen
 *     de que esté al día.
 *  4. niebla — antes que la IA y la interfaz, para que lo que se decida este tick se
 *     decida con la visibilidad de este tick.
 *  5. producción, construcción, recolección — la economía. Van antes que el combate
 *     porque una unidad que sale del barracón debe poder defenderse el mismo tick.
 *  6. combate — decide objetivos y pide acercamientos.
 *  7. buscador de rutas y movimiento — resuelven todas las peticiones acumuladas por los
 *     sistemas anteriores. Van al final para que ninguna orden espere un tick entero.
 *  8. limpieza de cadáveres y comprobación de fin de partida.
 */

export interface EstadisticasBando {
  bando: Bando;
  oro: number;
  madera: number;
  poblacion: number;
  poblacionMaxima: number;
  unidades: number;
  edificios: number;
  obras: number;
  derrotado: boolean;
}

export interface EstadisticasSimulacion {
  tick: number;
  entidades: number;
  unidades: number;
  edificios: number;
  yacimientos: number;
  terminada: boolean;
  ganador: Bando;
  rutas: { pendientes: number; calculadasEsteTick: number; nodosExplorados: number };
  bandos: EstadisticasBando[];
}

export class Simulacion {
  readonly mundo: Mundo;
  readonly buscador: BuscadorRutas;
  readonly bus: BusEventos;

  readonly movimiento: SistemaMovimiento;
  readonly niebla: SistemaNiebla;
  readonly produccion: SistemaProduccion;
  readonly construccion: SistemaConstruccion;
  readonly recoleccion: SistemaRecoleccion;
  readonly combate: SistemaCombate;

  /** Verdadero en cuanto se ha emitido `finPartida`. */
  terminada = false;
  ganador: Bando = Bando.NEUTRAL;

  /** Bandos que en algún momento han tenido algo en el mapa. */
  private readonly haExistido = new Uint8Array(NUM_BANDOS);

  private readonly estadisticasCache: EstadisticasSimulacion;

  constructor(mundo: Mundo, buscador: BuscadorRutas, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.buscador = buscador;
    this.bus = bus;

    this.movimiento = new SistemaMovimiento(mundo, buscador);
    this.niebla = new SistemaNiebla(mundo, bus);
    this.produccion = new SistemaProduccion(mundo, bus);
    this.construccion = new SistemaConstruccion(mundo, this.movimiento, buscador, bus);
    this.recoleccion = new SistemaRecoleccion(mundo, this.movimiento, bus);
    this.combate = new SistemaCombate(mundo, this.movimiento, bus);

    // Enganches de los módulos que no reciben dependencias por constructor.
    registrarFrenoMovimiento(this.movimiento);
    registrarInvalidadorDeRutas(buscador);

    this.estadisticasCache = {
      tick: 0,
      entidades: 0,
      unidades: 0,
      edificios: 0,
      yacimientos: 0,
      terminada: false,
      ganador: Bando.NEUTRAL,
      rutas: { pendientes: 0, calculadasEsteTick: 0, nodosExplorados: 0 },
      bandos: [],
    };
    for (let b = 0; b < NUM_BANDOS; b++) {
      this.estadisticasCache.bandos.push({
        bando: b as Bando,
        oro: 0,
        madera: 0,
        poblacion: 0,
        poblacionMaxima: 0,
        unidades: 0,
        edificios: 0,
        obras: 0,
        derrotado: false,
      });
    }
  }

  /** Un tick completo de simulación. `dt` es el paso fijo (ver `PASO_SIMULACION`). */
  paso(dt: number): void {
    const mundo = this.mundo;

    mundo.tick++;
    mundo.archivarTransformaciones();
    this.avanzarCronometros(dt);
    mundo.reconstruirEspacial();

    this.niebla.paso();
    this.produccion.paso(dt);
    this.construccion.paso(dt);
    this.recoleccion.paso(dt);
    this.combate.paso(dt);

    this.buscador.actualizar(mundo.tick);
    this.movimiento.paso(dt);

    this.combate.limpiarCadaveres();
    this.comprobarFinPartida();
  }

  /**
   * Cronómetro de estado de cada entidad.
   * Vive aquí y no en cada sistema porque el estado lo cambian cinco sistemas
   * distintos y ninguno debería tener que acordarse de mover el reloj.
   */
  private avanzarCronometros(dt: number): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      mundo.tiempoEstado[i] += dt;
    }
  }

  /**
   * Fin por aniquilación: un bando pierde cuando no le queda nada en el mapa. Solo se
   * considera derrotado quien alguna vez tuvo algo, para que un mundo recién creado o
   * un escenario de prueba no declare vencedor en el primer tick.
   */
  private comprobarFinPartida(): void {
    if (this.terminada) return;
    const mundo = this.mundo;

    const unidades = [0, 0, 0];
    const edificios = [0, 0, 0];

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.vida[i] <= 0) continue;
      const bando = mundo.bando[i];
      if (bando === Bando.NEUTRAL) continue;
      if (mundo.clase[i] === Clase.UNIDAD) unidades[bando]!++;
      else if (mundo.clase[i] === Clase.EDIFICIO) edificios[bando]!++;
    }

    let vivos = 0;
    let ultimoVivo: Bando = Bando.NEUTRAL;

    for (let k = 0; k < BANDOS_JUGABLES.length; k++) {
      const bando = BANDOS_JUGABLES[k]!;
      const estado = mundo.estadoDe(bando);
      const presencia = unidades[bando]! + edificios[bando]!;
      if (presencia > 0) this.haExistido[bando] = 1;
      else if (this.haExistido[bando] === 1) estado.derrotado = true;

      if (!estado.derrotado && this.haExistido[bando] === 1) {
        vivos++;
        ultimoVivo = bando;
      }
    }

    if (vivos === 1) {
      this.terminada = true;
      this.ganador = ultimoVivo;
      this.bus.emitir('finPartida', { ganador: ultimoVivo, motivo: 'aniquilacion' });
    } else if (vivos === 0 && this.haExistido[Bando.HUMANOS] === 1) {
      // Todos muertos a la vez: empate, sin ganador.
      this.terminada = true;
      this.ganador = Bando.NEUTRAL;
      this.bus.emitir('finPartida', { ganador: Bando.NEUTRAL, motivo: 'aniquilacion' });
    }
  }

  /**
   * Foto del estado para el panel de depuración y la interfaz.
   * Reutiliza siempre el mismo objeto: llamarla cada fotograma no debe generar basura.
   */
  estadisticas(): EstadisticasSimulacion {
    const mundo = this.mundo;
    const salida = this.estadisticasCache;

    salida.tick = mundo.tick;
    salida.entidades = 0;
    salida.unidades = 0;
    salida.edificios = 0;
    salida.yacimientos = 0;
    salida.terminada = this.terminada;
    salida.ganador = this.ganador;

    for (let b = 0; b < NUM_BANDOS; b++) {
      const fila = salida.bandos[b]!;
      const estado = mundo.estadoDe(b as Bando);
      fila.oro = estado.oro;
      fila.madera = estado.madera;
      fila.poblacion = estado.poblacion;
      fila.poblacionMaxima = estado.poblacionMaxima;
      fila.derrotado = estado.derrotado;
      fila.unidades = 0;
      fila.edificios = 0;
      fila.obras = 0;
    }

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      salida.entidades++;
      const clase = mundo.clase[i];
      const fila = salida.bandos[mundo.bando[i]]!;
      if (clase === Clase.UNIDAD) {
        salida.unidades++;
        if (mundo.vida[i] > 0) fila.unidades++;
      } else if (clase === Clase.EDIFICIO) {
        salida.edificios++;
        if (mundo.progresoObra[i] < 1) fila.obras++;
        else fila.edificios++;
      } else if (clase === Clase.YACIMIENTO) {
        salida.yacimientos++;
      }
    }

    const rutas = this.buscador.estadisticas();
    salida.rutas.pendientes = rutas.pendientes;
    salida.rutas.calculadasEsteTick = rutas.calculadasEsteTick;
    salida.rutas.nodosExplorados = rutas.nodosExplorados;

    return salida;
  }
}
