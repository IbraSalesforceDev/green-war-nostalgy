import { BucleJuego } from './core/loop';
import { Renderizador } from './render/renderizador';
import { crearEscenaCampana } from './campana/escena';
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
 * La campaña por turnos es la pantalla principal: un mapa de territorios que se
 * conquistan uno a uno. Cuando dos ejércitos chocan, la partida cede el mando a
 * una escena de acción —la batalla campal o el asalto a un fuerte— y espera su
 * veredicto para seguir. Esas escenas todavía no están montadas: de momento los
 * choques se dirimen con el modelo de fuerzas de `campana.ts`, que es el mismo
 * que usarán después para decidir quién parte con ventaja.
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

  progreso(0.8, 'Pasando revista a las tropas…');
  await respirar();

  // El audio arranca suspendido hasta el primer gesto: es política del navegador.
  const motorAudio = crearMotorAudio();
  motorAudio.desbloquearConGesto();

  const bucle = new BucleJuego({
    hercios: 30,
    alSimular: (dt) => {
      campana.actualizar(dt);
    },
    alRenderizar: (dtReal) => {
      renderizador.reiniciarEstadisticas();
      renderizador.nucleo.render(campana.escena, campana.camara);
      renderizador.ajustarResolucion(bucle.msRender + bucle.msSimulacion, dtReal);
    },
  });

  window.addEventListener('resize', () => {
    renderizador.redimensionar();
    campana.redimensionar(renderizador.ancho, renderizador.alto);
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
      escena: campana.escena,
      camara: campana.camara,
    },
  });
}

arrancar().catch(fallar);
