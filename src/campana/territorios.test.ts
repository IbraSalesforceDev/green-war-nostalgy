import { describe, expect, it } from 'vitest';
import { TERRITORIOS, TERRITORIO_POR_ID, capitalDe, sonVecinos, territorio } from './territorios';
import { BANDOS_EN_GUERRA, BandoCampana, type IdTerritorio } from './tipos';

/**
 * El mapa está escrito a mano, territorio a territorio. Esa clase de dato es
 * justo donde se cuelan las erratas que no dan error de compilación pero rompen
 * la partida: una frontera declarada en un sentido y no en el otro, un territorio
 * al que no se llega desde ninguna parte, un bando con dos capitales.
 *
 * Estas pruebas no comprueban que el mapa sea «bonito» —eso se mira—, sino que
 * cumple las invariantes de las que dependen la IA y las reglas de movimiento.
 */

describe('el mapa de la campaña', () => {
  it('no repite identificadores', () => {
    const vistos = new Set<IdTerritorio>();
    for (const t of TERRITORIOS) {
      expect(vistos.has(t.id), `id duplicado: ${t.id}`).toBe(false);
      vistos.add(t.id);
    }
    expect(TERRITORIO_POR_ID.size).toBe(TERRITORIOS.length);
  });

  it('solo declara fronteras con territorios que existen', () => {
    for (const t of TERRITORIOS) {
      for (const vecino of t.vecinos) {
        expect(TERRITORIO_POR_ID.has(vecino), `${t.id} limita con ${vecino}, que no existe`).toBe(
          true,
        );
      }
    }
  });

  it('nunca se declara vecino de sí mismo', () => {
    for (const t of TERRITORIOS) {
      expect(t.vecinos.includes(t.id), `${t.id} limita consigo mismo`).toBe(false);
    }
  });

  it('tiene todas las fronteras declaradas en los dos sentidos', () => {
    // Si A limita con B pero B no limita con A, un ejército puede entrar en un
    // territorio y quedarse encerrado sin poder volver por donde vino.
    for (const t of TERRITORIOS) {
      for (const vecino of t.vecinos) {
        expect(
          sonVecinos(vecino, t.id),
          `${t.id} limita con ${vecino}, pero ${vecino} no limita con ${t.id}`,
        ).toBe(true);
      }
    }
  });

  it('no repite un mismo vecino dos veces', () => {
    for (const t of TERRITORIOS) {
      expect(new Set(t.vecinos).size, `${t.id} repite alguna frontera`).toBe(t.vecinos.length);
    }
  });

  it('forma un mapa conexo: se llega a todas partes por tierra', () => {
    // Un territorio inalcanzable sería imposible de conquistar y la partida no
    // podría terminar nunca por conquista total.
    const alcanzados = new Set<IdTerritorio>([TERRITORIOS[0]!.id]);
    const pendientes: IdTerritorio[] = [TERRITORIOS[0]!.id];
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      for (const vecino of territorio(actual).vecinos) {
        if (alcanzados.has(vecino)) continue;
        alcanzados.add(vecino);
        pendientes.push(vecino);
      }
    }
    const inalcanzables = TERRITORIOS.filter((t) => !alcanzados.has(t.id)).map((t) => t.id);
    expect(inalcanzables, 'territorios aislados del resto del mapa').toEqual([]);
  });

  it('da a cada bando una capital y solo una', () => {
    for (const bando of BANDOS_EN_GUERRA) {
      const capitales = TERRITORIOS.filter((t) => t.capitalDe === bando);
      expect(capitales.length, `capitales del bando ${bando}`).toBe(1);
      // La capital tiene que empezar en manos de su propio bando: si no, la
      // partida arrancaría ya perdida.
      expect(capitales[0]!.duenoInicial).toBe(bando);
      expect(capitalDe(bando).id).toBe(capitales[0]!.id);
    }
  });

  it('reparte el mapa a partes iguales y sin tierra de nadie', () => {
    const porBando = new Map<BandoCampana, number>();
    for (const t of TERRITORIOS) {
      porBando.set(t.duenoInicial, (porBando.get(t.duenoInicial) ?? 0) + 1);
    }
    expect(porBando.get(BandoCampana.NINGUNO) ?? 0).toBe(0);
    expect(porBando.get(BandoCampana.UNION)).toBe(porBando.get(BandoCampana.CONFEDERACION));
  });

  it('arranca con las rentas equilibradas', () => {
    // Una diferencia de renta inicial es una ventaja que se compone turno a turno.
    // Puede haberla algún día, pero tiene que ser una decisión, no un descuido.
    const renta = (bando: BandoCampana): number =>
      TERRITORIOS.filter((t) => t.duenoInicial === bando).reduce((suma, t) => suma + t.renta, 0);
    expect(renta(BandoCampana.UNION)).toBe(renta(BandoCampana.CONFEDERACION));
  });

  it('deja pasos entre el Norte y el Sur, pero pocos', () => {
    // El frente es el corazón de la partida: sin pasos no habría guerra, y con
    // demasiados no habría nada que defender.
    const pasos: string[] = [];
    for (const t of TERRITORIOS) {
      for (const vecino of t.vecinos) {
        if (t.id > vecino) continue; // cada frontera se cuenta una sola vez
        if (territorio(vecino).duenoInicial !== t.duenoInicial) pasos.push(`${t.id}-${vecino}`);
      }
    }
    expect(pasos.length).toBeGreaterThanOrEqual(4);
    expect(pasos.length).toBeLessThanOrEqual(9);
  });

  it('da a cada bando por dónde recibir refuerzos', () => {
    for (const bando of BANDOS_EN_GUERRA) {
      const puertos = TERRITORIOS.filter((t) => t.duenoInicial === bando && t.puerto);
      expect(puertos.length, `puertos del bando ${bando}`).toBeGreaterThan(0);
    }
  });

  it('dibuja cada territorio con un polígono cerrable', () => {
    for (const t of TERRITORIOS) {
      expect(t.contorno.length, `contorno de ${t.id}`).toBeGreaterThanOrEqual(3);
      for (const [x, y] of t.contorno) {
        expect(Number.isFinite(x) && Number.isFinite(y), `vértice inválido en ${t.id}`).toBe(true);
      }
    }
  });

  it('recorre todos los contornos en el mismo sentido', () => {
    // La prueba de las costuras empareja cada frontera con su gemela recorrida al
    // revés; eso solo funciona si todos los polígonos giran igual. Un contorno
    // escrito al revés no rompe el dibujo —el triangulador lo aguanta— pero sí
    // rompe la comprobación, y entonces el hueco pasaría desapercibido.
    for (const t of TERRITORIOS) {
      expect(areaConSigno(t.contorno), `${t.id} está escrito en sentido horario`).toBeGreaterThan(0);
    }
  });

  it('no deja huecos entre territorios', () => {
    // Aquí vivía una errata cara: Arkansas terminaba en y = 34 y Luisiana empezaba
    // en y = 33, y el Sur aparecía cruzado por una franja de papel en blanco. Con
    // dieciocho polígonos escritos a mano el fallo es cuestión de tiempo, así que
    // se comprueba en vez de vigilarse.
    //
    // El criterio es el de una malla bien cosida: toda frontera interior tiene que
    // aparecer dos veces, una por cada lado y recorrida en sentidos opuestos. Las
    // que aparecen una sola vez son litoral, y esas sí deben quedar sueltas.
    const dirigidas = new Map<string, string>();
    for (const t of TERRITORIOS) {
      for (const [a, b] of aristas(t.contorno)) {
        const clave = `${a}->${b}`;
        expect(dirigidas.has(clave), `la frontera ${clave} la dibujan ${dirigidas.get(clave)} y ${t.id} en el mismo sentido`).toBe(false);
        dirigidas.set(clave, t.id);
      }
    }

    // Un vértice que cae en mitad de la arista del vecino —sin ser vértice suyo—
    // deja una rendija fina que este emparejamiento no vería, así que se busca aparte.
    const vertices = new Set<string>();
    for (const t of TERRITORIOS) for (const [a] of aristas(t.contorno)) vertices.add(a);

    const litoral: string[] = [];
    for (const [clave, dueno] of dirigidas) {
      const [a, b] = clave.split('->') as [string, string];
      if (dirigidas.has(`${b}->${a}`)) continue;
      litoral.push(clave);
      for (const vertice of vertices) {
        expect(
          enMitadDe(vertice, a, b),
          `un vértice del mapa cae sobre la costa ${clave} de ${dueno} sin ser suyo`,
        ).toBe(false);
      }
    }

    // Y el litoral tiene que ser una única costa cerrada: si fueran dos, el país
    // estaría partido en dos islas, o habría un agujero en el interior.
    const siguiente = new Map<string, string>();
    for (const clave of litoral) {
      const [a, b] = clave.split('->') as [string, string];
      expect(siguiente.has(a), `la costa se bifurca en ${a}`).toBe(false);
      siguiente.set(a, b);
    }
    const arranque = litoral[0]!.split('->')[0]!;
    let actual = siguiente.get(arranque)!;
    let pasos = 1;
    while (actual !== arranque && pasos <= litoral.length) {
      actual = siguiente.get(actual)!;
      pasos++;
    }
    expect(actual, 'la costa no cierra').toBe(arranque);
    expect(pasos, 'el mapa tiene más de una costa: hay islas o agujeros').toBe(litoral.length);
  });

  it('planta la ficha de cada territorio dentro de su propio contorno', () => {
    // El centro es donde se dibuja el ejército y donde se pulsa para seleccionarlo.
    // Si cae fuera del polígono, la ficha aparece flotando sobre el vecino.
    for (const t of TERRITORIOS) {
      expect(puntoEnPoligono(t.x, t.y, t.contorno), `el centro de ${t.id} cae fuera`).toBe(true);
    }
  });

  it('mantiene el Norte al norte y el Sur al sur', () => {
    // La IA usa la coordenada `y` para saber hacia dónde está el enemigo. Si los
    // territorios de un bando estuvieran entreverados, avanzaría en círculos.
    const norte = TERRITORIOS.filter((t) => t.duenoInicial === BandoCampana.UNION);
    const sur = TERRITORIOS.filter((t) => t.duenoInicial === BandoCampana.CONFEDERACION);
    const masAlSurDelNorte = Math.min(...norte.map((t) => t.y));
    const masAlNorteDelSur = Math.max(...sur.map((t) => t.y));
    expect(masAlSurDelNorte).toBeGreaterThan(masAlNorteDelSur);
  });
});

/** Las aristas de un contorno, como pares de vértices en texto para poder compararlos. */
function aristas(contorno: readonly (readonly [number, number])[]): Array<[string, string]> {
  return contorno.map((punto, indice) => {
    const siguiente = contorno[(indice + 1) % contorno.length]!;
    return [`${punto[0]},${punto[1]}`, `${siguiente[0]},${siguiente[1]}`];
  });
}

/** Fórmula del cordón de zapato. Positiva si el polígono gira en antihorario. */
function areaConSigno(contorno: readonly (readonly [number, number])[]): number {
  let suma = 0;
  for (let i = 0; i < contorno.length; i++) {
    const [x1, y1] = contorno[i]!;
    const [x2, y2] = contorno[(i + 1) % contorno.length]!;
    suma += x1 * y2 - x2 * y1;
  }
  return suma / 2;
}

/** ¿Cae `punto` sobre el segmento `a`–`b` sin ser ninguno de sus extremos? */
function enMitadDe(punto: string, a: string, b: string): boolean {
  if (punto === a || punto === b) return false;
  const [px, py] = punto.split(',').map(Number) as [number, number];
  const [ax, ay] = a.split(',').map(Number) as [number, number];
  const [bx, by] = b.split(',').map(Number) as [number, number];
  const cruz = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cruz) > 1e-9) return false;
  const producto = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  return producto > 0 && producto < (bx - ax) ** 2 + (by - ay) ** 2;
}

/** Cruce de rayos clásico: cuenta cortes con el polígono hacia la derecha. */
function puntoEnPoligono(
  x: number,
  y: number,
  poligono: readonly (readonly [number, number])[],
): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]!;
    const [xj, yj] = poligono[j]!;
    const cruza = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}
