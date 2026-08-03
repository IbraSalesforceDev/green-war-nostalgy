import { sesion } from '../estado/sesion';
import { fichaEdificio, nombreEdificio } from '../sim/datos/edificios';
import { fichaUnidad, nombreUnidad } from '../sim/datos/unidades';
import type { Mundo } from '../sim/mundo';
import { Bando, Clase, Entidad, ENTIDAD_NULA, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';
import type { ComandoInterfaz } from './hud';
import { elementoIcono, iconoDeEdificio, iconoDeUnidad } from './iconos';

/**
 * Panel de selección: la ficha central que responde a "¿qué tengo seleccionado?".
 *
 * Tres formas, según lo que haya en `sesion.seleccion`:
 *  - Una sola unidad o edificio: retrato grande, nombre, barra de vida y sus
 *    estadísticas (ataque, armadura, carga si es obrero).
 *  - Varias entidades: rejilla de retratos pequeños con su vida, pulsables para
 *    abrir un "vistazo" con la ficha completa de una de ellas sin tocar la
 *    selección real del jugador (eso es cosa de la entrada, no de la interfaz).
 *  - Un edificio productor propio: además de su ficha, la cola de producción con
 *    barra de progreso, cancelable elemento a elemento.
 */
export interface PanelSeleccion {
  readonly raiz: HTMLElement;
  actualizar(mundo: Mundo): void;
  /** Se dispara al cancelar un elemento de la cola de producción. */
  alPulsarComando(cb: (comando: ComandoInterfaz) => void): void;
  liberar(): void;
}

function claseVida(fraccion: number): string {
  if (fraccion > 0.55) return '';
  if (fraccion > 0.25) return 'gwn-barra--media';
  return 'gwn-barra--baja';
}

/** Fija la barra vía `transform: scaleX()`, nunca `width`: eso es lo que la hace barata a 60 Hz. */
function fijarBarra(relleno: HTMLElement, fraccion: number): void {
  relleno.style.transform = `scaleX(${Math.max(0, Math.min(1, fraccion)).toFixed(3)})`;
}

export function crearPanelSeleccion(): PanelSeleccion {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-panel gwn-seleccion gwn-oculto';

  let escucha: (comando: ComandoInterfaz) => void = () => {};

  // Estado local de "vistazo" en una selección múltiple: qué entidad se ha
  // pulsado en la rejilla para ver su ficha completa debajo. Es puramente visual,
  // no cambia `sesion.seleccion`.
  let entidadVistazo: Entidad = ENTIDAD_NULA;

  // Se reconstruye el contenido solo cuando cambia la "forma" de lo mostrado
  // (cuántas entidades, de qué tipo); los valores que cambian cada tick (vida,
  // progreso) se actualizan sobre los mismos nodos para no repintar de más.
  let firma = '';

  function ficha(): HTMLElement {
    const contenedor = document.createElement('div');
    contenedor.className = 'gwn-ficha';

    const retrato = document.createElement('div');
    retrato.className = 'gwn-ficha-retrato';
    retrato.dataset['campo'] = 'retrato';
    contenedor.appendChild(retrato);

    const info = document.createElement('div');
    info.className = 'gwn-ficha-info';

    const nombreEl = document.createElement('div');
    nombreEl.className = 'gwn-ficha-nombre';
    nombreEl.dataset['campo'] = 'nombre';
    info.appendChild(nombreEl);

    const barra = document.createElement('div');
    barra.className = 'gwn-barra gwn-barra--vida';
    const relleno = document.createElement('div');
    relleno.className = 'gwn-barra-relleno';
    barra.appendChild(relleno);
    barra.dataset['campo'] = 'vida';
    info.appendChild(barra);

    const stats = document.createElement('div');
    stats.className = 'gwn-stats';
    stats.dataset['campo'] = 'stats';
    info.appendChild(stats);

    contenedor.appendChild(info);
    return contenedor;
  }

  function actualizarFicha(mundo: Mundo, i: number, elemento: HTMLElement): void {
    const clase = mundo.clase[i];
    const bando = mundo.bando[i]!;
    const nombre =
      clase === Clase.EDIFICIO
        ? nombreEdificio(mundo.tipo[i] as TipoEdificio, bando)
        : nombreUnidad(mundo.tipo[i] as TipoUnidad, bando);

    const nombreIcono =
      clase === Clase.EDIFICIO ? iconoDeEdificio(mundo.tipo[i] as TipoEdificio) : iconoDeUnidad(mundo.tipo[i] as TipoUnidad);
    const retrato = elemento.querySelector<HTMLElement>('[data-campo="retrato"]')!;
    if (retrato.dataset['icono'] !== nombreIcono) {
      retrato.dataset['icono'] = nombreIcono;
      retrato.innerHTML = '';
      retrato.appendChild(elementoIcono(nombreIcono));
    }

    const nombreEl = elemento.querySelector<HTMLElement>('[data-campo="nombre"]')!;
    if (nombreEl.textContent !== nombre) nombreEl.textContent = nombre;

    const vidaMax = mundo.vidaMaxima[i]! || 1;
    const fraccion = Math.max(0, mundo.vida[i]!) / vidaMax;
    const barra = elemento.querySelector<HTMLElement>('[data-campo="vida"]')!;
    fijarBarra(barra.querySelector('.gwn-barra-relleno')!, fraccion);
    barra.classList.remove('gwn-barra--media', 'gwn-barra--baja');
    const claseExtra = claseVida(fraccion);
    if (claseExtra) barra.classList.add(claseExtra);

    const stats = elemento.querySelector<HTMLElement>('[data-campo="stats"]')!;
    const partes: string[] = [];
    partes.push(`vida:${Math.ceil(mundo.vida[i]!)}/${vidaMax}`);
    if (mundo.danioMax[i]! > 0) partes.push(`atq:${mundo.danioMin[i]}-${mundo.danioMax[i]}`);
    partes.push(`arm:${mundo.armadura[i]}`);
    if (clase !== Clase.EDIFICIO) {
      const esObrero = fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero;
      if (esObrero) partes.push(`carga:${Math.round(mundo.cargaCantidad[i]!)}/${fichaUnidad(mundo.tipo[i] as TipoUnidad).capacidadCarga}`);
    }
    const texto = partes.join('|');
    if (stats.dataset['ultimo'] !== texto) {
      stats.dataset['ultimo'] = texto;
      stats.innerHTML = '';

      const bloque = (icono: Parameters<typeof elementoIcono>[0], valor: string): void => {
        const span = document.createElement('span');
        span.appendChild(elementoIcono(icono));
        const num = document.createElement('b');
        num.textContent = valor;
        span.appendChild(num);
        stats.appendChild(span);
      };

      bloque('corazon', `${Math.ceil(mundo.vida[i]!)}/${vidaMax}`);
      if (mundo.danioMax[i]! > 0) bloque('espada', `${mundo.danioMin[i]}-${mundo.danioMax[i]}`);
      bloque('escudo', String(mundo.armadura[i]));
      if (clase !== Clase.EDIFICIO && fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero) {
        bloque('tronco', `${Math.round(mundo.cargaCantidad[i]!)}/${fichaUnidad(mundo.tipo[i] as TipoUnidad).capacidadCarga}`);
      }
    }
  }

  function construirCola(): HTMLElement {
    const cola = document.createElement('div');
    cola.className = 'gwn-cola';
    return cola;
  }

  function actualizarCola(mundo: Mundo, i: number, contenedor: HTMLElement): void {
    const elementos = mundo.colas.get(i) ?? [];

    if (elementos.length === 0) {
      if (contenedor.dataset['vacio'] !== '1') {
        contenedor.dataset['vacio'] = '1';
        contenedor.innerHTML = '';
        const vacio = document.createElement('div');
        vacio.className = 'gwn-cola-vacia';
        vacio.textContent = 'Sin producción en curso';
        contenedor.appendChild(vacio);
      }
      return;
    }
    contenedor.dataset['vacio'] = '0';

    // Reconstrucción completa: la cola rara vez cambia de tamaño (se añade o se
    // cancela un elemento, no cada tick), así que el coste de rehacer el DOM aquí
    // es insignificante comparado con la ganancia en simplicidad.
    const firmaCola = elementos.map((e) => e.tipoUnidad).join(',');
    if (contenedor.dataset['firma'] !== firmaCola) {
      contenedor.dataset['firma'] = firmaCola;
      contenedor.innerHTML = '';
      elementos.forEach((elemento, indice) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'gwn-cola-item';
        item.title = `Cancelar ${nombreUnidad(elemento.tipoUnidad, mundo.bando[i] as Bando)}`;
        item.appendChild(elementoIcono(iconoDeUnidad(elemento.tipoUnidad)));

        const progreso = document.createElement('div');
        progreso.className = 'gwn-cola-item-progreso';
        const relleno = document.createElement('span');
        progreso.appendChild(relleno);
        item.appendChild(progreso);

        const cancelar = document.createElement('div');
        cancelar.className = 'gwn-cola-item-cancelar';
        cancelar.appendChild(elementoIcono('cancelar'));
        item.appendChild(cancelar);

        item.addEventListener('click', () => escucha({ clase: 'cancelarCola', indice }));
        contenedor.appendChild(item);
      });
    }

    elementos.forEach((elemento, indice) => {
      const item = contenedor.children[indice] as HTMLElement | undefined;
      if (!item) return;
      const relleno = item.querySelector<HTMLElement>('.gwn-cola-item-progreso span')!;
      const fraccion = 1 - elemento.restante / Math.max(0.001, elemento.total);
      fijarBarra(relleno, fraccion);
    });
  }

  function construirMiniRetrato(): HTMLElement {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'gwn-retrato-mini';
    const icono = document.createElement('span');
    icono.className = 'gwn-retrato-mini-icono';
    boton.appendChild(icono);
    const vida = document.createElement('div');
    vida.className = 'gwn-retrato-mini-vida';
    vida.appendChild(document.createElement('span'));
    boton.appendChild(vida);
    return boton;
  }

  return {
    raiz,

    actualizar(mundo: Mundo): void {
      const seleccion = sesion.seleccion.filter((e) => mundo.esValida(e));

      if (seleccion.length === 0) {
        if (!raiz.classList.contains('gwn-oculto')) {
          raiz.classList.add('gwn-oculto');
          firma = '';
        }
        entidadVistazo = ENTIDAD_NULA;
        return;
      }
      raiz.classList.remove('gwn-oculto');

      if (seleccion.length === 1) {
        const i = indiceDe(seleccion[0]!);
        const esEdificioProductor =
          mundo.clase[i] === Clase.EDIFICIO && fichaEdificio(mundo.tipo[i] as TipoEdificio).entrena.length > 0;
        const formaNueva = esEdificioProductor ? 'edificio-productor' : 'uno';

        if (firma !== formaNueva) {
          firma = formaNueva;
          raiz.innerHTML = '';
          raiz.appendChild(ficha());
          if (esEdificioProductor) raiz.appendChild(construirCola());
        }

        actualizarFicha(mundo, i, raiz.querySelector('.gwn-ficha')!);
        if (esEdificioProductor) actualizarCola(mundo, i, raiz.querySelector('.gwn-cola')!);
        return;
      }

      // --- Selección múltiple ---
      const formaNueva = `varios:${seleccion.length}`;
      if (firma !== formaNueva) {
        firma = formaNueva;
        raiz.innerHTML = '';
        const rejilla = document.createElement('div');
        rejilla.className = 'gwn-rejilla-retratos';
        for (const entidad of seleccion) {
          const boton = construirMiniRetrato();
          boton.addEventListener('click', () => {
            entidadVistazo = entidadVistazo === entidad ? ENTIDAD_NULA : entidad;
            firma = ''; // fuerza la reconstrucción para mostrar/ocultar el vistazo
          });
          rejilla.appendChild(boton);
        }
        raiz.appendChild(rejilla);
        if (entidadVistazo !== ENTIDAD_NULA && mundo.esValida(entidadVistazo)) {
          raiz.appendChild(ficha());
        }
      }

      const rejilla = raiz.querySelector('.gwn-rejilla-retratos')!;
      seleccion.forEach((entidad, indice) => {
        const i = indiceDe(entidad);
        const boton = rejilla.children[indice] as HTMLElement | undefined;
        if (!boton) return;
        const nombreIcono =
          mundo.clase[i] === Clase.EDIFICIO ? iconoDeEdificio(mundo.tipo[i] as TipoEdificio) : iconoDeUnidad(mundo.tipo[i] as TipoUnidad);
        // El nodo del botón se reutiliza aunque la entidad de este hueco cambie
        // (una nueva caja de selección con el mismo número de unidades, distinta
        // tropa): el icono solo se rehace cuando el tipo mostrado difiere del último.
        if (boton.dataset['icono'] !== nombreIcono) {
          boton.dataset['icono'] = nombreIcono;
          const icono = boton.querySelector('.gwn-retrato-mini-icono')!;
          icono.innerHTML = elementoIcono(nombreIcono).innerHTML;
        }
        boton.classList.toggle('gwn-activo', entidad === entidadVistazo);
        const vidaMax = mundo.vidaMaxima[i]! || 1;
        const fraccion = Math.max(0, mundo.vida[i]!) / vidaMax;
        const relleno = boton.querySelector<HTMLElement>('.gwn-retrato-mini-vida span')!;
        fijarBarra(relleno, fraccion);
      });

      const vistazo = raiz.querySelector('.gwn-ficha');
      if (vistazo && entidadVistazo !== ENTIDAD_NULA && mundo.esValida(entidadVistazo)) {
        actualizarFicha(mundo, indiceDe(entidadVistazo), vistazo as HTMLElement);
      }
    },

    alPulsarComando(cb: (comando: ComandoInterfaz) => void): void {
      escucha = cb;
    },

    liberar(): void {
      raiz.remove();
    },
  };
}
