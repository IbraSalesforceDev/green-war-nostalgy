import { describe, expect, it } from 'vitest';
import {
  ALCANCE_CUERPO_MINIMO,
  ANCHO_CAMPO,
  Batalla,
  EstadoUnidad,
  FICHA,
  FONDO_CAMPO,
  PASO_BATALLA,
  Postura,
} from './batalla';
import { Arma, BandoCampana, type Composicion } from '../campana/tipos';

/** Monta una batalla con las composiciones dadas y la deja lista para correr. */
function montar(
  atacante: Composicion,
  defensor: Composicion,
  extra: { enFuerte?: boolean; semilla?: number } = {},
): Batalla {
  return new Batalla({
    atacante: BandoCampana.UNION,
    composicionAtacante: atacante,
    composicionDefensor: defensor,
    bandoJugador: BandoCampana.UNION,
    semilla: extra.semilla ?? 42,
    enFuerte: extra.enFuerte ?? false,
  });
}

/** Corre la batalla hasta que termine o se agote el presupuesto de ticks. */
function resolver(batalla: Batalla, segundosMax = 200): void {
  const ticks = Math.round(segundosMax / PASO_BATALLA);
  for (let i = 0; i < ticks && !batalla.terminada; i++) batalla.paso(PASO_BATALLA);
}

describe('el despliegue', () => {
  it('pone una figura por efectivo y a los dos bandos en el campo', () => {
    const batalla = montar([4, 2, 1], [3, 1, 2]);
    expect(batalla.vivasDe(BandoCampana.UNION).length).toBe(7);
    expect(batalla.vivasDe(BandoCampana.CONFEDERACION).length).toBe(6);
  });

  it('separa a los dos ejércitos: el atacante al oeste, el defensor al este', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0]);
    const oeste = batalla.vivasDe(BandoCampana.UNION);
    const este = batalla.vivasDe(BandoCampana.CONFEDERACION);
    expect(Math.max(...oeste.map((u) => u.x))).toBeLessThan(0);
    expect(Math.min(...este.map((u) => u.x))).toBeGreaterThan(0);
  });

  it('deja a nadie fuera del campo', () => {
    const batalla = montar([8, 4, 3], [8, 4, 3]);
    for (const u of batalla.unidades) {
      expect(Math.abs(u.x)).toBeLessThanOrEqual(ANCHO_CAMPO / 2);
      expect(Math.abs(u.z)).toBeLessThanOrEqual(FONDO_CAMPO / 2);
    }
  });

  it('retrasa la artillería y abre la caballería a los flancos', () => {
    const batalla = montar([4, 4, 4], [0, 0, 1]);
    const mias = batalla.vivasDe(BandoCampana.UNION);
    const infanteria = mias.filter((u) => u.arma === Arma.INFANTERIA);
    const artilleria = mias.filter((u) => u.arma === Arma.ARTILLERIA);
    const caballeria = mias.filter((u) => u.arma === Arma.CABALLERIA);

    // La artillería del atacante (que viene del oeste) queda más al oeste aún.
    const mediaX = (us: typeof mias): number => us.reduce((s, u) => s + u.x, 0) / us.length;
    expect(mediaX(artilleria)).toBeLessThan(mediaX(infanteria));
    // La caballería se despliega hacia los flancos, no en el eje central. El
    // listón va en fracción del fondo y no en unidades sueltas: el campo se
    // estrechó al pasar a vista de perfil y un número fijo dejó de significar nada.
    const mediaAbsZ = caballeria.reduce((s, u) => s + Math.abs(u.z), 0) / caballeria.length;
    expect(mediaAbsZ).toBeGreaterThan(FONDO_CAMPO * 0.2);
  });
});

describe('las fichas de las armas', () => {
  it('ningún alcance queda por debajo de la separación entre unidades', () => {
    // La separación mantiene a dos unidades a la suma de sus radios. Un alcance
    // menor que eso es un arma que nunca llega a tocar a nadie, y el síntoma
    // —ese bando pierde siempre— parece de equilibrio y no lo es.
    const radioMayor = Math.max(...[0, 1, 2].map((a) => FICHA[a as 0 | 1 | 2].radio));
    expect(ALCANCE_CUERPO_MINIMO).toBeGreaterThanOrEqual(radioMayor * 2);
    for (const arma of [0, 1, 2] as const) {
      expect(FICHA[arma].alcance, `alcance del arma ${arma}`).toBeGreaterThan(
        ALCANCE_CUERPO_MINIMO,
      );
    }
  });
});

describe('el triángulo de las armas en el campo', () => {
  it('la caballería arrolla a la artillería', () => {
    // Misma cantidad de efectivos: solo decide el emparejamiento.
    const batalla = montar([0, 6, 0], [0, 0, 6]);
    resolver(batalla);
    expect(batalla.terminada).toBe(true);
    expect(batalla.vencedor).toBe(BandoCampana.UNION);
  });

  it('la infantería rechaza a la caballería', () => {
    const batalla = montar([0, 0, 0].map(() => 0) as Composicion, [0, 0, 0] as Composicion);
    // Se monta explícito para que se lea qué pelea contra qué.
    const real = montar([0, 6, 0], [6, 0, 0]);
    resolver(real);
    expect(real.terminada).toBe(true);
    expect(real.vencedor).toBe(BandoCampana.CONFEDERACION);
    void batalla;
  });

  it('la artillería destroza a la infantería que avanza a campo abierto', () => {
    const batalla = montar([0, 0, 5], [5, 0, 0]);
    resolver(batalla);
    expect(batalla.terminada).toBe(true);
    expect(batalla.vencedor).toBe(BandoCampana.UNION);
  });
});

describe('el desarrollo de la batalla', () => {
  it('termina siempre, y con un vencedor', () => {
    for (const semilla of [1, 2, 3, 7, 99]) {
      const batalla = montar([5, 2, 1], [4, 2, 2], { semilla });
      resolver(batalla);
      expect(batalla.terminada, `semilla ${semilla}`).toBe(true);
      expect(batalla.vencedor).not.toBe(BandoCampana.NINGUNO);
    }
  });

  it('deja al vencedor con tropas en pie y al vencido sin ninguna', () => {
    const batalla = montar([8, 3, 2], [1, 0, 0]);
    resolver(batalla);
    expect(batalla.vencedor).toBe(BandoCampana.UNION);
    expect(batalla.vivasDe(BandoCampana.CONFEDERACION).length).toBe(0);
    expect(batalla.vivasDe(BandoCampana.UNION).length).toBeGreaterThan(0);
  });

  it('nunca devuelve más supervivientes de los que entraron', () => {
    const atacante: Composicion = [6, 3, 2];
    const defensor: Composicion = [5, 2, 3];
    const batalla = montar(atacante, defensor);
    resolver(batalla);
    const d = batalla.desenlace();
    for (let arma = 0; arma < 3; arma++) {
      expect(d.supervivientesAtacante[arma]).toBeLessThanOrEqual(atacante[arma]!);
      expect(d.supervivientesDefensor[arma]).toBeLessThanOrEqual(defensor[arma]!);
    }
  });

  it('el bando derrotado se queda sin supervivientes en el parte', () => {
    const batalla = montar([9, 4, 3], [1, 0, 0]);
    resolver(batalla);
    const d = batalla.desenlace();
    expect(d.vencedor).toBe(BandoCampana.UNION);
    expect(d.supervivientesDefensor.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('las unidades no se apilan unas encima de otras', () => {
    const batalla = montar([10, 0, 0], [10, 0, 0]);
    // Un rato de avance, ya en contacto.
    for (let i = 0; i < 600 && !batalla.terminada; i++) batalla.paso(PASO_BATALLA);

    const vivas = batalla.unidades.filter((u) => u.estado === EstadoUnidad.AVANZANDO || u.estado === EstadoUnidad.COMBATIENDO);
    let solapes = 0;
    for (let i = 0; i < vivas.length; i++) {
      for (let j = i + 1; j < vivas.length; j++) {
        const d = Math.hypot(vivas[i]!.x - vivas[j]!.x, vivas[i]!.z - vivas[j]!.z);
        // Se tolera un pequeño solape: la separación es de un solo paso por tick.
        if (d < 0.7) solapes++;
      }
    }
    expect(solapes).toBe(0);
  });

  it('anuncia los disparos para que el render pueda dibujarlos', () => {
    const batalla = montar([4, 0, 2], [4, 0, 2]);
    let huboDisparos = false;
    for (let i = 0; i < 3000 && !batalla.terminada; i++) {
      batalla.paso(PASO_BATALLA);
      if (batalla.disparos.length > 0) huboDisparos = true;
    }
    expect(huboDisparos).toBe(true);
  });

  it('vacía los disparos en cada tick para que no se acumulen', () => {
    const batalla = montar([4, 0, 2], [4, 0, 2]);
    for (let i = 0; i < 400; i++) batalla.paso(PASO_BATALLA);
    // Nunca puede haber más disparos en un tick que unidades vivas.
    expect(batalla.disparos.length).toBeLessThanOrEqual(batalla.unidades.length);
  });
});

describe('la fortificación', () => {
  it('deja al defensor claramente mejor parado que a campo abierto', () => {
    // Exigir que el fuerte dé la vuelta a un resultado concreto haría la prueba
    // rehén del punto exacto de equilibrio: basta retocar un daño para que deje
    // de valer sin que nada esté roto. Lo que sí debe cumplirse siempre es que
    // atrincherarse ayude, y de forma consistente en varias partidas.
    const atacante: Composicion = [7, 2, 1];
    const defensor: Composicion = [5, 1, 1];

    // Se mide por lo que le cuesta al atacante, no por lo que le queda al
    // defensor: contra fuerzas superiores el defensor acaba cayendo con fuerte y
    // sin él, y mirar solo sus supervivientes no distingue una defensa cara de
    // un paseo militar.
    let defensasMasCaras = 0;
    for (const semilla of [3, 11, 20, 37, 64]) {
      const llano = montar(atacante, defensor, { semilla });
      resolver(llano);
      const fuerte = montar(atacante, defensor, { semilla, enFuerte: true });
      resolver(fuerte);

      const cuestaLlano = llano.vivasDe(BandoCampana.UNION).length;
      const cuestaFuerte = fuerte.vivasDe(BandoCampana.UNION).length;
      if (cuestaFuerte < cuestaLlano || fuerte.vencedor === BandoCampana.CONFEDERACION) {
        defensasMasCaras++;
      }
    }
    expect(defensasMasCaras).toBeGreaterThanOrEqual(4);
  });

  it('puede volver del revés una batalla lo bastante ajustada', () => {
    // Con fuerzas parejas, la fortificación tiene que ser capaz de decidir.
    const atacante: Composicion = [6, 1, 1];
    const defensor: Composicion = [5, 1, 1];

    let vueltas = 0;
    for (const semilla of [1, 5, 12, 29, 44, 70]) {
      const llano = montar(atacante, defensor, { semilla });
      resolver(llano);
      const fuerte = montar(atacante, defensor, { semilla, enFuerte: true });
      resolver(fuerte);
      if (
        llano.vencedor === BandoCampana.UNION &&
        fuerte.vencedor === BandoCampana.CONFEDERACION
      ) {
        vueltas++;
      }
    }
    expect(vueltas).toBeGreaterThan(0);
  });

  it('mantiene al defensor atrincherado en su mitad del campo', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0], { enFuerte: true });
    for (let i = 0; i < 900 && !batalla.terminada; i++) batalla.paso(PASO_BATALLA);
    // El defensor no sale a campo abierto a buscar pelea: espera.
    for (const u of batalla.vivasDe(BandoCampana.CONFEDERACION)) {
      expect(u.x).toBeGreaterThan(-5);
    }
  });
});

describe('las órdenes del jugador', () => {
  it('lleva a las unidades propias al punto señalado', () => {
    const batalla = montar([4, 0, 0], [4, 0, 0]);
    const mias = batalla.vivasDe(BandoCampana.UNION);
    const ids = mias.map((u) => u.id);
    batalla.ordenarIr(ids, -10, 18);

    for (let i = 0; i < 200 && !batalla.terminada; i++) batalla.paso(PASO_BATALLA);
    // Al menos alguna se ha desplazado claramente hacia el punto pedido.
    const acercadas = batalla.vivasDe(BandoCampana.UNION).filter((u) => u.z > 8);
    expect(acercadas.length).toBeGreaterThan(0);
  });

  it('no acepta órdenes sobre las tropas del enemigo', () => {
    const batalla = montar([3, 0, 0], [3, 0, 0]);
    const suyas = batalla.vivasDe(BandoCampana.CONFEDERACION);
    const antes = suyas.map((u) => ({ x: u.x, z: u.z }));
    batalla.ordenarIr(suyas.map((u) => u.id), -30, 0);
    for (const [i, u] of batalla.vivasDe(BandoCampana.CONFEDERACION).entries()) {
      expect(u.destinoX).toBeNull();
      expect(u.x).toBeCloseTo(antes[i]!.x, 5);
    }
  });
});

describe('el mando por posturas', () => {
  it('MANTENER clava a las tropas en el sitio', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0]);
    batalla.fijarPostura(Arma.INFANTERIA, Postura.MANTENER);
    const antes = batalla.vivasDe(BandoCampana.UNION).map((u) => u.x);

    for (let i = 0; i < 150; i++) batalla.paso(PASO_BATALLA);

    for (const [i, u] of batalla.vivasDe(BandoCampana.UNION).entries()) {
      // Solo la separación entre vecinas puede haberlas movido un pelo.
      expect(Math.abs(u.x - antes[i]!)).toBeLessThan(2);
    }
  });

  it('AVANZAR las lleva hacia el enemigo', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0]);
    batalla.fijarPostura(Arma.INFANTERIA, Postura.AVANZAR);
    const antes = media(batalla.vivasDe(BandoCampana.UNION).map((u) => u.x));
    for (let i = 0; i < 150; i++) batalla.paso(PASO_BATALLA);
    expect(media(batalla.vivasDe(BandoCampana.UNION).map((u) => u.x))).toBeGreaterThan(antes);
  });

  it('RETIRAR las devuelve a su borde', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0]);
    // Primero avanzan un poco, para que la retirada se note.
    for (let i = 0; i < 120; i++) batalla.paso(PASO_BATALLA);
    const enPunta = media(batalla.vivasDe(BandoCampana.UNION).map((u) => u.x));

    batalla.fijarPostura(Arma.INFANTERIA, Postura.RETIRAR);
    for (let i = 0; i < 150; i++) batalla.paso(PASO_BATALLA);

    expect(media(batalla.vivasDe(BandoCampana.UNION).map((u) => u.x))).toBeLessThan(enPunta);
  });

  it('cada arma obedece por separado', () => {
    const batalla = montar([4, 4, 0], [4, 0, 0]);
    batalla.fijarPostura(Arma.INFANTERIA, Postura.MANTENER);
    batalla.fijarPostura(Arma.CABALLERIA, Postura.AVANZAR);

    const inf = () => media(
      batalla.vivasDe(BandoCampana.UNION).filter((u) => u.arma === Arma.INFANTERIA).map((u) => u.x),
    );
    const cab = () => media(
      batalla.vivasDe(BandoCampana.UNION).filter((u) => u.arma === Arma.CABALLERIA).map((u) => u.x),
    );
    const infAntes = inf();
    const cabAntes = cab();

    for (let i = 0; i < 120; i++) batalla.paso(PASO_BATALLA);

    // La caballería se ha lanzado y la infantería sigue esperando.
    expect(cab() - cabAntes).toBeGreaterThan(8);
    expect(Math.abs(inf() - infAntes)).toBeLessThan(3);
  });

  it('la carga acelera a la caballería mientras dura', () => {
    const sinCarga = montar([0, 4, 0], [4, 0, 0], { semilla: 5 });
    for (let i = 0; i < 60; i++) sinCarga.paso(PASO_BATALLA);
    const recorridoNormal = media(sinCarga.vivasDe(BandoCampana.UNION).map((u) => u.x));

    const conCarga = montar([0, 4, 0], [4, 0, 0], { semilla: 5 });
    expect(conCarga.lanzarCarga()).toBe(true);
    for (let i = 0; i < 60; i++) conCarga.paso(PASO_BATALLA);
    const recorridoCarga = media(conCarga.vivasDe(BandoCampana.UNION).map((u) => u.x));

    expect(recorridoCarga).toBeGreaterThan(recorridoNormal);
  });

  it('no deja encadenar cargas ni cargar sin caballería', () => {
    const batalla = montar([0, 3, 0], [3, 0, 0]);
    expect(batalla.lanzarCarga()).toBe(true);
    expect(batalla.lanzarCarga(), 'no se puede cargar dos veces seguidas').toBe(false);

    const sinJinetes = montar([4, 0, 0], [4, 0, 0]);
    expect(sinJinetes.lanzarCarga(), 'no hay caballería que lanzar').toBe(false);
  });

  it('el defensor de un fuerte empieza aguantando la posición', () => {
    const batalla = montar([5, 0, 0], [5, 0, 0], { enFuerte: true });
    expect(batalla.posturaDe(BandoCampana.CONFEDERACION, Arma.INFANTERIA)).toBe(Postura.MANTENER);
    expect(batalla.posturaDe(BandoCampana.UNION, Arma.INFANTERIA)).toBe(Postura.AVANZAR);
  });

  it('no acepta mando sobre las armas del enemigo', () => {
    const batalla = montar([4, 0, 0], [4, 0, 0]);
    batalla.fijarPostura(Arma.INFANTERIA, Postura.RETIRAR);
    // `fijarPostura` es siempre del bando que juega la persona.
    expect(batalla.posturaDe(BandoCampana.UNION, Arma.INFANTERIA)).toBe(Postura.RETIRAR);
    expect(batalla.posturaDe(BandoCampana.CONFEDERACION, Arma.INFANTERIA)).toBe(Postura.AVANZAR);
  });
});

/** Media aritmética; devuelve 0 con lista vacía para no propagar NaN. */
function media(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

describe('el determinismo', () => {
  it('la misma semilla da exactamente la misma batalla', () => {
    const guionar = (semilla: number): string => {
      const batalla = montar([5, 2, 2], [5, 2, 2], { semilla });
      resolver(batalla);
      return batalla.unidades
        .map((u) => `${u.id}:${u.estado}:${u.x.toFixed(3)}:${u.z.toFixed(3)}`)
        .join('|');
    };
    expect(guionar(555)).toBe(guionar(555));
  });

  it('semillas distintas dan batallas distintas', () => {
    // Se compara el desarrollo y no solo el desenlace: dos batallas distintas
    // pueden acabar igual de igualadas —todos caídos en posiciones parecidas— y
    // mirar únicamente el estado final daría un falso positivo de determinismo.
    const guionar = (semilla: number): string => {
      const batalla = montar([5, 2, 2], [5, 2, 2], { semilla });
      const instantes: string[] = [];
      for (let i = 0; i < 900 && !batalla.terminada; i++) {
        batalla.paso(PASO_BATALLA);
        if (i % 60 === 0) {
          instantes.push(
            batalla.unidades.map((u) => `${u.estado}:${u.vida.toFixed(1)}`).join(','),
          );
        }
      }
      return instantes.join('|');
    };
    expect(guionar(1)).not.toBe(guionar(2));
  });
});
