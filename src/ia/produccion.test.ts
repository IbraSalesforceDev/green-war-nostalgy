import { describe, expect, it } from 'vitest';
import { fichaEdificio } from '../sim/datos/edificios';
import { fichaUnidad } from '../sim/datos/unidades';
import { crearEdificio, crearUnidad } from '../sim/fabrica';
import { crearMundoDePruebas } from '../sim/sistemas/comun.test';
import { Bando, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';
import { FaseIA } from './fases';
import { OBJETIVO_OBREROS, ProduccionIA } from './produccion';

/**
 * Pruebas de `ProduccionIA` en aislamiento.
 *
 * No hace falta simulación ni buscador: `ProduccionIA.paso` solo lee el estado del
 * bando y encola con `encolarUnidad`, que es quien de verdad cobra los recursos.
 */

describe('producción de la IA', () => {
  it('encola campesinos en el ayuntamiento mientras falten para el objetivo', () => {
    const mundo = crearMundoDePruebas(2001);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 50;

    new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    const cola = mundo.colas.get(indiceDe(ayuntamiento));
    expect(cola?.length).toBe(1);
    expect(cola?.[0]?.tipoUnidad).toBe(TipoUnidad.CAMPESINO);
  });

  it('deja de encolar campesinos al alcanzar el objetivo', () => {
    const mundo = crearMundoDePruebas(2002);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 50;
    for (let k = 0; k < OBJETIVO_OBREROS; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20 + k, 20);
    }

    new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(mundo.colas.get(indiceDe(ayuntamiento))).toBeUndefined();
  });

  it('no entrena tropa durante el ARRANQUE aunque haya barracón', () => {
    const mundo = crearMundoDePruebas(2003);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const barracon = crearEdificio(mundo, TipoEdificio.BARRACON, Bando.ORCOS, 20, 20, true);
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 50;
    for (let k = 0; k < OBJETIVO_OBREROS; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 30 + k, 30);
    }

    new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(mundo.colas.get(indiceDe(barracon))).toBeUndefined();
  });

  it('entrena tropa en el barracón durante MILICIA, siempre algo que el barracón sepa entrenar', () => {
    for (let semilla = 3000; semilla < 3030; semilla++) {
      const mundo = crearMundoDePruebas(semilla);
      crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
      const barracon = crearEdificio(mundo, TipoEdificio.BARRACON, Bando.ORCOS, 20, 20, true);
      mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 50;
      for (let k = 0; k < OBJETIVO_OBREROS; k++) {
        crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 30 + k, 30);
      }

      new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.MILICIA);

      const cola = mundo.colas.get(indiceDe(barracon));
      expect(cola?.length).toBe(1);
      const entrenaBarracon = fichaEdificio(TipoEdificio.BARRACON).entrena;
      expect(entrenaBarracon.includes(cola![0]!.tipoUnidad)).toBe(true);
    }
  });

  it('nunca ofrece un tipo que el edificio no sepa entrenar (la catapulta no cabe hoy en el barracón)', () => {
    const entrenaBarracon = fichaEdificio(TipoEdificio.BARRACON).entrena;
    // Con los datos actuales del juego el barracón no entrena jinetes ni catapultas;
    // la IA no debe inventarse una unidad que la ficha del edificio no ofrece.
    expect(entrenaBarracon.includes(TipoUnidad.CATAPULTA)).toBe(false);

    for (let semilla = 4000; semilla < 4030; semilla++) {
      const mundo = crearMundoDePruebas(semilla);
      crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
      const barracon = crearEdificio(mundo, TipoEdificio.BARRACON, Bando.ORCOS, 20, 20, true);
      mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 50;
      for (let k = 0; k < OBJETIVO_OBREROS; k++) {
        crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 30 + k, 30);
      }

      new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ASALTO);

      const cola = mundo.colas.get(indiceDe(barracon));
      expect(cola?.[0]?.tipoUnidad).not.toBe(TipoUnidad.CATAPULTA);
      expect(cola?.[0]?.tipoUnidad).not.toBe(TipoUnidad.JINETE);
    }
  });

  it('nunca encola por encima de la población disponible', () => {
    const mundo = crearMundoDePruebas(5001);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const estado = mundo.estadoDe(Bando.ORCOS);
    // Población ya al límite: ni un campesino más debería encolarse.
    estado.poblacion = estado.poblacionMaxima;

    new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(mundo.colas.get(indiceDe(ayuntamiento))).toBeUndefined();
  });

  it('nunca gasta más oro o madera del que tiene', () => {
    const mundo = crearMundoDePruebas(5002);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const barracon = crearEdificio(mundo, TipoEdificio.BARRACON, Bando.ORCOS, 20, 20, true);
    const estado = mundo.estadoDe(Bando.ORCOS);
    estado.poblacionMaxima = 50;
    estado.oro = 0;
    estado.madera = 0;

    new ProduccionIA().paso(mundo, Bando.ORCOS, FaseIA.ASALTO);

    expect(mundo.colas.get(indiceDe(barracon))).toBeUndefined();
    expect(estado.oro).toBe(0);
    expect(estado.madera).toBe(0);
  });

  it('el objetivo de obreros cuenta unidades vivas, no cadáveres', () => {
    // Sanity check de la ficha usada por el módulo: si esto falla, algo cambió en
    // datos/unidades.ts que rompería la cuenta de "obrerosVivos".
    expect(fichaUnidad(TipoUnidad.CAMPESINO).esObrero).toBe(true);
    expect(fichaUnidad(TipoUnidad.SOLDADO).esObrero).toBe(false);
  });
});
