import { BusEventos, bus as busGlobal } from '../../core/events';
import { distanciaCuadrada } from '../../core/math';
import {
  DURACION_CADAVER,
  INTERVALO_BUSQUEDA_OBJETIVO,
  MAX_PERSECUCION,
  MULT_CRITICO,
  PROB_CRITICO,
  RADIO_AGRESION,
  TOLERANCIA_DESTINO,
  VELOCIDAD_FLECHA,
  VELOCIDAD_LANZA,
  VELOCIDAD_ROCA,
} from '../constantes';
import { fichaUnidad } from '../datos/unidades';
import { liberarYacimientoMemorizado, retirarEntidad } from '../fabrica';
import { Mundo } from '../mundo';
import {
  Bando,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoArmadura,
  TipoDanio,
  TipoUnidad,
  indiceDe,
  multiplicadorDanio,
} from '../tipos';
import { invalidarRutasEn } from './construccion';
import type { SistemaMovimiento } from './movimiento';

/**
 * Sistema de combate.
 *
 * Cubre las cuatro cosas que hacen que una pelea de RTS se sienta bien: buscar blanco
 * sola cuando la unidad está ociosa, acercarse hasta el alcance justo, pegar al ritmo
 * de su cadencia y morir de forma legible.
 *
 * Sobre el daño: el tipo de daño contra el tipo de armadura sale de `TABLA_DANIO`, y la
 * armadura numérica reduce en porcentaje, no en resta plana. La resta plana es la
 * tradicional, pero con edificios de armadura 20 haría que un soldado no pudiera
 * rascarle la pintura a una granja ni en diez minutos; el porcentaje mantiene el
 * triángulo táctico sin volver absurdo el cuerpo a cuerpo contra estructuras.
 */

// --- Ajustes propios del sistema (no existían en constantes.ts) ---

/**
 * Constante de saturación de la armadura: reduce un `a / (a + K)` del daño.
 * Con K = 30, una armadura de 2 quita el 6 % y una de 20 el 40 %.
 */
export const SATURACION_ARMADURA = 30;

/** Nadie hace menos de esto de daño, por mala que sea la matchup. */
export const DANIO_MINIMO = 1;

/** Margen que se descuenta del alcance al pedir el acercamiento, para no quedarse corto. */
export const MARGEN_ACERCAMIENTO = 0.25;

/** Cuánto se tiene que mover el objetivo para volver a pedir ruta, en casillas. */
export const UMBRAL_REPERSECUCION = 0.8;

/** Proyectiles en vuelo simultáneos. Pasado el tope, el disparo pega al instante. */
export const MAX_PROYECTILES = 256;

// --- Cálculo del daño ---

/**
 * Daño final que recibe un objetivo. Función pura a propósito: es el número que más se
 * mira al equilibrar el juego y tiene que poder probarse sin montar un mundo entero.
 */
export function calcularDanio(
  bruto: number,
  tipoDanio: TipoDanio,
  tipoArmadura: TipoArmadura,
  armadura: number,
): number {
  const conTabla = bruto * multiplicadorDanio(tipoDanio, tipoArmadura);
  const reduccion = armadura > 0 ? armadura / (armadura + SATURACION_ARMADURA) : 0;
  const final = conTabla * (1 - reduccion);
  return final < DANIO_MINIMO ? DANIO_MINIMO : final;
}

function velocidadProyectil(tipo: 'flecha' | 'lanza' | 'roca'): number {
  if (tipo === 'flecha') return VELOCIDAD_FLECHA;
  if (tipo === 'lanza') return VELOCIDAD_LANZA;
  return VELOCIDAD_ROCA;
}

// --- Sistema ---

export class SistemaCombate {
  readonly mundo: Mundo;
  readonly movimiento: SistemaMovimiento;
  readonly bus: BusEventos;

  // Proyectiles en vuelo, en arrays paralelos como todo lo demás.
  private readonly proyActivo = new Uint8Array(MAX_PROYECTILES);
  private readonly proyX = new Float32Array(MAX_PROYECTILES);
  private readonly proyZ = new Float32Array(MAX_PROYECTILES);
  private readonly proyVelocidad = new Float32Array(MAX_PROYECTILES);
  private readonly proyDanio = new Float32Array(MAX_PROYECTILES);
  private readonly proyTipoDanio = new Uint8Array(MAX_PROYECTILES);
  private readonly proyCritico = new Uint8Array(MAX_PROYECTILES);
  private readonly proyObjetivo = new Int32Array(MAX_PROYECTILES);
  private readonly proyAtacante = new Int32Array(MAX_PROYECTILES);
  private siguienteProyectil = 0;

  constructor(mundo: Mundo, movimiento: SistemaMovimiento, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.movimiento = movimiento;
    this.bus = bus;
  }

  paso(dt: number): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.vida[i] <= 0) continue;
      const clase = mundo.clase[i];
      if (clase === Clase.UNIDAD) this.atenderUnidad(i, dt);
      else if (clase === Clase.EDIFICIO) this.atenderTorre(i, dt);
    }
    this.avanzarProyectiles(dt);
  }

  /** Cadáveres que ya han cumplido su tiempo en el suelo. Lo llama el orquestador. */
  limpiarCadaveres(): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.vida[i] > 0) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (mundo.tiempoEstado[i] < DURACION_CADAVER) continue;
      this.movimiento.olvidar(i);
      retirarEntidad(mundo, i);
    }
  }

  // --- Unidades ---

  private atenderUnidad(i: number, dt: number): void {
    const mundo = this.mundo;
    if (mundo.estado[i] === EstadoUnidad.MURIENDO) return;
    if (mundo.enfriamientoAtaque[i] > 0) mundo.enfriamientoAtaque[i] -= dt;

    const orden = mundo.orden[i];
    let objetivo = mundo.objetivoActual[i] as Entidad;

    // 1. Una orden expresa de atacar manda sobre cualquier objetivo adquirido solo.
    if (orden === Orden.ATACAR) {
      const ordenado = mundo.ordenObjetivo[i] as Entidad;
      if (mundo.esObjetivoValido(i, ordenado)) {
        objetivo = ordenado;
      } else {
        mundo.orden[i] = Orden.NINGUNA;
        mundo.ordenObjetivo[i] = ENTIDAD_NULA;
        objetivo = ENTIDAD_NULA;
      }
    }

    // 2. El objetivo que traía puede haber muerto o haber caducado su generación.
    if (objetivo !== ENTIDAD_NULA && !mundo.esObjetivoValido(i, objetivo)) {
      objetivo = ENTIDAD_NULA;
    }

    // 3. Correa: nadie persigue hasta el fin del mundo salvo por orden expresa.
    if (objetivo !== ENTIDAD_NULA && orden !== Orden.ATACAR) {
      const j = indiceDe(objetivo);
      const lejos = distanciaCuadrada(mundo.anclaX[i], mundo.anclaZ[i], mundo.x[j], mundo.z[j]);
      if (lejos > MAX_PERSECUCION * MAX_PERSECUCION) objetivo = ENTIDAD_NULA;
    }

    // 4. Adquisición por cuenta propia, repartida entre ticks.
    if (objetivo === ENTIDAD_NULA && this.puedeAdquirir(i) && this.tocaBuscar(i)) {
      const candidato = mundo.enemigoMasCercano(i, RADIO_AGRESION);
      if (candidato !== 0) objetivo = mundo.entidadDeIndice(candidato);
    }

    mundo.objetivoActual[i] = objetivo;

    if (objetivo === ENTIDAD_NULA) {
      if (mundo.estado[i] === EstadoUnidad.ATACANDO) {
        mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
      }
      return;
    }

    const j = indiceDe(objetivo);
    if (mundo.distanciaEntreBordes(i, j) <= mundo.alcance[i]) {
      this.movimiento.detener(i);
      mundo.angulo[i] = Math.atan2(mundo.x[j] - mundo.x[i], mundo.z[j] - mundo.z[i]);
      mundo.cambiarEstado(i, EstadoUnidad.ATACANDO);
      if (mundo.enfriamientoAtaque[i] <= 0 && mundo.danioMax[i] > 0) {
        this.golpear(i, j);
        mundo.enfriamientoAtaque[i] = mundo.cadencia[i];
      }
      return;
    }

    // Fuera de alcance: quien mantiene la posición no da un paso, suelta el blanco.
    if (orden === Orden.MANTENER_POSICION) {
      mundo.objetivoActual[i] = ENTIDAD_NULA;
      if (mundo.estado[i] === EstadoUnidad.ATACANDO) {
        mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
      }
      return;
    }

    this.perseguir(i, j);
  }

  /**
   * Pide acercamiento solo cuando hace falta.
   * Volver a pedir ruta cada tick porque el enemigo se ha movido diez centímetros
   * ahogaría al buscador de caminos; con un umbral, una persecución cuesta unas pocas
   * búsquedas en vez de veinte por segundo.
   */
  private perseguir(i: number, j: number): void {
    const mundo = this.mundo;
    const tolerancia = Math.max(
      TOLERANCIA_DESTINO,
      mundo.alcance[i] + mundo.radio[i] + mundo.radio[j] - MARGEN_ACERCAMIENTO,
    );

    const desvio = distanciaCuadrada(
      this.movimiento.destinoX(i),
      this.movimiento.destinoZ(i),
      mundo.x[j],
      mundo.z[j],
    );
    if (!this.movimiento.estaActivo(i) || desvio > UMBRAL_REPERSECUCION * UMBRAL_REPERSECUCION) {
      this.movimiento.solicitarMovimiento(i, mundo.x[j], mundo.z[j], tolerancia);
    }

    if (this.movimiento.haFallado(i)) {
      mundo.objetivoActual[i] = ENTIDAD_NULA;
      if (mundo.orden[i] === Orden.ATACAR) {
        mundo.orden[i] = Orden.NINGUNA;
        mundo.ordenObjetivo[i] = ENTIDAD_NULA;
      }
    }
  }

  /** ¿Puede esta unidad entrar en combate por su cuenta? */
  private puedeAdquirir(i: number): boolean {
    const mundo = this.mundo;
    if (mundo.danioMax[i] <= 0) return false;
    // Los obreros no dejan el pico para salir a pelear: es lo que espera el jugador.
    if (fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero) return false;
    const orden = mundo.orden[i];
    return (
      orden === Orden.NINGUNA ||
      orden === Orden.MANTENER_POSICION ||
      orden === Orden.ATACAR_MOVER ||
      orden === Orden.PATRULLAR
    );
  }

  /** Reparte las búsquedas entre ticks: nunca todas las unidades el mismo. */
  private tocaBuscar(i: number): boolean {
    return (this.mundo.tick + i) % INTERVALO_BUSQUEDA_OBJETIVO === 0;
  }

  // --- Torres ---

  private atenderTorre(i: number, dt: number): void {
    const mundo = this.mundo;
    if (mundo.alcance[i] <= 0 || mundo.danioMax[i] <= 0) return;
    if (mundo.progresoObra[i] < 1) return;
    if (mundo.enfriamientoAtaque[i] > 0) mundo.enfriamientoAtaque[i] -= dt;

    let objetivo = mundo.objetivoActual[i] as Entidad;
    if (objetivo !== ENTIDAD_NULA && !mundo.esObjetivoValido(i, objetivo)) {
      objetivo = ENTIDAD_NULA;
    }
    if (objetivo !== ENTIDAD_NULA) {
      const j = indiceDe(objetivo);
      if (mundo.distanciaEntreBordes(i, j) > mundo.alcance[i]) objetivo = ENTIDAD_NULA;
    }
    if (objetivo === ENTIDAD_NULA && this.tocaBuscar(i)) {
      const candidato = mundo.enemigoMasCercano(i, mundo.alcance[i] + mundo.radio[i]);
      if (candidato !== 0) objetivo = mundo.entidadDeIndice(candidato);
    }

    mundo.objetivoActual[i] = objetivo;
    if (objetivo === ENTIDAD_NULA) return;

    const j = indiceDe(objetivo);
    if (mundo.distanciaEntreBordes(i, j) > mundo.alcance[i]) return;
    if (mundo.enfriamientoAtaque[i] > 0) return;

    this.golpear(i, j);
    mundo.enfriamientoAtaque[i] = mundo.cadencia[i];
  }

  // --- Golpes ---

  private golpear(i: number, j: number): void {
    const mundo = this.mundo;
    const base = mundo.azar.rango(mundo.danioMin[i], mundo.danioMax[i]);
    const critico = mundo.azar.probabilidad(PROB_CRITICO);
    const bruto = critico ? base * MULT_CRITICO : base;
    const tipoDanio = mundo.tipoDanio[i] as TipoDanio;

    const proyectil = this.proyectilDe(i);
    if (proyectil) {
      this.lanzarProyectil(i, j, bruto, tipoDanio, critico, proyectil);
      return;
    }

    this.aplicarGolpe(mundo.entidadDeIndice(i), j, bruto, tipoDanio, critico);
  }

  private proyectilDe(i: number): 'flecha' | 'lanza' | 'roca' | null {
    const mundo = this.mundo;
    if (mundo.clase[i] === Clase.UNIDAD) {
      return fichaUnidad(mundo.tipo[i] as TipoUnidad).proyectil;
    }
    // Las torres disparan saetas; es lo único que dispara entre los edificios.
    return mundo.alcance[i] > 0 ? 'flecha' : null;
  }

  private lanzarProyectil(
    i: number,
    j: number,
    bruto: number,
    tipoDanio: TipoDanio,
    critico: boolean,
    tipo: 'flecha' | 'lanza' | 'roca',
  ): void {
    const mundo = this.mundo;
    const velocidad = velocidadProyectil(tipo);

    const ranura = this.reservarProyectil();
    if (ranura < 0) {
      // Sin ranuras libres el disparo se resuelve en el acto: mejor eso que perderlo.
      this.aplicarGolpe(mundo.entidadDeIndice(i), j, bruto, tipoDanio, critico);
      return;
    }

    this.proyActivo[ranura] = 1;
    this.proyX[ranura] = mundo.x[i];
    this.proyZ[ranura] = mundo.z[i];
    this.proyVelocidad[ranura] = velocidad;
    this.proyDanio[ranura] = bruto;
    this.proyTipoDanio[ranura] = tipoDanio;
    this.proyCritico[ranura] = critico ? 1 : 0;
    this.proyObjetivo[ranura] = mundo.entidadDeIndice(j);
    this.proyAtacante[ranura] = mundo.entidadDeIndice(i);

    this.bus.emitir('proyectil', {
      origenX: mundo.x[i],
      origenZ: mundo.z[i],
      origenY: mundo.alturaDe(i) + mundo.radio[i] + 0.6,
      destino: mundo.entidadDeIndice(j),
      tipo,
      velocidad,
    });
  }

  private reservarProyectil(): number {
    for (let k = 0; k < MAX_PROYECTILES; k++) {
      const ranura = (this.siguienteProyectil + k) % MAX_PROYECTILES;
      if (this.proyActivo[ranura] === 0) {
        this.siguienteProyectil = (ranura + 1) % MAX_PROYECTILES;
        return ranura;
      }
    }
    return -1;
  }

  private avanzarProyectiles(dt: number): void {
    const mundo = this.mundo;
    for (let k = 0; k < MAX_PROYECTILES; k++) {
      if (this.proyActivo[k] === 0) continue;

      const objetivo = this.proyObjetivo[k] as Entidad;
      if (!mundo.esValida(objetivo)) {
        this.proyActivo[k] = 0;
        continue;
      }

      const j = indiceDe(objetivo);
      const dx = mundo.x[j] - this.proyX[k];
      const dz = mundo.z[j] - this.proyZ[k];
      const distancia = Math.sqrt(dx * dx + dz * dz);
      const paso = this.proyVelocidad[k] * dt;

      if (distancia <= paso + mundo.radio[j]) {
        this.proyActivo[k] = 0;
        if (mundo.vida[j] > 0) {
          this.aplicarGolpe(
            this.proyAtacante[k] as Entidad,
            j,
            this.proyDanio[k],
            this.proyTipoDanio[k] as TipoDanio,
            this.proyCritico[k] === 1,
          );
        }
        continue;
      }

      this.proyX[k] += (dx / distancia) * paso;
      this.proyZ[k] += (dz / distancia) * paso;
    }
  }

  private aplicarGolpe(
    atacante: Entidad,
    j: number,
    bruto: number,
    tipoDanio: TipoDanio,
    critico: boolean,
  ): void {
    const mundo = this.mundo;
    if (mundo.vida[j] <= 0) return;

    const danio = calcularDanio(
      bruto,
      tipoDanio,
      mundo.tipoArmadura[j] as TipoArmadura,
      mundo.armadura[j],
    );
    mundo.vida[j] -= danio;

    this.bus.emitir('danio', {
      objetivo: mundo.entidadDeIndice(j),
      atacante,
      cantidad: danio,
      x: mundo.x[j],
      z: mundo.z[j],
      esCritico: critico,
    });

    if (mundo.vida[j] <= 0) this.matar(j, atacante);
  }

  /**
   * Muerte de una entidad.
   *
   * Las unidades dejan cadáver (`MURIENDO`) y se retiran cuando pasa `DURACION_CADAVER`;
   * los edificios se retiran en el acto, porque un escombro que sigue bloqueando cuatro
   * casillas es un problema de juego, no un adorno.
   */
  private matar(j: number, asesino: Entidad): void {
    const mundo = this.mundo;
    mundo.vida[j] = 0;
    const entidad = mundo.entidadDeIndice(j);

    this.bus.emitir('muerte', { entidad, asesino, x: mundo.x[j], z: mundo.z[j] });

    if (mundo.esValida(asesino)) {
      const bandoAsesino = mundo.bando[indiceDe(asesino)] as Bando;
      if (bandoAsesino !== Bando.NEUTRAL) mundo.estadoDe(bandoAsesino).bajasCausadas++;
    }

    const bando = mundo.bando[j] as Bando;

    if (mundo.clase[j] === Clase.UNIDAD) {
      if (bando !== Bando.NEUTRAL) mundo.estadoDe(bando).unidadesPerdidas++;
      liberarYacimientoMemorizado(mundo, j);
      mundo.orden[j] = Orden.NINGUNA;
      mundo.ordenObjetivo[j] = ENTIDAD_NULA;
      mundo.objetivoActual[j] = ENTIDAD_NULA;
      mundo.cargaCantidad[j] = 0;
      this.movimiento.detener(j);
      mundo.cambiarEstado(j, EstadoUnidad.MURIENDO);
      return;
    }

    if (mundo.clase[j] === Clase.EDIFICIO) {
      const cx = mundo.casillaX[j];
      const cz = mundo.casillaZ[j];
      const lado = mundo.huella[j];
      retirarEntidad(mundo, j);
      invalidarRutasEn(cx, cz, lado);
      return;
    }

    retirarEntidad(mundo, j);
  }
}
