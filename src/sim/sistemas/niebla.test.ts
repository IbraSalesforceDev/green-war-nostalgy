import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { INTERVALO_NIEBLA } from '../constantes';
import { crearEdificio, crearUnidad, retirarEntidad } from '../fabrica';
import { Bando, TipoEdificio, TipoUnidad, Vision, indiceDe } from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { Simulacion } from './orquestador';

const PASO = 0.05;

describe('sistema de niebla de guerra', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('ilumina alrededor de las unidades propias y solo de su bando', () => {
    const mundo = crearMundoDePruebas(41);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);

    let actualizaciones = 0;
    bus.al('nieblaActualizada', () => actualizaciones++);

    for (let t = 0; t < INTERVALO_NIEBLA; t++) sim.paso(PASO);

    expect(actualizaciones).toBeGreaterThan(0);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 20, 20)).toBe(Vision.VISIBLE);
    expect(mundo.mapa.visionEn(Bando.ORCOS, 20, 20)).toBe(Vision.OCULTO);
    // Fuera del radio de visión del soldado (7 casillas) sigue todo negro.
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 20, 32)).toBe(Vision.OCULTO);
  });

  it('al moverse, lo que deja atrás queda recordado y no visible', () => {
    const mundo = crearMundoDePruebas(42);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const soldado = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 10.5, 10.5);

    for (let t = 0; t < INTERVALO_NIEBLA; t++) sim.paso(PASO);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 10, 10)).toBe(Vision.VISIBLE);

    // Teletransporte: el sistema no debe fiarse de por dónde ha pasado, solo de dónde está.
    const i = indiceDe(soldado);
    mundo.x[i] = 36.5;
    mundo.z[i] = 36.5;
    for (let t = 0; t < INTERVALO_NIEBLA * 2; t++) sim.paso(PASO);

    expect(mundo.mapa.visionEn(Bando.HUMANOS, 10, 10)).toBe(Vision.RECORDADO);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 36, 36)).toBe(Vision.VISIBLE);
  });

  it('dos fuentes solapadas mantienen la casilla visible hasta que se van las dos', () => {
    const mundo = crearMundoDePruebas(43);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const uno = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);
    const dos = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 21.5, 20.5);

    for (let t = 0; t < INTERVALO_NIEBLA; t++) sim.paso(PASO);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 20, 20)).toBe(Vision.VISIBLE);

    retirarEntidad(mundo, indiceDe(uno));
    for (let t = 0; t < INTERVALO_NIEBLA * 2; t++) sim.paso(PASO);
    // El segundo sigue allí: la casilla no puede apagarse.
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 20, 20)).toBe(Vision.VISIBLE);

    retirarEntidad(mundo, indiceDe(dos));
    for (let t = 0; t < INTERVALO_NIEBLA * 2; t++) sim.paso(PASO);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 20, 20)).toBe(Vision.RECORDADO);
  });

  it('los edificios también ven, y su visión desaparece con ellos', () => {
    const mundo = crearMundoDePruebas(44);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const torre = crearEdificio(mundo, TipoEdificio.TORRE, Bando.HUMANOS, 20, 20, true);

    for (let t = 0; t < INTERVALO_NIEBLA; t++) sim.paso(PASO);
    expect(mundo.mapa.visionEn(Bando.HUMANOS, 25, 21)).toBe(Vision.VISIBLE);
    expect(sim.niebla.fuentesActivas()).toBe(1);

    retirarEntidad(mundo, indiceDe(torre));
    for (let t = 0; t < INTERVALO_NIEBLA * 2; t++) sim.paso(PASO);

    expect(mundo.mapa.visionEn(Bando.HUMANOS, 25, 21)).toBe(Vision.RECORDADO);
    expect(sim.niebla.fuentesActivas()).toBe(0);
  });

  it('no recalcula nada en los ticks intermedios', () => {
    const mundo = crearMundoDePruebas(45);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20.5, 20.5);

    let actualizaciones = 0;
    bus.al('nieblaActualizada', () => actualizaciones++);

    for (let t = 0; t < INTERVALO_NIEBLA * 4; t++) sim.paso(PASO);

    // Solo la primera aplicación cuenta: quieta y viva, la unidad no toca el mapa.
    expect(actualizaciones).toBe(1);
  });
});
