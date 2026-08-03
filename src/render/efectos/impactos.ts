import { bus as busGlobal, BusEventos, type MapaEventos } from '../../core/events';
import { azarVisual } from '../../core/rng';
import { Mundo } from '../../sim/mundo';
import { Clase, indiceDe } from '../../sim/tipos';
import type { SistemaParticulas } from './particulas';
import {
  EMISOR_ASTILLA,
  EMISOR_CHISPA_GOLPE,
  EMISOR_DESTELLO_ORO,
  EMISOR_HOJA,
  EMISOR_HUMO,
  EMISOR_POLVO_OBRA,
  EMISOR_SANGRE,
} from './particulas';
import type { SistemaDecals } from './decalcomanias';
import type { InfoImpactoProyectil } from './proyectiles';

/**
 * Vocabulario de impactos: traduce los hechos de la simulación (el bus de eventos y
 * los impactos de proyectil que reporta `proyectiles.ts`) a partículas y
 * decalcomanías concretas.
 *
 * Cada reacción es deliberadamente breve: en un RTS la lectura del combate —cuántas
 * unidades hay, quién está ganando el cruce— manda sobre el espectáculo. Una chispa
 * de cuatro fotogramas comunica «ahí hay un golpe» sin tapar la unidad que lo recibe.
 *
 * No incluye proyectiles en vuelo (eso es de `proyectiles.ts`, que además es quien
 * llama a `impactoDeProyectil` en el momento exacto de la colisión) ni los círculos
 * de selección (`seleccion.ts`): esto es solo la capa de reacción a hechos consumados.
 *
 * ── API pública ─────────────────────────────────────────────────────────────
 *   crearSistemaImpactos(mundo, particulas, decals, bus?): SistemaImpactos
 *     · impactoDeProyectil(info): reacciona a la llegada de un proyectil concreto
 *     · liberar(): se da de baja del bus
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface SistemaImpactos {
  /** Llamarlo desde el sistema de proyectiles en el instante exacto del impacto. */
  impactoDeProyectil(info: InfoImpactoProyectil): void;
  liberar(): void;
}

/** Vector de trabajo del módulo: cero reservas por evento. */
const dir = { x: 0, y: 0, z: 0 };

function direccionAleatoria(): void {
  const angulo = azarVisual.siguiente() * Math.PI * 2;
  dir.x = Math.cos(angulo);
  dir.y = 0.6 + azarVisual.siguiente() * 0.4;
  dir.z = Math.sin(angulo);
}

export function crearSistemaImpactos(
  mundo: Mundo,
  particulas: SistemaParticulas,
  decals: SistemaDecals,
  bus: BusEventos = busGlobal,
): SistemaImpactos {
  function golpeCuerpoACuerpo(x: number, y: number, z: number): void {
    direccionAleatoria();
    particulas.emitir(EMISOR_CHISPA_GOLPE, {
      x, y: y + 0.4, z,
      cantidad: 6,
      velocidad: 2.6,
      dispersion: 0.9,
      dirX: dir.x, dirY: dir.y, dirZ: dir.z,
      vidaMin: 0.12, vidaMax: 0.22,
    });
  }

  function alDanio(datos: MapaEventos['danio']): void {
    if (!mundo.esValida(datos.objetivo)) return;
    const j = indiceDe(datos.objetivo);
    const clase = mundo.clase[j];
    const y = mundo.alturaDe(j) + mundo.radio[j] * 1.6;

    if (clase === Clase.EDIFICIO) {
      direccionAleatoria();
      particulas.emitir(EMISOR_ASTILLA, {
        x: datos.x, y, z: datos.z,
        cantidad: 5,
        velocidad: 3.2,
        dispersion: 0.7,
        dirX: dir.x, dirY: 1, dirZ: dir.z,
        vidaMin: 0.35, vidaMax: 0.6,
      });
      // Cuanto más maltrecho el edificio, más humo levanta cada golpe: la salud
      // decreciente se lee de un vistazo sin mirar ninguna barra.
      const fraccionVida = mundo.vida[j] / Math.max(1, mundo.vidaMaxima[j]);
      if (fraccionVida < 0.5) {
        particulas.emitir(EMISOR_HUMO, {
          x: datos.x, y: y + 0.3, z: datos.z,
          cantidad: fraccionVida < 0.25 ? 3 : 1,
          velocidad: 0.5,
          dispersion: 0.4,
          dirY: 1,
          vidaMin: 0.9, vidaMax: 1.5,
        });
      }
    } else {
      golpeCuerpoACuerpo(datos.x, y, datos.z);
    }

    if (datos.esCritico) {
      particulas.emitir(EMISOR_CHISPA_GOLPE, {
        x: datos.x, y: y + 0.5, z: datos.z,
        cantidad: 4,
        velocidad: 3.4,
        dispersion: 1.3,
        dirY: 1,
        vidaMin: 0.15, vidaMax: 0.25,
        escala: 1.4,
      });
    }
  }

  function alMuerte(datos: MapaEventos['muerte']): void {
    if (!mundo.esValida(datos.asesino) && !mundo.esValida(datos.entidad)) return;
    const clase = mundo.esValida(datos.entidad) ? mundo.clase[indiceDe(datos.entidad)] : Clase.UNIDAD;
    if (clase === Clase.EDIFICIO) return; // los edificios no sangran; su propio derrumbe ya habla

    direccionAleatoria();
    particulas.emitir(EMISOR_SANGRE, {
      x: datos.x, y: 0.35, z: datos.z,
      cantidad: 10,
      velocidad: 1.8,
      dispersion: 1.1,
      dirY: 0.7,
      vidaMin: 0.4, vidaMax: 0.7,
    });
    decals.agregar('sangre', { x: datos.x, z: datos.z, radio: 0.5 + azarVisual.siguiente() * 0.3 });
  }

  function alConstruccionIniciada(_datos: MapaEventos['construccionIniciada']): void {
    void _datos; // el andamio ya se ve por sí mismo; sin efecto de polvo al colocarlo
  }

  function alProducidoTerminado(datos: MapaEventos['producidoTerminado']): void {
    if (!mundo.esValida(datos.entidad)) return;
    const i = indiceDe(datos.entidad);
    if (mundo.clase[i] !== Clase.EDIFICIO) return; // solo edificios: entrenar tropa no levanta polvo

    particulas.emitir(EMISOR_POLVO_OBRA, {
      x: mundo.x[i], y: 0.15, z: mundo.z[i],
      cantidad: 14,
      velocidad: 1.1,
      dispersion: 1.4,
      dirY: 0.3,
      vidaMin: 0.6, vidaMax: 1.1,
      escala: 1.6,
    });
  }

  function alRecursoEntregado(datos: MapaEventos['recursoEntregado']): void {
    if (!mundo.esValida(datos.deposito)) return;
    const j = indiceDe(datos.deposito);
    particulas.emitir(EMISOR_DESTELLO_ORO, {
      x: mundo.x[j], y: mundo.alturaDe(j) + 1.2, z: mundo.z[j],
      cantidad: 3,
      velocidad: 0.8,
      dispersion: 0.5,
      dirY: 1,
      vidaMin: 0.3, vidaMax: 0.45,
    });
  }

  function alRecursoAgotado(datos: MapaEventos['recursoAgotado']): void {
    if (datos.tipo !== 1) return; // TipoRecurso.MADERA; el oro no deja hojas al agotarse
    for (let k = 0; k < 8; k++) {
      direccionAleatoria();
      particulas.emitir(EMISOR_HOJA, {
        x: datos.x, y: 1.4, z: datos.z,
        cantidad: 1,
        velocidad: 0.6,
        dispersion: 1.6,
        dirX: dir.x, dirY: 0.3, dirZ: dir.z,
        vidaMin: 0.8, vidaMax: 1.3,
      });
    }
  }

  const bajas = [
    bus.al('danio', alDanio),
    bus.al('muerte', alMuerte),
    bus.al('construccionIniciada', alConstruccionIniciada),
    bus.al('producidoTerminado', alProducidoTerminado),
    bus.al('recursoEntregado', alRecursoEntregado),
    bus.al('recursoAgotado', alRecursoAgotado),
  ];

  return {
    impactoDeProyectil(info: InfoImpactoProyectil): void {
      direccionAleatoria();
      if (info.tipo === 'flecha' || info.tipo === 'lanza') {
        particulas.emitir(EMISOR_CHISPA_GOLPE, {
          x: info.x, y: info.y, z: info.z,
          cantidad: 4,
          velocidad: 1.6,
          dispersion: 0.8,
          dirX: dir.x, dirY: dir.y, dirZ: dir.z,
          vidaMin: 0.12, vidaMax: 0.2,
        });
      } else if (info.tipo === 'roca') {
        particulas.emitir(EMISOR_ASTILLA, {
          x: info.x, y: info.y, z: info.z,
          cantidad: 9,
          velocidad: 4,
          dispersion: 1.2,
          dirY: 1,
          vidaMin: 0.4, vidaMax: 0.7,
        });
        decals.agregar(info.esEdificio ? 'crater' : 'quemado', {
          x: info.x, z: info.z, radio: 1.1 + azarVisual.siguiente() * 0.4,
        });
      } else {
        particulas.emitir(EMISOR_DESTELLO_ORO, {
          x: info.x, y: info.y, z: info.z,
          cantidad: 6,
          velocidad: 1.4,
          dispersion: 1,
          dirY: 1,
          vidaMin: 0.25, vidaMax: 0.4,
        });
      }
    },

    liberar(): void {
      for (const baja of bajas) baja();
    },
  };
}
