import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { VIDA_INICIAL_OBRA } from '../constantes';
import { fichaEdificio } from '../datos/edificios';
import { crearEdificio, crearUnidad } from '../fabrica';
import { ordenarConstruir, ordenarReparar } from '../ordenes';
import {
  Bando,
  Bloqueo,
  ENTIDAD_NULA,
  Entidad,
  Orden,
  TipoEdificio,
  TipoUnidad,
  indiceDe,
} from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { Simulacion } from './orquestador';

const PASO = 0.05;

function montarBase(semilla: number): {
  mundo: ReturnType<typeof crearMundoDePruebas>;
  sim: Simulacion;
  obreros: Entidad[];
} {
  const mundo = crearMundoDePruebas(semilla);
  const sim = new Simulacion(mundo, new BuscadorRecto());
  crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
  const obreros = [
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18, 12),
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18, 13),
  ];
  return { mundo, sim, obreros };
}

describe('sistema de construcción', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('levanta una granja de principio a fin y desbloquea su población', () => {
    const { mundo, sim, obreros } = montarBase(21);
    const estado = mundo.estadoDe(Bando.HUMANOS);
    const ficha = fichaEdificio(TipoEdificio.GRANJA);
    const oroAntes = estado.oro;
    const maderaAntes = estado.madera;
    const poblacionAntes = estado.poblacionMaxima;

    let iniciadas = 0;
    let terminadas = 0;
    bus.al('construccionIniciada', () => iniciadas++);
    bus.al('producidoTerminado', () => terminadas++);

    const andamio = ordenarConstruir(mundo, obreros, TipoEdificio.GRANJA, 20, 20);
    expect(andamio).not.toBe(ENTIDAD_NULA);
    const o = indiceDe(andamio);

    // El coste se cobra al colocar el andamio, no al terminarlo.
    expect(estado.oro).toBe(oroAntes - ficha.coste.oro);
    expect(estado.madera).toBe(maderaAntes - ficha.coste.madera);
    expect(iniciadas).toBe(1);
    expect(mundo.progresoObra[o]).toBe(0);
    expect(mundo.vida[o]).toBeCloseTo(ficha.vida * VIDA_INICIAL_OBRA, 5);
    expect(mundo.mapa.bloqueoEn(20, 20) & Bloqueo.OBRA).toBe(Bloqueo.OBRA);

    for (let t = 0; t < 2000 && mundo.progresoObra[o] < 1; t++) sim.paso(PASO);

    expect(mundo.progresoObra[o]).toBeGreaterThanOrEqual(1);
    expect(mundo.vida[o]).toBe(ficha.vida);
    expect(terminadas).toBe(1);
    // La huella pasa de obra a edificio: ni doble marca ni casilla suelta.
    for (let dz = 0; dz < ficha.huella; dz++) {
      for (let dx = 0; dx < ficha.huella; dx++) {
        expect(mundo.mapa.bloqueoEn(20 + dx, 20 + dz)).toBe(Bloqueo.EDIFICIO);
      }
    }
    expect(estado.poblacionMaxima).toBe(poblacionAntes + ficha.poblacionQueAporta);
    expect(estado.edificiosDisponibles.has(TipoEdificio.GRANJA)).toBe(true);
    // Y los obreros quedan libres al terminar.
    for (let t = 0; t < 5; t++) sim.paso(PASO);
    for (const obrero of obreros) {
      expect(mundo.orden[indiceDe(obrero)]).toBe(Orden.NINGUNA);
    }
  });

  it('varios obreros terminan antes que uno solo', () => {
    const contar = (numeroObreros: number): number => {
      const mundo = crearMundoDePruebas(22);
      const sim = new Simulacion(mundo, new BuscadorRecto());
      crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
      const obreros: Entidad[] = [];
      for (let k = 0; k < numeroObreros; k++) {
        obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 18, 20 + k * 0.8));
      }
      const andamio = ordenarConstruir(mundo, obreros, TipoEdificio.GRANJA, 20, 20);
      const o = indiceDe(andamio);
      let ticks = 0;
      while (ticks < 3000 && mundo.progresoObra[o] < 1) {
        sim.paso(PASO);
        ticks++;
      }
      return ticks;
    };

    const conUno = contar(1);
    const conTres = contar(3);
    expect(conTres).toBeLessThan(conUno);
  });

  it('no cobra ni coloca nada si el sitio está ocupado o falta tecnología', () => {
    const { mundo, obreros } = montarBase(23);
    const estado = mundo.estadoDe(Bando.HUMANOS);

    // Encima del propio ayuntamiento.
    const oroAntes = estado.oro;
    let avisos = 0;
    bus.al('aviso', () => avisos++);
    expect(ordenarConstruir(mundo, obreros, TipoEdificio.GRANJA, 11, 11)).toBe(ENTIDAD_NULA);
    expect(estado.oro).toBe(oroAntes);
    expect(avisos).toBeGreaterThan(0);

    // La herrería exige barracón, que aún no existe.
    expect(ordenarConstruir(mundo, obreros, TipoEdificio.HERRERIA, 30, 30)).toBe(ENTIDAD_NULA);
    expect(estado.oro).toBe(oroAntes);
  });

  it('no coloca el andamio si no hay oro suficiente', () => {
    const { mundo, obreros } = montarBase(24);
    const estado = mundo.estadoDe(Bando.HUMANOS);
    estado.oro = 10;
    const maderaAntes = estado.madera;

    expect(ordenarConstruir(mundo, obreros, TipoEdificio.GRANJA, 20, 20)).toBe(ENTIDAD_NULA);
    expect(estado.oro).toBe(10);
    expect(estado.madera).toBe(maderaAntes);
    expect(mundo.mapa.bloqueoEn(20, 20)).toBe(Bloqueo.LIBRE);
  });

  it('reparar cura el edificio y cuesta recursos', () => {
    const { mundo, sim, obreros } = montarBase(25);
    const granja = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 20, 20, true);
    const g = indiceDe(granja);
    mundo.vida[g] = 100;

    const estado = mundo.estadoDe(Bando.HUMANOS);
    const oroAntes = estado.oro;
    const maderaAntes = estado.madera;

    expect(ordenarReparar(mundo, obreros, granja)).toBe(2);
    for (let t = 0; t < 600 && mundo.vida[g] < mundo.vidaMaxima[g]; t++) sim.paso(PASO);

    expect(mundo.vida[g]).toBe(mundo.vidaMaxima[g]);
    expect(estado.oro).toBeLessThan(oroAntes);
    expect(estado.madera).toBeLessThan(maderaAntes);
    // Al quedar entera, los obreros sueltan la orden.
    sim.paso(PASO);
    expect(mundo.orden[indiceDe(obreros[0]!)]).toBe(Orden.NINGUNA);
  });
});
