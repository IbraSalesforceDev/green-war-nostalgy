import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { crearEdificio, crearUnidad, crearYacimiento } from '../fabrica';
import {
  cancelarOrden,
  ordenContextual,
  ordenarAtacar,
  ordenarMantenerPosicion,
  ordenarMover,
  ordenarRecolectar,
} from '../ordenes';
import {
  Bando,
  ENTIDAD_NULA,
  Entidad,
  Orden,
  TipoEdificio,
  TipoUnidad,
  TipoYacimiento,
  indiceDe,
} from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { Simulacion } from './orquestador';

const PASO = 0.05;

describe('órdenes', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('no obedece a unidades de otro bando ni a entidades muertas', () => {
    const mundo = crearMundoDePruebas(51);
    new Simulacion(mundo, new BuscadorRecto());

    const propia = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);
    const ajena = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 21.5, 20.5);

    expect(ordenarMover(mundo, [propia, ajena], 30, 30, Bando.HUMANOS)).toBe(1);
    expect(mundo.orden[indiceDe(ajena)]).toBe(Orden.NINGUNA);

    mundo.vida[indiceDe(propia)] = 0;
    expect(ordenarMover(mundo, [propia], 30, 30)).toBe(0);
  });

  it('emite ordenEmitida con las entidades que de verdad han obedecido', () => {
    const mundo = crearMundoDePruebas(52);
    new Simulacion(mundo, new BuscadorRecto());
    const unidades: Entidad[] = [
      crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5),
      crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 21.5, 20.5),
    ];

    let recibido: { tipo: string; entidades: readonly Entidad[] } | null = null;
    bus.al('ordenEmitida', (datos) => {
      recibido = { tipo: datos.tipo, entidades: datos.entidades };
    });

    ordenarMover(mundo, unidades, 30, 30);
    expect(recibido).not.toBeNull();
    expect(recibido!.tipo).toBe('mover');
    expect(recibido!.entidades).toEqual(unidades);
  });

  it('recolectar solo lo aceptan los obreros', () => {
    const mundo = crearMundoDePruebas(53);
    new Simulacion(mundo, new BuscadorRecto());
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    const soldado = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 18.5, 12.5);
    const campesino = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18.5, 13.5);

    expect(ordenarRecolectar(mundo, [soldado, campesino], mina)).toBe(1);
    expect(mundo.orden[indiceDe(campesino)]).toBe(Orden.RECOLECTAR);
    expect(mundo.orden[indiceDe(soldado)]).toBe(Orden.NINGUNA);
  });

  it('atacar exige que el blanco sea enemigo', () => {
    const mundo = crearMundoDePruebas(54);
    new Simulacion(mundo, new BuscadorRecto());
    const propia = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);
    const amiga = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 21.5, 20.5);
    const enemiga = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 25.5, 20.5);

    expect(ordenarAtacar(mundo, [propia], amiga)).toBe(0);
    expect(ordenarAtacar(mundo, [propia], enemiga)).toBe(1);
    expect(mundo.ordenObjetivo[indiceDe(propia)]).toBe(enemiga);
  });

  it('cancelar detiene el movimiento en curso', () => {
    const mundo = crearMundoDePruebas(55);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);
    const i = indiceDe(unidad);

    ordenarMover(mundo, [unidad], 40, 40);
    for (let t = 0; t < 20; t++) sim.paso(PASO);
    expect(mundo.x[i]).toBeGreaterThan(20.5);

    cancelarOrden(mundo, [unidad]);
    const x = mundo.x[i];
    const z = mundo.z[i];
    for (let t = 0; t < 40; t++) sim.paso(PASO);

    expect(mundo.orden[i]).toBe(Orden.NINGUNA);
    expect(mundo.x[i]).toBeCloseTo(x, 5);
    expect(mundo.z[i]).toBeCloseTo(z, 5);
  });

  it('mantener posición fija el ancla en el sitio actual', () => {
    const mundo = crearMundoDePruebas(56);
    new Simulacion(mundo, new BuscadorRecto());
    const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 22.5, 24.5);

    expect(ordenarMantenerPosicion(mundo, [unidad])).toBe(1);
    const i = indiceDe(unidad);
    expect(mundo.orden[i]).toBe(Orden.MANTENER_POSICION);
    expect(mundo.anclaX[i]).toBeCloseTo(22.5, 5);
    expect(mundo.anclaZ[i]).toBeCloseTo(24.5, 5);
  });

  describe('orden contextual', () => {
    it('sobre suelo vacío mueve', () => {
      const mundo = crearMundoDePruebas(57);
      new Simulacion(mundo, new BuscadorRecto());
      const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);

      ordenContextual(mundo, [unidad], 30, 30, ENTIDAD_NULA);
      expect(mundo.orden[indiceDe(unidad)]).toBe(Orden.MOVER);
    });

    it('sobre un enemigo ataca', () => {
      const mundo = crearMundoDePruebas(58);
      new Simulacion(mundo, new BuscadorRecto());
      const unidad = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);
      const enemigo = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 26.5, 20.5);

      ordenContextual(mundo, [unidad], 26.5, 20.5, enemigo);
      expect(mundo.orden[indiceDe(unidad)]).toBe(Orden.ATACAR);
      expect(mundo.ordenObjetivo[indiceDe(unidad)]).toBe(enemigo);
    });

    it('sobre un árbol manda al obrero a talar y al soldado a caminar', () => {
      const mundo = crearMundoDePruebas(59);
      new Simulacion(mundo, new BuscadorRecto());
      const arbol = crearYacimiento(mundo, TipoYacimiento.ARBOL, 24, 20);
      const campesino = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 20.5, 20.5);

      ordenContextual(mundo, [campesino], 24.5, 20.5, arbol);
      expect(mundo.orden[indiceDe(campesino)]).toBe(Orden.RECOLECTAR);

      const soldado = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 21.5);
      ordenContextual(mundo, [soldado], 24.5, 20.5, arbol);
      expect(mundo.orden[indiceDe(soldado)]).toBe(Orden.MOVER);
    });

    it('sobre un edificio propio dañado, el obrero repara', () => {
      const mundo = crearMundoDePruebas(60);
      new Simulacion(mundo, new BuscadorRecto());
      const granja = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 24, 20, true);
      mundo.vida[indiceDe(granja)] = 50;
      const campesino = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 20.5, 20.5);

      ordenContextual(mundo, [campesino], 25, 21, granja);
      expect(mundo.orden[indiceDe(campesino)]).toBe(Orden.REPARAR);
      expect(mundo.ordenObjetivo[indiceDe(campesino)]).toBe(granja);
    });

    it('sobre un andamio propio, el obrero se suma a la obra', () => {
      const mundo = crearMundoDePruebas(61);
      new Simulacion(mundo, new BuscadorRecto());
      const andamio = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 24, 20, false);
      const campesino = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 20.5, 20.5);

      ordenContextual(mundo, [campesino], 25, 21, andamio);
      expect(mundo.orden[indiceDe(campesino)]).toBe(Orden.CONSTRUIR);
      expect(mundo.ordenObjetivo[indiceDe(campesino)]).toBe(andamio);
    });

    it('sobre un edificio propio intacto, simplemente mueve', () => {
      const mundo = crearMundoDePruebas(62);
      new Simulacion(mundo, new BuscadorRecto());
      const granja = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 24, 20, true);
      const campesino = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 20.5, 20.5);

      ordenContextual(mundo, [campesino], 25, 21, granja);
      expect(mundo.orden[indiceDe(campesino)]).toBe(Orden.MOVER);
    });
  });
});
