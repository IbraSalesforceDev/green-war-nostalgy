import type { AvisoActivo } from '../estado/sesion';
import { elementoIcono } from './iconos';

/**
 * Pila de avisos: "sin oro", "base atacada", "población al límite"…
 *
 * La lista vive en `sesion.avisos`, que ya se encarga de las repeticiones (el
 * enfriamiento por clave) y de la caducidad (`caducarAvisos`). Este módulo solo
 * traduce ese array a tarjetas visuales: entra deslizando desde la derecha, se
 * desvanece al final de su vida y el de severidad "peligro" parpadea todo el
 * rato. Pulsar una tarjeta salta la cámara al punto del aviso.
 */
export interface Avisos {
  readonly raiz: HTMLElement;
  /** `tiempoPartida` en segundos, para calcular cuánto le queda de vida a cada uno. */
  actualizar(avisos: readonly AvisoActivo[], tiempoPartida: number): void;
  alPulsar(cb: (x: number, z: number) => void): void;
  liberar(): void;
}

const ICONO_SEVERIDAD = {
  info: 'brujula',
  alerta: 'rayo',
  peligro: 'calavera',
} as const;

/** Segundos antes de la caducidad real en los que la tarjeta empieza a desvanecerse. */
const ANTELACION_DESVANECIDO = 1.5;

interface Tarjeta {
  nacido: number;
  elemento: HTMLElement;
}

export function crearAvisos(): Avisos {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-avisos';
  raiz.setAttribute('aria-live', 'polite');

  let escucha: (x: number, z: number) => void = () => {};
  // Se indexan por el objeto `AvisoActivo` en sí: `sesion` no da un identificador
  // estable, pero la referencia del objeto no cambia mientras el aviso vive.
  const tarjetas = new Map<AvisoActivo, Tarjeta>();

  return {
    raiz,

    actualizar(avisos: readonly AvisoActivo[], tiempoPartida: number): void {
      const vivos = new Set(avisos);

      // Retira las tarjetas de avisos que `sesion` ya ha hecho caducar.
      for (const [aviso, tarjeta] of tarjetas) {
        if (!vivos.has(aviso)) {
          tarjeta.elemento.remove();
          tarjetas.delete(aviso);
        }
      }

      for (const aviso of avisos) {
        let tarjeta = tarjetas.get(aviso);
        if (!tarjeta) {
          const elemento = document.createElement('div');
          elemento.className = `gwn-aviso gwn-aviso--${aviso.severidad}`;
          elemento.appendChild(elementoIcono(ICONO_SEVERIDAD[aviso.severidad]));
          const texto = document.createElement('span');
          texto.textContent = aviso.texto;
          elemento.appendChild(texto);
          elemento.addEventListener('click', () => escucha(aviso.x, aviso.z));
          raiz.appendChild(elemento);
          tarjeta = { nacido: aviso.nacido, elemento };
          tarjetas.set(aviso, tarjeta);
        }

        // `sesion.caducarAvisos()` retira el aviso a los 7 segundos por defecto;
        // aquí solo se anticipa el desvanecido para que no desaparezca en seco.
        const edad = tiempoPartida - aviso.nacido;
        tarjeta.elemento.classList.toggle('gwn-aviso--saliendo', edad > 7 - ANTELACION_DESVANECIDO);
      }
    },

    alPulsar(cb: (x: number, z: number) => void): void {
      escucha = cb;
    },

    liberar(): void {
      raiz.remove();
      tarjetas.clear();
    },
  };
}
