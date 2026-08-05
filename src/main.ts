import * as THREE from 'three';
import { BucleJuego } from './core/loop';
import { CamaraJuego } from './render/camara';
import { Renderizador } from './render/renderizador';
import { construirTerreno } from './render/terreno';
import { crearAgua } from './render/agua';
import { crearCielo } from './render/cielo';
import { crearVegetacion } from './render/vegetacion';
import { crearIluminacion } from './render/iluminacion';
import { crearRenderEntidades } from './render/entidades';
import { crearFabricaModelos } from './render/modelos/fabrica';
import { crearGestorEfectos } from './render/efectos/gestor';
import { crearMotorAudio } from './audio/motor';
import { crearSistemaAudio } from './audio/efectos';
import { bus } from './core/events';
import { generarMapa } from './sim/generador';
import { Mundo } from './sim/mundo';
import { poblarMapaInicial } from './sim/fabrica';
import { crearBuscadorRutas } from './sim/rutas/buscador';
import { Simulacion } from './sim/sistemas/orquestador';
import { enchufarEvitacion } from './sim/enlaceEvitacion';
import { sesion } from './estado/sesion';
import * as ordenes from './sim/ordenes';
import { encolarUnidad, cancelarProduccion } from './sim/sistemas/produccion';
import { crearHud, type ComandoInterfaz } from './ui/hud';
import { crearEntrada } from './input/entrada';
import { Bando, Clase, indiceDe } from './sim/tipos';
import {
  ALTO_MAPA,
  ANCHO_MAPA,
  HERCIOS_SIMULACION,
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

  // La semilla se puede fijar por la barra de direcciones (?semilla=123): así una
  // partida concreta se puede reproducir exactamente, que es media depuración ganada.
  const parametros = new URLSearchParams(location.search);
  const semillaPedida = Number(parametros.get('semilla'));
  const semilla = Number.isFinite(semillaPedida) && semillaPedida > 0
    ? semillaPedida
    : Math.floor(Math.random() * 0x7fffffff);

  const generado = generarMapa({ ancho: ANCHO_MAPA, alto: ALTO_MAPA, semilla });
  const mundo = new Mundo(generado.mapa, semilla);

  progreso(0.45, 'Sembrando los bosques…');
  await respirar();

  // Bosques, vetas de oro, rocas y las dos bases de inicio con sus campesinos.
  poblarMapaInicial(mundo, generado);
  mundo.estadoDe(Bando.ORCOS).esIA = true;
  sesion.bandoJugador = Bando.HUMANOS;

  // La evitación local vive en el módulo de rutas y el movimiento la consume a través
  // de un registro: así ninguno de los dos depende del otro. `Mundo` cumple el
  // contrato `EntornoUnidades` de forma estructural, de modo que el adaptador es
  // solo un cambio de forma de la llamada.
  const buscador = crearBuscadorRutas(generado.mapa);
  enchufarEvitacion();

  const simulacion = new Simulacion(mundo, buscador);

  const escena = new THREE.Scene();

  const terreno = construirTerreno(generado.mapa, renderizador.calidad);
  escena.add(terreno.malla);

  const agua = crearAgua(generado.mapa, renderizador.calidad);
  escena.add(agua.raiz);

  const cielo = crearCielo(escena, renderizador.calidad);

  const vegetacion = crearVegetacion(generado.mapa, renderizador.calidad);
  escena.add(vegetacion.raiz);

  const fabricaModelos = crearFabricaModelos();
  const renderEntidades = crearRenderEntidades(escena, mundo, renderizador.calidad, fabricaModelos);

  progreso(0.7, 'Encendiendo el sol…');
  await respirar();

  const iluminacion = crearIluminacion(escena, renderizador.calidad);
  escena.add(iluminacion.raiz);

  const camara = new CamaraJuego(generado.mapa, renderizador.relacionAspecto);
  const inicioJugador = generado.inicios[0]!;
  camara.saltarA(inicioJugador.cx + 2, inicioJugador.cz + 2);

  progreso(0.85, 'Convocando a los ejércitos…');
  await respirar();

  const capaInterfaz = document.getElementById('capa-ui') as HTMLElement;

  // `entrada` necesita dos cosas de `hud.menus` (qué hacer cuando Escape no
  // cancela nada de la jugabilidad, y si hay un menú abierto ahora mismo), pero
  // `hud` necesita `entrada` ya construido para el minimapa. Se rompe el ciclo
  // con una indirección: los callbacks que guarda `crearEntrada` se resuelven
  // más abajo, no al registrarse.
  let manejarEscapeVacio = (): void => {};
  let hayMenuAbierto = (): boolean => false;
  const entrada = crearEntrada({
    lienzo,
    camara,
    mundo,
    capaInterfaz,
    alEscapeVacio: () => manejarEscapeVacio(),
    hayMenuAbierto: () => hayMenuAbierto(),
  });

  const hud = crearHud(capaInterfaz, mundo);
  manejarEscapeVacio = () => hud.menus.alternarPausa();
  hayMenuAbierto = () => hud.menus.estaAbierta();
  hud.fijarCamara(camara);
  hud.alPulsarMinimapa((x, z) => entrada.alPulsarMinimapa(x, z));
  hud.alPulsarComando((comando) => ejecutarComandoInterfaz(mundo, comando, entrada));

  const efectos = crearGestorEfectos(
    escena,
    camara.nucleo,
    mundo,
    generado.mapa,
    sesion.bandoJugador,
    sesion,
    renderizador,
    renderizador.calidad,
  );

  // El contexto de audio arranca suspendido: los navegadores bloquean el sonido
  // hasta el primer gesto del usuario. `desbloquearConGesto` lo resuelve solo.
  const motorAudio = crearMotorAudio();
  motorAudio.desbloquearConGesto();
  const audio = crearSistemaAudio(motorAudio, mundo, sesion.bandoJugador, bus);

  const menus = hud.menus;

  // El volumen del menú es [0, 1] pero se deja margen bajo 1 para que el
  // compresor del motor de audio siga teniendo con qué trabajar en un combate
  // grande a volumen máximo.
  const GANANCIA_MAESTRA_MAXIMA = 0.7;
  function aplicarOpciones(opciones: ReturnType<typeof menus.opcionesActuales>): void {
    motorAudio.maestro.gain.value = opciones.volumen * GANANCIA_MAESTRA_MAXIMA;
    entrada.fijarVelocidadCamara(opciones.velocidadCamara);
  }
  aplicarOpciones(menus.opcionesActuales());
  menus.alCambiarOpciones(aplicarOpciones);

  // La pausa por menú y la pausa por pestaña en segundo plano son dos motivos
  // distintos para lo mismo; si se solapan (se oculta la pestaña con el menú
  // abierto), volver a primer plano no debe reanudar por su cuenta.
  let pausadoPorMenu = false;
  menus.alPausar(() => {
    pausadoPorMenu = true;
    bucle.pausar();
  });
  menus.alReanudar(() => {
    pausadoPorMenu = false;
    bucle.reanudar();
  });
  menus.alRendirse(() => simulacion.rendirse(sesion.bandoJugador));

  progreso(0.95, 'Desplegando el mando…');
  await respirar();

  const bucle = new BucleJuego({
    hercios: HERCIOS_SIMULACION,
    alSimular: (dt) => {
      // `paso` se encarga por su cuenta del contador de ticks, de archivar las
      // transformaciones y de reconstruir la rejilla espacial.
      simulacion.paso(dt);
      sesion.tiempoPartida += dt;
      sesion.depurarSeleccion(mundo);
      sesion.caducarAvisos();
    },
    alRenderizar: (dtReal, alfa) => {
      entrada.actualizar(dtReal);
      camara.actualizar(dtReal);
      iluminacion.enfocarSombras(camara.objetivoX, camara.objetivoZ);
      iluminacion.actualizar(dtReal);
      agua.actualizar(dtReal);
      cielo.actualizar(dtReal);
      vegetacion.actualizar(dtReal);
      renderEntidades.actualizar(alfa, dtReal);
      efectos.actualizar(dtReal, alfa);
      hud.actualizar(mundo, dtReal);
      menus.actualizar(mundo, dtReal);
      renderizador.reiniciarEstadisticas();
      efectos.renderizar();
      renderizador.ajustarResolucion(bucle.msRender + bucle.msSimulacion, dtReal);
    },
  });

  window.addEventListener('resize', () => {
    renderizador.redimensionar();
    camara.redimensionar(renderizador.relacionAspecto);
    efectos.redimensionar(renderizador.ancho, renderizador.alto);
  });

  // Al volver de segundo plano no queremos que la simulación intente recuperar
  // todo el tiempo perdido de golpe. Si el motivo de la pausa era el menú, volver
  // a la pestaña no debe reanudar por su cuenta: eso lo decide el jugador.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) bucle.pausar();
    else if (!pausadoPorMenu) bucle.reanudar();
  });

  bucle.iniciar();

  progreso(1, '¡A las armas!');
  await respirar();

  cargador?.classList.add('oculto');
  setTimeout(() => cargador?.remove(), 900);

  // Expuesto para depuración desde la consola del navegador y para las capturas
  // automatizadas de la revisión visual.
  Object.assign(window as unknown as Record<string, unknown>, {
    juego: {
      mundo, camara, escena, renderizador, bucle, generado, simulacion, buscador, sesion, ordenes,
      terreno, agua, cielo, vegetacion, iluminacion, fabricaModelos, renderEntidades,
      entrada, hud, efectos, motorAudio, audio, menus,
    },
  });
}

/**
 * Traduce un `ComandoInterfaz` (lo que anuncia el HUD al pulsar un botón) a una
 * llamada real sobre el mundo. Ni `hud.ts` ni sus paneles tocan la simulación
 * directamente —solo anuncian la intención—, así que este es el único sitio que
 * decide qué significa de verdad «entrenar un arquero» o «reparar».
 */
function ejecutarComandoInterfaz(
  mundo: Mundo,
  comando: ComandoInterfaz,
  entrada: ReturnType<typeof crearEntrada>,
): void {
  switch (comando.clase) {
    case 'entrenar': {
      const edificio = edificioSeleccionadoPropio(mundo);
      if (edificio !== null) encolarUnidad(mundo, edificio, comando.tipoUnidad);
      break;
    }
    case 'construir':
      sesion.iniciarColocacion(comando.tipoEdificio);
      break;
    case 'cancelarCola': {
      const edificio = edificioSeleccionadoPropio(mundo);
      if (edificio !== null) cancelarProduccion(mundo, edificio, comando.indice);
      break;
    }
    case 'accion':
      switch (comando.accion) {
        case 'detener':
          ordenes.cancelarOrden(mundo, sesion.seleccion, sesion.bandoJugador);
          break;
        case 'mantenerPosicion':
          ordenes.ordenarMantenerPosicion(mundo, sesion.seleccion, sesion.bandoJugador);
          break;
        case 'atacar':
        case 'patrullar':
        case 'reparar':
        case 'recolectar':
          entrada.activarModoObjetivo(comando.accion);
          break;
      }
      break;
  }
}

/** La única entidad seleccionada, si es un edificio propio; si no, null. */
function edificioSeleccionadoPropio(mundo: Mundo) {
  if (sesion.seleccion.length !== 1) return null;
  const entidad = sesion.seleccion[0]!;
  if (!mundo.esValida(entidad)) return null;
  const i = indiceDe(entidad);
  if (mundo.clase[i] !== Clase.EDIFICIO) return null;
  if (mundo.bando[i] !== sesion.bandoJugador) return null;
  return entidad;
}

arrancar().catch(fallar);
