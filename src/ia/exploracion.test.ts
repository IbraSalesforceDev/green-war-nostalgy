import { describe, expect, it } from 'vitest';
import { crearUnidad } from '../sim/fabrica';
import { crearMundoDePruebas } from '../sim/sistemas/comun.test';
import { Bando, Orden, TipoUnidad, Vision, indiceDe } from '../sim/tipos';
import { ExploracionIA, OBREROS_DE_RESERVA, buscarPuntoInexplorado } from './exploracion';

describe('exploración de la IA', () => {
  it('recluta obreros de sobra (no de los primeros) como exploradores', () => {
    const mundo = crearMundoDePruebas(6001);
    const obreros = [];
    // Uno más que la reserva: el primer "de sobra" debería salir a explorar.
    for (let k = 0; k < OBREROS_DE_RESERVA + 1; k++) {
      obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20 + k, 20));
    }

    new ExploracionIA().paso(mundo, Bando.ORCOS);

    let enMarcha = 0;
    for (const obrero of obreros) {
      if (mundo.orden[indiceDe(obrero)] === Orden.MOVER) enMarcha++;
    }
    expect(enMarcha).toBe(1);
    // Los cuatro primeros (la reserva) se quedan como estaban, libres para la economía.
    for (let k = 0; k < OBREROS_DE_RESERVA; k++) {
      expect(mundo.orden[indiceDe(obreros[k]!)]).toBe(Orden.NINGUNA);
    }
  });

  it('recluta hasta el objetivo de exploradores cuando hay obreros de sobra', () => {
    const mundo = crearMundoDePruebas(6002);
    for (let k = 0; k < OBREROS_DE_RESERVA + 2; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20 + k, 20);
    }

    new ExploracionIA().paso(mundo, Bando.ORCOS);

    let enMarcha = 0;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] === 1 && mundo.orden[i] === Orden.MOVER) enMarcha++;
    }
    expect(enMarcha).toBe(2);
  });

  it('recurre a una unidad militar libre si no hay obreros de sobra', () => {
    const mundo = crearMundoDePruebas(6003);
    // Solo la reserva de obreros: ninguno debería salir a explorar.
    for (let k = 0; k < OBREROS_DE_RESERVA; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20 + k, 20);
    }
    const soldado = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 25, 25);

    new ExploracionIA().paso(mundo, Bando.ORCOS);

    expect(mundo.orden[indiceDe(soldado)]).toBe(Orden.MOVER);
  });

  it('vuelve a dar destino al explorador en cuanto llega', () => {
    const mundo = crearMundoDePruebas(6004);
    const obreros = [];
    for (let k = 0; k < OBREROS_DE_RESERVA + 1; k++) {
      obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20 + k, 20));
    }

    const ia = new ExploracionIA();
    ia.paso(mundo, Bando.ORCOS);

    const explorador = obreros.find((e) => mundo.orden[indiceDe(e)] === Orden.MOVER)!;
    const i = indiceDe(explorador);
    const primerDestinoX = mundo.ordenX[i];
    const primerDestinoZ = mundo.ordenZ[i];

    // Simula que el sistema de movimiento le dio la orden por cumplida al llegar.
    mundo.orden[i] = Orden.NINGUNA;
    // Y que de verdad llegó: la casilla de destino queda explorada.
    mundo.mapa.aplicarVision(Bando.ORCOS, mundo.mapa.aCasilla(primerDestinoX), mundo.mapa.aCasilla(primerDestinoZ), 6, true);
    mundo.x[i] = primerDestinoX;
    mundo.z[i] = primerDestinoZ;

    ia.paso(mundo, Bando.ORCOS);

    expect(mundo.orden[i]).toBe(Orden.MOVER);
    // El nuevo destino ya no es el mismo punto que el que se acaba de explorar.
    expect(mundo.ordenX[i] !== primerDestinoX || mundo.ordenZ[i] !== primerDestinoZ).toBe(true);
  });

  it('libera al explorador y no manda a nadie si el mapa ya está del todo explorado', () => {
    const mundo = crearMundoDePruebas(6005, 16);
    mundo.mapa.vision[Bando.ORCOS]!.fill(Vision.VISIBLE);
    const obreros = [];
    for (let k = 0; k < OBREROS_DE_RESERVA + 1; k++) {
      obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 5 + k * 0.2, 5));
    }

    new ExploracionIA().paso(mundo, Bando.ORCOS);

    for (const obrero of obreros) {
      expect(mundo.orden[indiceDe(obrero)]).toBe(Orden.NINGUNA);
    }
  });

  it('buscarPuntoInexplorado ignora las casillas ya vistas', () => {
    const mundo = crearMundoDePruebas(6006, 32);
    mundo.mapa.vision[Bando.ORCOS]!.fill(Vision.VISIBLE);
    // Deja un único agujero sin explorar en una esquina conocida.
    const cx = 4;
    const cz = 28;
    mundo.mapa.vision[Bando.ORCOS]![mundo.mapa.indice(cx, cz)] = Vision.OCULTO;

    const destino = buscarPuntoInexplorado(mundo, Bando.ORCOS, 0, 0);
    expect(destino).not.toBeNull();
    expect(mundo.mapa.aCasilla(destino!.x)).toBe(cx);
    expect(mundo.mapa.aCasilla(destino!.z)).toBe(cz);
  });
});
