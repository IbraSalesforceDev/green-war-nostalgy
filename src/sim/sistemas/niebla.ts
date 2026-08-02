import { BusEventos, bus as busGlobal } from '../../core/events';
import { INTERVALO_NIEBLA } from '../constantes';
import { Mundo } from '../mundo';
import { Bando, Clase, ENTIDAD_NULA, Entidad, MAX_ENTIDADES } from '../tipos';

/**
 * Sistema de niebla de guerra.
 *
 * La versión ingenua de esto —borrar la visión entera y volver a pintarla cada vez—
 * cuesta, en un mapa de 96x96 con cien unidades, cientos de miles de escrituras por
 * segundo. Aquí se hace de forma incremental: cada fuente de visión recuerda dónde se
 * aplicó por última vez y solo se toca el mapa cuando esa fuente cambia de casilla,
 * muere o cambia de bando. En una partida en reposo el coste es literalmente cero.
 *
 * Lo que hace que el enfoque incremental sea seguro es el contador por casilla de
 * `MapaJuego.aplicarVision`: sumar y restar fuentes siempre está equilibrado, así que
 * no hay forma de que una casilla se quede iluminada por un fantasma.
 */
export class SistemaNiebla {
  readonly mundo: Mundo;
  readonly bus: BusEventos;

  /** Entidad (con generación) cuya visión está aplicada en cada índice, o 0. */
  private readonly aplicada = new Int32Array(MAX_ENTIDADES);
  private readonly aplicadaBando = new Uint8Array(MAX_ENTIDADES);
  private readonly aplicadaX = new Int16Array(MAX_ENTIDADES);
  private readonly aplicadaZ = new Int16Array(MAX_ENTIDADES);
  private readonly aplicadaRadio = new Float32Array(MAX_ENTIDADES);

  /** Índice más alto con visión aplicada; acota el barrido de limpieza. */
  private maximoAplicado = 0;

  constructor(mundo: Mundo, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.bus = bus;
  }

  paso(): void {
    const mundo = this.mundo;
    if (mundo.tick % INTERVALO_NIEBLA !== 0) return;

    let cambios = 0;
    const limite = Math.max(mundo.indiceMaximo, this.maximoAplicado);

    for (let i = 1; i <= limite; i++) {
      const entidad = this.fuenteEn(i);
      const anterior = this.aplicada[i] as Entidad;

      if (entidad === ENTIDAD_NULA) {
        if (anterior !== ENTIDAD_NULA) {
          this.quitar(i);
          cambios++;
        }
        continue;
      }

      const cx = mundo.mapa.aCasilla(mundo.x[i]);
      const cz = mundo.mapa.aCasilla(mundo.z[i]);

      if (anterior === entidad) {
        // La misma fuente en la misma casilla no cuesta nada: es el caso normal.
        if (this.aplicadaX[i] === cx && this.aplicadaZ[i] === cz) continue;
        this.quitar(i);
      } else if (anterior !== ENTIDAD_NULA) {
        // El índice se ha reciclado para otra entidad: hay que deshacer la anterior.
        this.quitar(i);
      }

      this.poner(i, entidad, cx, cz);
      cambios++;
    }

    if (cambios > 0) this.bus.emitir('nieblaActualizada', {});
  }

  /** Deshace toda la visión aplicada. Para reiniciar la partida sin rastros. */
  reiniciar(): void {
    for (let i = 1; i <= this.maximoAplicado; i++) {
      if (this.aplicada[i] !== ENTIDAD_NULA) this.quitar(i);
    }
    this.maximoAplicado = 0;
  }

  /** ¿Qué entidad debería estar iluminando desde el índice `i`? */
  private fuenteEn(i: number): Entidad {
    const mundo = this.mundo;
    if (mundo.activos[i] !== 1) return ENTIDAD_NULA;
    if (mundo.vision[i] <= 0) return ENTIDAD_NULA;
    if (mundo.vida[i] <= 0) return ENTIDAD_NULA;
    if (mundo.bando[i] === Bando.NEUTRAL) return ENTIDAD_NULA;
    const clase = mundo.clase[i];
    if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) return ENTIDAD_NULA;
    return mundo.entidadDeIndice(i);
  }

  private poner(i: number, entidad: Entidad, cx: number, cz: number): void {
    const mundo = this.mundo;
    const bando = mundo.bando[i] as Bando;
    const radio = mundo.vision[i];
    mundo.mapa.aplicarVision(bando, cx, cz, radio, true);
    this.aplicada[i] = entidad;
    this.aplicadaBando[i] = bando;
    this.aplicadaX[i] = cx;
    this.aplicadaZ[i] = cz;
    this.aplicadaRadio[i] = radio;
    if (i > this.maximoAplicado) this.maximoAplicado = i;
  }

  /** Quita la visión con los datos con los que se aplicó, no con los actuales. */
  private quitar(i: number): void {
    if (this.aplicada[i] === ENTIDAD_NULA) return;
    this.mundo.mapa.aplicarVision(
      this.aplicadaBando[i] as Bando,
      this.aplicadaX[i],
      this.aplicadaZ[i],
      this.aplicadaRadio[i],
      false,
    );
    this.aplicada[i] = ENTIDAD_NULA;
  }

  /** Número de fuentes activas. Para el panel de depuración. */
  fuentesActivas(): number {
    let n = 0;
    for (let i = 1; i <= this.maximoAplicado; i++) {
      if (this.aplicada[i] !== ENTIDAD_NULA) n++;
    }
    return n;
  }
}
