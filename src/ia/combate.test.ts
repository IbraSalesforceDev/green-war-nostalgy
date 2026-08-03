import { beforeEach, describe, expect, it } from 'vitest';
import { BusEventos } from '../core/events';
import { crearEdificio, crearUnidad } from '../sim/fabrica';
import { crearMundoDePruebas } from '../sim/sistemas/comun.test';
import { Bando, Orden, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';
import { CombateIA } from './combate';
import { FaseIA } from './fases';

/**
 * Pruebas de `CombateIA` en aislamiento, con un bus propio en cada prueba para que
 * la suscripción al evento `danio` de una prueba no contamine la siguiente.
 */

describe('combate de la IA', () => {
  let bus: BusEventos;

  beforeEach(() => {
    bus = new BusEventos();
  });

  it('cuenta la milicia libre e ignora obreros y unidades ya atacando', () => {
    const mundo = crearMundoDePruebas(7001);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 20, 20);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 21, 20);
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 22, 20);
    const yaAtacando = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 23, 20);
    mundo.orden[indiceDe(yaAtacando)] = Orden.ATACAR_MOVER;

    const ia = new CombateIA(Bando.ORCOS, bus);
    ia.paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(ia.tamanoMiliciaLibre).toBe(2);
    ia.destruir();
  });

  it('no ataca por debajo del umbral de la fase aunque el enemigo sea visible', () => {
    const mundo = crearMundoDePruebas(7002);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 20, 20);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 21, 20);
    const enemigo = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 40, 40);
    mundo.mapa.aplicarVision(Bando.ORCOS, mundo.mapa.aCasilla(40), mundo.mapa.aCasilla(40), 3, true);

    const ia = new CombateIA(Bando.ORCOS, bus);
    ia.paso(mundo, Bando.ORCOS, FaseIA.MILICIA); // umbral de MILICIA es 8, aquí solo hay 2

    expect(mundo.orden[indiceDe(enemigo)]).toBe(Orden.NINGUNA);
    let atacando = 0;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] === 1 && mundo.orden[i] === Orden.ATACAR_MOVER) atacando++;
    }
    expect(atacando).toBe(0);
    ia.destruir();
  });

  it('ataca al enemigo visible cuando la milicia libre alcanza el umbral', () => {
    const mundo = crearMundoDePruebas(7003);
    const libres = [];
    for (let k = 0; k < 8; k++) {
      libres.push(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 20 + k, 20));
    }
    const cxEnemigo = 40;
    const czEnemigo = 40;
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, cxEnemigo, czEnemigo);
    mundo.mapa.aplicarVision(
      Bando.ORCOS,
      mundo.mapa.aCasilla(cxEnemigo),
      mundo.mapa.aCasilla(czEnemigo),
      3,
      true,
    );

    const ia = new CombateIA(Bando.ORCOS, bus);
    ia.paso(mundo, Bando.ORCOS, FaseIA.MILICIA);

    for (const libre of libres) {
      const i = indiceDe(libre);
      expect(mundo.orden[i]).toBe(Orden.ATACAR_MOVER);
      expect(Math.hypot(mundo.ordenX[i] - cxEnemigo, mundo.ordenZ[i] - czEnemigo)).toBeLessThan(2);
    }
    ia.destruir();
  });

  it('no ataca a un enemigo que el bando nunca ha visto ni recuerda', () => {
    // Mapa por defecto, sin tocar la niebla: todo empieza OCULTO, como en una
    // partida real antes de que nadie explore nada.
    const mundo = crearMundoDePruebas(7004);
    const libres = [];
    for (let k = 0; k < 8; k++) {
      libres.push(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 10 + k * 0.5, 10));
    }
    // El enemigo está lejos, en la esquina opuesta; su casilla sigue oculta para el
    // bando IA. Si la IA "hiciera trampa" leyendo mundo.x directamente, el ataque
    // apuntaría aquí; si juega limpio, el punto de mundo desconocido más cercano a
    // su propia zona está en otra parte bien distinta.
    const enemigo = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 44, 44);

    const ia = new CombateIA(Bando.ORCOS, bus);
    ia.paso(mundo, Bando.ORCOS, FaseIA.MILICIA);

    const ex = mundo.x[indiceDe(enemigo)]!;
    const ez = mundo.z[indiceDe(enemigo)]!;
    for (const libre of libres) {
      const i = indiceDe(libre);
      if (mundo.orden[i] !== Orden.ATACAR_MOVER) continue;
      const distancia = Math.hypot(mundo.ordenX[i] - ex, mundo.ordenZ[i] - ez);
      expect(distancia).toBeGreaterThan(5);
    }
    ia.destruir();
  });

  it('defiende la base: redirige la milicia libre cercana al punto de un golpe reciente', () => {
    const mundo = crearMundoDePruebas(7005);
    const propio = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
    const libreCerca = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 14, 14);
    const libreLejos = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 90, 90);

    const ia = new CombateIA(Bando.ORCOS, bus);
    // Primer pensamiento: sin milicia bastante y sin objetivo, no hace nada, pero deja
    // el mundo enganchado para que el oyente de daño sepa a qué mundo pertenece.
    ia.paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    bus.emitir('danio', {
      objetivo: propio,
      atacante: 0,
      cantidad: 10,
      x: mundo.x[indiceDe(propio)],
      z: mundo.z[indiceDe(propio)],
      esCritico: false,
    });

    ia.paso(mundo, Bando.ORCOS, FaseIA.ARRANQUE);

    expect(mundo.orden[indiceDe(libreCerca)]).toBe(Orden.ATACAR_MOVER);
    // El lejano no tiene forma de llegar a tiempo: se queda como estaba.
    expect(mundo.orden[indiceDe(libreLejos)]).toBe(Orden.NINGUNA);
    ia.destruir();
  });
});
