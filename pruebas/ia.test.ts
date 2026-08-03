import { describe, expect, it } from 'vitest';
import { bus } from '../src/core/events';
import { DirectorIA, FaseIA } from '../src/ia/director';
import { PASO_SIMULACION } from '../src/sim/constantes';
import { enchufarEvitacion } from '../src/sim/enlaceEvitacion';
import { poblarMapaInicial } from '../src/sim/fabrica';
import { generarMapa } from '../src/sim/generador';
import { Mundo } from '../src/sim/mundo';
import { crearBuscadorRutas } from '../src/sim/rutas/buscador';
import { Simulacion } from '../src/sim/sistemas/orquestador';
import { Bando, Clase, indiceDe } from '../src/sim/tipos';

/**
 * Prueba de integración de la IA: mapa generado de verdad, `Mundo`, `poblarMapaInicial`
 * y `Simulacion` con buscador de rutas real —el mismo montaje que
 * `pruebas/integracion.test.ts`— más un `DirectorIA` gobernando a los ORCOS y el bando
 * HUMANOS totalmente pasivo (nadie le da órdenes, tal y como estaría un jugador que se
 * ha ido a por café). Lo que se comprueba es justo lo que promete el encargo: que la
 * IA hace progresar su partida sola, sin trampas y sin gastar de más.
 */

function montarPartida(semilla: number) {
  const generado = generarMapa({ ancho: 96, alto: 96, semilla });
  const mundo = new Mundo(generado.mapa, semilla);
  poblarMapaInicial(mundo, generado);
  mundo.estadoDe(Bando.ORCOS).esIA = true;

  const buscador = crearBuscadorRutas(generado.mapa);
  enchufarEvitacion();

  const simulacion = new Simulacion(mundo, buscador);
  const director = new DirectorIA(mundo, Bando.ORCOS, bus);
  return { generado, mundo, simulacion, director };
}

function avanzar(simulacion: Simulacion, director: DirectorIA, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    simulacion.paso(PASO_SIMULACION);
    director.paso(PASO_SIMULACION);
  }
}

function contarActivos(mundo: Mundo, clase: Clase, bando: Bando): number {
  let n = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== clase) continue;
    if (mundo.bando[i] !== bando) continue;
    n++;
  }
  return n;
}

describe('la IA de los ORCOS en una partida real', () => {
  it('hace crecer su economía: más edificios y más unidades que al empezar', () => {
    bus.limpiar();
    const { mundo, simulacion, director } = montarPartida(910001);

    const edificiosAntes = contarActivos(mundo, Clase.EDIFICIO, Bando.ORCOS);
    const unidadesAntes = contarActivos(mundo, Clase.UNIDAD, Bando.ORCOS);

    // 6 minutos de partida simulada: de sobra para que la economía se note.
    avanzar(simulacion, director, Math.round(360 / PASO_SIMULACION));

    const edificiosDespues = contarActivos(mundo, Clase.EDIFICIO, Bando.ORCOS);
    const unidadesDespues = contarActivos(mundo, Clase.UNIDAD, Bando.ORCOS);

    expect(edificiosDespues).toBeGreaterThan(edificiosAntes);
    expect(unidadesDespues).toBeGreaterThan(unidadesAntes);
    expect(director.fase).not.toBe(FaseIA.ARRANQUE);

    director.destruir();
  }, 30000);

  it('nunca gasta más oro ni madera del que tiene, en ningún tick', () => {
    bus.limpiar();
    const { mundo, simulacion, director } = montarPartida(910002);

    const ticks = Math.round(240 / PASO_SIMULACION);
    for (let t = 0; t < ticks; t++) {
      simulacion.paso(PASO_SIMULACION);
      director.paso(PASO_SIMULACION);
      const estado = mundo.estadoDe(Bando.ORCOS);
      if (estado.oro < 0 || estado.madera < 0) {
        throw new Error(`Recursos negativos en el tick ${mundo.tick}: oro=${estado.oro} madera=${estado.madera}`);
      }
    }

    director.destruir();
  }, 30000);

  it('llega a lanzar al menos un ataque en una partida suficientemente larga', () => {
    bus.limpiar();
    const { mundo, simulacion, director } = montarPartida(910003);

    let ataquesDeLosOrcos = 0;
    const bajaEscucha = bus.al('ordenEmitida', (datos) => {
      if (datos.tipo !== 'atacar') return;
      const entidad = datos.entidades[0];
      if (entidad === undefined) return;
      const i = indiceDe(entidad);
      if (mundo.activos[i] === 1 && mundo.bando[i] === Bando.ORCOS) ataquesDeLosOrcos++;
    });

    // 30 minutos simulados. La cifra original de 12 resultó demasiado optimista una
    // vez arreglada la economía de verdad: cada unidad cuesta entre 500 y 900 de oro,
    // cuatro obreros de oro rinden del orden de 120-150 de oro por minuto, y reunir
    // los cinco soldados libres del umbral de ataque implica antes pagar el
    // barracón (700) y a menudo una segunda granja (500) para tener sitio de
    // población. Con esta semilla concreta la veta de oro más próxima a la base se
    // agota alrededor del minuto 5 y la reasignación a una veta de repuesto más
    // lejana le cuesta a la economía unos minutos de tropiezo. Trazado minuto a
    // minuto con `pruebas/_debug.test.ts` durante el propio arreglo, el umbral de
    // cinco unidades libres se alcanza hacia el minuto 26 con esta semilla; 30
    // minutos deja un margen real por encima de ese punto sin dejar de acotar la
    // prueba a un tiempo razonable (sigue tardando unos segundos reales en correr).
    avanzar(simulacion, director, Math.round(1800 / PASO_SIMULACION));

    bajaEscucha();
    expect(ataquesDeLosOrcos).toBeGreaterThan(0);

    director.destruir();
  }, 60000);

  it('nunca intenta construir dos edificios de la IA en la misma casilla', () => {
    bus.limpiar();
    const { mundo, simulacion, director } = montarPartida(910004);

    const huellas: Array<{ cx: number; cz: number; lado: number }> = [];
    const bajaEscucha = bus.al('construccionIniciada', (datos) => {
      if (datos.bando !== Bando.ORCOS) return;
      if (!mundo.esValida(datos.entidad)) return;
      const i = indiceDe(datos.entidad);
      huellas.push({ cx: mundo.casillaX[i]!, cz: mundo.casillaZ[i]!, lado: mundo.huella[i]! });
    });

    avanzar(simulacion, director, Math.round(300 / PASO_SIMULACION));
    bajaEscucha();

    expect(huellas.length).toBeGreaterThan(0);
    for (let a = 0; a < huellas.length; a++) {
      for (let b = a + 1; b < huellas.length; b++) {
        expect(seSuperponen(huellas[a]!, huellas[b]!)).toBe(false);
      }
    }

    director.destruir();
  }, 30000);

  it('es determinista: misma semilla, mismo resultado tras el mismo número de ticks', () => {
    bus.limpiar();
    const a = montarPartida(910005);
    avanzar(a.simulacion, a.director, 4000);
    a.director.destruir();

    bus.limpiar();
    const b = montarPartida(910005);
    avanzar(b.simulacion, b.director, 4000);
    b.director.destruir();

    expect(a.director.fase).toBe(b.director.fase);
    expect(a.mundo.estadoDe(Bando.ORCOS).oro).toBe(b.mundo.estadoDe(Bando.ORCOS).oro);
    expect(a.mundo.estadoDe(Bando.ORCOS).madera).toBe(b.mundo.estadoDe(Bando.ORCOS).madera);
    expect(a.mundo.estadoDe(Bando.ORCOS).unidadesEntrenadas).toBe(
      b.mundo.estadoDe(Bando.ORCOS).unidadesEntrenadas,
    );
    expect(a.mundo.indiceMaximo).toBe(b.mundo.indiceMaximo);
    for (let i = 1; i <= a.mundo.indiceMaximo; i++) {
      expect(a.mundo.x[i]).toBeCloseTo(b.mundo.x[i]!, 5);
      expect(a.mundo.z[i]).toBeCloseTo(b.mundo.z[i]!, 5);
      expect(a.mundo.vida[i]).toBeCloseTo(b.mundo.vida[i]!, 5);
      expect(a.mundo.orden[i]).toBe(b.mundo.orden[i]);
    }
  }, 30000);
});

function seSuperponen(
  x: { cx: number; cz: number; lado: number },
  y: { cx: number; cz: number; lado: number },
): boolean {
  if (x.cx + x.lado <= y.cx || y.cx + y.lado <= x.cx) return false;
  if (x.cz + x.lado <= y.cz || y.cz + y.lado <= x.cz) return false;
  return true;
}
