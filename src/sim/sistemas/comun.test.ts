import { describe, expect, it } from 'vitest';
import { MapaJuego } from '../mapa';
import { Mundo } from '../mundo';
import type { BuscadorRutas, PeticionRuta, ResultadoRuta } from '../rutas/contrato';
import { Ruta } from '../tipos';

/**
 * Utillaje compartido por las pruebas de los sistemas.
 *
 * Vive en un `.test.ts` a propósito: no es código de juego y no debe acabar en el
 * paquete final. La prueba de humo del final está para que vitest no se queje de un
 * fichero de pruebas sin pruebas.
 */

/** Mapa vacío: hierba a nivel cero, sin bloqueos. Todo lo demás lo pone cada prueba. */
export function crearMapaLlano(lado = 48): MapaJuego {
  return new MapaJuego(lado, lado);
}

export function crearMundoDePruebas(semilla = 20240607, lado = 48): Mundo {
  return new Mundo(crearMapaLlano(lado), semilla);
}

/**
 * Doble del buscador de rutas: siempre contesta con una recta al destino.
 *
 * Es exactamente lo que necesitan las pruebas de los sistemas: los mapas son llanos y
 * despejados, así que la recta es la ruta correcta, y así ninguna prueba depende del
 * A* de verdad (que además todavía se está escribiendo en otra rama).
 */
export class BuscadorRecto implements BuscadorRutas {
  private pendientes = new Map<number, PeticionRuta>();
  private listas = new Map<number, Ruta>();
  private tick = 0;

  /** Regiones invalidadas, para poder comprobar que los sistemas avisan. */
  readonly invalidaciones: Array<[number, number, number]> = [];

  pedir(peticion: PeticionRuta): void {
    this.pendientes.set(peticion.entidad, peticion);
    this.listas.delete(peticion.entidad);
  }

  recoger(entidad: number): ResultadoRuta {
    const ruta = this.listas.get(entidad);
    if (ruta) {
      this.listas.delete(entidad);
      return { estado: 'lista', ruta };
    }
    return { estado: 'pendiente' };
  }

  cancelar(entidad: number): void {
    this.pendientes.delete(entidad);
    this.listas.delete(entidad);
  }

  actualizar(tick: number): void {
    this.tick = tick;
    for (const [entidad, peticion] of this.pendientes) {
      this.listas.set(entidad, {
        puntos: Float32Array.from([peticion.destinoX, peticion.destinoZ]),
        indice: 0,
        tickCalculo: this.tick,
      });
    }
    this.pendientes.clear();
  }

  invalidarRegion(cx: number, cz: number, lado: number): void {
    this.invalidaciones.push([cx, cz, lado]);
  }

  estadisticas(): { pendientes: number; calculadasEsteTick: number; nodosExplorados: number } {
    return { pendientes: this.pendientes.size, calculadasEsteTick: this.listas.size, nodosExplorados: 0 };
  }
}

/** Huella del mundo entero: si dos partidas iguales divergen, esto lo delata. */
export function huellaDelMundo(mundo: Mundo): string {
  const trozos: string[] = [];
  trozos.push(`tick=${mundo.tick}`);
  for (let b = 1; b < mundo.bandos.length; b++) {
    const estado = mundo.bandos[b]!;
    trozos.push(
      `b${b}:${estado.oro.toFixed(4)}/${estado.madera.toFixed(4)}/${estado.poblacion}/` +
        `${estado.poblacionMaxima}/${estado.unidadesPerdidas}/${estado.bajasCausadas}/` +
        `${estado.oroRecogido.toFixed(4)}`,
    );
  }
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    trozos.push(
      `${i}:${mundo.clase[i]}:${mundo.tipo[i]}:${mundo.bando[i]}:` +
        `${mundo.x[i].toFixed(5)}:${mundo.z[i].toFixed(5)}:${mundo.angulo[i].toFixed(5)}:` +
        `${mundo.vida[i].toFixed(5)}:${mundo.estado[i]}:${mundo.orden[i]}:` +
        `${mundo.objetivoActual[i]}:${mundo.cargaCantidad[i].toFixed(3)}:` +
        `${mundo.progresoTrabajo[i].toFixed(4)}:${mundo.progresoObra[i].toFixed(5)}:` +
        `${mundo.reserva[i].toFixed(3)}`,
    );
  }
  return trozos.join('|');
}

describe('utillaje de pruebas', () => {
  it('el buscador recto entrega una ruta directa al destino', () => {
    const buscador = new BuscadorRecto();
    buscador.pedir({
      entidad: 7,
      origenX: 0,
      origenZ: 0,
      destinoX: 5,
      destinoZ: 9,
      radio: 0.3,
      tolerancia: 0.2,
      prioridad: 1,
    });
    expect(buscador.recoger(7).estado).toBe('pendiente');
    buscador.actualizar(1);
    const resultado = buscador.recoger(7);
    expect(resultado.estado).toBe('lista');
    if (resultado.estado === 'lista') {
      expect(Array.from(resultado.ruta.puntos)).toEqual([5, 9]);
    }
  });
});
