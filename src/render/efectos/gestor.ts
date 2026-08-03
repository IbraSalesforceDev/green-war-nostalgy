import * as THREE from 'three';
import { bus as busGlobal, BusEventos } from '../../core/events';
import type { Mundo } from '../../sim/mundo';
import type { MapaJuego } from '../../sim/mapa';
import { Bando } from '../../sim/tipos';
import type { SesionJuego } from '../../estado/sesion';
import type { CalidadRender, Renderizador } from '../renderizador';
import { crearSistemaParticulas } from './particulas';
import { crearSistemaProyectiles } from './proyectiles';
import { crearSistemaImpactos } from './impactos';
import { crearSistemaDecals } from './decalcomanias';
import { crearSistemaSeleccion } from './seleccion';
import { crearNieblaGuerra } from './nieblaGuerra';
import { crearPostProceso } from './postproceso';

/**
 * Fachada del subsistema de efectos.
 *
 * Ensambla, en el orden que importa, todas las capas que traducen los hechos de la
 * simulación (el bus de eventos) y el estado de la sesión (la selección) en algo que
 * se ve: partículas, proyectiles en vuelo, decalcomanías, círculos de selección y
 * niebla de guerra, más la cadena de post-procesado que los presenta todos juntos.
 *
 * Es el único punto de esta capa que el resto del juego necesita conocer:
 *
 * ```ts
 * const efectos = crearGestorEfectos(escena, mundo, camara, renderizador.calidad, renderizador);
 * // en el bucle de render, por fotograma:
 * efectos.actualizar(dt, alfa);
 * efectos.renderizar(escena, camara.nucleo);   // sustituye a renderizador.nucleo.render(...)
 * // al redimensionar la ventana:
 * efectos.redimensionar(ancho, alto);
 * // al cerrar la partida:
 * efectos.liberar();
 * ```
 *
 * El orden de ensamblado no es casual: los proyectiles necesitan el sistema de
 * partículas ya construido (le pasan su propio emisor de estelas y le entregan cada
 * impacto a `impactos.ts`), y `impactos.ts` necesita a su vez las partículas y las
 * decalcomanías para poder reaccionar a un impacto de catapulta con astillas *y* un
 * cráter en el mismo golpe.
 *
 * ── Móvil primero ─────────────────────────────────────────────────────────────
 * Todo respeta `CalidadRender`: en el nivel `bajo` no hay post-proceso ni
 * decalcomanías y el presupuesto de partículas se recorta solo (cada sistema lee
 * `calidad` por su cuenta), pero la niebla de guerra se mantiene siempre — no es un
 * adorno, es la mitad de la jugabilidad de un RTS.
 */

export interface GestorEfectos {
  /** Avanza todos los sistemas de efectos un fotograma. */
  actualizar(dt: number, alfa: number): void;
  /** Dibuja el fotograma: usa el compositor si el post-proceso está activo. */
  renderizar(): void;
  redimensionar(ancho: number, alto: number): void;
  /** Cambia de qué bando se pinta la niebla de guerra (cambio de perspectiva/depuración). */
  fijarBandoNiebla(bando: Bando): void;
  liberar(): void;
}

export function crearGestorEfectos(
  escena: THREE.Scene,
  camara: THREE.Camera,
  mundo: Mundo,
  mapa: MapaJuego,
  bandoJugador: Bando,
  sesion: SesionJuego,
  renderizador: Renderizador,
  calidad: CalidadRender,
  bus: BusEventos = busGlobal,
): GestorEfectos {
  const particulas = crearSistemaParticulas(escena, calidad);
  const decals = crearSistemaDecals(escena, mapa, calidad);
  const impactos = crearSistemaImpactos(mundo, particulas, decals, bus);
  const proyectiles = crearSistemaProyectiles(
    escena,
    mundo,
    calidad,
    particulas,
    (info) => impactos.impactoDeProyectil(info),
  );
  const seleccion = crearSistemaSeleccion(escena, mundo, sesion, calidad);
  const niebla = crearNieblaGuerra(escena, mapa, bandoJugador, bus);
  // La cámara se fija aquí: es la misma instancia de THREE.PerspectiveCamera durante
  // toda la partida (solo cambian su posición y sus propiedades, nunca el objeto),
  // así que el compositor puede capturarla una sola vez en su RenderPass.
  const postProceso = crearPostProceso(renderizador.nucleo, escena, camara, calidad);

  return {
    actualizar(dt: number, alfa: number): void {
      particulas.actualizar(dt);
      proyectiles.actualizar(dt);
      decals.actualizar(dt);
      seleccion.actualizar(dt, alfa);
      niebla.actualizar(dt);
    },

    renderizar(): void {
      if (postProceso.activo) {
        postProceso.renderizar();
      } else {
        renderizador.nucleo.render(escena, camara);
      }
    },

    redimensionar(ancho: number, alto: number): void {
      postProceso.redimensionar(ancho, alto);
    },

    fijarBandoNiebla(bando: Bando): void {
      niebla.fijarBando(bando);
    },

    liberar(): void {
      postProceso.liberar();
      niebla.liberar();
      seleccion.liberar();
      proyectiles.liberar();
      impactos.liberar();
      decals.liberar();
      particulas.liberar();
    },
  };
}
