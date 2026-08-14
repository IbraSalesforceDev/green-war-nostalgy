import * as THREE from 'three';
import { Campana, type Choque } from './campana';
import { IACampana } from './ia';
import { crearMapaCampana } from './render/mapa';
import { crearFichasEjercitos } from './render/fichas';
import { crearUiCampana, fraseConquista } from './ui';
import { territorio } from './territorios';
import {
  BandoCampana,
  type Ejercito,
  FaseTurno,
  type IdTerritorio,
  NOMBRE_BANDO,
  type ResultadoBatalla,
  bandoRival,
} from './tipos';

/**
 * La escena del mapa de campaña: lo que se ve y se toca entre batalla y batalla.
 *
 * Junta las cuatro piezas que ya saben hacer su trabajo por separado —el estado de
 * la campaña, el mapa dibujado, las fichas y la interfaz— y añade lo único que
 * ninguna puede resolver sola: qué pasa cuando alguien toca la pantalla, y en qué
 * orden corren los turnos.
 *
 * ── El gesto ─────────────────────────────────────────────────────────────────
 * Un toque sobre un ejército propio lo elige y enciende sus destinos. Un segundo
 * toque sobre un destino encendido lo mueve. Un toque en cualquier otro sitio
 * deselecciona. No hay más: es todo lo que se puede pedir a un dedo, y funciona
 * igual con un ratón.
 *
 * ── Por qué el turno de la máquina va a cámara lenta ─────────────────────────
 * La IA resuelve su turno entero en menos de un milisegundo. Si se aplicara de
 * golpe, el mapa cambiaría entre dos fotogramas y nadie entendería qué ha pasado.
 * Los movimientos se van soltando con una pausa entre ellos para que se lean.
 */

/** Pausa entre movimientos de la máquina, en segundos. */
const RITMO_IA = 0.55;

const DISTANCIA_MIN = 45;
/**
 * Con un campo de visión estrecho la cámara tiene que irse mucho más lejos para
 * encuadrar lo mismo, así que el techo sube en la misma proporción.
 */
const DISTANCIA_MAX = 700;

/**
 * Campo de visión de la cámara del mapa.
 *
 * Muy estrecho, y a propósito. Con los 48° de antes el mapa salía en trapecio
 * —la orilla cercana ensanchada y la lejana estrechada—, y esa deformación era
 * buena parte de lo que hacía que el mapa «se viera raro»: la silueta del país
 * dejaba de ser la del país. La culpa no era de la inclinación sino de la
 * apertura: es la divergencia de los rayos la que abre el trapecio. Cerrando el
 * objetivo y alejando la cámara —lo mismo que hace un teleobjetivo— las líneas
 * salen casi paralelas y la lámina se lee plana, que es como se mira un mapa.
 */
const CAMPO_VISION = 28;

/**
 * Lo que ocupa el mapa una vez proyectado, en unidades de escena. El alto sale
 * menor que el ancho porque la cámara mira inclinada y eso acorta la profundidad.
 */
const EXTENSION_ANCHO = 105;
/**
 * A 60° de elevación la profundidad se acorta por el seno del ángulo, un 13 %.
 * Es un acortamiento uniforme —no una deformación—, así que la silueta se sigue
 * leyendo bien; solo hay que descontarlo al encuadrar.
 */
const EXTENSION_ALTO = 95;

const APROVECHAMIENTO_ANCHO = 0.9;

/**
 * Altura que se comen la barra de turno y el botón de pasar turno, en píxeles CSS.
 *
 * Es una cantidad fija, no una fracción, y ahí está el detalle que importa: en un
 * monitor de 900 px de alto estorba un 22 %, pero en un móvil apaisado de 390 px
 * se lleva la mitad de la pantalla. Calcular el encuadre con una fracción
 * constante dejaba medio mapa debajo del HUD justo en el aparato para el que se
 * está haciendo el juego.
 */
const RESERVA_HUD_PX = 150;

/**
 * Distancia a la que el mapa entero cabe en el hueco que deja el HUD.
 *
 * Una distancia fija no vale: la misma que encuadra bien un monitor apaisado deja
 * medio mapa fuera en un móvil, donde el alto es escaso y el HUD proporcionalmente
 * enorme.
 */
function distanciaParaEncuadrar(fovGrados: number, aspecto: number, altoCss: number): number {
  const mitadFov = (fovGrados * Math.PI) / 180 / 2;
  const tangente = 2 * Math.tan(mitadFov);
  const libre = limitar((altoCss - RESERVA_HUD_PX) / Math.max(1, altoCss), 0.34, 0.8);
  const porAlto = EXTENSION_ALTO / libre / tangente;
  const porAncho = EXTENSION_ANCHO / APROVECHAMIENTO_ANCHO / (tangente * aspecto);
  return Math.min(DISTANCIA_MAX, Math.max(porAlto, porAncho));
}

/**
 * Inclinación de la cámara sobre el mapa: 60° sobre la horizontal.
 *
 * El primer intento de arreglar el mapa fue subir la cámara casi a cenital,
 * culpando a la inclinación de la deformación. Era el diagnóstico equivocado —el
 * trapecio lo abría el campo de visión, no el ángulo— y encima cobraba un precio:
 * desde arriba del todo las figuras de los ejércitos se veían por el sombrero y
 * no se distinguía un jinete de un cañón. Con el objetivo ya cerrado la lámina se
 * lee plana igualmente, así que la cámara puede volver a bajar hasta donde las
 * figuras enseñan su silueta.
 */
const INCLINACION = 1.05;

export interface EscenaCampana {
  actualizar(dt: number): void;
  /**
   * Avisa de que hay un choque que dirimir. Quien orqueste el juego debe montar
   * la escena de acción y devolver el veredicto con `resolverBatallaJugada`; la
   * campaña se queda congelada hasta entonces.
   */
  alPedirBatalla(cb: (choque: Choque) => void): void;
  /** Aplica el resultado de una batalla ya jugada y reanuda el turno. */
  resolverBatallaJugada(resultado: ResultadoBatalla): void;
  redimensionar(ancho: number, alto: number): void;
  readonly escena: THREE.Scene;
  readonly camara: THREE.PerspectiveCamera;
  readonly campana: Campana;
  liberar(): void;
}

export interface OpcionesEscena {
  lienzo: HTMLCanvasElement;
  capaInterfaz: HTMLElement;
  relacionAspecto: number;
  /** Alto del lienzo en píxeles CSS: hace falta para descontar el HUD al encuadrar. */
  altoCss: number;
  semilla?: number;
  /** Sombras y demás lujos: se apagan en los dispositivos flojos. */
  conSombras?: boolean;
}

export function crearEscenaCampana(opciones: OpcionesEscena): EscenaCampana {
  const { lienzo, capaInterfaz, relacionAspecto } = opciones;

  const bandoJugador = BandoCampana.UNION;
  const campana = new Campana({ semilla: opciones.semilla, bandoJugador });
  const ia = new IACampana(bandoRival(bandoJugador));

  // --- Escena y luces ---
  const escena = new THREE.Scene();
  // Fondo de mesa de trabajo: el mapa es una lámina apoyada encima, y el margen
  // oscuro la enmarca en vez de competir con ella.
  escena.background = new THREE.Color(0x2a2118);

  // El mapa se pinta con materiales básicos, que no dependen de la luz: así el
  // color de cada tinta sale exacto y plano, sin un lado más apagado que otro.
  // Las luces quedan solo para las fichas de los ejércitos, que sí tienen volumen.
  const sol = new THREE.DirectionalLight(0xfff2d8, 2.6);
  sol.position.set(-45, 80, 40);
  if (opciones.conSombras !== false) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    const c = sol.shadow.camera;
    c.left = -80;
    c.right = 80;
    c.top = 80;
    c.bottom = -80;
    c.near = 10;
    c.far = 220;
  }
  escena.add(sol);
  escena.add(new THREE.HemisphereLight(0xf2e8d0, 0x8a7a58, 1.5));

  // --- Cámara ---
  const camara = new THREE.PerspectiveCamera(CAMPO_VISION, relacionAspecto, 1, 1200);
  let objetivoX = 0;
  // Apuntar un poco al norte del centro real baja el mapa en pantalla, que es
  // justo lo que hace falta para que no se meta debajo de la barra de turno.
  let objetivoZ = -4;
  let distancia = distanciaParaEncuadrar(camara.fov, relacionAspecto, opciones.altoCss);
  /** Quien juega ha tocado el zoom: a partir de ahí, no se reencuadra solo. */
  let zoomManual = false;

  function recolocarCamara(): void {
    const alto = Math.sin(INCLINACION) * distancia;
    const fondo = Math.cos(INCLINACION) * distancia;
    camara.position.set(objetivoX, alto, objetivoZ + fondo);
    camara.lookAt(objetivoX, 0, objetivoZ);
  }
  recolocarCamara();

  // --- Piezas ---
  const mapa = crearMapaCampana(escena);
  const fichas = crearFichasEjercitos(escena);
  const ui = crearUiCampana(capaInterfaz, bandoJugador);

  let seleccionado: Ejercito | null = null;
  let destinos: IdTerritorio[] = [];
  let esperandoIA = false;
  let cronometroIA = 0;
  let finAnunciado = false;
  /** Hay una batalla en curso fuera de esta escena: todo queda en pausa. */
  let batallaEnCurso = false;
  /** Qué había que seguir haciendo cuando la batalla devuelva su veredicto. */
  let reanudarCon: 'jugador' | 'ia' | null = null;
  let cbBatalla: (choque: Choque) => void = () => {};

  function refrescar(): void {
    mapa.sincronizar((id) => campana.duenoDe(id));
    fichas.sincronizar(campana.todosLosEjercitos, (id) => mapa.posicionDe(id));
    fichas.fijarSeleccionado(seleccionado?.id ?? null);
    mapa.fijarSeleccionado(seleccionado?.territorio ?? null);
    mapa.fijarDestinos(destinos);
    ui.actualizar(campana, seleccionado);
  }

  function seleccionar(ejercito: Ejercito | null): void {
    // Solo se pueden elegir los ejércitos propios, y solo en el turno propio.
    if (ejercito && (ejercito.bando !== bandoJugador || campana.bandoActivo !== bandoJugador)) {
      ejercito = null;
    }
    seleccionado = ejercito;
    destinos = ejercito ? campana.destinosDe(ejercito.id) : [];
    refrescar();
  }

  /**
   * Cede el siguiente choque a la escena de acción. Devuelve si hay batalla en
   * marcha, en cuyo caso quien llame debe detenerse y esperar el veredicto.
   */
  function pedirSiguienteBatalla(): boolean {
    if (batallaEnCurso) return true;
    const choque = campana.siguienteChoque();
    if (!choque) return false;
    batallaEnCurso = true;
    ui.fijarVisible(false);
    const nombre = territorio(choque.territorio).nombre;
    ui.anotar(
      choque.tipo === 'fuerte' ? `¡Asalto a ${nombre}!` : `¡Batalla en ${nombre}!`,
      'info',
    );
    cbBatalla(choque);
    return true;
  }

  function comprobarFinal(): boolean {
    if (campana.fase !== FaseTurno.FIN || finAnunciado) return finAnunciado;
    finAnunciado = true;
    ui.mostrarFinal(campana.ganador, campana.ganador === bandoJugador, campana.turno);
    return true;
  }

  function terminarTurnoJugador(): void {
    if (campana.bandoActivo !== bandoJugador) return;
    if (campana.fase === FaseTurno.FIN) return;

    // Si el turno deja batallas pendientes, se ceden a la escena de acción y el
    // resto del cierre de turno espera a que vuelva el veredicto.
    if (pedirSiguienteBatalla()) {
      reanudarCon = 'jugador';
      return;
    }
    if (comprobarFinal()) return;

    seleccionar(null);
    campana.terminarTurno();

    if (comprobarFinal()) return;
    esperandoIA = true;
    cronometroIA = RITMO_IA;
    ui.fijarEsperando(true);
    refrescar();
  }
  ui.alTerminarTurno(terminarTurnoJugador);

  /** Un paso del turno de la máquina. Devuelve si le queda algo por hacer. */
  function pasoIA(): boolean {
    if (campana.fase === FaseTurno.FIN) return false;

    const territoriosAntes = new Map(
      campana.todosLosEjercitos.map((e) => [e.id, e.territorio] as const),
    );
    const movimientos = ia.jugarManiobra(campana);

    if (campana.hayChoquesPendientes) {
      reanudarCon = 'ia';
      pedirSiguienteBatalla();
      return true;
    }
    if (movimientos === 0) return false;

    // Se anota la conquista solo si de verdad cambió de manos algo.
    for (const ejercito of campana.ejercitosDe(bandoRival(bandoJugador))) {
      const antes = territoriosAntes.get(ejercito.id);
      if (antes && antes !== ejercito.territorio && campana.duenoDe(ejercito.territorio) === ejercito.bando) {
        const info = territorio(ejercito.territorio);
        if (info.duenoInicial === bandoJugador) {
          ui.anotar(fraseConquista(ejercito.territorio, ejercito.bando), 'malo');
        }
      }
    }
    return true;
  }

  // --- Entrada ------------------------------------------------------------------

  const rayo = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  // Copias mutables de las listas de objetivos: el trazador de rayos no acepta
  // arrays de solo lectura y hacer la copia en cada movimiento del puntero
  // generaría basura a ritmo de fotograma. Las superficies no cambian nunca.
  const objetivosFichas: THREE.Object3D[] = [...fichas.superficies];
  const objetivosMapa: THREE.Object3D[] = [...mapa.superficies];
  let arrastrando = false;
  let huboArrastre = false;
  let ultimoX = 0;
  let ultimoY = 0;
  /** Distancia entre dedos en el pellizco anterior; 0 si no hay pellizco. */
  let pellizcoPrevio = 0;
  const punterosActivos = new Map<number, { x: number; y: number }>();

  function actualizarPuntero(evento: PointerEvent): void {
    const rect = lienzo.getBoundingClientRect();
    puntero.x = ((evento.clientX - rect.left) / rect.width) * 2 - 1;
    puntero.y = -((evento.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Qué hay bajo el puntero: primero las fichas, que están por encima. */
  function loQueHayDebajo(): { ejercito: number | null; territorio: IdTerritorio | null } {
    rayo.setFromCamera(puntero, camara);

    const enFichas = rayo.intersectObjects(objetivosFichas, true);
    for (const golpe of enFichas) {
      const id = fichas.ejercitoDe(golpe.object);
      if (id !== null) {
        // También interesa saber en qué territorio cayó, por si el ejército no es
        // seleccionable y el gesto debe interpretarse como toque al terreno.
        const ejercito = campana.ejercitoPorId(id);
        return { ejercito: id, territorio: ejercito?.territorio ?? null };
      }
    }

    const enMapa = rayo.intersectObjects(objetivosMapa, false);
    if (enMapa.length > 0) {
      return { ejercito: null, territorio: mapa.territorioDe(enMapa[0]!.object) };
    }
    return { ejercito: null, territorio: null };
  }

  function alPointerDown(evento: PointerEvent): void {
    if (evento.target !== lienzo) return;
    lienzo.setPointerCapture(evento.pointerId);
    punterosActivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    arrastrando = true;
    huboArrastre = false;
    ultimoX = evento.clientX;
    ultimoY = evento.clientY;
  }

  function alPointerMove(evento: PointerEvent): void {
    if (punterosActivos.has(evento.pointerId)) {
      punterosActivos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    }

    // Pellizco: dos dedos gobiernan el acercamiento y anulan el arrastre.
    if (punterosActivos.size === 2) {
      const [a, b] = [...punterosActivos.values()];
      const separacion = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pellizcoPrevio > 0) {
        distancia = limitar(
          distancia * (pellizcoPrevio / separacion),
          DISTANCIA_MIN,
          DISTANCIA_MAX,
        );
        zoomManual = true;
        recolocarCamara();
      }
      pellizcoPrevio = separacion;
      huboArrastre = true;
      return;
    }

    if (arrastrando) {
      const dx = evento.clientX - ultimoX;
      const dy = evento.clientY - ultimoY;
      ultimoX = evento.clientX;
      ultimoY = evento.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) huboArrastre = true;
      // El desplazamiento se escala con la distancia: de cerca, el mapa debe
      // seguir al dedo; de lejos, un mismo gesto tiene que recorrer más terreno.
      const factor = distancia / 900;
      objetivoX = limitar(objetivoX - dx * factor, -70, 70);
      objetivoZ = limitar(objetivoZ - dy * factor, -70, 80);
      recolocarCamara();
      return;
    }

    // Sin botón pulsado: solo resaltar lo que hay debajo.
    actualizarPuntero(evento);
    const debajo = loQueHayDebajo();
    mapa.fijarResaltado(debajo.territorio);
  }

  function alPointerUp(evento: PointerEvent): void {
    punterosActivos.delete(evento.pointerId);
    if (punterosActivos.size < 2) pellizcoPrevio = 0;
    if (!arrastrando) return;
    arrastrando = false;

    // Un arrastre mueve la cámara; solo un toque limpio cuenta como orden.
    if (huboArrastre) return;
    if (campana.fase === FaseTurno.FIN || esperandoIA || batallaEnCurso) return;

    actualizarPuntero(evento);
    const debajo = loQueHayDebajo();

    // Si hay un destino encendido bajo el dedo, la orden es moverse allí.
    if (seleccionado && debajo.territorio && destinos.includes(debajo.territorio)) {
      const choque = campana.mover(seleccionado.id, debajo.territorio);
      if (!choque) {
        ui.anotar(fraseConquista(debajo.territorio, bandoJugador), 'bueno');
      } else {
        // Atacar abre la escena de batalla en el acto: es el momento que da
        // sentido a todo lo que se ha maniobrado en el mapa.
        reanudarCon = null;
        pedirSiguienteBatalla();
      }
      seleccionar(null);
      return;
    }

    if (debajo.ejercito !== null) {
      seleccionar(campana.ejercitoPorId(debajo.ejercito) ?? null);
      return;
    }
    // Tocar un territorio propio con ejército también lo elige, aunque el dedo
    // caiga junto a la ficha y no encima.
    if (debajo.territorio) {
      const ejercito = campana.ejercitoEn(debajo.territorio);
      seleccionar(ejercito ?? null);
      return;
    }
    seleccionar(null);
  }

  function alWheel(evento: WheelEvent): void {
    evento.preventDefault();
    const factor = evento.deltaY > 0 ? 1.12 : 1 / 1.12;
    distancia = limitar(distancia * factor, DISTANCIA_MIN, DISTANCIA_MAX);
    zoomManual = true;
    recolocarCamara();
  }

  lienzo.addEventListener('pointerdown', alPointerDown);
  lienzo.addEventListener('pointermove', alPointerMove);
  lienzo.addEventListener('pointerup', alPointerUp);
  lienzo.addEventListener('pointercancel', alPointerUp);
  lienzo.addEventListener('wheel', alWheel, { passive: false });

  refrescar();
  ui.anotar('La guerra ha comenzado. Mueve tus ejércitos y toma el Sur.', 'info');

  return {
    escena,
    camara,
    campana,

    alPedirBatalla(cb): void {
      cbBatalla = cb;
    },

    resolverBatallaJugada(resultado): void {
      batallaEnCurso = false;
      ui.fijarVisible(true);
      const gana = resultado.vencedor;
      const nombre = territorio(resultado.territorio).nombre;
      campana.aplicarResultado(resultado);
      ui.anotar(
        `${nombre}: vence ${NOMBRE_BANDO[gana]}`,
        gana === bandoJugador ? 'bueno' : 'malo',
      );
      refrescar();
      if (comprobarFinal()) return;

      // Quedan más choques del mismo turno: se dirimen uno a uno.
      if (pedirSiguienteBatalla()) return;

      const continuar = reanudarCon;
      reanudarCon = null;
      if (continuar === 'jugador') {
        seleccionar(null);
        campana.terminarTurno();
        if (comprobarFinal()) return;
        esperandoIA = true;
        cronometroIA = RITMO_IA;
        ui.fijarEsperando(true);
      }
      refrescar();
    },

    actualizar(dt: number): void {
      fichas.actualizar(dt);

      // Con una batalla en marcha, el mapa se congela: manda la otra escena.
      if (batallaEnCurso) return;
      if (!esperandoIA) return;
      cronometroIA -= dt;
      if (cronometroIA > 0) return;
      cronometroIA = RITMO_IA;

      const sigue = pasoIA();
      refrescar();
      if (comprobarFinal()) {
        esperandoIA = false;
        ui.fijarEsperando(false);
        return;
      }
      if (sigue) return;

      // La máquina no tiene más que hacer: cierra su turno y devuelve el mando.
      campana.terminarTurno();
      esperandoIA = false;
      ui.fijarEsperando(false);
      refrescar();
      comprobarFinal();
    },

    redimensionar(ancho: number, alto: number): void {
      camara.aspect = ancho / Math.max(1, alto);
      camara.updateProjectionMatrix();
      // Al girar el móvil, el encuadre que valía deja de valer. Se rehace solo,
      // salvo que quien juega haya ajustado el zoom a mano: esa intención manda.
      if (!zoomManual) {
        distancia = distanciaParaEncuadrar(camara.fov, camara.aspect, alto);
        recolocarCamara();
      }
    },

    liberar(): void {
      lienzo.removeEventListener('pointerdown', alPointerDown);
      lienzo.removeEventListener('pointermove', alPointerMove);
      lienzo.removeEventListener('pointerup', alPointerUp);
      lienzo.removeEventListener('pointercancel', alPointerUp);
      lienzo.removeEventListener('wheel', alWheel);
      mapa.liberar();
      fichas.liberar();
      ui.liberar();
    },
  };
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}
