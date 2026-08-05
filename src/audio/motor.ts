/**
 * Motor de audio sintetizado.
 *
 * Cero ficheros de sonido: todo se genera con osciladores, ruido filtrado y
 * envolventes, igual que la geometría del juego se genera por código en vez de
 * cargarse de un modelo. Además de evitar cualquier roce con IP ajena, mantiene
 * el peso de la descarga en cero.
 *
 * Los navegadores bloquean el audio hasta el primer gesto del usuario
 * (`autoplay policy`); `crearMotorAudio` no arranca el `AudioContext` por su
 * cuenta, `desbloquearConGesto` lo hace en el primer toque o clic.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearMotorAudio(): MotorAudio
 *     · maestro: nodo de ganancia raíz, para conectar cualquier fuente nueva
 *     · tono(opciones): oscilador con envolvente ADR simple, ya conectado y lanzado
 *     · ruido(opciones): ráfaga de ruido filtrado, misma forma de uso que `tono`
 *     · silenciar(activo): corta o restaura el volumen maestro sin parar nada
 *     · liberar(): cierra el contexto
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface OpcionesTono {
  /** Hercios al empezar. */
  frecuencia: number;
  /** Si se indica, la frecuencia desliza hasta este valor a lo largo de la nota. */
  frecuenciaFinal?: number;
  tipo?: OscillatorType;
  duracion: number;
  ganancia?: number;
  ataque?: number;
  /** Retraso antes de empezar a sonar, en segundos desde ahora. */
  retraso?: number;
}

export interface OpcionesRuido {
  duracion: number;
  tipoFiltro?: BiquadFilterType;
  frecuenciaFiltro: number;
  q?: number;
  ganancia?: number;
  ataque?: number;
  retraso?: number;
}

export interface MotorAudio {
  readonly contexto: AudioContext;
  readonly maestro: GainNode;
  desbloquearConGesto(): void;
  tono(opciones: OpcionesTono): void;
  ruido(opciones: OpcionesRuido): void;
  silenciar(activo: boolean): void;
  liberar(): void;
}

/** Búfer de ruido blanco reutilizado por todas las ráfagas: generarlo una vez es gratis. */
function crearBuferRuido(contexto: AudioContext): AudioBuffer {
  const duracion = 2;
  const buffer = contexto.createBuffer(1, contexto.sampleRate * duracion, contexto.sampleRate);
  const canal = buffer.getChannelData(0);
  for (let i = 0; i < canal.length; i++) canal[i] = Math.random() * 2 - 1;
  return buffer;
}

export function crearMotorAudio(): MotorAudio {
  const ConstructorContexto =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const contexto = new ConstructorContexto();

  const maestro = contexto.createGain();
  maestro.gain.value = 0.55;

  // Sin compresor, una ráfaga de daño en un combate grande recortaría la señal
  // (clipping audible) en vez de simplemente sonar más lleno.
  const compresor = contexto.createDynamicsCompressor();
  compresor.threshold.value = -18;
  compresor.knee.value = 12;
  compresor.ratio.value = 6;
  compresor.attack.value = 0.003;
  compresor.release.value = 0.18;

  maestro.connect(compresor);
  compresor.connect(contexto.destination);

  const buferRuido = crearBuferRuido(contexto);

  let ganPrevia = maestro.gain.value;

  function desbloquearConGesto(): void {
    if (contexto.state !== 'suspended') return;
    const reanudar = () => {
      contexto.resume().catch(() => {});
    };
    // 'once' se da de baja solo: no hace falta llevar la cuenta de los listeners.
    window.addEventListener('pointerdown', reanudar, { once: true });
    window.addEventListener('keydown', reanudar, { once: true });
  }

  return {
    contexto,
    maestro,

    desbloquearConGesto,

    tono({ frecuencia, frecuenciaFinal, tipo = 'sine', duracion, ganancia = 0.3, ataque = 0.006, retraso = 0 }): void {
      if (contexto.state !== 'running') return;
      const ahora = contexto.currentTime + retraso;

      const oscilador = contexto.createOscillator();
      oscilador.type = tipo;
      oscilador.frequency.setValueAtTime(frecuencia, ahora);
      if (frecuenciaFinal !== undefined) {
        oscilador.frequency.exponentialRampToValueAtTime(Math.max(1, frecuenciaFinal), ahora + duracion);
      }

      const envolvente = contexto.createGain();
      envolvente.gain.setValueAtTime(0, ahora);
      envolvente.gain.linearRampToValueAtTime(ganancia, ahora + ataque);
      envolvente.gain.exponentialRampToValueAtTime(0.001, ahora + duracion);

      oscilador.connect(envolvente);
      envolvente.connect(maestro);
      oscilador.start(ahora);
      oscilador.stop(ahora + duracion + 0.02);
    },

    ruido({ duracion, tipoFiltro = 'bandpass', frecuenciaFiltro, q = 1, ganancia = 0.3, ataque = 0.002, retraso = 0 }): void {
      if (contexto.state !== 'running') return;
      const ahora = contexto.currentTime + retraso;

      const fuente = contexto.createBufferSource();
      fuente.buffer = buferRuido;
      // Punto de partida aleatorio en el búfer: dos ráfagas seguidas no suenan idénticas.
      fuente.loop = false;
      const inicio = Math.random() * (buferRuido.duration - duracion - 0.05);

      const filtro = contexto.createBiquadFilter();
      filtro.type = tipoFiltro;
      filtro.frequency.value = frecuenciaFiltro;
      filtro.Q.value = q;

      const envolvente = contexto.createGain();
      envolvente.gain.setValueAtTime(0, ahora);
      envolvente.gain.linearRampToValueAtTime(ganancia, ahora + ataque);
      envolvente.gain.exponentialRampToValueAtTime(0.001, ahora + duracion);

      fuente.connect(filtro);
      filtro.connect(envolvente);
      envolvente.connect(maestro);
      fuente.start(ahora, Math.max(0, inicio));
      fuente.stop(ahora + duracion + 0.02);
    },

    silenciar(activo: boolean): void {
      if (activo) {
        ganPrevia = maestro.gain.value;
        maestro.gain.setTargetAtTime(0, contexto.currentTime, 0.05);
      } else {
        maestro.gain.setTargetAtTime(ganPrevia, contexto.currentTime, 0.05);
      }
    },

    liberar(): void {
      contexto.close().catch(() => {});
    },
  };
}
