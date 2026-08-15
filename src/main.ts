import { BucleJuego } from './core/loop';
import { Renderizador } from './render/renderizador';
import { crearEscenaCampana } from './campana/escena';
import { crearEscenaBatalla, type EscenaBatalla } from './batalla/escena';
import { PASO_BATALLA } from './batalla/batalla';
import { crearMotorAudio } from './audio/motor';
import './ui/estilos.css';

/**
 * Punto de entrada.
 *
 * Monta el renderizador, arranca la escena de campaña y echa a andar el bucle.
 * Todo lo que ocurre aquí es cableado: la lógica vive en los módulos, y este
 * archivo solo decide en qué orden se construyen las cosas y quién habla con quién.
 *
 * ── Estructura del juego ─────────────────────────────────────────────────────
 * Hay dos escenas y este fichero decide cuál manda. La campaña por turnos es la
 * pantalla principal: un mapa de territorios que se conquistan uno a uno. Cuando
 * dos ejércitos chocan, el mapa se congela y cede el mando a la batalla campal,
 * que se juega en tiempo real; al terminar, su veredicto vuelve a la campaña y
 * el turno sigue donde lo dejó.
 *
 * El cambio de escena es un simple puntero: `escenaActiva` decide a quién se le
 * pasa el `dt` y qué cámara se dibuja. No hace falta más maquinaria para dos
 * escenas que nunca coexisten.
 */

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement | null;
const cargador = document.getElementById('cargador');
const barra = document.getElementById('barra-relleno');
const textoCarga = document.getElementById('texto-carga');
const avisoError = document.getElementById('aviso-error');
const detalleError = document.getElementById('detalle-error');

function progreso(fraccion: number, mensaje: string): void {
  if (barra) barra.style.width = `${Math.round(fraccion * 100)}%`;
  if (textoCarga) textoCarga.textContent = mensaje;
}

function fallar(error: unknown): void {
  console.error(error);
  if (cargador) cargador.style.display = 'none';
  if (avisoError) avisoError.style.display = 'flex';
  if (detalleError) {
    detalleError.textContent =
      error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  }
}

/** Deja pasar un fotograma para que la barra de carga se repinte de verdad. */
function respirar(): Promise<void> {
  return new Promise((resolver) => requestAnimationFrame(() => resolver()));
}

async function arrancar(): Promise<void> {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo en el documento.');

  progreso(0.15, 'Desplegando los mapas…');
  await respirar();

  const renderizador = new Renderizador(lienzo);
  console.log(`[arranque] Calidad detectada: ${renderizador.calidad.nivel}`);

  progreso(0.45, 'Repartiendo los estados…');
  await respirar();

  const capaInterfaz = document.getElementById('capa-ui') as HTMLElement;

  // La semilla se puede fijar por la barra de direcciones para repetir una partida
  // concreta: es lo que hace reproducibles los informes de fallo.
  const parametros = new URLSearchParams(location.search);
  const semillaTexto = parametros.get('semilla');
  const semilla = semillaTexto ? Number(semillaTexto) : undefined;

  const campana = crearEscenaCampana({
    lienzo,
    capaInterfaz,
    relacionAspecto: renderizador.relacionAspecto,
    altoCss: lienzo.clientHeight || window.innerHeight,
    semilla: Number.isFinite(semilla) ? semilla : undefined,
    conSombras: renderizador.calidad.resolucionSombras > 0,
  });

  // --- Cambio entre el mapa y el campo de batalla ---
  let batalla: EscenaBatalla | null = null;
  /** Territorio que se disputa en la batalla en curso: hay que devolverlo con el parte. */
  let territorioEnDisputa = '';

  campana.alPedirBatalla((choque) => {
    territorioEnDisputa = choque.territorio;
    batalla = crearEscenaBatalla({
      capaInterfaz,
      relacionAspecto: renderizador.relacionAspecto,
      atacante: choque.atacante,
      composicionAtacante: choque.composicionAtacante,
      composicionDefensor: choque.composicionDefensor,
      bandoJugador: campana.campana.bandoJugador,
      enFuerte: choque.tipo === 'fuerte',
      // La semilla se deriva del territorio y del turno para que repetir la
      // misma partida reproduzca también la misma batalla.
      semilla: (choque.territorio.length * 7919 + campana.campana.turno * 104729) >>> 0,
      conSombras: renderizador.calidad.resolucionSombras > 0,
    });
    batalla.redimensionar(renderizador.ancho, renderizador.alto);
  });

  /** Cierra la batalla en curso y devuelve su veredicto a la campaña. */
  function terminarBatalla(activa: EscenaBatalla): void {
    const desenlace = activa.desenlace();
    const choque = activa.batalla;
    activa.liberar();
    batalla = null;
    campana.resolverBatallaJugada({
      territorio: territorioEnDisputa,
      atacante: choque.atacante,
      vencedor: desenlace.vencedor,
      supervivientesAtacante: desenlace.supervivientesAtacante,
      supervivientesDefensor: desenlace.supervivientesDefensor,
    });
  }

  progreso(0.8, 'Pasando revista a las tropas…');
  await respirar();

  // El audio arranca suspendido hasta el primer gesto: es política del navegador.
  const motorAudio = crearMotorAudio();
  motorAudio.desbloquearConGesto();

  const bucle = new BucleJuego({
    hercios: 30,
    alSimular: (dt) => {
      const activa = batalla;
      if (activa) {
        // La batalla corre a su propio ritmo fijo, no al del bucle del mapa. El
        // ×2 y el ×3 repiten ese mismo paso en vez de alargarlo: así acelerar
        // solo cambia lo que tardas en verla, nunca cómo acaba.
        for (let i = 0; i < activa.velocidad; i++) {
          activa.actualizar(PASO_BATALLA);
          if (activa.terminada) break;
        }
        if (activa.terminada) terminarBatalla(activa);
        return;
      }
      campana.actualizar(dt);
    },
    alRenderizar: (dtReal) => {
      renderizador.reiniciarEstadisticas();
      const activa = batalla;
      renderizador.nucleo.render(
        activa ? activa.escena : campana.escena,
        activa ? activa.camara : campana.camara,
      );
      renderizador.ajustarResolucion(bucle.msRender + bucle.msSimulacion, dtReal);
    },
  });

  window.addEventListener('resize', () => {
    renderizador.redimensionar();
    campana.redimensionar(renderizador.ancho, renderizador.alto);
    batalla?.redimensionar(renderizador.ancho, renderizador.alto);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) bucle.pausar();
    else bucle.reanudar();
  });

  bucle.iniciar();

  progreso(1, '¡A las armas!');
  await respirar();

  cargador?.classList.add('oculto');
  setTimeout(() => cargador?.remove(), 900);

  // Expuesto para depuración desde la consola y para las capturas automatizadas.
  Object.assign(window as unknown as Record<string, unknown>, {
    juego: {
      renderizador,
      bucle,
      motorAudio,
      campanaEscena: campana,
      campana: campana.campana,
      get batalla() {
        return batalla;
      },
      escena: campana.escena,
      camara: campana.camara,
    },
  });
}

arrancar().catch(fallar);
