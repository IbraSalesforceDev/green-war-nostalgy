/**
 * Bus de eventos tipado.
 *
 * Es la única vía por la que la simulación habla con el render, el audio y la
 * interfaz. La regla es estricta y no negociable: la simulación emite hechos
 * («la unidad 12 recibió 8 de daño»), nunca órdenes de presentación. Quien
 * escucha decide si eso son chispas, un grito o un parpadeo rojo en el minimapa.
 *
 * Gracias a esa separación la simulación puede correr sin ningún render detrás
 * (tests, servidor autoritativo, avance rápido de una repetición).
 */

import type { Entidad } from '../sim/tipos';
import type { TipoRecurso, Bando } from '../sim/tipos';

export interface MapaEventos {
  /** Una unidad o edificio ha recibido daño. */
  danio: {
    objetivo: Entidad;
    atacante: Entidad;
    cantidad: number;
    x: number;
    z: number;
    esCritico: boolean;
  };
  /** Una entidad ha llegado a cero puntos de vida. */
  muerte: {
    entidad: Entidad;
    asesino: Entidad;
    x: number;
    z: number;
  };
  /** Un proyectil ha salido disparado. */
  proyectil: {
    origenX: number;
    origenZ: number;
    origenY: number;
    destino: Entidad;
    tipo: 'flecha' | 'lanza' | 'roca' | 'hechizo';
    velocidad: number;
  };
  /** Una entidad ha terminado de construirse o entrenarse. */
  producidoTerminado: {
    entidad: Entidad;
    productor: Entidad;
    bando: Bando;
  };
  /** Se ha colocado el andamio de un edificio. */
  construccionIniciada: {
    entidad: Entidad;
    bando: Bando;
  };
  /** Un obrero ha entregado recursos en un depósito. */
  recursoEntregado: {
    obrero: Entidad;
    deposito: Entidad;
    tipo: TipoRecurso;
    cantidad: number;
    bando: Bando;
  };
  /** Una veta de oro o un bosque se ha agotado. */
  recursoAgotado: {
    entidad: Entidad;
    tipo: TipoRecurso;
    x: number;
    z: number;
  };
  /** Cambio en la selección del jugador. */
  seleccionCambiada: {
    entidades: readonly Entidad[];
  };
  /** Órdenes emitidas por el jugador; el render las usa para el marcador de destino. */
  ordenEmitida: {
    entidades: readonly Entidad[];
    x: number;
    z: number;
    tipo: 'mover' | 'atacar' | 'recolectar' | 'construir' | 'patrullar' | 'mantener';
    objetivo: Entidad;
  };
  /** Aviso al jugador: sin recursos, base atacada, población al límite… */
  aviso: {
    texto: string;
    severidad: 'info' | 'alerta' | 'peligro';
    x: number;
    z: number;
    /** Evita que el mismo aviso se repita en ráfaga. */
    clave: string;
  };
  /** Fin de la partida. */
  finPartida: {
    ganador: Bando;
    motivo: 'aniquilacion' | 'rendicion' | 'tiempo';
  };
  /** El nivel de niebla de guerra ha cambiado en una región (para repintar). */
  nieblaActualizada: Record<string, never>;
}

export type NombreEvento = keyof MapaEventos;
export type Escucha<K extends NombreEvento> = (datos: MapaEventos[K]) => void;

export class BusEventos {
  private oyentes = new Map<NombreEvento, Set<(datos: never) => void>>();

  /** Suscribe una función. Devuelve la función para darse de baja. */
  al<K extends NombreEvento>(evento: K, escucha: Escucha<K>): () => void {
    let conjunto = this.oyentes.get(evento);
    if (!conjunto) {
      conjunto = new Set();
      this.oyentes.set(evento, conjunto);
    }
    conjunto.add(escucha as (datos: never) => void);
    return () => {
      conjunto!.delete(escucha as (datos: never) => void);
    };
  }

  /** Se suscribe y se da de baja automáticamente tras la primera emisión. */
  unaVez<K extends NombreEvento>(evento: K, escucha: Escucha<K>): () => void {
    const baja = this.al(evento, (datos) => {
      baja();
      escucha(datos);
    });
    return baja;
  }

  emitir<K extends NombreEvento>(evento: K, datos: MapaEventos[K]): void {
    const conjunto = this.oyentes.get(evento);
    if (!conjunto || conjunto.size === 0) return;
    // Copiamos antes de iterar: un oyente puede darse de baja durante la emisión.
    for (const escucha of [...conjunto]) {
      try {
        (escucha as Escucha<K>)(datos);
      } catch (error) {
        // Un oyente roto no puede tumbar la simulación entera.
        console.error(`[bus] Fallo en un oyente de "${String(evento)}"`, error);
      }
    }
  }

  limpiar(evento?: NombreEvento): void {
    if (evento) this.oyentes.delete(evento);
    else this.oyentes.clear();
  }

  numeroDeOyentes(evento: NombreEvento): number {
    return this.oyentes.get(evento)?.size ?? 0;
  }
}

/** Bus compartido por toda la aplicación. */
export const bus = new BusEventos();
