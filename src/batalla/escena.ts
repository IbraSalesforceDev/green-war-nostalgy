import * as THREE from 'three';
import { crearFigurasDeBando } from '../campana/render/figuras';
import { ARMAS, Arma, BandoCampana, type Composicion } from '../campana/tipos';
import {
  ANCHO_CAMPO,
  Batalla,
  type DesenlaceBatalla,
  EstadoUnidad,
  FONDO_CAMPO,
  type UnidadBatalla,
} from './batalla';

/**
 * La escena de la batalla campal: el campo, las tropas y el mando.
 *
 * Reutiliza las mismas figurillas que las fichas del mapa —el fusilero con el
 * arma terciada, el jinete y el cañón—, y por un motivo que no es de ahorro:
 * quien acaba de mover una ficha con esas tres siluetas tiene que reconocer al
 * instante lo que ve cuando la ficha se convierte en un ejército de verdad.
 *
 * ── El mando ─────────────────────────────────────────────────────────────────
 * Arrastrar traza un rectángulo y elige tropas propias; un toque suelto sobre el
 * campo las manda allí. Sin selección previa, el toque ordena a todo el ejército.
 * Es lo justo para dirigir una batalla con un dedo y sin menús: el grueso del
 * combate lo resuelven las unidades solas, y quien juega decide dónde carga.
 */

/** Alto del suelo. Las unidades andan sobre él. */
const ALTURA_SUELO = 0;

/**
 * Las figuras se agrandan respecto a su tamaño «real» en el campo.
 *
 * A escala honesta, un soldado de tres unidades sobre un frente de ochenta y
 * cuatro ocupa cuarenta píxeles y la batalla se ve como hormigas. Aquí el
 * protagonista es la tropa, no la topografía: se exagera el tamaño igual que lo
 * hacen los juegos de este género desde siempre.
 */
const ESCALA_FIGURA = 1.7;

const COLOR_SELECCION = 0xffe9a8;

export interface EscenaBatalla {
  readonly escena: THREE.Scene;
  readonly camara: THREE.PerspectiveCamera;
  readonly batalla: Batalla;
  actualizar(dt: number): void;
  redimensionar(ancho: number, alto: number): void;
  /** La batalla ha terminado y su resultado está listo para la campaña. */
  readonly terminada: boolean;
  desenlace(): DesenlaceBatalla;
  liberar(): void;
}

export interface OpcionesEscenaBatalla {
  lienzo: HTMLCanvasElement;
  /** Dónde colgar el marcador de la batalla. */
  capaInterfaz: HTMLElement;
  relacionAspecto: number;
  atacante: BandoCampana;
  composicionAtacante: Composicion;
  composicionDefensor: Composicion;
  bandoJugador: BandoCampana;
  enFuerte?: boolean;
  semilla?: number;
  conSombras?: boolean;
}

interface VistaUnidad {
  malla: THREE.Mesh;
  anillo: THREE.Mesh;
  unidad: UnidadBatalla;
}

export function crearEscenaBatalla(opciones: OpcionesEscenaBatalla): EscenaBatalla {
  const { lienzo } = opciones;

  const batalla = new Batalla({
    atacante: opciones.atacante,
    composicionAtacante: opciones.composicionAtacante,
    composicionDefensor: opciones.composicionDefensor,
    bandoJugador: opciones.bandoJugador,
    enFuerte: opciones.enFuerte ?? false,
    semilla: opciones.semilla,
  });

  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x8fa9c4);
  escena.fog = new THREE.Fog(0x8fa9c4, 90, 190);

  const sol = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sol.position.set(-40, 60, 30);
  if (opciones.conSombras !== false) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    const c = sol.shadow.camera;
    c.left = -60;
    c.right = 60;
    c.top = 40;
    c.bottom = -40;
    c.near = 5;
    c.far = 160;
  }
  escena.add(sol);
  escena.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a4028, 0.7));

  const desechables: Array<{ dispose(): void }> = [];

  // --- El campo ---
  const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(ANCHO_CAMPO + 30, FONDO_CAMPO + 30, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1, metalness: 0 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  suelo.receiveShadow = true;
  escena.add(suelo);
  desechables.push(suelo.geometry, suelo.material as THREE.Material);

  // Franjas de labranza: dan escala y hacen visible el avance de las tropas, que
  // sobre un verde liso parecería que patinan sin moverse.
  const franjas = new THREE.Group();
  for (let i = -6; i <= 6; i++) {
    const franja = new THREE.Mesh(
      new THREE.PlaneGeometry(ANCHO_CAMPO + 20, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x64823f, roughness: 1 }),
    );
    franja.rotation.x = -Math.PI / 2;
    franja.position.set(0, 0.02, i * 6.5);
    escena.add(franja);
    desechables.push(franja.geometry, franja.material as THREE.Material);
  }
  escena.add(franjas);

  // Empalizada del defensor cuando la batalla es un asalto a posición fortificada.
  if (batalla.enFuerte) {
    const muro = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 3.2, FONDO_CAMPO - 4),
      new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.95, flatShading: true }),
    );
    muro.position.set(ANCHO_CAMPO / 2 - 20, 1.6, 0);
    muro.castShadow = true;
    muro.receiveShadow = true;
    escena.add(muro);
    desechables.push(muro.geometry, muro.material as THREE.Material);
  }

  // --- Figuras, una malla por unidad ---
  const geoPorBando = new Map<BandoCampana, Readonly<Record<Arma, THREE.BufferGeometry>>>();
  for (const bando of [BandoCampana.UNION, BandoCampana.CONFEDERACION]) {
    const juego = crearFigurasDeBando(bando);
    geoPorBando.set(bando, juego);
    for (const arma of ARMAS) desechables.push(juego[arma]);
  }

  const materialFiguras = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
  });
  const materialAnillo = new THREE.MeshBasicMaterial({
    color: COLOR_SELECCION,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const geoAnillo = new THREE.RingGeometry(2.0, 2.6, 16);
  geoAnillo.rotateX(-Math.PI / 2);
  desechables.push(materialFiguras, materialAnillo, geoAnillo);

  const vistas: VistaUnidad[] = [];
  for (const unidad of batalla.unidades) {
    const juego = geoPorBando.get(unidad.bando)!;
    const malla = new THREE.Mesh(juego[unidad.arma], materialFiguras);
    malla.castShadow = true;
    malla.scale.setScalar(ESCALA_FIGURA);
    // Las figuras se modelaron mirando al este; el ángulo de la simulación se
    // aplica en negativo porque el eje Z de la escena crece hacia el sur.
    malla.position.set(unidad.x, ALTURA_SUELO, unidad.z);
    escena.add(malla);

    const anillo = new THREE.Mesh(geoAnillo, materialAnillo);
    anillo.position.set(unidad.x, ALTURA_SUELO + 0.05, unidad.z);
    anillo.visible = false;
    escena.add(anillo);

    vistas.push({ malla, anillo, unidad });
  }

  // --- Fogonazos de los disparos ---
  const MAX_FOGONAZOS = 40;
  const geoFogonazo = new THREE.SphereGeometry(0.42, 6, 4);
  const materialFogonazo = new THREE.MeshBasicMaterial({
    color: 0xffd88a,
    transparent: true,
    opacity: 1,
  });
  desechables.push(geoFogonazo, materialFogonazo);
  const fogonazos: Array<{ malla: THREE.Mesh; vida: number }> = [];
  for (let i = 0; i < MAX_FOGONAZOS; i++) {
    const malla = new THREE.Mesh(geoFogonazo, materialFogonazo);
    malla.visible = false;
    escena.add(malla);
    fogonazos.push({ malla, vida: 0 });
  }
  let cursorFogonazo = 0;

  // --- Cámara ---
  const camara = new THREE.PerspectiveCamera(46, opciones.relacionAspecto, 0.5, 400);
  let distancia = 64;
  let objetivoX = 0;
  const INCLINACION = 0.82;

  function recolocarCamara(): void {
    camara.position.set(
      objetivoX,
      Math.sin(INCLINACION) * distancia,
      Math.cos(INCLINACION) * distancia,
    );
    camara.lookAt(objetivoX, 0, 0);
  }
  recolocarCamara();

  // --- Entrada: selección por arrastre y órdenes por toque ---
  const seleccionados = new Set<number>();
  let arrastrando = false;
  let huboArrastre = false;
  let inicioX = 0;
  let inicioY = 0;
  const rayo = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const puntoMundo = new THREE.Vector3();

  /** Punto del campo bajo el puntero, o null si el rayo no toca el suelo. */
  function suelBajoPuntero(evento: PointerEvent): THREE.Vector3 | null {
    const rect = lienzo.getBoundingClientRect();
    puntero.x = ((evento.clientX - rect.left) / rect.width) * 2 - 1;
    puntero.y = -((evento.clientY - rect.top) / rect.height) * 2 + 1;
    rayo.setFromCamera(puntero, camara);
    return rayo.ray.intersectPlane(planoSuelo, puntoMundo) ? puntoMundo.clone() : null;
  }

  function alPointerDown(evento: PointerEvent): void {
    if (evento.target !== lienzo) return;
    lienzo.setPointerCapture(evento.pointerId);
    arrastrando = true;
    huboArrastre = false;
    inicioX = evento.clientX;
    inicioY = evento.clientY;
  }

  function alPointerMove(evento: PointerEvent): void {
    if (!arrastrando) return;
    if (Math.abs(evento.clientX - inicioX) + Math.abs(evento.clientY - inicioY) > 12) {
      huboArrastre = true;
    }
  }

  function alPointerUp(evento: PointerEvent): void {
    if (!arrastrando) return;
    arrastrando = false;
    if (batalla.terminada) return;

    const punto = suelBajoPuntero(evento);
    if (!punto) return;

    if (huboArrastre) {
      // Arrastre: elige las tropas propias del rectángulo barrido.
      const inicio = suelBajoPuntero({
        clientX: inicioX,
        clientY: inicioY,
      } as PointerEvent);
      if (!inicio) return;
      seleccionados.clear();
      const minX = Math.min(inicio.x, punto.x);
      const maxX = Math.max(inicio.x, punto.x);
      const minZ = Math.min(inicio.z, punto.z);
      const maxZ = Math.max(inicio.z, punto.z);
      for (const unidad of batalla.vivasDe(opciones.bandoJugador)) {
        if (unidad.x >= minX && unidad.x <= maxX && unidad.z >= minZ && unidad.z <= maxZ) {
          seleccionados.add(unidad.id);
        }
      }
      return;
    }

    // Toque suelto: manda a lo elegido, o a todo el ejército si no hay nada elegido.
    const destinatarios =
      seleccionados.size > 0
        ? [...seleccionados]
        : batalla.vivasDe(opciones.bandoJugador).map((u) => u.id);
    batalla.ordenarIr(destinatarios, punto.x, punto.z);
  }

  lienzo.addEventListener('pointerdown', alPointerDown);
  lienzo.addEventListener('pointermove', alPointerMove);
  lienzo.addEventListener('pointerup', alPointerUp);
  lienzo.addEventListener('pointercancel', alPointerUp);

  // --- Marcador ---
  const hud = document.createElement('div');
  hud.className = 'gwn-hud gwn-batalla-hud';
  const marcador = document.createElement('div');
  marcador.className = 'gwn-panel gwn-batalla-marcador';
  hud.appendChild(marcador);

  const lado = (clase: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = `gwn-batalla-lado ${clase}`;
    marcador.appendChild(el);
    return el;
  };
  const marcaPropia = lado('gwn-batalla-lado--propio');
  const separadorMarcador = document.createElement('div');
  separadorMarcador.className = 'gwn-batalla-separador';
  separadorMarcador.textContent = batalla.enFuerte ? 'ASALTO' : 'BATALLA';
  marcador.appendChild(separadorMarcador);
  const marcaAjena = lado('gwn-batalla-lado--ajeno');

  const pista = document.createElement('div');
  pista.className = 'gwn-batalla-pista';
  pista.textContent = 'Arrastra para elegir tropas · toca el campo para mandarlas';
  hud.appendChild(pista);
  opciones.capaInterfaz.appendChild(hud);

  // La pista estorba en cuanto se entiende: se retira sola.
  setTimeout(() => pista.classList.add('gwn-batalla-pista--ida'), 6000);

  const rival = opciones.bandoJugador === BandoCampana.UNION
    ? BandoCampana.CONFEDERACION
    : BandoCampana.UNION;

  function refrescarMarcador(): void {
    marcaPropia.textContent = String(batalla.vivasDe(opciones.bandoJugador).length);
    marcaAjena.textContent = String(batalla.vivasDe(rival).length);
  }
  refrescarMarcador();

  return {
    escena,
    camara,
    batalla,

    get terminada(): boolean {
      return batalla.terminada;
    },

    desenlace: () => batalla.desenlace(),

    actualizar(dt: number): void {
      batalla.paso(dt);
      refrescarMarcador();

      // Un fogonazo por disparo de este tick.
      for (const disparo of batalla.disparos) {
        const f = fogonazos[cursorFogonazo]!;
        cursorFogonazo = (cursorFogonazo + 1) % MAX_FOGONAZOS;
        f.malla.position.set(disparo.origenX, 1.4, disparo.origenZ);
        f.malla.scale.setScalar(disparo.arma === Arma.ARTILLERIA ? 1.8 : 1);
        f.malla.visible = true;
        f.vida = 0.12;
      }
      for (const f of fogonazos) {
        if (!f.malla.visible) continue;
        f.vida -= dt;
        if (f.vida <= 0) f.malla.visible = false;
      }

      // Las figuras siguen a sus unidades.
      for (const vista of vistas) {
        const u = vista.unidad;
        if (u.estado === EstadoUnidad.MUERTA) {
          vista.malla.visible = false;
          vista.anillo.visible = false;
          continue;
        }
        vista.malla.position.set(u.x, ALTURA_SUELO, u.z);
        // El ángulo va negado: la simulación mide en el plano XZ con Z hacia el
        // sur, y la rotación de Three gira en sentido contrario sobre ese plano.
        vista.malla.rotation.y = -u.angulo;

        if (u.estado === EstadoUnidad.MURIENDO) {
          // Se desploma de costado mientras dura la agonía.
          const caida = 1 - Math.max(0, u.agonia / 0.9);
          vista.malla.rotation.z = caida * (Math.PI / 2);
          vista.malla.position.y = ALTURA_SUELO - caida * 0.2;
          vista.anillo.visible = false;
          continue;
        }

        const elegida = seleccionados.has(u.id);
        vista.anillo.visible = elegida;
        if (elegida) vista.anillo.position.set(u.x, ALTURA_SUELO + 0.05, u.z);
      }

      // La cámara sigue al grueso del combate para que la acción no se salga.
      const enPie = batalla.unidades.filter(
        (u) => u.estado === EstadoUnidad.AVANZANDO || u.estado === EstadoUnidad.COMBATIENDO,
      );
      if (enPie.length > 0) {
        const medio = enPie.reduce((s, u) => s + u.x, 0) / enPie.length;
        objetivoX += (medio - objetivoX) * Math.min(1, dt * 1.2);
        recolocarCamara();
      }
    },

    redimensionar(ancho: number, alto: number): void {
      camara.aspect = ancho / Math.max(1, alto);
      camara.updateProjectionMatrix();
    },

    liberar(): void {
      hud.remove();
      lienzo.removeEventListener('pointerdown', alPointerDown);
      lienzo.removeEventListener('pointermove', alPointerMove);
      lienzo.removeEventListener('pointerup', alPointerUp);
      lienzo.removeEventListener('pointercancel', alPointerUp);
      for (const d of desechables) d.dispose();
      escena.clear();
    },
  };
}
