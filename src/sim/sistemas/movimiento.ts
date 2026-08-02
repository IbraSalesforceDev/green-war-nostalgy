import { distanciaCuadrada, girarHacia, limitar } from '../../core/math';
import {
  ALTURA_ESCALON,
  CADUCIDAD_RUTA,
  FUERZA_SEPARACION,
  PACIENCIA_ATASCO,
  TOLERANCIA_DESTINO,
  TOLERANCIA_PUNTO_RUTA,
} from '../constantes';
import { Mundo } from '../mundo';
import type { BuscadorRutas } from '../rutas/contrato';
import { Clase, EstadoUnidad, MAX_ENTIDADES, Orden } from '../tipos';

/**
 * Sistema de movimiento.
 *
 * Traduce «quiero estar allí» en «este tick avanzo tanto». Todo lo demás —quién
 * quiere ir a dónde y por qué— es asunto de los otros sistemas, que hablan con este
 * a través de `solicitarMovimiento` / `detener` / `haLlegado`.
 *
 * El sistema es dueño de tres cosas y de ninguna más: la petición de ruta al
 * `BuscadorRutas`, el seguimiento de los puntos de esa ruta y la integración de la
 * posición. Nunca decide una orden por su cuenta salvo abandonar una que resultó
 * imposible.
 */

// --- Ajustes propios del sistema (no existían en constantes.ts) ---

/** Cuánto puede alejarse el destino antes de recalcular la ruta entera, en casillas. */
export const UMBRAL_REPLANIFICACION = 1.6;

/** Por debajo de esta distancia y con línea despejada se va en línea recta, sin A*. */
export const DISTANCIA_DIRECTA_MAXIMA = 6;

/** Avance mínimo (casillas/s) por debajo del cual se considera que hay atasco. */
export const VELOCIDAD_MINIMA_AVANCE = 0.2;

/** Cuánto frena una cuesta arriba de un escalón completo, de 0 a 1. */
export const PENALIZACION_PENDIENTE = 0.45;

/** Recálculos de ruta antes de rendirse con la orden. */
export const MAX_REINTENTOS_RUTA = 2;

/** Paso de muestreo al comprobar si la línea recta está despejada, en casillas. */
const PASO_MUESTREO_LINEA = 0.4;

/** Tolerancia con la que se comparan dos destinos para saber si son el mismo. */
const EPSILON_DESTINO = 0.02;

// --- Estados internos del movimiento ---

export const MOV_INACTIVO = 0;
export const MOV_ACTIVO = 1;
export const MOV_LLEGADO = 2;
export const MOV_FALLADO = 3;

// --- Evitación local ---

/**
 * Firma de la evitación local. La implementa `src/sim/rutas/evitacion.ts`; mientras no
 * exista, el sistema usa una separación propia y modesta que evita el apelotonamiento
 * sin producir temblores.
 *
 * Recibe la dirección deseada ya normalizada y escribe en `salida` la corregida,
 * también normalizada. No debe reservar memoria.
 */
export type FuncionEvitacion = (
  mundo: Mundo,
  indice: number,
  deseadoX: number,
  deseadoZ: number,
  salida: { x: number; z: number },
) => void;

let evitacionExterna: FuncionEvitacion | null = null;

/** Enchufa la evitación de verdad cuando el módulo de rutas esté disponible. */
export function registrarEvitacion(funcion: FuncionEvitacion | null): void {
  evitacionExterna = funcion;
}

// --- Vectores de trabajo del módulo (reutilizados, cero basura por tick) ---

const direccion = { x: 0, z: 0 };

export class SistemaMovimiento {
  readonly mundo: Mundo;
  readonly buscador: BuscadorRutas;

  /** Estado del movimiento por entidad (MOV_*). */
  private readonly estadoMov = new Uint8Array(MAX_ENTIDADES);
  private readonly destX = new Float32Array(MAX_ENTIDADES);
  private readonly destZ = new Float32Array(MAX_ENTIDADES);
  private readonly tolerancia = new Float32Array(MAX_ENTIDADES);
  /** Destino con el que se pidió la ruta vigente. */
  private readonly rutaDestX = new Float32Array(MAX_ENTIDADES);
  private readonly rutaDestZ = new Float32Array(MAX_ENTIDADES);
  /** 1 si hay una petición de ruta en vuelo. */
  private readonly pendiente = new Uint8Array(MAX_ENTIDADES);
  private readonly reintentos = new Uint8Array(MAX_ENTIDADES);
  private readonly ultimaX = new Float32Array(MAX_ENTIDADES);
  private readonly ultimaZ = new Float32Array(MAX_ENTIDADES);

  /** Estado del visitante de separación; evita crear un cierre por consulta. */
  private sepIndice = 0;
  private sepX = 0;
  private sepZ = 0;
  private readonly visitanteSeparacion: (indice: number) => void;

  constructor(mundo: Mundo, buscador: BuscadorRutas) {
    this.mundo = mundo;
    this.buscador = buscador;
    this.visitanteSeparacion = (indice: number): void => this.acumularSeparacion(indice);
  }

  // --- API para los demás sistemas ---

  /**
   * Pide llegar a (x, z) con la tolerancia dada. Repetir la llamada con el mismo
   * destino es barato: no vuelve a pedir ruta.
   */
  solicitarMovimiento(i: number, x: number, z: number, tolerancia = TOLERANCIA_DESTINO): void {
    const mismoDestino =
      Math.abs(this.destX[i] - x) < EPSILON_DESTINO &&
      Math.abs(this.destZ[i] - z) < EPSILON_DESTINO;

    if (mismoDestino && this.estadoMov[i] !== MOV_INACTIVO) {
      this.tolerancia[i] = tolerancia;
      return;
    }

    this.destX[i] = x;
    this.destZ[i] = z;
    this.tolerancia[i] = tolerancia;
    this.estadoMov[i] = MOV_ACTIVO;
    this.reintentos[i] = 0;
    this.mundo.tiempoAtascado[i] = 0;
    this.ultimaX[i] = this.mundo.x[i];
    this.ultimaZ[i] = this.mundo.z[i];
    this.planificar(i, false);
  }

  /** Corta el movimiento en seco y olvida la ruta. */
  detener(i: number): void {
    if (this.estadoMov[i] === MOV_ACTIVO || this.pendiente[i] === 1) {
      this.buscador.cancelar(this.mundo.entidadDeIndice(i));
      this.mundo.rutas.delete(i);
    }
    this.pendiente[i] = 0;
    this.estadoMov[i] = MOV_INACTIVO;
    this.mundo.vx[i] = 0;
    this.mundo.vz[i] = 0;
    this.mundo.tiempoAtascado[i] = 0;
  }

  estaActivo(i: number): boolean {
    return this.estadoMov[i] === MOV_ACTIVO;
  }

  haLlegado(i: number): boolean {
    return this.estadoMov[i] === MOV_LLEGADO;
  }

  haFallado(i: number): boolean {
    return this.estadoMov[i] === MOV_FALLADO;
  }

  destinoX(i: number): number {
    return this.destX[i];
  }

  destinoZ(i: number): number {
    return this.destZ[i];
  }

  /** Limpia el hueco de una entidad que se va del mundo (los índices se reciclan). */
  olvidar(i: number): void {
    if (this.pendiente[i] === 1) this.buscador.cancelar(this.mundo.entidadDeIndice(i));
    this.estadoMov[i] = MOV_INACTIVO;
    this.pendiente[i] = 0;
    this.reintentos[i] = 0;
    this.destX[i] = 0;
    this.destZ[i] = 0;
    this.mundo.rutas.delete(i);
  }

  // --- Tick ---

  paso(dt: number): void {
    const mundo = this.mundo;
    this.derivarDeOrdenes();

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;

      if (mundo.vida[i] <= 0 || mundo.estado[i] === EstadoUnidad.MURIENDO) {
        if (this.estadoMov[i] === MOV_ACTIVO) this.detener(i);
        mundo.vx[i] = 0;
        mundo.vz[i] = 0;
        continue;
      }

      if (this.estadoMov[i] !== MOV_ACTIVO) {
        mundo.vx[i] = 0;
        mundo.vz[i] = 0;
        if (mundo.estado[i] === EstadoUnidad.CAMINANDO) {
          mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
        }
        continue;
      }

      this.avanzar(i, dt);
    }
  }

  /**
   * Convierte las órdenes que son puro movimiento en peticiones al propio sistema.
   * Las órdenes con contenido (recolectar, construir, atacar) las traducen sus
   * sistemas, que saben a qué punto exacto hay que ir.
   */
  private derivarDeOrdenes(): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (mundo.vida[i] <= 0) continue;

      const orden = mundo.orden[i];
      if (orden === Orden.MOVER) {
        this.solicitarMovimiento(i, mundo.ordenX[i], mundo.ordenZ[i], TOLERANCIA_DESTINO);
      } else if (orden === Orden.ATACAR_MOVER || orden === Orden.PATRULLAR) {
        // Solo se avanza si el combate no ha enganchado un objetivo; si lo hay, manda él.
        if (!mundo.esValida(mundo.objetivoActual[i])) {
          this.solicitarMovimiento(i, mundo.ordenX[i], mundo.ordenZ[i], TOLERANCIA_DESTINO);
        }
      }
    }
  }

  // --- Planificación ---

  private planificar(i: number, forzarRuta: boolean): void {
    const mundo = this.mundo;
    const x = mundo.x[i];
    const z = mundo.z[i];
    const dx = this.destX[i] - x;
    const dz = this.destZ[i] - z;
    const distancia = Math.sqrt(dx * dx + dz * dz);

    if (distancia <= this.tolerancia[i]) {
      this.llegar(i);
      return;
    }

    mundo.rutas.delete(i);
    this.rutaDestX[i] = this.destX[i];
    this.rutaDestZ[i] = this.destZ[i];

    if (
      !forzarRuta &&
      distancia < DISTANCIA_DIRECTA_MAXIMA &&
      hayLineaLibre(mundo, x, z, this.destX[i], this.destZ[i])
    ) {
      // Cerca y sin obstáculos: dirección directa, sin gastar un A*.
      this.pendiente[i] = 0;
      this.buscador.cancelar(mundo.entidadDeIndice(i));
      return;
    }

    this.buscador.pedir({
      entidad: mundo.entidadDeIndice(i),
      origenX: x,
      origenZ: z,
      destinoX: this.destX[i],
      destinoZ: this.destZ[i],
      radio: mundo.radio[i],
      tolerancia: this.tolerancia[i],
      prioridad: 1,
    });
    this.pendiente[i] = 1;
  }

  private llegar(i: number): void {
    const mundo = this.mundo;
    this.estadoMov[i] = MOV_LLEGADO;
    this.pendiente[i] = 0;
    mundo.rutas.delete(i);
    mundo.vx[i] = 0;
    mundo.vz[i] = 0;
    mundo.tiempoAtascado[i] = 0;
    if (mundo.estado[i] === EstadoUnidad.CAMINANDO) {
      mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
    }
    this.cerrarOrdenDeMovimiento(i);
  }

  private fallar(i: number): void {
    const mundo = this.mundo;
    this.estadoMov[i] = MOV_FALLADO;
    this.pendiente[i] = 0;
    this.buscador.cancelar(mundo.entidadDeIndice(i));
    mundo.rutas.delete(i);
    mundo.vx[i] = 0;
    mundo.vz[i] = 0;
    mundo.tiempoAtascado[i] = 0;
    if (mundo.estado[i] === EstadoUnidad.CAMINANDO) {
      mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
    }
    // Abandonar con elegancia: la unidad se queda donde está, no sigue empujando.
    if (mundo.orden[i] === Orden.MOVER || mundo.orden[i] === Orden.ATACAR_MOVER) {
      mundo.orden[i] = Orden.NINGUNA;
    }
  }

  /** Al llegar, una orden de puro movimiento se da por cumplida; la patrulla, se invierte. */
  private cerrarOrdenDeMovimiento(i: number): void {
    const mundo = this.mundo;
    const orden = mundo.orden[i];
    if (orden === Orden.MOVER || orden === Orden.ATACAR_MOVER) {
      if (
        Math.abs(mundo.ordenX[i] - this.destX[i]) < EPSILON_DESTINO &&
        Math.abs(mundo.ordenZ[i] - this.destZ[i]) < EPSILON_DESTINO
      ) {
        mundo.orden[i] = Orden.NINGUNA;
      }
    } else if (orden === Orden.PATRULLAR) {
      if (
        Math.abs(mundo.ordenX[i] - this.destX[i]) < EPSILON_DESTINO &&
        Math.abs(mundo.ordenZ[i] - this.destZ[i]) < EPSILON_DESTINO
      ) {
        const vueltaX = mundo.anclaX[i];
        const vueltaZ = mundo.anclaZ[i];
        mundo.anclaX[i] = mundo.ordenX[i];
        mundo.anclaZ[i] = mundo.ordenZ[i];
        mundo.ordenX[i] = vueltaX;
        mundo.ordenZ[i] = vueltaZ;
      }
    }
  }

  // --- Integración ---

  private avanzar(i: number, dt: number): void {
    const mundo = this.mundo;
    const x = mundo.x[i];
    const z = mundo.z[i];

    // 1. ¿Ha llegado ya la ruta que estábamos esperando?
    if (this.pendiente[i] === 1) {
      const resultado = this.buscador.recoger(mundo.entidadDeIndice(i));
      if (resultado.estado === 'lista') {
        this.pendiente[i] = 0;
        resultado.ruta.indice = 0;
        mundo.rutas.set(i, resultado.ruta);
      } else if (resultado.estado === 'imposible') {
        this.fallar(i);
        return;
      } else {
        // Aún calculando: la unidad espera quieta en vez de salir a ciegas.
        mundo.vx[i] = 0;
        mundo.vz[i] = 0;
        if (mundo.estado[i] === EstadoUnidad.CAMINANDO) {
          mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
        }
        return;
      }
    }

    // 2. ¿Se ha movido tanto el destino que la ruta ya no sirve?
    const desvio = distanciaCuadrada(
      this.destX[i],
      this.destZ[i],
      this.rutaDestX[i],
      this.rutaDestZ[i],
    );
    if (desvio > UMBRAL_REPLANIFICACION * UMBRAL_REPLANIFICACION) {
      this.planificar(i, false);
      if (this.estadoMov[i] !== MOV_ACTIVO) return;
    }

    // 3. ¿Llegamos?
    const dxFinal = this.destX[i] - x;
    const dzFinal = this.destZ[i] - z;
    const distanciaFinal = Math.sqrt(dxFinal * dxFinal + dzFinal * dzFinal);
    if (distanciaFinal <= this.tolerancia[i]) {
      this.llegar(i);
      return;
    }

    // 4. Punto al que apuntar: el siguiente vértice de la ruta o el destino final.
    let objetivoX = this.destX[i];
    let objetivoZ = this.destZ[i];
    const ruta = mundo.rutas.get(i);
    if (ruta) {
      if (mundo.tick - ruta.tickCalculo > CADUCIDAD_RUTA) {
        this.planificar(i, true);
        if (this.estadoMov[i] !== MOV_ACTIVO) return;
      } else {
        const total = ruta.puntos.length >> 1;
        while (ruta.indice < total) {
          const px = ruta.puntos[ruta.indice * 2];
          const pz = ruta.puntos[ruta.indice * 2 + 1];
          if (
            distanciaCuadrada(x, z, px, pz) <=
            TOLERANCIA_PUNTO_RUTA * TOLERANCIA_PUNTO_RUTA
          ) {
            ruta.indice++;
            continue;
          }
          objetivoX = px;
          objetivoZ = pz;
          break;
        }
        if (ruta.indice >= total) mundo.rutas.delete(i);
      }
    }

    // 5. Dirección deseada y evitación local.
    let dirX = objetivoX - x;
    let dirZ = objetivoZ - z;
    const largo = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (largo < 1e-6) {
      this.llegar(i);
      return;
    }
    dirX /= largo;
    dirZ /= largo;

    if (evitacionExterna) {
      direccion.x = dirX;
      direccion.z = dirZ;
      evitacionExterna(mundo, i, dirX, dirZ, direccion);
      dirX = direccion.x;
      dirZ = direccion.z;
    } else {
      this.evitacionPropia(i, dirX, dirZ, direccion);
      dirX = direccion.x;
      dirZ = direccion.z;
    }

    // 6. Velocidad, con la pendiente del terreno pasando factura.
    let velocidad = mundo.velocidad[i];
    const alturaActual = mundo.mapa.alturaEnMundo(x, z);
    const sondaX = x + dirX * 0.6;
    const sondaZ = z + dirZ * 0.6;
    const subida = mundo.mapa.alturaEnMundo(sondaX, sondaZ) - alturaActual;
    if (subida > 0) {
      velocidad *= 1 - limitar(subida / ALTURA_ESCALON, 0, 1) * PENALIZACION_PENDIENTE;
    }

    let paso = velocidad * dt;
    // Nunca sobrepasar el destino: produce el temblor clásico alrededor del punto.
    if (paso > distanciaFinal) paso = distanciaFinal;

    // 7. Desplazamiento con deslizamiento sobre los bloqueos.
    const candidatoX = x + dirX * paso;
    const candidatoZ = z + dirZ * paso;
    let nuevoX = x;
    let nuevoZ = z;

    if (this.puedePisar(i, candidatoX, candidatoZ)) {
      nuevoX = candidatoX;
      nuevoZ = candidatoZ;
    } else if (this.puedePisar(i, candidatoX, z)) {
      nuevoX = candidatoX;
    } else if (this.puedePisar(i, x, candidatoZ)) {
      nuevoZ = candidatoZ;
    }

    mundo.x[i] = nuevoX;
    mundo.z[i] = nuevoZ;
    mundo.vx[i] = (nuevoX - x) / dt;
    mundo.vz[i] = (nuevoZ - z) / dt;

    // 8. Giro hacia el avance.
    const avanceX = nuevoX - x;
    const avanceZ = nuevoZ - z;
    if (avanceX * avanceX + avanceZ * avanceZ > 1e-8) {
      // Convenio: ángulo 0 mira hacia +Z, y crece hacia +X.
      const objetivoAngulo = Math.atan2(avanceX, avanceZ);
      mundo.angulo[i] = girarHacia(
        mundo.angulo[i],
        objetivoAngulo,
        mundo.velocidadGiro[i] * dt,
      );
      if (mundo.estado[i] !== EstadoUnidad.MURIENDO) {
        mundo.cambiarEstado(i, EstadoUnidad.CAMINANDO);
      }
    }

    // 9. Atasco.
    const recorrido = Math.sqrt(
      distanciaCuadrada(nuevoX, nuevoZ, this.ultimaX[i], this.ultimaZ[i]),
    );
    if (recorrido / dt < VELOCIDAD_MINIMA_AVANCE) {
      mundo.tiempoAtascado[i] += dt;
      if (mundo.tiempoAtascado[i] >= PACIENCIA_ATASCO) {
        mundo.tiempoAtascado[i] = 0;
        if (this.reintentos[i] < MAX_REINTENTOS_RUTA) {
          this.reintentos[i]++;
          this.planificar(i, true);
        } else {
          this.fallar(i);
        }
      }
    } else {
      mundo.tiempoAtascado[i] = 0;
    }
    this.ultimaX[i] = nuevoX;
    this.ultimaZ[i] = nuevoZ;

    mundo.casillaX[i] = mundo.mapa.aCasilla(nuevoX);
    mundo.casillaZ[i] = mundo.mapa.aCasilla(nuevoZ);
  }

  /** ¿Puede el centro de la unidad ocupar ese punto? */
  private puedePisar(i: number, x: number, z: number): boolean {
    const mapa = this.mundo.mapa;
    const cx = mapa.aCasilla(x);
    const cz = mapa.aCasilla(z);
    const desdeX = mapa.aCasilla(this.mundo.x[i]);
    const desdeZ = mapa.aCasilla(this.mundo.z[i]);
    if (cx === desdeX && cz === desdeZ) return true;
    return mapa.transitableEntre(desdeX, desdeZ, cx, cz);
  }

  // --- Evitación de reserva ---

  /**
   * Separación simple mientras el módulo de rutas no aporte la suya.
   * Empuja a la unidad lejos de sus vecinos inmediatos con una fuerza proporcional
   * al solapamiento, y renormaliza para no alterar la velocidad de avance.
   */
  private evitacionPropia(
    i: number,
    deseadoX: number,
    deseadoZ: number,
    salida: { x: number; z: number },
  ): void {
    this.sepIndice = i;
    this.sepX = 0;
    this.sepZ = 0;
    const radio = this.mundo.radio[i] * 2 + 0.7;
    this.mundo.consultarRadio(this.mundo.x[i], this.mundo.z[i], radio, this.visitanteSeparacion);

    let x = deseadoX + this.sepX * FUERZA_SEPARACION;
    let z = deseadoZ + this.sepZ * FUERZA_SEPARACION;
    const largo = Math.sqrt(x * x + z * z);
    if (largo < 1e-6) {
      salida.x = deseadoX;
      salida.z = deseadoZ;
      return;
    }
    x /= largo;
    z /= largo;
    salida.x = x;
    salida.z = z;
  }

  private acumularSeparacion(j: number): void {
    const i = this.sepIndice;
    if (j === i) return;
    const mundo = this.mundo;
    if (mundo.clase[j] !== Clase.UNIDAD) return;
    if (mundo.vida[j] <= 0) return;

    const dx = mundo.x[i] - mundo.x[j];
    const dz = mundo.z[i] - mundo.z[j];
    const distanciaCuad = dx * dx + dz * dz;
    const minima = mundo.radio[i] + mundo.radio[j];
    if (distanciaCuad >= minima * minima) return;

    if (distanciaCuad < 1e-8) {
      // Superpuestas exactamente: se desempata con el índice, que es determinista.
      this.sepX += i > j ? 0.01 : -0.01;
      this.sepZ += i > j ? -0.01 : 0.01;
      return;
    }

    const distancia = Math.sqrt(distanciaCuad);
    const empuje = (minima - distancia) / minima;
    this.sepX += (dx / distancia) * empuje;
    this.sepZ += (dz / distancia) * empuje;
  }
}

/**
 * ¿Está despejado el segmento entre dos puntos?
 * Muestreo simple sobre la rejilla: barato y suficiente para decidir si merece la
 * pena molestar al buscador de rutas.
 */
export function hayLineaLibre(
  mundo: Mundo,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  const mapa = mundo.mapa;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const largo = Math.sqrt(dx * dx + dz * dz);
  if (largo < 1e-6) return true;

  const pasos = Math.max(1, Math.ceil(largo / PASO_MUESTREO_LINEA));
  let anteriorX = mapa.aCasilla(x0);
  let anteriorZ = mapa.aCasilla(z0);

  for (let k = 1; k <= pasos; k++) {
    const t = k / pasos;
    const cx = mapa.aCasilla(x0 + dx * t);
    const cz = mapa.aCasilla(z0 + dz * t);
    if (cx === anteriorX && cz === anteriorZ) continue;
    if (!mapa.transitableEntre(anteriorX, anteriorZ, cx, cz)) return false;
    anteriorX = cx;
    anteriorZ = cz;
  }
  return true;
}
