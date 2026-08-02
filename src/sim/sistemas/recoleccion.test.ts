import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { crearEdificio, crearUnidad, crearYacimiento } from '../fabrica';
import { ordenarRecolectar } from '../ordenes';
import {
  Bando,
  Bloqueo,
  Orden,
  TipoEdificio,
  TipoRecurso,
  TipoUnidad,
  TipoYacimiento,
  indiceDe,
} from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { Simulacion } from './orquestador';

const PASO = 0.05;

/** Base humana con ayuntamiento en (10,10) y una veta de oro despejada al este. */
function montarBase(semilla: number): {
  mundo: ReturnType<typeof crearMundoDePruebas>;
  sim: Simulacion;
  buscador: BuscadorRecto;
} {
  const mundo = crearMundoDePruebas(semilla);
  const buscador = new BuscadorRecto();
  const sim = new Simulacion(mundo, buscador);
  crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
  return { mundo, sim, buscador };
}

describe('sistema de recolección', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('el obrero completa el ciclo entero y entrega el oro en el ayuntamiento', () => {
    const { mundo, sim } = montarBase(11);
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 16.5, 12.5);
    const i = indiceDe(obrero);

    const oroAntes = mundo.estadoDe(Bando.HUMANOS).oro;
    let entregas = 0;
    let ultimaCantidad = 0;
    bus.al('recursoEntregado', (datos) => {
      expect(datos.tipo).toBe(TipoRecurso.ORO);
      expect(datos.bando).toBe(Bando.HUMANOS);
      ultimaCantidad = datos.cantidad;
      entregas++;
    });

    expect(ordenarRecolectar(mundo, [obrero], mina)).toBe(1);
    // La plaza se reserva en cuanto arranca el ciclo, no al llegar.
    for (let t = 0; t < 600 && entregas === 0; t++) sim.paso(PASO);

    expect(entregas).toBe(1);
    expect(ultimaCantidad).toBe(10);
    expect(mundo.estadoDe(Bando.HUMANOS).oro).toBe(oroAntes + 10);
    expect(mundo.estadoDe(Bando.HUMANOS).oroRecogido).toBe(10);
    expect(mundo.cargaCantidad[i]).toBe(0);
    // Y vuelve a la MISMA veta, que es lo que mantiene la cuadrilla en su sitio.
    expect(mundo.orden[i]).toBe(Orden.RECOLECTAR);
    expect(mundo.yacimientoMemorizado[i]).toBe(mina);
    expect(mundo.ordenObjetivo[i]).toBe(mina);
  });

  it('el ciclo se repite solo: dos viajes seguidos sin volver a dar órdenes', () => {
    const { mundo, sim } = montarBase(12);
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 16.5, 12.5);

    let entregas = 0;
    bus.al('recursoEntregado', () => entregas++);

    ordenarRecolectar(mundo, [obrero], mina);
    for (let t = 0; t < 1200 && entregas < 2; t++) sim.paso(PASO);

    expect(entregas).toBeGreaterThanOrEqual(2);
    expect(mundo.estadoDe(Bando.HUMANOS).oroRecogido).toBeGreaterThanOrEqual(20);
    expect(mundo.reserva[indiceDe(mina)]).toBeLessThanOrEqual(2500 - 20);
  });

  it('reparte la cuadrilla entre yacimientos en vez de amontonarla', () => {
    const { mundo, sim } = montarBase(13);
    crearYacimiento(mundo, TipoYacimiento.ARBOL, 20, 12);
    crearYacimiento(mundo, TipoYacimiento.ARBOL, 20, 14);
    crearYacimiento(mundo, TipoYacimiento.ARBOL, 20, 16);

    const obreros = [];
    for (let k = 0; k < 3; k++) {
      obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 16.5, 12.5 + k));
    }

    // Se manda a todos al mismo árbol y el reparto lo hace el sistema al volver.
    // Aquí basta con arrancar el ciclo sin destino concreto: cada uno elige el suyo.
    for (const obrero of obreros) {
      const i = indiceDe(obrero);
      mundo.orden[i] = Orden.RECOLECTAR;
      mundo.cargaTipo[i] = TipoRecurso.MADERA;
    }

    for (let t = 0; t < 20; t++) sim.paso(PASO);

    const elegidos = new Set(obreros.map((o) => mundo.yacimientoMemorizado[indiceDe(o)]));
    expect(elegidos.size).toBe(3);
  });

  it('una veta agotada desaparece, libera su casilla y avisa al buscador de rutas', () => {
    const { mundo, sim, buscador } = montarBase(14);
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    mundo.reserva[indiceDe(mina)] = 4;
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18.5, 12.5);

    let agotados = 0;
    bus.al('recursoAgotado', (datos) => {
      expect(datos.tipo).toBe(TipoRecurso.ORO);
      agotados++;
    });

    expect(mundo.mapa.bloqueoEn(20, 12) & Bloqueo.YACIMIENTO).toBe(Bloqueo.YACIMIENTO);
    ordenarRecolectar(mundo, [obrero], mina);
    for (let t = 0; t < 400 && agotados === 0; t++) sim.paso(PASO);

    expect(agotados).toBe(1);
    expect(mundo.esValida(mina)).toBe(false);
    expect(mundo.mapa.bloqueoEn(20, 12)).toBe(Bloqueo.LIBRE);
    expect(buscador.invalidaciones.some(([cx, cz]) => cx === 20 && cz === 12)).toBe(true);

    // Y el obrero se lleva a casa lo poco que quedaba en vez de quedarse plantado.
    for (let t = 0; t < 400; t++) sim.paso(PASO);
    expect(mundo.estadoDe(Bando.HUMANOS).oroRecogido).toBe(4);
  });

  it('sin depósito al que volver, el obrero suelta la orden y avisa', () => {
    const mundo = crearMundoDePruebas(15);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18.5, 12.5);

    let avisos = 0;
    bus.al('aviso', (datos) => {
      if (datos.clave === 'sin-deposito') avisos++;
    });

    ordenarRecolectar(mundo, [obrero], mina);
    for (let t = 0; t < 400 && avisos === 0; t++) sim.paso(PASO);

    expect(avisos).toBeGreaterThan(0);
    expect(mundo.orden[indiceDe(obrero)]).toBe(Orden.NINGUNA);
  });
});
