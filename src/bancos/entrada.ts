import * as THREE from 'three';
import { crearEdificio, crearUnidad } from '../sim/fabrica';
import { MapaJuego } from '../sim/mapa';
import { Mundo } from '../sim/mundo';
import { CamaraJuego } from '../render/camara';
import { crearEntrada } from '../input/entrada';
import { sesion } from '../estado/sesion';
import { bus } from '../core/events';
import { Bando, Entidad, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';

/**
 * Banco de pruebas de la entrada del jugador.
 *
 * Monta un mundo llano, poblado a mano con unas veinte unidades de ambos bandos y
 * un ayuntamiento cada uno, una cámara real y el `GestorEntrada` de este frente ya
 * cableado. No depende de la simulación (nadie mueve nada por su cuenta: las
 * órdenes se aceptan y quedan escritas en `mundo.orden/ordenX/ordenZ`, que es
 * hasta donde llega la responsabilidad de la entrada) ni del resto del render
 * (las entidades son primitivas de Three.js, no los modelos definitivos, que son
 * de otro frente).
 *
 * Expone `window.banco = { entrada, camara, mundo, sesion }` para que Playwright
 * pueda simular gestos reales con `page.mouse` / `page.touchscreen` / `page.keyboard`
 * y comprobar el estado resultante leyendo `sesion` y `mundo` directamente.
 */

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement | null;
const capaInterfaz = document.getElementById('capa-ui') as HTMLElement | null;
const cajaSeleccionDom = document.getElementById('caja-seleccion') as HTMLElement | null;
const panelEstado = document.getElementById('estado') as HTMLElement | null;
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

const ANCHO_MAPA = 48;
const ALTO_MAPA = 48;

const COLOR_BANDO: Record<number, number> = {
  [Bando.HUMANOS]: 0x4d7fe0,
  [Bando.ORCOS]: 0xd1432f,
};

interface VisualEntidad {
  entidad: Entidad;
  indice: number;
  malla: THREE.Mesh;
  anillo: THREE.Mesh;
}

function arrancar(): void {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo.');
  if (!capaInterfaz) throw new Error('No se ha encontrado #capa-ui.');

  // --- Mundo: llano, sin agua ni acantilados, para no complicar la prueba de entrada. ---
  const mapa = new MapaJuego(ANCHO_MAPA, ALTO_MAPA);
  const mundo = new Mundo(mapa, 2024);

  const baseHumanos = { cx: 4, cz: 4 };
  const baseOrcos = { cx: ANCHO_MAPA - 8, cz: ALTO_MAPA - 8 };

  const ayuntamientoHumanos = crearEdificio(
    mundo,
    TipoEdificio.AYUNTAMIENTO,
    Bando.HUMANOS,
    baseHumanos.cx,
    baseHumanos.cz,
  );
  const ayuntamientoOrcos = crearEdificio(
    mundo,
    TipoEdificio.AYUNTAMIENTO,
    Bando.ORCOS,
    baseOrcos.cx,
    baseOrcos.cz,
  );

  const TIPOS_MEZCLA: readonly TipoUnidad[] = [
    TipoUnidad.CAMPESINO,
    TipoUnidad.CAMPESINO,
    TipoUnidad.SOLDADO,
    TipoUnidad.SOLDADO,
    TipoUnidad.ARQUERO,
    TipoUnidad.JINETE,
  ];

  function poblarBando(bando: Bando, cxBase: number, czBase: number): Entidad[] {
    const creadas: Entidad[] = [];
    for (let i = 0; i < 10; i++) {
      const tipo = TIPOS_MEZCLA[i % TIPOS_MEZCLA.length]!;
      const anillo = 2 + Math.floor(i / 6);
      const angulo = (i / 6) * Math.PI * 2;
      const x = cxBase + 3 + Math.cos(angulo) * anillo * 1.6;
      const z = czBase + 3 + Math.sin(angulo) * anillo * 1.6;
      creadas.push(crearUnidad(mundo, tipo, bando, x, z));
    }
    return creadas;
  }

  const unidadesHumanos = poblarBando(Bando.HUMANOS, baseHumanos.cx, baseHumanos.cz);
  const unidadesOrcos = poblarBando(Bando.ORCOS, baseOrcos.cx, baseOrcos.cz);

  mundo.reconstruirEspacial();

  // --- Render mínimo: primitivas, no los modelos definitivos (son de otro frente). ---
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x1b2230, 1);

  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0x1b2230, 50, 160);

  const sol = new THREE.DirectionalLight(0xffe7c2, 2.4);
  sol.position.set(-30, 60, 40);
  escena.add(sol);
  const ambiente = new THREE.HemisphereLight(0xa6cdf5, 0x4c3d29, 0.9);
  escena.add(ambiente);

  const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(ANCHO_MAPA, ALTO_MAPA),
    new THREE.MeshStandardMaterial({ color: 0x3c4a32, roughness: 0.95 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  suelo.position.set(ANCHO_MAPA / 2, 0, ALTO_MAPA / 2);
  escena.add(suelo);
  const rejilla = new THREE.GridHelper(ANCHO_MAPA, ANCHO_MAPA, 0x5c6c48, 0x445236);
  rejilla.position.set(ANCHO_MAPA / 2, 0.01, ALTO_MAPA / 2);
  escena.add(rejilla);

  const visuales: VisualEntidad[] = [];

  function anadirVisual(entidad: Entidad, esEdificio: boolean): void {
    const i = indiceDe(entidad);
    const bando = mundo.bando[i] as Bando;
    const color = COLOR_BANDO[bando] ?? 0xd8b23a;
    const alto = esEdificio ? 1.6 : 0.9;
    const geometria = esEdificio
      ? new THREE.BoxGeometry(mundo.radio[i]! * 1.7, alto, mundo.radio[i]! * 1.7)
      : new THREE.ConeGeometry(mundo.radio[i]!, alto, 6);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const malla = new THREE.Mesh(geometria, material);
    malla.position.set(mundo.x[i]!, mundo.alturaDe(i) + alto / 2, mundo.z[i]!);
    escena.add(malla);

    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(mundo.radio[i]! + 0.12, mundo.radio[i]! + 0.28, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe36b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    anillo.rotation.x = -Math.PI / 2;
    anillo.position.set(mundo.x[i]!, mundo.alturaDe(i) + 0.03, mundo.z[i]!);
    anillo.visible = false;
    escena.add(anillo);

    visuales.push({ entidad, indice: i, malla, anillo });
  }

  anadirVisual(ayuntamientoHumanos, true);
  anadirVisual(ayuntamientoOrcos, true);
  for (const e of unidadesHumanos) anadirVisual(e, false);
  for (const e of unidadesOrcos) anadirVisual(e, false);

  // --- Fantasma de colocación de edificio (tecla B) ---
  const fantasma = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.4, 1),
    new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45 }),
  );
  fantasma.visible = false;
  escena.add(fantasma);

  // --- Cámara ---
  const camara = new CamaraJuego(mapa, window.innerWidth / window.innerHeight);
  camara.saltarA(baseHumanos.cx + 8, baseHumanos.cz + 8);

  function redimensionar(): void {
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(ancho, alto, false);
    camara.redimensionar(ancho / Math.max(1, alto));
  }
  window.addEventListener('resize', redimensionar);
  redimensionar();

  // --- Entrada: el objeto bajo prueba. ---
  const entrada = crearEntrada({ lienzo, camara, mundo, capaInterfaz });

  document.getElementById('boton-prueba-ui')?.addEventListener('click', () => {
    // Si esto seleccionara algo, sería la prueba de que `eventoEsDeInterfaz` falló.
    console.info('[banco-entrada] botón de interfaz pulsado (no debe afectar a la selección)');
  });

  bus.al('ordenEmitida', (datos) => {
    console.info('[banco-entrada] orden', datos.tipo, 'x=', datos.x.toFixed(2), 'z=', datos.z.toFixed(2));
  });

  // --- Bucle ---
  let ultimo = performance.now();
  function fotograma(): void {
    requestAnimationFrame(fotograma);
    const ahora = performance.now();
    const dt = Math.min(0.1, (ahora - ultimo) / 1000);
    ultimo = ahora;

    // El juego real reconstruye la rejilla espacial una vez por tick de simulación;
    // aquí no hay simulación corriendo, así que se rehace cada fotograma para que
    // la selección puntual (que depende de `mundo.consultarRadio`) siga siendo
    // correcta aunque nada se mueva.
    mundo.reconstruirEspacial();

    entrada.actualizar(dt);
    camara.actualizar(dt);

    for (const v of visuales) {
      const seleccionada = sesion.seleccion.includes(v.entidad);
      v.anillo.visible = seleccionada;
    }

    if (sesion.colocacion.activo) {
      const cx = sesion.colocacion.cx;
      const cz = sesion.colocacion.cz;
      fantasma.visible = true;
      fantasma.position.set(cx + 0.5, mapa.alturaEnMundo(cx + 0.5, cz + 0.5) + 0.2, cz + 0.5);
      (fantasma.material as THREE.MeshBasicMaterial).color.set(
        sesion.colocacion.valida ? 0x66ff88 : 0xff5a5a,
      );
    } else {
      fantasma.visible = false;
    }

    if (cajaSeleccionDom) {
      const caja = sesion.cajaSeleccion;
      if (caja) {
        const x0 = Math.min(caja.x0, caja.x1);
        const y0 = Math.min(caja.y0, caja.y1);
        const x1 = Math.max(caja.x0, caja.x1);
        const y1 = Math.max(caja.y0, caja.y1);
        cajaSeleccionDom.style.display = 'block';
        cajaSeleccionDom.style.left = `${x0}px`;
        cajaSeleccionDom.style.top = `${y0}px`;
        cajaSeleccionDom.style.width = `${x1 - x0}px`;
        cajaSeleccionDom.style.height = `${y1 - y0}px`;
      } else {
        cajaSeleccionDom.style.display = 'none';
      }
    }

    if (panelEstado) {
      panelEstado.textContent =
        `seleccion=${sesion.seleccion.length} ` +
        `colocando=${sesion.colocacion.activo} ` +
        `bando=${sesion.bandoJugador} ` +
        `zoom=${camara.distancia.toFixed(1)} ` +
        `azimut=${((camara.azimut * 180) / Math.PI).toFixed(0)}°`;
    }

    renderer.render(escena, camara.nucleo);
  }
  fotograma();

  Object.assign(window as unknown as Record<string, unknown>, {
    banco: {
      entrada,
      camara,
      mundo,
      sesion,
      // Datos de la partida de prueba, útiles para que Playwright no tenga que
      // adivinar índices: entidades reales devueltas por la fábrica.
      ayuntamientoHumanos,
      ayuntamientoOrcos,
      unidadesHumanos,
      unidadesOrcos,
      lienzo,
    },
  });

  console.info(
    `[banco-entrada] humanos=${unidadesHumanos.length + 1} orcos=${unidadesOrcos.length + 1} mapa=${ANCHO_MAPA}x${ALTO_MAPA}`,
  );
}

try {
  arrancar();
} catch (error) {
  fallar(error);
}
