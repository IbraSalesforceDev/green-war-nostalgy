import * as THREE from 'three';
import { BucleJuego } from './core/loop';
import { CamaraJuego } from './render/camara';
import { Renderizador } from './render/renderizador';
import { construirTerreno } from './render/terreno';
import { generarMapa } from './sim/generador';
import { Mundo } from './sim/mundo';
import {
  ALTO_MAPA,
  ANCHO_MAPA,
  HERCIOS_SIMULACION,
  VELOCIDAD_CAMARA,
} from './sim/constantes';

/**
 * Punto de entrada.
 *
 * Ensambla las piezas y arranca el bucle. Todo lo que ocurre aquí es cableado:
 * la lógica vive en los módulos, y este archivo solo decide en qué orden se
 * construyen las cosas y quién habla con quién.
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
    detalleError.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  }
}

/** Deja pasar un fotograma para que la barra de carga se repinte de verdad. */
function respirar(): Promise<void> {
  return new Promise((resolver) => requestAnimationFrame(() => resolver()));
}

async function arrancar(): Promise<void> {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo en el documento.');

  progreso(0.05, 'Encendiendo la forja…');
  await respirar();

  const renderizador = new Renderizador(lienzo);
  console.info(`[arranque] Calidad detectada: ${renderizador.calidad.nivel}`);

  progreso(0.2, 'Levantando las montañas…');
  await respirar();

  const semilla = Math.floor(Math.random() * 0x7fffffff);
  const generado = generarMapa({ ancho: ANCHO_MAPA, alto: ALTO_MAPA, semilla });
  const mundo = new Mundo(generado.mapa, semilla);

  progreso(0.45, 'Sembrando los bosques…');
  await respirar();

  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x1b2530);
  escena.fog = new THREE.Fog(0x1b2530, 60, 190);

  const terreno = construirTerreno(generado.mapa);
  escena.add(terreno.malla);

  progreso(0.7, 'Encendiendo el sol…');
  await respirar();

  configurarLuces(escena, renderizador);

  const camara = new CamaraJuego(generado.mapa, renderizador.relacionAspecto);
  const inicioJugador = generado.inicios[0]!;
  camara.saltarA(inicioJugador.cx + 2, inicioJugador.cz + 2);

  progreso(0.9, 'Convocando a los ejércitos…');
  await respirar();

  const teclas = conectarControles(camara, renderizador);

  const bucle = new BucleJuego({
    hercios: HERCIOS_SIMULACION,
    alSimular: (dt) => {
      mundo.tick++;
      mundo.archivarTransformaciones();
      mundo.reconstruirEspacial();
      void dt;
    },
    alRenderizar: (dtReal) => {
      teclas.aplicar(dtReal);
      camara.actualizar(dtReal);
      renderizador.reiniciarEstadisticas();
      renderizador.nucleo.render(escena, camara.nucleo);
      renderizador.ajustarResolucion(bucle.msRender + bucle.msSimulacion, dtReal);
    },
  });

  window.addEventListener('resize', () => {
    renderizador.redimensionar();
    camara.redimensionar(renderizador.relacionAspecto);
  });

  // Al volver de segundo plano no queremos que la simulación intente recuperar
  // todo el tiempo perdido de golpe.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) bucle.pausar();
    else bucle.reanudar();
  });

  bucle.iniciar();

  progreso(1, '¡A las armas!');
  await respirar();

  cargador?.classList.add('oculto');
  setTimeout(() => cargador?.remove(), 900);

  // Expuesto para depuración desde la consola del navegador y para las capturas
  // automatizadas de la revisión visual.
  Object.assign(window as unknown as Record<string, unknown>, {
    juego: { mundo, camara, escena, renderizador, bucle, generado },
  });
}

/**
 * Iluminación de la escena.
 *
 * Tres luces y nada más: un sol direccional que proyecta las sombras y define la
 * hora del día, un relleno frío desde el lado opuesto para que las zonas en sombra
 * no sean manchas negras, y una hemisférica que simula el rebote del cielo y del
 * suelo. Es el esquema mínimo que hace que un modelo sencillo parezca esculpido.
 */
function configurarLuces(escena: THREE.Scene, renderizador: Renderizador): void {
  const sol = new THREE.DirectionalLight(0xffe8bd, 2.6);
  sol.position.set(-45, 70, 30);
  sol.name = 'sol';

  if (renderizador.calidad.resolucionSombras > 0) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(
      renderizador.calidad.resolucionSombras,
      renderizador.calidad.resolucionSombras,
    );
    const c = sol.shadow.camera;
    c.near = 1;
    c.far = 260;
    c.left = -55;
    c.right = 55;
    c.top = 55;
    c.bottom = -55;
    c.updateProjectionMatrix();
    // El sesgo normal es el que quita el moteado de las superficies inclinadas sin
    // despegar las sombras de los pies de las unidades.
    sol.shadow.bias = -0.0006;
    sol.shadow.normalBias = 0.035;
  }

  escena.add(sol);
  escena.add(sol.target);

  const relleno = new THREE.DirectionalLight(0x8ab4e8, 0.55);
  relleno.position.set(50, 35, -40);
  escena.add(relleno);

  const cielo = new THREE.HemisphereLight(0x9fc6f0, 0x4a3b28, 0.75);
  escena.add(cielo);
}

/** Controles provisionales de cámara: teclado, rueda y arrastre. */
function conectarControles(
  camara: CamaraJuego,
  renderizador: Renderizador,
): { aplicar(dt: number): void } {
  const pulsadas = new Set<string>();

  window.addEventListener('keydown', (evento) => {
    pulsadas.add(evento.code);
    if (evento.code === 'Space') camara.reiniciarGiro();
  });
  window.addEventListener('keyup', (evento) => pulsadas.delete(evento.code));

  renderizador.lienzo.addEventListener(
    'wheel',
    (evento) => {
      evento.preventDefault();
      camara.acercar(evento.deltaY > 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );

  let arrastrando = false;
  let ultimoX = 0;
  let ultimoY = 0;

  renderizador.lienzo.addEventListener('pointerdown', (evento) => {
    if (evento.button !== 2 && evento.button !== 1) return;
    arrastrando = true;
    ultimoX = evento.clientX;
    ultimoY = evento.clientY;
    renderizador.lienzo.setPointerCapture(evento.pointerId);
  });

  renderizador.lienzo.addEventListener('pointermove', (evento) => {
    if (!arrastrando) return;
    const escalaMundo = camara.distancia * 0.0022;
    camara.desplazar(
      -(evento.clientX - ultimoX) * escalaMundo,
      -(evento.clientY - ultimoY) * escalaMundo,
    );
    ultimoX = evento.clientX;
    ultimoY = evento.clientY;
  });

  const soltar = (): void => {
    arrastrando = false;
  };
  renderizador.lienzo.addEventListener('pointerup', soltar);
  renderizador.lienzo.addEventListener('pointercancel', soltar);
  renderizador.lienzo.addEventListener('contextmenu', (evento) => evento.preventDefault());

  return {
    aplicar(dt: number): void {
      let dx = 0;
      let dz = 0;
      if (pulsadas.has('KeyW') || pulsadas.has('ArrowUp')) dz -= 1;
      if (pulsadas.has('KeyS') || pulsadas.has('ArrowDown')) dz += 1;
      if (pulsadas.has('KeyA') || pulsadas.has('ArrowLeft')) dx -= 1;
      if (pulsadas.has('KeyD') || pulsadas.has('ArrowRight')) dx += 1;
      if (dx === 0 && dz === 0) return;

      const norma = Math.hypot(dx, dz);
      const paso = (VELOCIDAD_CAMARA * dt) / norma;
      camara.desplazar(dx * paso, dz * paso);
    },
  };
}

arrancar().catch(fallar);
