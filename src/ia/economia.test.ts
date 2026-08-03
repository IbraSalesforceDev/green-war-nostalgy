import { describe, expect, it } from 'vitest';
import { crearEdificio, crearUnidad, crearYacimiento } from '../sim/fabrica';
import { crearMundoDePruebas } from '../sim/sistemas/comun.test';
import { Bando, Clase, Orden, TipoEdificio, TipoUnidad, TipoYacimiento, indiceDe } from '../sim/tipos';
import { EconomiaIA } from './economia';
import { FaseIA } from './fases';

/**
 * Pruebas de `EconomiaIA` en aislamiento: mapas llanos de `crearMundoDePruebas`, sin
 * simulación ni buscador de rutas de por medio, porque `EconomiaIA.paso` no mueve
 * nada por sí sola, solo escribe órdenes.
 *
 * Como el mundo de pruebas no corre el sistema de niebla, la visión hay que dársela
 * a mano con `mapa.aplicarVision`; es justo lo que hace posible probar por separado
 * que la IA nunca recolecta de un yacimiento que su bando no ha visto nunca.
 */

function contarEdificios(mundo: ReturnType<typeof crearMundoDePruebas>, tipo: TipoEdificio): number {
  let n = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== Clase.EDIFICIO) continue;
    if (mundo.tipo[i] === tipo) n++;
  }
  return n;
}

describe('economía de la IA', () => {
  it('manda a un obrero libre a la veta visible más conveniente', () => {
    const mundo = crearMundoDePruebas(1001);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 10);
    mundo.mapa.aplicarVision(Bando.ORCOS, 20, 10, 2, true);
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13, 13);
    // Sin presión de población: aquí solo interesa la elección de yacimiento.
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 20;

    // La rejilla espacial la reconstruye cada tick el orquestador; aquí no hay
    // ninguno corriendo, así que hay que dejarla lista a mano antes de pensar.
    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    const i = indiceDe(obrero);
    expect(mundo.orden[i]).toBe(Orden.RECOLECTAR);
    expect(mundo.ordenObjetivo[i]).toBe(mina);
  });

  it('no manda a un obrero a un yacimiento que el bando nunca ha visto', () => {
    const mundo = crearMundoDePruebas(1002);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 10); // sin aplicarVision: nunca visto
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13, 13);
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 20;

    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(mundo.orden[indiceDe(obrero)]).toBe(Orden.NINGUNA);
  });

  it('levanta una granja en cuanto la población empieza a apretar', () => {
    const mundo = crearMundoDePruebas(1003);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    // El ayuntamiento aporta 5 de población; cinco campesinos la agotan del todo.
    for (let k = 0; k < 5; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13 + k * 0.5, 13);
    }

    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(contarEdificios(mundo, TipoEdificio.GRANJA)).toBe(1);

    let obrerosConstruyendo = 0;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] === 1 && mundo.clase[i] === Clase.UNIDAD && mundo.orden[i] === Orden.CONSTRUIR) {
        obrerosConstruyendo++;
      }
    }
    expect(obrerosConstruyendo).toBe(1);
  });

  it('no levanta una segunda granja mientras la primera sigue en obras', () => {
    const mundo = crearMundoDePruebas(1004);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    for (let k = 0; k < 5; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13 + k * 0.5, 13);
    }
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13, 16);
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 14, 16);

    const ia = new EconomiaIA();
    mundo.reconstruirEspacial();
    ia.paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);
    mundo.reconstruirEspacial();
    ia.paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(contarEdificios(mundo, TipoEdificio.GRANJA)).toBe(1);
  });

  it('no intenta construir nada si no puede pagarlo, y no toca los recursos', () => {
    const mundo = crearMundoDePruebas(1005);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    for (let k = 0; k < 5; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13 + k * 0.5, 13);
    }
    const estado = mundo.estadoDe(Bando.ORCOS);
    estado.oro = 0;
    estado.madera = 0;

    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(contarEdificios(mundo, TipoEdificio.GRANJA)).toBe(0);
    expect(estado.oro).toBe(0);
    expect(estado.madera).toBe(0);
  });

  it('no levanta un barracón durante el ARRANQUE aunque pueda pagarlo', () => {
    const mundo = crearMundoDePruebas(1006);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const obrero = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13, 13);
    // Sin presión de población: aquí solo interesa aislar la puerta de la fase.
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 20;

    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(contarEdificios(mundo, TipoEdificio.BARRACON)).toBe(0);
    // Sin granja que construir y sin yacimiento visible, el obrero se queda libre.
    expect(mundo.orden[indiceDe(obrero)]).toBe(Orden.NINGUNA);
  });

  it('sí levanta el barracón en CRECIMIENTO si hay para pagarlo', () => {
    const mundo = crearMundoDePruebas(1007);
    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 13, 13);
    mundo.estadoDe(Bando.ORCOS).poblacionMaxima = 20;

    mundo.reconstruirEspacial();
    new EconomiaIA().paso(mundo, Bando.ORCOS, FaseIA.CRECIMIENTO);

    expect(contarEdificios(mundo, TipoEdificio.BARRACON)).toBe(1);
  });
});
