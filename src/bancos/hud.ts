import * as THREE from 'three';
import { CamaraJuego } from '../render/camara';
import { Renderizador } from '../render/renderizador';
import { construirTerreno } from '../render/terreno';
import { crearAgua } from '../render/agua';
import { crearCielo } from '../render/cielo';
import { crearVegetacion } from '../render/vegetacion';
import { crearIluminacion } from '../render/iluminacion';
import { generarMapa } from '../sim/generador';
import { Mundo } from '../sim/mundo';
import { buscarHuecoParaHuella, crearEdificio, crearUnidad, poblarMapaInicial } from '../sim/fabrica';
import { fichaEdificio } from '../sim/datos/edificios';
import { fichaUnidad } from '../sim/datos/unidades';
import { ANCHO_MAPA, ALTO_MAPA, VELOCIDAD_CAMARA } from '../sim/constantes';
import { Bando, Clase, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';
import { sesion } from '../estado/sesion';
import { crearHud, type ComandoInterfaz } from '../ui/hud';

/**
 * Banco de pruebas del HUD.
 *
 * Monta un mundo real —mapa generado, terreno, agua, cielo, vegetación,
 * iluminación y las dos bases con `poblarMapaInicial`— y le añade a mano justo lo
 * que ninguna partida de cinco segundos tendría todavía: tropa variada, una cola
 * de producción con progreso dispar y un edificio enemigo a media vida. No corre
 * la simulación real (nada de rutas ni de IA): este banco es de la interfaz, y la
 * interfaz no necesita una partida jugable debajo, solo un `Mundo` con datos
 * interesantes que leer.
 *
 * Parámetros por URL:
 *   ?semilla=1234        semilla del mapa
 *   ?vista=edificio|obrero|tropa|construir|multiple|enemigo|vacio
 *                        qué hay seleccionado al arrancar (por defecto "edificio")
 *   ?x=&z=&d=            pose inicial de la cámara, para encuadrar a mano
 *
 * Expone `window.banco = { hud, mundo, camara }` tal y como pide la verificación
 * visual, y además `window.juego` con la misma cámara y la telemetría, por
 * compatibilidad con `tools/capturar.mjs`.
 */

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement | null;
const avisoError = document.getElementById('aviso-error');
const detalleError = document.getElementById('detalle-error');
const capaUi = document.getElementById('capa-ui');

function fallar(error: unknown): void {
  console.error(error);
  if (avisoError) avisoError.style.display = 'flex';
  if (detalleError) {
    detalleError.textContent =
      error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  }
}

/** Revela un círculo de visión permanente, como si un explorador vigilara ese punto. */
function revelarCirculo(mundo: Mundo, bando: Bando, x: number, z: number, radioCasillas: number): void {
  const cx = mundo.mapa.aCasilla(x);
  const cz = mundo.mapa.aCasilla(z);
  mundo.mapa.aplicarVision(bando, cx, cz, radioCasillas, true);
}

/** Revela una zona y la deja acto seguido en "recordado": terreno visto, no vigilado. */
function revelarMemoria(mundo: Mundo, bando: Bando, x: number, z: number, radioCasillas: number): void {
  const cx = mundo.mapa.aCasilla(x);
  const cz = mundo.mapa.aCasilla(z);
  mundo.mapa.aplicarVision(bando, cx, cz, radioCasillas, true);
  mundo.mapa.aplicarVision(bando, cx, cz, radioCasillas, false);
}

function arrancar(): void {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo.');
  if (!capaUi) throw new Error('No se ha encontrado #capa-ui.');

  const parametros = new URLSearchParams(location.search);
  const semilla = Number(parametros.get('semilla') ?? 20260803);
  const vista = parametros.get('vista') ?? 'edificio';

  const renderizador = new Renderizador(lienzo);
  const calidad = renderizador.calidad;

  const generado = generarMapa({ ancho: ANCHO_MAPA, alto: ALTO_MAPA, semilla });
  const mundo = new Mundo(generado.mapa, semilla);
  poblarMapaInicial(mundo, generado);
  mundo.estadoDe(Bando.ORCOS).esIA = true;
  sesion.bandoJugador = Bando.HUMANOS;

  const inicioJugador = generado.inicios[0]!;
  const inicioEnemigo = generado.inicios[1]!;
  const centroJugadorX = mundo.mapa.centroCasilla(inicioJugador.cx + 2);
  const centroJugadorZ = mundo.mapa.centroCasilla(inicioJugador.cz + 2);
  const centroEnemigoX = mundo.mapa.centroCasilla(inicioEnemigo.cx + 2);
  const centroEnemigoZ = mundo.mapa.centroCasilla(inicioEnemigo.cz + 2);

  // --- Escena: mismas piezas que `main.ts`, para que el HUD se juzgue sobre el
  //     mismo aspecto que verá el jugador de verdad. ---
  const escena = new THREE.Scene();
  const terreno = construirTerreno(generado.mapa, calidad);
  escena.add(terreno.malla);
  const agua = crearAgua(generado.mapa, calidad);
  escena.add(agua.raiz);
  const cielo = crearCielo(escena, calidad);
  const vegetacion = crearVegetacion(generado.mapa, calidad);
  escena.add(vegetacion.raiz);
  const iluminacion = crearIluminacion(escena, calidad);
  escena.add(iluminacion.raiz);

  // --- Tropa y edificios extra, a mano, para ejercitar cada panel del HUD. ---

  const soldadosJugador = [
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, centroJugadorX + 3.2, centroJugadorZ - 2.4),
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, centroJugadorX + 4.2, centroJugadorZ - 2.4),
    crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, centroJugadorX + 3.7, centroJugadorZ - 3.4),
    crearUnidad(mundo, TipoUnidad.JINETE, Bando.HUMANOS, centroJugadorX + 5.2, centroJugadorZ - 3),
  ];
  // Un campesino con carga a medias, para que la ficha de un solo obrero muestre algo.
  const obreroCargado = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, centroJugadorX - 3, centroJugadorZ + 2);
  {
    const i = indiceDe(obreroCargado);
    mundo.cargaTipo[i] = 0;
    mundo.cargaCantidad[i] = 6;
    mundo.vida[i] = fichaUnidad(TipoUnidad.CAMPESINO).vida * 0.7;
  }

  const tropaEnemiga = [
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, centroEnemigoX - 3, centroEnemigoZ + 2),
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, centroEnemigoX - 4, centroEnemigoZ + 2.6),
  ];

  // El ayuntamiento propio: le fabricamos una cola de dos campesinos con progresos
  // distintos, para que el panel de selección dibuje la barra de progreso y el
  // botón de cancelar de verdad.
  let ayuntamientoJugador = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== Clase.EDIFICIO) continue;
    if (mundo.bando[i] !== Bando.HUMANOS) continue;
    if (mundo.tipo[i] !== TipoEdificio.AYUNTAMIENTO) continue;
    ayuntamientoJugador = i;
    break;
  }
  if (ayuntamientoJugador) {
    const tiempo = fichaUnidad(TipoUnidad.CAMPESINO).tiempoEntrenamiento;
    mundo.colas.set(ayuntamientoJugador, [
      { tipoUnidad: TipoUnidad.CAMPESINO, restante: tiempo * 0.35, total: tiempo },
      { tipoUnidad: TipoUnidad.CAMPESINO, restante: tiempo * 0.9, total: tiempo },
    ]);
  }

  // Un edificio enemigo propio de la tropa (no el ayuntamiento) a media vida, para
  // ver la barra de vida en tono ámbar/rojo cuando se inspecciona algo que no es
  // propio (la carta de comandos, en ese caso, debe quedar vacía).
  let barraconEnemigo = 0;
  const huecoBarracon = buscarHuecoParaHuella(
    mundo.mapa,
    inicioEnemigo.cx - 6,
    inicioEnemigo.cz + 1,
    fichaEdificio(TipoEdificio.BARRACON).huella,
    10,
  );
  if (huecoBarracon) {
    const entidadBarracon = crearEdificio(mundo, TipoEdificio.BARRACON, Bando.ORCOS, huecoBarracon[0], huecoBarracon[1], true);
    barraconEnemigo = indiceDe(entidadBarracon);
    mundo.vida[barraconEnemigo] = fichaEdificio(TipoEdificio.BARRACON).vida * 0.32;
  }

  // --- Niebla de guerra: alrededor de la base propia y de la tropa, vigilancia
  //     activa; un corredor hacia el enemigo, memoria; el resto, sin explorar. ---
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.bando[i] !== Bando.HUMANOS) continue;
    if (mundo.clase[i] !== Clase.UNIDAD && mundo.clase[i] !== Clase.EDIFICIO) continue;
    revelarCirculo(mundo, Bando.HUMANOS, mundo.x[i]!, mundo.z[i]!, Math.max(6, mundo.vision[i]!));
  }
  const pasos = 10;
  for (let k = 0; k <= pasos; k++) {
    const t = k / pasos;
    revelarMemoria(
      mundo,
      Bando.HUMANOS,
      centroJugadorX + (centroEnemigoX - centroJugadorX) * t,
      centroJugadorZ + (centroEnemigoZ - centroJugadorZ) * t,
      7,
    );
  }
  // Un "explorador" ha llegado hasta la base enemiga: se ve en vivo, no solo de memoria.
  revelarCirculo(mundo, Bando.HUMANOS, centroEnemigoX, centroEnemigoZ, 9);

  // --- Avisos de ejemplo: uno de cada severidad, con claves distintas para que
  //     `sesion.avisar` no los descarte por repetidos. ---
  sesion.avisar('Aserradero terminado', 'info', centroJugadorX, centroJugadorZ, 'demo-info');
  sesion.avisar('Población casi al límite', 'alerta', centroJugadorX, centroJugadorZ, 'demo-alerta');
  sesion.avisar('¡Tu base está bajo ataque!', 'peligro', centroEnemigoX, centroEnemigoZ, 'demo-peligro');

  // --- Selección inicial, según `?vista=`. ---
  function seleccionar(entidades: number[]): void {
    sesion.seleccionar(mundo, entidades);
  }
  switch (vista) {
    case 'obrero':
      seleccionar([obreroCargado]);
      break;
    case 'tropa':
      seleccionar(soldadosJugador);
      break;
    case 'construir':
      // Selecciona el obrero y simula el clic real en "Construir" para abrir el
      // submenú: es estado privado de `cartaComandos`, así que la única forma
      // honesta de llegar a él desde fuera es a través del propio botón.
      seleccionar([obreroCargado]);
      requestAnimationFrame(() => {
        const boton = capaUi.querySelector<HTMLButtonElement>('.gwn-comandos [aria-label="Construir"]');
        boton?.click();
      });
      break;
    case 'multiple':
      seleccionar([obreroCargado, ...soldadosJugador]);
      break;
    case 'enemigo':
      if (barraconEnemigo) seleccionar([mundo.entidadDeIndice(barraconEnemigo)]);
      break;
    case 'vacio':
      break;
    default:
      if (ayuntamientoJugador) seleccionar([mundo.entidadDeIndice(ayuntamientoJugador)]);
  }

  // --- Cámara y HUD ---
  const camara = new CamaraJuego(generado.mapa, renderizador.relacionAspecto);
  camara.saltarA(
    Number(parametros.get('x') ?? centroJugadorX),
    Number(parametros.get('z') ?? centroJugadorZ + 2),
  );
  const distanciaPedida = Number(parametros.get('d') ?? 0);
  camara.distancia = distanciaPedida > 0 ? distanciaPedida : 20;

  const hud = crearHud(capaUi, mundo);
  hud.fijarCamara(camara);
  hud.alPulsarMinimapa((x, z) => console.info(`[banco-hud] minimapa -> (${x.toFixed(1)}, ${z.toFixed(1)})`));
  hud.alPulsarComando((comando: ComandoInterfaz) => console.info('[banco-hud] comando', comando));

  const teclas = conectarControles(camara, renderizador);

  // --- Bucle: nada de simulación real, solo cosmética para que el HUD respire
  //     en las capturas (los números ruedan, la cola avanza, algo se mueve). ---
  const telemetria = { fps: 0, msRender: 0, msSimulacion: 0 };
  let ultimo = performance.now();
  let acumulado = 0;
  let fotogramas = 0;

  function fotograma(): void {
    requestAnimationFrame(fotograma);

    const ahora = performance.now();
    const dt = Math.min(0.1, (ahora - ultimo) / 1000);
    ultimo = ahora;

    sesion.tiempoPartida += dt;
    sesion.depurarSeleccion(mundo);
    sesion.caducarAvisos();

    // Economía de juguete: sube despacio para que la barra de recursos se vea
    // rodar en las capturas con espera, sin necesitar un solo sistema real.
    const humanos = mundo.estadoDe(Bando.HUMANOS);
    humanos.oro = Math.min(4000, humanos.oro + dt * 45);
    humanos.madera = Math.min(3000, humanos.madera + dt * 22);

    if (ayuntamientoJugador) {
      const cola = mundo.colas.get(ayuntamientoJugador);
      if (cola) {
        for (const elemento of cola) elemento.restante = Math.max(0, elemento.restante - dt * 0.4);
      }
    }

    teclas.aplicar(dt);
    camara.actualizar(dt);
    iluminacion.enfocarSombras(camara.objetivoX, camara.objetivoZ);
    iluminacion.actualizar(dt);
    agua.actualizar(dt);
    cielo.actualizar(dt);
    vegetacion.actualizar(dt);

    hud.actualizar(mundo, dt);

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

  const banco = { hud, mundo, camara, escena, renderizador, generado, tropaEnemiga, bucle: telemetria };
  Object.assign(window as unknown as Record<string, unknown>, {
    banco,
    // `tools/capturar.mjs` busca `window.juego` para mover la cámara y leer la telemetría.
    juego: { camara, renderizador, bucle: telemetria, mundo },
  });

  console.info(`[banco-hud] vista=${vista} semilla=${semilla}`);
}

/** Controles mínimos: teclado para desplazar, rueda para el zoom. */
function conectarControles(camara: CamaraJuego, renderizador: Renderizador): { aplicar(dt: number): void } {
  const pulsadas = new Set<string>();
  window.addEventListener('keydown', (evento) => pulsadas.add(evento.code));
  window.addEventListener('keyup', (evento) => pulsadas.delete(evento.code));

  renderizador.lienzo.addEventListener(
    'wheel',
    (evento) => {
      evento.preventDefault();
      camara.acercar(evento.deltaY > 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );

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

try {
  arrancar();
} catch (error) {
  fallar(error);
}
