import { calcularEvitacion } from './rutas/evitacion';
import { registrarEvitacion } from './sistemas/movimiento';
import type { OpcionesEvitacion } from './rutas/evitacion';

/**
 * Enchufa la evitación local del módulo de rutas al sistema de movimiento.
 *
 * Los dos módulos están deliberadamente desacoplados —el movimiento consume una
 * función registrada y las rutas no saben quién la usa— pero hablan idiomas
 * ligeramente distintos, y el desajuste es una trampa:
 *
 *   · `calcularEvitacion` devuelve **solo la corrección de separación**, y escribe
 *     (0, 0) cuando no hay ningún vecino al que esquivar.
 *   · El movimiento toma lo que reciba como **dirección final de avance**.
 *
 * Conectarlos a lo bruto deja a toda unidad sin vecinos con dirección (0, 0), es
 * decir, clavada en el sitio con la orden puesta y sin ningún error por ninguna
 * parte. Aquí se suma la corrección a la dirección deseada y se renormaliza, que es
 * el uso que documenta el propio módulo de evitación.
 *
 * Existe como módulo aparte, y no como cuatro líneas dentro de `main.ts`, para que
 * las pruebas de integración ejerciten exactamente el mismo cableado que la partida
 * real. Este fallo se coló justo por ahí.
 */

/** Vector de trabajo del módulo: cero reservas de memoria por unidad y tick. */
const correccion = { x: 0, z: 0 };

export function enchufarEvitacion(opciones?: OpcionesEvitacion): void {
  registrarEvitacion((mundo, indice, deseadoX, deseadoZ, salida) => {
    const magnitud = calcularEvitacion(
      mundo,
      mundo.mapa,
      indice,
      deseadoX,
      deseadoZ,
      correccion,
      opciones,
    );

    // Sin vecinos cerca no hay nada que corregir: se sigue la ruta tal cual.
    if (magnitud <= 0) {
      salida.x = deseadoX;
      salida.z = deseadoZ;
      return;
    }

    const x = deseadoX + correccion.x;
    const z = deseadoZ + correccion.z;
    const largo = Math.sqrt(x * x + z * z);

    // Caso extremo: el empuje anula exactamente a la dirección deseada. Antes que
    // detenerse en seco, la unidad conserva su rumbo y deja que la separación se
    // resuelva en los siguientes ticks.
    if (largo < 1e-4) {
      salida.x = deseadoX;
      salida.z = deseadoZ;
      return;
    }

    salida.x = x / largo;
    salida.z = z / largo;
  });
}

/** Desconecta la evitación externa; el movimiento vuelve a su separación propia. */
export function desenchufarEvitacion(): void {
  registrarEvitacion(null);
}
