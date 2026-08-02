import { bus } from '../core/events';
import { MAX_SELECCION } from '../sim/constantes';
import { Bando, ENTIDAD_NULA, Entidad, TipoEdificio, indiceDe } from '../sim/tipos';
import type { Mundo } from '../sim/mundo';

/**
 * Estado de sesión: lo que sabe la persona que juega, no lo que sabe el mundo.
 *
 * La selección, el bando que controlas, el edificio que estás colocando o el grupo
 * de control que acabas de pulsar no forman parte de la simulación —un espectador
 * o una repetición tienen el mismo mundo con otra sesión distinta— pero sí los
 * necesitan a la vez la entrada (que los modifica) y la interfaz (que los pinta).
 *
 * Vive aquí para que ninguna de las dos capas tenga que conocer a la otra.
 */

export interface ModoColocacion {
  activo: boolean;
  tipo: TipoEdificio;
  /** Casilla bajo el cursor, esquina de la huella. */
  cx: number;
  cz: number;
  /** Si la posición actual es válida; el render lo usa para el color del fantasma. */
  valida: boolean;
}

export interface AvisoActivo {
  texto: string;
  severidad: 'info' | 'alerta' | 'peligro';
  x: number;
  z: number;
  /** Marca de tiempo en segundos desde el arranque. */
  nacido: number;
}

export class SesionJuego {
  /** Bando que controla la persona que juega. */
  bandoJugador: Bando = Bando.HUMANOS;

  /** Entidades seleccionadas, en orden de adición. */
  readonly seleccion: Entidad[] = [];

  /** Grupos de control del 1 al 9. */
  readonly grupos = new Map<number, Entidad[]>();

  readonly colocacion: ModoColocacion = {
    activo: false,
    tipo: TipoEdificio.GRANJA,
    cx: 0,
    cz: 0,
    valida: false,
  };

  /** Avisos vivos, los más recientes al final. */
  readonly avisos: AvisoActivo[] = [];

  /** Entidad bajo el cursor o el dedo; la interfaz muestra su ficha. */
  entidadResaltada: Entidad = ENTIDAD_NULA;

  /** Caja de selección en curso, en píxeles de pantalla. Nula si no se arrastra. */
  cajaSeleccion: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /** Partida terminada: bloquea la entrada y muestra el resumen. */
  terminada = false;

  /** Última vez que se emitió cada clave de aviso, para no repetirlos en ráfaga. */
  private ultimoAviso = new Map<string, number>();

  /** Segundos transcurridos de partida. */
  tiempoPartida = 0;

  // --- Selección ---

  /** Reemplaza la selección entera. Filtra lo que ya no exista y respeta el tope. */
  seleccionar(mundo: Mundo, entidades: readonly Entidad[]): void {
    this.seleccion.length = 0;
    for (const entidad of entidades) {
      if (this.seleccion.length >= MAX_SELECCION) break;
      if (!mundo.esValida(entidad)) continue;
      if (this.seleccion.includes(entidad)) continue;
      this.seleccion.push(entidad);
    }
    bus.emitir('seleccionCambiada', { entidades: [...this.seleccion] });
  }

  /** Añade a la selección sin borrar lo anterior (mayúsculas mantenidas). */
  anadirASeleccion(mundo: Mundo, entidades: readonly Entidad[]): void {
    let cambio = false;
    for (const entidad of entidades) {
      if (this.seleccion.length >= MAX_SELECCION) break;
      if (!mundo.esValida(entidad)) continue;
      if (this.seleccion.includes(entidad)) continue;
      this.seleccion.push(entidad);
      cambio = true;
    }
    if (cambio) bus.emitir('seleccionCambiada', { entidades: [...this.seleccion] });
  }

  /** Quita de la selección lo que ya no exista. Se llama una vez por tick. */
  depurarSeleccion(mundo: Mundo): void {
    let escritura = 0;
    for (let lectura = 0; lectura < this.seleccion.length; lectura++) {
      const entidad = this.seleccion[lectura]!;
      if (mundo.esValida(entidad) && mundo.vida[indiceDe(entidad)] > 0) {
        this.seleccion[escritura++] = entidad;
      }
    }
    if (escritura !== this.seleccion.length) {
      this.seleccion.length = escritura;
      bus.emitir('seleccionCambiada', { entidades: [...this.seleccion] });
    }
  }

  limpiarSeleccion(): void {
    if (this.seleccion.length === 0) return;
    this.seleccion.length = 0;
    bus.emitir('seleccionCambiada', { entidades: [] });
  }

  /** ¿Está todo lo seleccionado bajo mi control? Gobierna qué comandos se ofrecen. */
  seleccionEsPropia(mundo: Mundo): boolean {
    if (this.seleccion.length === 0) return false;
    for (const entidad of this.seleccion) {
      if (mundo.bando[indiceDe(entidad)] !== this.bandoJugador) return false;
    }
    return true;
  }

  // --- Grupos de control ---

  guardarGrupo(numero: number): void {
    this.grupos.set(numero, [...this.seleccion]);
  }

  recuperarGrupo(mundo: Mundo, numero: number): boolean {
    const grupo = this.grupos.get(numero);
    if (!grupo || grupo.length === 0) return false;
    this.seleccionar(mundo, grupo);
    return this.seleccion.length > 0;
  }

  // --- Colocación de edificios ---

  iniciarColocacion(tipo: TipoEdificio): void {
    this.colocacion.activo = true;
    this.colocacion.tipo = tipo;
    this.colocacion.valida = false;
  }

  cancelarColocacion(): void {
    this.colocacion.activo = false;
  }

  // --- Avisos ---

  /**
   * Registra un aviso, descartando repeticiones de la misma clave en menos de
   * `enfriamiento` segundos. Sin esto, una base bajo ataque generaría un aviso por
   * cada golpe recibido y la pantalla sería ilegible justo cuando más hay que leerla.
   */
  avisar(
    texto: string,
    severidad: AvisoActivo['severidad'],
    x: number,
    z: number,
    clave: string,
    enfriamiento = 8,
  ): void {
    const ultimo = this.ultimoAviso.get(clave) ?? -Infinity;
    if (this.tiempoPartida - ultimo < enfriamiento) return;
    this.ultimoAviso.set(clave, this.tiempoPartida);
    this.avisos.push({ texto, severidad, x, z, nacido: this.tiempoPartida });
    if (this.avisos.length > 6) this.avisos.shift();
  }

  /** Retira los avisos caducados. */
  caducarAvisos(duracion = 7): void {
    while (this.avisos.length > 0 && this.tiempoPartida - this.avisos[0]!.nacido > duracion) {
      this.avisos.shift();
    }
  }

  /** El aviso más reciente, al que salta la cámara con la tecla de espacio. */
  get ultimoAvisoActivo(): AvisoActivo | null {
    return this.avisos.length > 0 ? this.avisos[this.avisos.length - 1]! : null;
  }
}

/** Sesión única de la partida en curso. */
export const sesion = new SesionJuego();
