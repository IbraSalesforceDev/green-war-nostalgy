import * as THREE from 'three';
import { CamaraJuego } from '../render/camara';
import { Renderizador, calidadPara, type NivelDispositivo } from '../render/renderizador';
import { construirTerreno } from '../render/terreno';
import { crearAgua } from '../render/agua';
import { crearCielo } from '../render/cielo';
import { crearVegetacion } from '../render/vegetacion';
import { crearIluminacion } from '../render/iluminacion';
import { generarMapa } from '../sim/generador';
import { ALTO_MAPA, ANCHO_MAPA, VELOCIDAD_CAMARA } from '../sim/constantes';

/**
 * Banco de pruebas del terreno.
 *
 * Monta *solo* el entorno —relieve, agua, cielo, vegetación e iluminación— sin
 * simulación, sin unidades y sin interfaz. Sirve para dos cosas: revisar el
 * aspecto con capturas automatizadas sin depender del resto del juego, y medir el
 * coste real del entorno (llamadas de dibujado y triángulos) aislado de todo lo
 * demás.
 *
 * Parámetros por URL:
 *   ?semilla=1234    semilla del mapa
 *   ?calidad=alto    fuerza el nivel de calidad (alto | medio | bajo)
 *   ?x=40&z=40&d=22  pose inicial de la cámara
 *
 * Expone `window.banco` y, por compatibilidad con `tools/capturar.mjs`,
 * `window.juego` con la misma cámara, el renderizador y la telemetría.
 */

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement | null;
const avisoError = document.getElementById('aviso-error');
const detalleError = document.getElementById('detalle-error');

function fallar(error: unknown): void {
  console.error(error);
  if (avisoError) avisoError.style.display = 'flex';
  if (detalleError) {
    detalleError.textContent =
      error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  }
}

function arrancar(): void {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo.');

  const parametros = new URLSearchParams(location.search);
  const semilla = Number(parametros.get('semilla') ?? 20260802);
  const nivelForzado = parametros.get('calidad') as NivelDispositivo | null;

  const renderizador = new Renderizador(lienzo);
  if (nivelForzado === 'alto' || nivelForzado === 'medio' || nivelForzado === 'bajo') {
    Object.assign(renderizador.calidad, calidadPara(nivelForzado));
    renderizador.nucleo.shadowMap.enabled = renderizador.calidad.resolucionSombras > 0;
  }
  const calidad = renderizador.calidad;

  const generado = generarMapa({ ancho: ANCHO_MAPA, alto: ALTO_MAPA, semilla });

  const escena = new THREE.Scene();

  const cielo = crearCielo(escena, calidad);
  const iluminacion = crearIluminacion(escena, calidad);

  const terreno = construirTerreno(generado.mapa, calidad);
  escena.add(terreno.malla);

  const agua = crearAgua(generado.mapa, calidad);
  escena.add(agua.raiz);

  const vegetacion = crearVegetacion(generado.mapa, calidad);
  escena.add(vegetacion.raiz);

  const camara = new CamaraJuego(generado.mapa, renderizador.relacionAspecto);
  const inicio = generado.inicios[0]!;
  camara.saltarA(
    Number(parametros.get('x') ?? inicio.cx + 4),
    Number(parametros.get('z') ?? inicio.cz + 4),
  );
  const distanciaPedida = Number(parametros.get('d') ?? 0);
  if (distanciaPedida > 0) camara.distancia = distanciaPedida;

  const teclas = conectarControles(camara, renderizador);

  const telemetria = { fps: 0, msRender: 0, msSimulacion: 0 };
  let ultimo = performance.now();
  let acumulado = 0;
  let fotogramas = 0;

  function fotograma(): void {
    requestAnimationFrame(fotograma);

    const ahora = performance.now();
    const dt = Math.min(0.1, (ahora - ultimo) / 1000);
    ultimo = ahora;

    teclas.aplicar(dt);
    // Con dt = 0 la cámara aplica su transformación sin perseguir los valores
    // deseados: así la pose que fija la herramienta de captura no se deshace sola.
    camara.actualizar(teclas.hayMovimiento ? dt : 0);

    iluminacion.actualizar(dt);
    iluminacion.enfocarSombras(camara.objetivoX, camara.objetivoZ);
    cielo.actualizar(dt);
    terreno.actualizar(dt);
    agua.actualizar(dt);
    vegetacion.actualizar(dt);

    renderizador.reiniciarEstadisticas();
    const inicioRender = performance.now();
    renderizador.nucleo.render(escena, camara.nucleo);
    telemetria.msRender = performance.now() - inicioRender;

    fotogramas++;
    acumulado += dt;
    if (acumulado >= 0.5) {
      telemetria.fps = fotogramas / acumulado;
      acumulado = 0;
      fotogramas = 0;
    }
  }

  window.addEventListener('resize', () => {
    renderizador.redimensionar();
    camara.redimensionar(renderizador.relacionAspecto);
  });

  fotograma();

  const banco = {
    escena,
    camara,
    renderizador,
    terreno,
    agua,
    cielo,
    vegetacion,
    iluminacion,
    generado,
    bucle: telemetria,
  };

  Object.assign(window as unknown as Record<string, unknown>, {
    banco,
    // `tools/capturar.mjs` busca `window.juego` para mover la cámara y leer la
    // telemetría; se lo damos con el mismo contenido.
    juego: banco,
  });

  console.info(
    `[banco] calidad=${calidad.nivel} plantas=${vegetacion.total} agua=${agua.hayAgua}`,
  );
}

/** Controles mínimos: teclado para desplazar y rueda para acercar. */
function conectarControles(
  camara: CamaraJuego,
  renderizador: Renderizador,
): { aplicar(dt: number): void; hayMovimiento: boolean } {
  const pulsadas = new Set<string>();

  window.addEventListener('keydown', (evento) => pulsadas.add(evento.code));
  window.addEventListener('keyup', (evento) => pulsadas.delete(evento.code));

  renderizador.lienzo.addEventListener(
    'wheel',
    (evento) => {
      evento.preventDefault();
      camara.acercar(evento.deltaY > 0 ? 1.12 : 0.89);
      control.hayMovimiento = true;
    },
    { passive: false },
  );

  const control = {
    hayMovimiento: false,
    aplicar(dt: number): void {
      let dx = 0;
      let dz = 0;
      if (pulsadas.has('KeyW') || pulsadas.has('ArrowUp')) dz -= 1;
      if (pulsadas.has('KeyS') || pulsadas.has('ArrowDown')) dz += 1;
      if (pulsadas.has('KeyA') || pulsadas.has('ArrowLeft')) dx -= 1;
      if (pulsadas.has('KeyD') || pulsadas.has('ArrowRight')) dx += 1;
      if (pulsadas.has('KeyQ')) camara.girar(dt * 0.9);
      if (pulsadas.has('KeyE')) camara.girar(-dt * 0.9);
      if (dx === 0 && dz === 0) return;

      control.hayMovimiento = true;
      const norma = Math.hypot(dx, dz);
      const paso = (VELOCIDAD_CAMARA * dt) / norma;
      camara.desplazar(dx * paso, dz * paso);
    },
  };

  return control;
}

try {
  arrancar();
} catch (error) {
  fallar(error);
}
