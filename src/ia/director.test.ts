import { describe, expect, it } from 'vitest';
import { bus } from '../core/events';
import { PASO_SIMULACION } from '../sim/constantes';
import { crearEdificio, crearUnidad, crearYacimiento } from '../sim/fabrica';
import { BuscadorRecto, crearMundoDePruebas } from '../sim/sistemas/comun.test';
import { Simulacion } from '../sim/sistemas/orquestador';
import { Bando, Clase, TipoEdificio, TipoUnidad, TipoYacimiento } from '../sim/tipos';
import { DirectorIA, FaseIA } from './director';

/**
 * Pruebas del director con una `Simulacion` real de por medio (necesarias porque las
 * fases avanzan con obras y colas que solo el orquestador hace progresar), pero con
 * un mapa llano y un `BuscadorRecto` en vez del A* de verdad: aquí no interesa poner
 * a prueba el pathfinding, solo que `DirectorIA` esté bien enganchado y que la
 * máquina de fases se mueva con el tiempo. La prueba de integración con el mapa y el
 * buscador reales vive en `pruebas/ia.test.ts`.
 */

function montarBaseOrca(semilla: number): { mundo: ReturnType<typeof crearMundoDePruebas>; simulacion: Simulacion } {
  const mundo = crearMundoDePruebas(semilla, 64);
  crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.ORCOS, 10, 10, true);
  crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
  crearYacimiento(mundo, TipoYacimiento.ARBOL, 12, 20);
  crearYacimiento(mundo, TipoYacimiento.ARBOL, 13, 20);
  for (let k = 0; k < 5; k++) {
    crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 14 + k * 0.6, 15);
  }
  const simulacion = new Simulacion(mundo, new BuscadorRecto());
  return { mundo, simulacion };
}

function avanzar(simulacion: Simulacion, director: DirectorIA, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    simulacion.paso(PASO_SIMULACION);
    director.paso(PASO_SIMULACION);
  }
}

describe('DirectorIA', () => {
  it('arranca en ARRANQUE y evoluciona de fase con el tiempo y la economía', () => {
    bus.limpiar();
    const { mundo, simulacion } = montarBaseOrca(8001);
    const director = new DirectorIA(mundo, Bando.ORCOS, bus);
    expect(director.fase).toBe(FaseIA.ARRANQUE);

    // 220 s de partida: de sobra para dejar el ARRANQUE atrás con esta economía.
    avanzar(simulacion, director, Math.round(220 / PASO_SIMULACION));

    expect(director.fase).not.toBe(FaseIA.ARRANQUE);
    director.destruir();
  });

  it('construye y entrena más de lo que había al empezar', () => {
    bus.limpiar();
    const { mundo, simulacion } = montarBaseOrca(8002);
    const director = new DirectorIA(mundo, Bando.ORCOS, bus);

    const edificiosAntes = contarActivos(mundo, Clase.EDIFICIO, Bando.ORCOS);
    const unidadesAntes = contarActivos(mundo, Clase.UNIDAD, Bando.ORCOS);

    avanzar(simulacion, director, Math.round(300 / PASO_SIMULACION));

    const edificiosDespues = contarActivos(mundo, Clase.EDIFICIO, Bando.ORCOS);
    const unidadesDespues = contarActivos(mundo, Clase.UNIDAD, Bando.ORCOS);

    expect(edificiosDespues).toBeGreaterThan(edificiosAntes);
    expect(unidadesDespues).toBeGreaterThan(unidadesAntes);
    director.destruir();
  });

  it('nunca dice haber gastado más recursos de los que el bando tiene', () => {
    bus.limpiar();
    const { mundo, simulacion } = montarBaseOrca(8003);
    const director = new DirectorIA(mundo, Bando.ORCOS, bus);

    for (let t = 0; t < Math.round(180 / PASO_SIMULACION); t++) {
      simulacion.paso(PASO_SIMULACION);
      director.paso(PASO_SIMULACION);
      const estado = mundo.estadoDe(Bando.ORCOS);
      expect(estado.oro).toBeGreaterThanOrEqual(0);
      expect(estado.madera).toBeGreaterThanOrEqual(0);
    }
    director.destruir();
  });

  it('es determinista: misma semilla, mismo resultado tras el mismo número de ticks', () => {
    bus.limpiar();
    const a = montarBaseOrca(8004);
    const directorA = new DirectorIA(a.mundo, Bando.ORCOS, bus);
    avanzar(a.simulacion, directorA, 1500);
    directorA.destruir();

    bus.limpiar();
    const b = montarBaseOrca(8004);
    const directorB = new DirectorIA(b.mundo, Bando.ORCOS, bus);
    avanzar(b.simulacion, directorB, 1500);
    directorB.destruir();

    expect(directorA.fase).toBe(directorB.fase);
    expect(a.mundo.estadoDe(Bando.ORCOS).oro).toBe(b.mundo.estadoDe(Bando.ORCOS).oro);
    expect(a.mundo.estadoDe(Bando.ORCOS).madera).toBe(b.mundo.estadoDe(Bando.ORCOS).madera);
    expect(a.mundo.indiceMaximo).toBe(b.mundo.indiceMaximo);
    for (let i = 1; i <= a.mundo.indiceMaximo; i++) {
      expect(a.mundo.x[i]).toBeCloseTo(b.mundo.x[i]!, 6);
      expect(a.mundo.z[i]).toBeCloseTo(b.mundo.z[i]!, 6);
    }
  });
});

function contarActivos(
  mundo: ReturnType<typeof crearMundoDePruebas>,
  clase: Clase,
  bando: Bando,
): number {
  let n = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== clase) continue;
    if (mundo.bando[i] !== bando) continue;
    n++;
  }
  return n;
}
