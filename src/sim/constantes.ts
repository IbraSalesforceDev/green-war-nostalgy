/**
 * Constantes de ajuste del juego.
 *
 * Punto único de verdad para escalas, ritmos y presupuestos de rendimiento.
 * Si un número mágico aparece en un sistema, es que debería estar aquí.
 */

// --- Escala del mundo ---

/** Lado de una casilla en unidades de mundo. Uno a uno: simplifica todas las cuentas. */
export const TAM_CASILLA = 1;

/** Altura de un escalón de acantilado. Marca la silueta del relieve. */
export const ALTURA_ESCALON = 0.55;

/** Subdivisiones del terreno por casilla. Más vértices = relieve más suave, más coste. */
export const SUBDIVISIONES_CASILLA = 2;

// --- Ritmo de la simulación ---

/** Ticks de simulación por segundo. 20 Hz basta para un RTS y deja aire al render. */
export const HERCIOS_SIMULACION = 20;
export const PASO_SIMULACION = 1 / HERCIOS_SIMULACION;

/** Cada cuántos ticks se recalcula la niebla de guerra. */
export const INTERVALO_NIEBLA = 4;

/** Cada cuántos ticks una unidad ociosa busca enemigos por su cuenta. */
export const INTERVALO_BUSQUEDA_OBJETIVO = 5;

/** Cada cuántos ticks piensa la IA. */
export const INTERVALO_IA = 20;

/** Antigüedad máxima de una ruta antes de recalcularla, en ticks. */
export const CADUCIDAD_RUTA = 60;

// --- Economía ---

export const ORO_INICIAL = 800;
export const MADERA_INICIAL = 500;

/** Cuánto entrega un obrero por viaje. */
export const CARGA_ORO = 10;
export const CARGA_MADERA = 10;

/** Segundos que tarda un obrero en llenar la carga. */
export const TIEMPO_MINADO = 3.2;
export const TIEMPO_TALA = 4.5;

/** Reservas iniciales de un yacimiento. */
export const ORO_POR_MINA = 2500;
export const MADERA_POR_ARBOL = 100;

/** Techo absoluto de población. */
export const LIMITE_POBLACION = 100;

/** Población que aporta cada granja y cada ayuntamiento. */
export const POBLACION_POR_GRANJA = 5;
export const POBLACION_POR_AYUNTAMIENTO = 5;

/** Proporción del coste que se devuelve al cancelar una producción. */
export const REEMBOLSO_CANCELACION = 0.75;

/** Puntos de vida reparados por segundo y coste en recursos por punto reparado. */
export const REPARACION_POR_SEGUNDO = 12;
export const COSTE_REPARACION_POR_PUNTO = 0.35;

// --- Combate ---

/** Un edificio nace con esta fracción de su vida y sube hasta el 100 % al terminarse. */
export const VIDA_INICIAL_OBRA = 0.1;

/** Radio en casillas dentro del cual una unidad ociosa entra en combate sola. */
export const RADIO_AGRESION = 5;

/** Cuánto puede alejarse de su puesto una unidad que persigue a un enemigo. */
export const MAX_PERSECUCION = 8;

/** Probabilidad de golpe crítico y su multiplicador. */
export const PROB_CRITICO = 0.08;
export const MULT_CRITICO = 1.6;

/** Segundos que un cadáver permanece en el suelo antes de desvanecerse. */
export const DURACION_CADAVER = 12;

/** Velocidad de los proyectiles en casillas por segundo. */
export const VELOCIDAD_FLECHA = 14;
export const VELOCIDAD_LANZA = 11;
export const VELOCIDAD_ROCA = 7;

// --- Movimiento y evitación ---

/** Fuerza de separación entre unidades. Demasiada y tiemblan; poca y se solapan. */
export const FUERZA_SEPARACION = 2.4;

/** Distancia a la que una unidad considera alcanzado un punto de ruta. */
export const TOLERANCIA_PUNTO_RUTA = 0.35;

/** Distancia al destino final para darse por llegada. */
export const TOLERANCIA_DESTINO = 0.25;

/** Segundos atascada sin avanzar antes de abandonar la orden de movimiento. */
export const PACIENCIA_ATASCO = 2.5;

/** Radio en el que se dispersan las unidades de un grupo al recibir una orden. */
export const DISPERSION_FORMACION = 0.9;

// --- Niebla de guerra ---

/** Resolución de la textura de niebla respecto a la rejilla. */
export const ESCALA_TEXTURA_NIEBLA = 1;

/** Velocidad a la que la niebla se disipa visualmente, para que no parpadee. */
export const SUAVIZADO_NIEBLA = 6;

// --- Mapa por defecto ---

export const ANCHO_MAPA = 96;
export const ALTO_MAPA = 96;

// --- Presupuestos de rendimiento ---

/** Máximo de rutas completas calculadas por tick. El resto espera en cola. */
export const MAX_RUTAS_POR_TICK = 12;

/** Máximo de nodos explorados por búsqueda A*. Corta las búsquedas imposibles. */
export const MAX_NODOS_ASTAR = 6000;

/** Cuántas unidades caben en una celda del particionado espacial. */
export const TAM_CELDA_ESPACIAL = 4;

/** Objetivo de fotogramas por segundo. La resolución dinámica apunta a esto. */
export const FPS_OBJETIVO = 60;

/** Escala de render mínima y máxima de la resolución dinámica. */
export const ESCALA_RENDER_MIN = 0.6;
export const ESCALA_RENDER_MAX = 1;

// --- Cámara ---

/** Ángulo de inclinación de la cámara isométrica, en grados sobre el horizonte. */
export const INCLINACION_CAMARA = 52;

/** Giro de la cámara respecto al norte, en grados. El sesgo clásico del género. */
export const AZIMUT_CAMARA = 45;

export const ZOOM_MIN = 14;
export const ZOOM_MAX = 46;
export const ZOOM_INICIAL = 26;

/** Velocidad de desplazamiento de la cámara con el teclado, en casillas por segundo. */
export const VELOCIDAD_CAMARA = 22;

/** Margen en píxeles del borde de pantalla que activa el desplazamiento con el ratón. */
export const MARGEN_BORDE_CAMARA = 18;

// --- Selección ---

/** Tope de unidades seleccionables a la vez. */
export const MAX_SELECCION = 24;

/** Píxeles que hay que arrastrar para que un clic se convierta en caja de selección. */
export const UMBRAL_ARRASTRE = 8;

/** Milisegundos de pulsación larga en táctil para abrir el menú contextual. */
export const MS_PULSACION_LARGA = 380;

/** Milisegundos entre dos toques para contarlos como doble toque. */
export const MS_DOBLE_TOQUE = 280;
