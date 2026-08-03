import { sesion } from '../estado/sesion';
import { estaDesbloqueado, fichaEdificio, nombreEdificio, ORDEN_CARTA_EDIFICIOS } from '../sim/datos/edificios';
import { fichaUnidad, nombreUnidad, ORDEN_CARTA_UNIDADES } from '../sim/datos/unidades';
import type { Mundo } from '../sim/mundo';
import { Clase, Coste, TipoEdificio, TipoUnidad, indiceDe } from '../sim/tipos';
import type { AccionUnidad, ComandoInterfaz } from './hud';
import { elementoIcono, iconoDeEdificio, iconoDeUnidad, NombreIcono } from './iconos';

/**
 * Carta de comandos: la rejilla de 4x3 botones de abajo a la derecha.
 *
 * Qué botones aparecen depende exclusivamente de lo que hay en `sesion.seleccion`
 * y de a quién pertenece:
 *
 *   - Un obrero (o varios): construir (abre el submenú de edificios), reparar,
 *     recolectar, detener.
 *   - Tropa de combate: atacar-mover, mantener posición, patrullar, detener.
 *   - Selección mixta de obreros y tropa: solo lo que ambos comparten (detener).
 *   - Un único edificio productor propio: un botón de entrenar por cada unidad
 *     que sabe producir, con su coste, su atajo y, si no se puede pagar o la
 *     población está llena, deshabilitado con el motivo en el `title`.
 *   - Cualquier otra cosa (edificio ajeno, edificio sin cola, nada): rejilla vacía.
 *
 * El submenú de construcción es estado puramente local a este módulo — nunca
 * llega a `sesion` ni a `mundo` — y se cierra solo si la selección deja de ser
 * "un grupo de obreros propios".
 */
export interface CartaComandos {
  readonly raiz: HTMLElement;
  actualizar(mundo: Mundo): void;
  alPulsarComando(cb: (comando: ComandoInterfaz) => void): void;
  liberar(): void;
}

/** Disposición clásica de atajos: tres filas de cuatro, como en los clásicos del género. */
const TECLAS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'] as const;
const NUM_SLOTS = TECLAS.length;

interface Slot {
  boton: HTMLButtonElement;
  tecla: HTMLElement;
  costeEl: HTMLElement;
}

interface DefinicionBoton {
  icono: NombreIcono;
  etiqueta: string;
  comando: ComandoInterfaz | 'volver' | 'submenuConstruir';
  coste?: Coste;
  poblacionExtra?: number;
  requiereTipo?: TipoEdificio;
}

const ETIQUETA_ACCION: Record<AccionUnidad, string> = {
  detener: 'Detener',
  atacar: 'Atacar',
  mantenerPosicion: 'Mantener posición',
  patrullar: 'Patrullar',
  recolectar: 'Recolectar',
  reparar: 'Reparar',
};

const ICONO_ACCION: Record<AccionUnidad, NombreIcono> = {
  detener: 'detener',
  atacar: 'espadas',
  mantenerPosicion: 'mantener',
  patrullar: 'patrullar',
  recolectar: 'pico',
  reparar: 'reparar',
};

function botonAccion(accion: AccionUnidad): DefinicionBoton {
  return {
    icono: ICONO_ACCION[accion],
    etiqueta: ETIQUETA_ACCION[accion],
    comando: { clase: 'accion', accion },
  };
}

export function crearCartaComandos(): CartaComandos {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-panel gwn-comandos';
  raiz.setAttribute('aria-label', 'Comandos');

  let escucha: (comando: ComandoInterfaz) => void = () => {};
  let submenuConstruccion = false;
  let firma = '';
  let definicionesActivas: DefinicionBoton[] = [];

  const slots: Slot[] = [];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'gwn-boton-comando gwn-boton-comando--vacio';
    const tecla = document.createElement('span');
    tecla.className = 'gwn-boton-tecla';
    tecla.textContent = TECLAS[k]!;
    boton.appendChild(tecla);
    const costeEl = document.createElement('span');
    costeEl.className = 'gwn-boton-coste';
    boton.appendChild(costeEl);
    raiz.appendChild(boton);
    slots.push({ boton, tecla, costeEl });
  }

  function limpiarSlot(slot: Slot): void {
    slot.boton.className = 'gwn-boton-comando gwn-boton-comando--vacio';
    slot.boton.disabled = false;
    slot.boton.title = '';
    slot.boton.onclick = null;
    slot.boton.querySelector('.icono-svg')?.remove();
    slot.costeEl.innerHTML = '';
    slot.boton.dataset['firma'] = '';
  }

  function pintarCosteEnSlot(slot: Slot, coste: Coste | undefined): void {
    slot.costeEl.innerHTML = '';
    if (!coste) return;
    if (coste.oro > 0) {
      slot.costeEl.appendChild(elementoIcono('moneda'));
      const n = document.createElement('b');
      n.textContent = String(coste.oro);
      slot.costeEl.appendChild(n);
    }
    if (coste.madera > 0) {
      slot.costeEl.appendChild(elementoIcono('tronco'));
      const n = document.createElement('b');
      n.textContent = String(coste.madera);
      slot.costeEl.appendChild(n);
    }
  }

  function montarSlot(slot: Slot, def: DefinicionBoton): void {
    const firmaSlot = `${def.icono}:${def.etiqueta}`;
    slot.boton.classList.remove('gwn-boton-comando--vacio');
    if (slot.boton.dataset['firma'] !== firmaSlot) {
      slot.boton.dataset['firma'] = firmaSlot;
      slot.boton.querySelector('.icono-svg')?.remove();
      slot.boton.insertBefore(elementoIcono(def.icono), slot.boton.firstChild);
      pintarCosteEnSlot(slot, def.coste);
      slot.boton.setAttribute('aria-label', def.etiqueta);
    }

    slot.boton.onclick = (): void => {
      if (def.comando === 'volver') {
        submenuConstruccion = false;
        firma = '';
        return;
      }
      if (def.comando === 'submenuConstruir') {
        submenuConstruccion = true;
        firma = '';
        return;
      }
      escucha(def.comando);
      if (def.comando.clase === 'construir') {
        submenuConstruccion = false;
        firma = '';
      }
    };
  }

  /** Recalcula disponibilidad (oro, madera, población, desbloqueo) cada fotograma. */
  function actualizarDisponibilidad(mundo: Mundo, slot: Slot, def: DefinicionBoton): void {
    let motivo = '';
    if (def.requiereTipo !== undefined) {
      const bandoEstado = mundo.estadoDe(sesion.bandoJugador);
      if (!estaDesbloqueado(def.requiereTipo, bandoEstado.edificiosDisponibles)) {
        motivo = 'Aún no disponible: falta el edificio que lo desbloquea';
      }
    }
    if (!motivo && def.coste) {
      const bandoEstado = mundo.estadoDe(sesion.bandoJugador);
      if (bandoEstado.oro < def.coste.oro) motivo = 'Oro insuficiente';
      else if (bandoEstado.madera < def.coste.madera) motivo = 'Madera insuficiente';
      else if (
        def.poblacionExtra &&
        bandoEstado.poblacion + def.poblacionExtra > bandoEstado.poblacionMaxima
      ) {
        motivo = 'Población al límite: construye una granja';
      }
    }
    const deshabilitado = motivo !== '';
    const titulo = motivo ? `${def.etiqueta} — ${motivo}` : def.etiqueta;
    if (slot.boton.disabled !== deshabilitado) slot.boton.disabled = deshabilitado;
    if (slot.boton.title !== titulo) slot.boton.title = titulo;
  }

  function definicionesParaSeleccion(mundo: Mundo): { definiciones: DefinicionBoton[]; clave: string } {
    if (!sesion.seleccionEsPropia(mundo)) return { definiciones: [], clave: 'vacio' };
    const seleccion = sesion.seleccion.filter((e) => mundo.esValida(e));
    if (seleccion.length === 0) return { definiciones: [], clave: 'vacio' };

    if (seleccion.length === 1) {
      const i = indiceDe(seleccion[0]!);
      if (mundo.clase[i] === Clase.EDIFICIO) {
        const ficha = fichaEdificio(mundo.tipo[i] as TipoEdificio);
        if (ficha.entrena.length === 0) return { definiciones: [], clave: 'vacio' };

        const definiciones = ORDEN_CARTA_UNIDADES.filter((t) => ficha.entrena.includes(t)).map(
          (tipoUnidad): DefinicionBoton => {
            const fichaU = fichaUnidad(tipoUnidad);
            return {
              icono: iconoDeUnidad(tipoUnidad),
              etiqueta: `Entrenar ${nombreUnidad(tipoUnidad, sesion.bandoJugador)}`,
              comando: { clase: 'entrenar', tipoUnidad },
              coste: fichaU.coste,
              poblacionExtra: fichaU.coste.poblacion,
            };
          },
        );
        return { definiciones, clave: `edificio:${mundo.tipo[i]}` };
      }
    }

    let hayObrero = false;
    let hayTropa = false;
    for (const entidad of seleccion) {
      const i = indiceDe(entidad);
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero) hayObrero = true;
      else hayTropa = true;
    }

    if (hayObrero && !hayTropa) {
      if (submenuConstruccion) {
        const definiciones: DefinicionBoton[] = [
          { icono: 'volver', etiqueta: 'Volver', comando: 'volver' },
        ];
        for (const tipoEdificio of ORDEN_CARTA_EDIFICIOS) {
          const ficha = fichaEdificio(tipoEdificio);
          definiciones.push({
            icono: iconoDeEdificio(tipoEdificio),
            etiqueta: `Construir ${nombreEdificio(tipoEdificio, sesion.bandoJugador)}`,
            comando: { clase: 'construir', tipoEdificio },
            coste: ficha.coste,
            requiereTipo: tipoEdificio,
          });
        }
        return { definiciones, clave: 'construccion' };
      }
      return {
        definiciones: [
          { icono: 'construir', etiqueta: 'Construir', comando: 'submenuConstruir' },
          botonAccion('reparar'),
          botonAccion('recolectar'),
          botonAccion('detener'),
        ],
        clave: 'obrero',
      };
    }

    if (hayTropa && !hayObrero) {
      return {
        definiciones: [
          botonAccion('atacar'),
          botonAccion('mantenerPosicion'),
          botonAccion('patrullar'),
          botonAccion('detener'),
        ],
        clave: 'tropa',
      };
    }

    // Selección mixta: solo lo que todos entienden.
    return { definiciones: [botonAccion('detener')], clave: 'mixto' };
  }

  return {
    raiz,

    actualizar(mundo: Mundo): void {
      // Si la selección deja de ser "solo obreros propios", el submenú no tiene
      // sentido y se cierra solo, en vez de quedar fantasma la próxima vez.
      const { definiciones, clave } = definicionesParaSeleccion(mundo);
      if (clave !== 'obrero' && clave !== 'construccion') submenuConstruccion = false;

      raiz.classList.toggle('gwn-oculto', definiciones.length === 0);

      if (firma !== clave) {
        firma = clave;
        for (const slot of slots) limpiarSlot(slot);
        definiciones.forEach((def, indice) => {
          const slot = slots[indice];
          if (slot) montarSlot(slot, def);
        });
        // Guarda las definiciones activas en cada slot para poder recalcular su
        // disponibilidad sin reconstruir nada.
        definicionesActivas = definiciones;
      }

      definicionesActivas.forEach((def, indice) => {
        const slot = slots[indice];
        if (slot) actualizarDisponibilidad(mundo, slot, def);
      });
    },

    alPulsarComando(cb: (comando: ComandoInterfaz) => void): void {
      escucha = cb;
    },

    liberar(): void {
      raiz.remove();
    },
  };
}
