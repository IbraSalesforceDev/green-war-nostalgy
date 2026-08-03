import { describe, expect, it, beforeEach, vi } from 'vitest';
import { crearAdorno, crearEdificio, crearUnidad, crearYacimiento } from '../sim/fabrica';
import { MapaJuego } from '../sim/mapa';
import { Mundo } from '../sim/mundo';
import { Bando, TipoEdificio, TipoUnidad, TipoYacimiento, indiceDe } from '../sim/tipos';
import { CamaraJuego } from '../render/camara';
import {
  entidadBajoPuntero,
  filtrarPrioridad,
  mismasEnMapa,
  mismasEnPantalla,
  obrerosOciosos,
  seleccionEnCaja,
} from './seleccion';
import { DetectorGestos, CallbacksGestos, ResultadoPulsacionLarga } from './gestos';
import { MS_DOBLE_TOQUE, MS_PULSACION_LARGA, UMBRAL_ARRASTRE } from '../sim/constantes';

/**
 * Pruebas de lógica pura de este frente: caja de selección, prioridades de
 * filtrado y detección de gestos con eventos sintéticos. Se aíslan del DOM y de
 * `entrada.ts` (que solo cablea Pointer Events reales) pero usan un `Mundo` y una
 * `CamaraJuego` de verdad: ninguna de las dos clases toca el navegador, así que
 * corren igual bajo vitest que en el juego.
 */

function mundoDePrueba(): Mundo {
  const mapa = new MapaJuego(32, 32);
  return new Mundo(mapa, 7);
}

describe('filtrarPrioridad', () => {
  let mundo: Mundo;

  beforeEach(() => {
    mundo = mundoDePrueba();
  });

  it('deja pasar tal cual una lista de 0 o 1 elementos', () => {
    expect(filtrarPrioridad(mundo, [], Bando.HUMANOS)).toEqual([]);
    const u = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5));
    expect(filtrarPrioridad(mundo, [u], Bando.HUMANOS)).toEqual([u]);
  });

  it('con unidades propias y enemigas mezcladas, se queda solo con las propias', () => {
    const propia = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5));
    const enemiga = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 6, 5));
    const resultado = filtrarPrioridad(mundo, [propia, enemiga], Bando.HUMANOS);
    expect(resultado).toEqual([propia]);
  });

  it('si todo es enemigo, no descarta nada (no hay "propias" con las que quedarse)', () => {
    const e1 = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 5, 5));
    const e2 = indiceDe(crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.ORCOS, 6, 5));
    const resultado = filtrarPrioridad(mundo, [e1, e2], Bando.HUMANOS);
    expect(resultado.sort()).toEqual([e1, e2].sort());
  });

  it('con unidades y edificios mezclados, se queda solo con las unidades', () => {
    const unidad = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5));
    const edificio = indiceDe(crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 2, 2));
    const resultado = filtrarPrioridad(mundo, [unidad, edificio], Bando.HUMANOS);
    expect(resultado).toEqual([unidad]);
  });

  it('aplica primero la prioridad de bando y luego la de clase', () => {
    const unidadPropia = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5));
    const edificioPropio = indiceDe(crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 2, 2));
    const unidadEnemiga = indiceDe(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 8, 8));
    const resultado = filtrarPrioridad(
      mundo,
      [unidadPropia, edificioPropio, unidadEnemiga],
      Bando.HUMANOS,
    );
    expect(resultado).toEqual([unidadPropia]);
  });
});

describe('entidadBajoPuntero', () => {
  let mundo: Mundo;

  beforeEach(() => {
    mundo = mundoDePrueba();
  });

  it('devuelve la entidad nula sobre suelo vacío', () => {
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5);
    mundo.reconstruirEspacial();
    expect(entidadBajoPuntero(mundo, 20, 20)).toBe(0);
  });

  it('prioriza unidades sobre edificios cuando se solapan', () => {
    const edificio = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 5, 5);
    const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 6, 6);
    mundo.reconstruirEspacial();
    // El punto de consulta cae dentro del radio de ambas: la unidad debe ganar.
    const resultado = entidadBajoPuntero(mundo, 6, 6);
    expect(resultado).toBe(unidad);
    expect(resultado).not.toBe(edificio);
  });

  it('elige la más cercana entre varias unidades candidatas', () => {
    const lejana = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 10, 10);
    const cercana = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 10.3, 10.3);
    void lejana;
    mundo.reconstruirEspacial();
    expect(entidadBajoPuntero(mundo, 10.3, 10.3)).toBe(cercana);
  });

  it('ignora una unidad muerta', () => {
    const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 5, 5);
    mundo.vida[indiceDe(unidad)] = 0;
    mundo.reconstruirEspacial();
    expect(entidadBajoPuntero(mundo, 5, 5)).toBe(0);
  });

  it('ignora un yacimiento y un adorno: solo unidades y edificios cuentan', () => {
    crearYacimiento(mundo, TipoYacimiento.ARBOL, 5, 5);
    crearAdorno(mundo, 0, 6, 6, false);
    mundo.reconstruirEspacial();
    expect(entidadBajoPuntero(mundo, 5.5, 5.5)).toBe(0);
  });
});

describe('seleccionEnCaja / mismasEnPantalla / mismasEnMapa', () => {
  let mundo: Mundo;
  let camara: CamaraJuego;
  const ANCHO = 800;
  const ALTO = 600;

  beforeEach(() => {
    mundo = mundoDePrueba();
    camara = new CamaraJuego(mundo.mapa, ANCHO / ALTO);
    // Cámara cenital, mirando al centro del mapa: con `azimut` en el valor por
    // defecto y una inclinación pronunciada las coordenadas de pantalla siguen
    // aproximadamente los ejes de mundo, que es lo único que necesitan estas
    // pruebas para razonar sobre "dentro/fuera de la caja".
    camara.saltarA(16, 16);
    camara.distancia = 40;
    camara.inclinacion = Math.PI / 2 - 0.05; // casi cenital: X/Z ~ pantalla X/Y
  });

  it('la caja recoge solo lo que cae dentro del rectángulo de pantalla', () => {
    const dentro1 = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 16, 16);
    const dentro2 = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 17, 17);
    const fuera = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 30, 30);

    const proyeccion = { x: 0, y: 0 };
    camara.aPantalla(16, mundo.alturaDe(indiceDe(dentro1)), 16, ANCHO, ALTO, proyeccion);
    const centroX = proyeccion.x;
    const centroY = proyeccion.y;

    const resultado = seleccionEnCaja(
      mundo,
      camara,
      centroX - 120,
      centroY - 120,
      centroX + 120,
      centroY + 120,
      Bando.HUMANOS,
      ANCHO,
      ALTO,
    );

    expect(resultado).toContain(dentro1);
    expect(resultado).toContain(dentro2);
    expect(resultado).not.toContain(fuera);
  });

  it('la caja de selección respeta la prioridad propias > enemigas y unidades > edificios', () => {
    const propia = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 16, 16);
    const enemiga = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 16.2, 16.2);
    crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 15, 15);

    const proyeccion = { x: 0, y: 0 };
    camara.aPantalla(16, mundo.alturaDe(indiceDe(propia)), 16, ANCHO, ALTO, proyeccion);

    const resultado = seleccionEnCaja(
      mundo,
      camara,
      proyeccion.x - 300,
      proyeccion.y - 300,
      proyeccion.x + 300,
      proyeccion.y + 300,
      Bando.HUMANOS,
      ANCHO,
      ALTO,
    );

    expect(resultado).toEqual([propia]);
    expect(resultado).not.toContain(enemiga);
  });

  it('mismasEnPantalla solo trae al mismo tipo/bando visible en pantalla', () => {
    const modelo = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 16, 16);
    const mismoTipoCerca = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 17, 17);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 16, 17); // otro tipo
    crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.ORCOS, 15, 15); // otro bando
    const lejosDePantalla = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 300, 300);

    const resultado = mismasEnPantalla(mundo, camara, modelo, ANCHO, ALTO);
    expect(resultado).toContain(modelo);
    expect(resultado).toContain(mismoTipoCerca);
    expect(resultado).not.toContain(lejosDePantalla);
    expect(resultado.length).toBe(2);
  });

  it('mismasEnMapa ignora si está en pantalla o no', () => {
    const modelo = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 16, 16);
    const lejos = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 300, 300);
    const resultado = mismasEnMapa(mundo, modelo);
    expect(resultado).toContain(modelo);
    expect(resultado).toContain(lejos);
  });
});

describe('obrerosOciosos', () => {
  it('encuentra solo campesinos vivos, del bando pedido y sin orden en curso', () => {
    const mundo = mundoDePrueba();
    const ociosoPropio = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 5, 5);
    const soldadoPropio = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 6, 5);
    const campesinoEnemigo = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 7, 5);
    void soldadoPropio;
    void campesinoEnemigo;

    const ociosos = obrerosOciosos(mundo, Bando.HUMANOS);
    expect(ociosos).toEqual([indiceDe(ociosoPropio)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detección de gestos: eventos sintéticos sobre `DetectorGestos`, sin DOM.
// ─────────────────────────────────────────────────────────────────────────────

function callbacksEspia() {
  return {
    alTocar: vi.fn(),
    alTocarDoble: vi.fn(),
    alPulsarLargo: vi.fn((_x: number, _y: number) => 'ninguno' as ResultadoPulsacionLarga),
    alIniciarArrastreCamara: vi.fn(),
    alArrastrarCamara: vi.fn(),
    alSoltarArrastreCamara: vi.fn(),
    alIniciarCaja: vi.fn(),
    alArrastrarCaja: vi.fn(),
    alSoltarCaja: vi.fn(),
    alPellizco: vi.fn(),
    alRotarDosDedos: vi.fn(),
    alIniciarDosDedos: vi.fn(),
    alSoltarDosDedos: vi.fn(),
  } satisfies CallbacksGestos;
}

describe('DetectorGestos — ratón', () => {
  it('un clic izquierdo sin arrastre es un toque', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, true, 0, 0);
    d.alSoltar(1, 100, 100, 50);
    expect(cb.alTocar).toHaveBeenCalledWith(100, 100, true, 0);
    expect(cb.alIniciarCaja).not.toHaveBeenCalled();
  });

  it('arrastrar con el izquierdo más del umbral abre una caja, no mueve la cámara', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, true, 0, 0);
    d.alMover(1, 100 + UMBRAL_ARRASTRE + 5, 100, 10);
    expect(cb.alIniciarCaja).toHaveBeenCalledTimes(1);
    expect(cb.alIniciarArrastreCamara).not.toHaveBeenCalled();
    d.alSoltar(1, 120, 100, 20);
    expect(cb.alSoltarCaja).toHaveBeenCalledTimes(1);
  });

  it('el botón derecho dispara el toque al instante, incluso sin soltar', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 50, 60, true, 2, 0);
    expect(cb.alTocar).toHaveBeenCalledWith(50, 60, true, 2);
  });

  it('dos clics rápidos y cercanos cuentan como doble clic', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, true, 0, 0);
    d.alSoltar(1, 100, 100, 5);
    d.alPresionar(1, 102, 101, true, 0, 50);
    d.alSoltar(1, 102, 101, 60);
    expect(cb.alTocarDoble).toHaveBeenCalledTimes(1);
    expect(cb.alTocar).toHaveBeenCalledTimes(1); // solo el primero cuenta como toque simple
  });

  it('dos clics lejanos en el tiempo no cuentan como doble clic', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, true, 0, 0);
    d.alSoltar(1, 100, 100, 5);
    d.alPresionar(1, 100, 100, true, 0, 5 + MS_DOBLE_TOQUE + 50);
    d.alSoltar(1, 100, 100, 5 + MS_DOBLE_TOQUE + 60);
    expect(cb.alTocarDoble).not.toHaveBeenCalled();
    expect(cb.alTocar).toHaveBeenCalledTimes(2);
  });

  it('el ratón nunca dispara pulsación larga', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, true, 0, 0);
    d.actualizar(MS_PULSACION_LARGA + 100);
    expect(cb.alPulsarLargo).not.toHaveBeenCalled();
  });
});

describe('DetectorGestos — táctil', () => {
  it('un dedo que arrastra de inmediato mueve la cámara, no abre una caja', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alMover(1, 100 + UMBRAL_ARRASTRE + 5, 100, 10);
    expect(cb.alIniciarArrastreCamara).toHaveBeenCalledTimes(1);
    expect(cb.alIniciarCaja).not.toHaveBeenCalled();
  });

  it('un dedo quieto el tiempo de pulsación larga la dispara, sin haberse movido', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.actualizar(MS_PULSACION_LARGA + 10);
    expect(cb.alPulsarLargo).toHaveBeenCalledWith(100, 100);
  });

  it('si la pulsación larga devuelve "caja", el arrastre posterior dibuja una caja', () => {
    const cb = callbacksEspia();
    cb.alPulsarLargo = vi.fn(() => 'caja' as ResultadoPulsacionLarga);
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.actualizar(MS_PULSACION_LARGA + 10);
    expect(cb.alIniciarCaja).toHaveBeenCalledWith(100, 100);
    d.alMover(1, 130, 100, MS_PULSACION_LARGA + 40);
    expect(cb.alArrastrarCaja).toHaveBeenCalled();
  });

  it('si la pulsación larga devuelve "ninguno", el arrastre posterior no hace nada', () => {
    const cb = callbacksEspia();
    cb.alPulsarLargo = vi.fn(() => 'ninguno' as ResultadoPulsacionLarga);
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.actualizar(MS_PULSACION_LARGA + 10);
    d.alMover(1, 160, 100, MS_PULSACION_LARGA + 40);
    expect(cb.alIniciarArrastreCamara).not.toHaveBeenCalled();
    expect(cb.alIniciarCaja).not.toHaveBeenCalled();
  });

  it('un segundo dedo activa el modo de dos dedos y suspende el arrastre de cámara', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alMover(1, 100 + UMBRAL_ARRASTRE + 5, 100, 10); // entra en modo cámara
    expect(cb.alIniciarArrastreCamara).toHaveBeenCalledTimes(1);

    d.alPresionar(2, 200, 100, false, -1, 15);
    expect(cb.alSoltarArrastreCamara).toHaveBeenCalledTimes(1);
    expect(cb.alIniciarDosDedos).toHaveBeenCalledTimes(1);
    expect(d.cantidadActiva).toBe(2);
  });

  it('el pellizco reporta un factor de escala y el punto medio', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alPresionar(2, 200, 100, false, -1, 0); // 100px de separación inicial
    d.alMover(1, 80, 100, 10); // separación pasa a 140px: se alejan (zoom in)
    expect(cb.alPellizco).toHaveBeenCalled();
    const [factor, xMedio] = cb.alPellizco.mock.calls[0]!;
    expect(factor).toBeGreaterThan(1);
    expect(xMedio).toBeCloseTo(140, 0); // (80+200)/2
  });

  it('la rotación de dos dedos no se dispara por debajo del umbral', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alPresionar(2, 200, 100, false, -1, 0);
    // Movimiento minúsculo: gira un ángulo insignificante.
    d.alMover(1, 100, 101, 10);
    expect(cb.alRotarDosDedos).not.toHaveBeenCalled();
  });

  it('la rotación de dos dedos se dispara al superar el umbral', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alPresionar(2, 200, 100, false, -1, 0);
    // Levanta el dedo 1 verticalmente una cantidad grande: gira bastante el ángulo.
    d.alMover(1, 100, 40, 10);
    expect(cb.alRotarDosDedos).toHaveBeenCalled();
  });

  it('(regresión) una pulsación larga no se dispara si ya hay un segundo dedo activo', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alPresionar(2, 200, 100, false, -1, 10); // segundo dedo llega pronto
    d.actualizar(MS_PULSACION_LARGA + 20); // el primero ya lleva quieto de sobra
    expect(cb.alPulsarLargo).not.toHaveBeenCalled();
  });

  it('cancelar un puntero durante un arrastre de cámara suelta limpiamente', () => {
    const cb = callbacksEspia();
    const d = new DetectorGestos(cb);
    d.alPresionar(1, 100, 100, false, -1, 0);
    d.alMover(1, 100 + UMBRAL_ARRASTRE + 5, 100, 10);
    d.alCancelar(1);
    expect(cb.alSoltarArrastreCamara).toHaveBeenCalledTimes(1);
    expect(d.cantidadActiva).toBe(0);
  });
});
