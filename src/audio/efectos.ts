import { Clase, indiceDe, TipoRecurso } from '../sim/tipos';
import type { Bando } from '../sim/tipos';
import type { Mundo } from '../sim/mundo';
import type { BusEventos } from '../core/events';
import type { MotorAudio } from './motor';

/**
 * Traduce los hechos del bus a sonido. Mismo principio que `efectos/impactos.ts`
 * en el render: escucha, nunca decide, y una fuente rota no puede tumbar nada
 * más (`bus.emitir` ya blinda cada oyente por separado).
 *
 * ── Por qué hay limitadores ──────────────────────────────────────────────────
 * Una escaramuza de veinte unidades dispara "danio" veinte veces en el mismo
 * fotograma. Sin límite, eso no sube el volumen: lo satura, y de paso crea
 * veinte nodos de audio por fotograma solo para que se enmascaren entre sí.
 * `crearLimitador` impone un hueco mínimo entre disparos de un mismo tipo de
 * sonido; el resultado se lee como "hay una pelea" en vez de un pitido sordo.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearSistemaAudio(motor, mundo, bandoJugador, bus): { liberar() }
 * ──────────────────────────────────────────────────────────────────────────────
 */

function crearLimitador(minIntervaloMs: number): () => boolean {
  let ultimo = -Infinity;
  return () => {
    const ahora = performance.now();
    if (ahora - ultimo < minIntervaloMs) return false;
    ultimo = ahora;
    return true;
  };
}

export function crearSistemaAudio(
  motor: MotorAudio,
  mundo: Mundo,
  bandoJugador: Bando,
  bus: BusEventos,
): { liberar(): void } {
  const puedeImpacto = crearLimitador(45);
  const puedeMuerte = crearLimitador(70);
  const puedeMoneda = crearLimitador(160);
  const puedeMadera = crearLimitador(160);
  const puedeProduccion = crearLimitador(120);
  const puedeAviso = crearLimitador(500);

  // --- Combate --------------------------------------------------------------

  const alDanio = bus.al('danio', (datos) => {
    if (!puedeImpacto()) return;
    // Variación de tono ligera y aleatoria: la repetición exacta es lo que
    // más delata un sonido sintético barato.
    const variacion = 1 + (Math.random() - 0.5) * 0.25;
    if (datos.esCritico) {
      motor.ruido({ duracion: 0.09, tipoFiltro: 'bandpass', frecuenciaFiltro: 2200 * variacion, q: 2.2, ganancia: 0.34 });
    } else {
      motor.ruido({ duracion: 0.07, tipoFiltro: 'bandpass', frecuenciaFiltro: 1400 * variacion, q: 1.4, ganancia: 0.22 });
    }
  });

  const alMuerte = bus.al('muerte', (datos) => {
    if (!puedeMuerte()) return;
    const i = indiceDe(datos.entidad);
    const esEdificio = mundo.clase[i] === Clase.EDIFICIO;
    if (esEdificio) {
      // Derrumbe: ruido grave con barrido descendente, más largo.
      motor.ruido({ duracion: 0.5, tipoFiltro: 'lowpass', frecuenciaFiltro: 500, q: 0.7, ganancia: 0.32 });
      motor.tono({ frecuencia: 110, frecuenciaFinal: 45, tipo: 'sawtooth', duracion: 0.45, ganancia: 0.18 });
    } else {
      motor.tono({ frecuencia: 220, frecuenciaFinal: 70, tipo: 'triangle', duracion: 0.22, ganancia: 0.2 });
    }
  });

  const alProyectil = bus.al('proyectil', () => {
    if (!puedeImpacto()) return;
    const variacion = 1 + (Math.random() - 0.5) * 0.3;
    motor.ruido({ duracion: 0.12, tipoFiltro: 'highpass', frecuenciaFiltro: 2600 * variacion, q: 0.6, ganancia: 0.09 });
  });

  // --- Economía ---------------------------------------------------------------

  const alRecursoEntregado = bus.al('recursoEntregado', (datos) => {
    if (datos.bando !== bandoJugador) return; // Solo interesa el sonido de la propia economía.
    if (datos.tipo === TipoRecurso.ORO) {
      if (!puedeMoneda()) return;
      motor.tono({ frecuencia: 1500, tipo: 'sine', duracion: 0.1, ganancia: 0.16 });
      motor.tono({ frecuencia: 2200, tipo: 'sine', duracion: 0.12, ganancia: 0.12, retraso: 0.035 });
    } else {
      if (!puedeMadera()) return;
      motor.ruido({ duracion: 0.06, tipoFiltro: 'bandpass', frecuenciaFiltro: 900, q: 3, ganancia: 0.14 });
    }
  });

  const alConstruccionIniciada = bus.al('construccionIniciada', (datos) => {
    if (datos.bando !== bandoJugador) return;
    motor.ruido({ duracion: 0.05, tipoFiltro: 'lowpass', frecuenciaFiltro: 700, q: 0.8, ganancia: 0.2 });
    motor.tono({ frecuencia: 180, frecuenciaFinal: 140, tipo: 'square', duracion: 0.08, ganancia: 0.1, retraso: 0.02 });
  });

  const alProducidoTerminado = bus.al('producidoTerminado', (datos) => {
    if (datos.bando !== bandoJugador) return;
    if (!puedeProduccion()) return;
    // Campanilla de dos notas ascendentes: "ya está listo".
    motor.tono({ frecuencia: 660, tipo: 'triangle', duracion: 0.14, ganancia: 0.18 });
    motor.tono({ frecuencia: 880, tipo: 'triangle', duracion: 0.18, ganancia: 0.16, retraso: 0.07 });
  });

  // --- Interfaz -----------------------------------------------------------------

  const alOrdenEmitida = bus.al('ordenEmitida', (datos) => {
    if (datos.entidades.length === 0) return;
    const i = indiceDe(datos.entidades[0]!);
    if (mundo.bando[i] !== bandoJugador) return;
    if (datos.tipo === 'atacar') {
      motor.tono({ frecuencia: 340, frecuenciaFinal: 220, tipo: 'square', duracion: 0.1, ganancia: 0.14 });
    } else {
      motor.tono({ frecuencia: 520, frecuenciaFinal: 640, tipo: 'sine', duracion: 0.08, ganancia: 0.1 });
    }
  });

  const alAviso = bus.al('aviso', (datos) => {
    if (!puedeAviso()) return;
    if (datos.severidad === 'peligro') {
      motor.tono({ frecuencia: 480, tipo: 'square', duracion: 0.16, ganancia: 0.2 });
      motor.tono({ frecuencia: 480, tipo: 'square', duracion: 0.16, ganancia: 0.2, retraso: 0.22 });
    } else if (datos.severidad === 'alerta') {
      motor.tono({ frecuencia: 400, tipo: 'triangle', duracion: 0.14, ganancia: 0.14 });
    }
  });

  // --- Fin de partida --------------------------------------------------------------

  const alFinPartida = bus.al('finPartida', (datos) => {
    if (datos.ganador === bandoJugador) {
      const notas = [523, 659, 784, 1046];
      notas.forEach((frecuencia, indice) => {
        motor.tono({ frecuencia, tipo: 'triangle', duracion: 0.35, ganancia: 0.22, retraso: indice * 0.14 });
      });
    } else {
      motor.tono({ frecuencia: 220, frecuenciaFinal: 90, tipo: 'sawtooth', duracion: 1.1, ganancia: 0.2 });
    }
  });

  const bajas = [
    alDanio, alMuerte, alProyectil, alRecursoEntregado, alConstruccionIniciada,
    alProducidoTerminado, alOrdenEmitida, alAviso, alFinPartida,
  ];

  return {
    liberar(): void {
      for (const baja of bajas) baja();
    },
  };
}
