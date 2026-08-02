import { ALTURA_ESCALON, TAM_CASILLA } from './constantes';
import { Bando, Bloqueo, NUM_BANDOS, TipoCasilla, Vision } from './tipos';

/**
 * La rejilla del mapa: terreno, alturas, bloqueos y niebla de guerra.
 *
 * Todo son arrays planos indexados por `z * ancho + x`. Es feo de leer pero es
 * lo que permite recorrer 9.216 casillas por tick sin que el recolector de basura
 * aparezca; en un móvil eso es la diferencia entre 60 fps y un tirón cada segundo.
 *
 * Convenio de coordenadas, fijo en todo el proyecto:
 *   - El mundo se extiende en el plano XZ. La Y es siempre altura.
 *   - La casilla (cx, cz) ocupa el cuadrado [cx, cx+1) x [cz, cz+1) en unidades de mundo.
 *   - El centro de la casilla (cx, cz) está en (cx + 0.5, cz + 0.5).
 */
export class MapaJuego {
  readonly ancho: number;
  readonly alto: number;
  readonly numCasillas: number;

  /** Tipo de terreno por casilla. */
  readonly casillas: Uint8Array;

  /**
   * Nivel de altura por casilla, en escalones enteros. La altura en unidades de
   * mundo es `nivel * ALTURA_ESCALON`. Trabajar con enteros evita que las rampas
   * y los acantilados queden a alturas incoherentes.
   */
  readonly niveles: Uint8Array;

  /** Máscara de bloqueo (ver enum Bloqueo). */
  readonly bloqueos: Uint8Array;

  /** Marca las casillas por las que sí se puede subir o bajar de nivel. */
  readonly rampas: Uint8Array;

  /** Entidad que ocupa la casilla (edificio o yacimiento), 0 si ninguna. */
  readonly ocupante: Int32Array;

  /**
   * Niebla de guerra por bando: un array por bando, un byte por casilla.
   * Guarda el valor máximo alcanzado (OCULTO/RECORDADO/VISIBLE).
   */
  readonly vision: Uint8Array[];

  /** Contador de fuentes de visión activas por casilla y bando. */
  private contadorVision: Uint16Array[];

  /** Variación pseudoaleatoria por casilla, para romper la repetición de texturas. */
  readonly variacion: Uint8Array;

  constructor(ancho: number, alto: number) {
    this.ancho = ancho;
    this.alto = alto;
    this.numCasillas = ancho * alto;

    this.casillas = new Uint8Array(this.numCasillas);
    this.niveles = new Uint8Array(this.numCasillas);
    this.bloqueos = new Uint8Array(this.numCasillas);
    this.rampas = new Uint8Array(this.numCasillas);
    this.ocupante = new Int32Array(this.numCasillas);
    this.variacion = new Uint8Array(this.numCasillas);

    this.vision = [];
    this.contadorVision = [];
    for (let b = 0; b < NUM_BANDOS; b++) {
      this.vision.push(new Uint8Array(this.numCasillas));
      this.contadorVision.push(new Uint16Array(this.numCasillas));
    }
  }

  // --- Indexación ---

  indice(cx: number, cz: number): number {
    return cz * this.ancho + cx;
  }

  dentro(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.ancho && cz < this.alto;
  }

  /** Convierte una coordenada de mundo a índice de casilla. */
  aCasilla(coordenada: number): number {
    return Math.floor(coordenada / TAM_CASILLA);
  }

  /** Centro en unidades de mundo de una casilla. */
  centroCasilla(c: number): number {
    return (c + 0.5) * TAM_CASILLA;
  }

  // --- Terreno ---

  tipoEn(cx: number, cz: number): TipoCasilla {
    if (!this.dentro(cx, cz)) return TipoCasilla.ROCA;
    return this.casillas[this.indice(cx, cz)] as TipoCasilla;
  }

  nivelEn(cx: number, cz: number): number {
    if (!this.dentro(cx, cz)) return 0;
    return this.niveles[this.indice(cx, cz)];
  }

  /** Altura del terreno en unidades de mundo, en el centro de la casilla. */
  alturaEnCasilla(cx: number, cz: number): number {
    return this.nivelEn(cx, cz) * ALTURA_ESCALON;
  }

  /**
   * Altura interpolada en un punto continuo del mundo.
   * Interpola bilinealmente entre los centros de las cuatro casillas vecinas, de
   * modo que las unidades ruedan por las pendientes en vez de dar saltos.
   */
  alturaEnMundo(x: number, z: number): number {
    const fx = x / TAM_CASILLA - 0.5;
    const fz = z / TAM_CASILLA - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    const h00 = this.alturaEnCasilla(x0, z0);
    const h10 = this.alturaEnCasilla(x0 + 1, z0);
    const h01 = this.alturaEnCasilla(x0, z0 + 1);
    const h11 = this.alturaEnCasilla(x0 + 1, z0 + 1);

    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  esAgua(cx: number, cz: number): boolean {
    const t = this.tipoEn(cx, cz);
    return t === TipoCasilla.AGUA_BAJA || t === TipoCasilla.AGUA_PROFUNDA;
  }

  // --- Bloqueos ---

  bloqueoEn(cx: number, cz: number): number {
    if (!this.dentro(cx, cz)) return Bloqueo.TERRENO;
    return this.bloqueos[this.indice(cx, cz)];
  }

  /** ¿Puede una unidad terrestre pisar esta casilla? */
  transitable(cx: number, cz: number): boolean {
    if (!this.dentro(cx, cz)) return false;
    return this.bloqueos[this.indice(cx, cz)] === Bloqueo.LIBRE;
  }

  /**
   * ¿Se puede pasar de una casilla a su vecina?
   * Además del bloqueo, comprueba el desnivel: subir un escalón solo es posible
   * por una rampa. Es lo que convierte un acantilado en una barrera táctica real
   * y no en un simple adorno.
   */
  transitableEntre(desdeX: number, desdeZ: number, haciaX: number, haciaZ: number): boolean {
    if (!this.transitable(haciaX, haciaZ)) return false;
    const nivelA = this.nivelEn(desdeX, desdeZ);
    const nivelB = this.nivelEn(haciaX, haciaZ);
    if (nivelA === nivelB) return true;
    if (Math.abs(nivelA - nivelB) > 1) return false;
    const iA = this.indice(desdeX, desdeZ);
    const iB = this.indice(haciaX, haciaZ);
    return this.rampas[iA] === 1 || this.rampas[iB] === 1;
  }

  marcarBloqueo(cx: number, cz: number, mascara: Bloqueo, entidad = 0): void {
    if (!this.dentro(cx, cz)) return;
    const i = this.indice(cx, cz);
    this.bloqueos[i] |= mascara;
    if (entidad !== 0) this.ocupante[i] = entidad;
  }

  limpiarBloqueo(cx: number, cz: number, mascara: Bloqueo): void {
    if (!this.dentro(cx, cz)) return;
    const i = this.indice(cx, cz);
    this.bloqueos[i] &= ~mascara;
    if (this.bloqueos[i] === Bloqueo.LIBRE) this.ocupante[i] = 0;
  }

  /** Marca o limpia el rectángulo que ocupa un edificio. */
  marcarHuella(
    cxOrigen: number,
    czOrigen: number,
    lado: number,
    mascara: Bloqueo,
    entidad: number,
  ): void {
    for (let dz = 0; dz < lado; dz++) {
      for (let dx = 0; dx < lado; dx++) {
        this.marcarBloqueo(cxOrigen + dx, czOrigen + dz, mascara, entidad);
      }
    }
  }

  limpiarHuella(cxOrigen: number, czOrigen: number, lado: number, mascara: Bloqueo): void {
    for (let dz = 0; dz < lado; dz++) {
      for (let dx = 0; dx < lado; dx++) {
        this.limpiarBloqueo(cxOrigen + dx, czOrigen + dz, mascara);
      }
    }
  }

  /**
   * ¿Cabe aquí un edificio de lado `lado`?
   * Exige suelo libre, mismo nivel en toda la huella y nada de agua: un ayuntamiento
   * a caballo entre dos alturas se vería flotando.
   */
  cabeEdificio(cxOrigen: number, czOrigen: number, lado: number): boolean {
    if (!this.dentro(cxOrigen, czOrigen)) return false;
    if (!this.dentro(cxOrigen + lado - 1, czOrigen + lado - 1)) return false;
    const nivelBase = this.nivelEn(cxOrigen, czOrigen);
    for (let dz = 0; dz < lado; dz++) {
      for (let dx = 0; dx < lado; dx++) {
        const cx = cxOrigen + dx;
        const cz = czOrigen + dz;
        if (!this.transitable(cx, cz)) return false;
        if (this.nivelEn(cx, cz) !== nivelBase) return false;
        if (this.esAgua(cx, cz)) return false;
      }
    }
    return true;
  }

  // --- Niebla de guerra ---

  /**
   * Añade o quita una fuente de visión circular.
   * Se lleva un contador por casilla en vez de un booleano porque muchas unidades
   * comparten campo de visión: al morir una, las demás deben seguir iluminando.
   */
  aplicarVision(bando: Bando, cx: number, cz: number, radio: number, sumar: boolean): void {
    const contador = this.contadorVision[bando];
    const vision = this.vision[bando];
    if (!contador || !vision) return;

    const r = Math.ceil(radio);
    const rCuadrado = radio * radio;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(this.ancho - 1, cx + r);
    const minZ = Math.max(0, cz - r);
    const maxZ = Math.min(this.alto - 1, cz + r);

    for (let z = minZ; z <= maxZ; z++) {
      const dz = z - cz;
      const filaBase = z * this.ancho;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dz * dz > rCuadrado) continue;
        const i = filaBase + x;
        if (sumar) {
          contador[i]++;
          vision[i] = Vision.VISIBLE;
        } else if (contador[i] > 0) {
          contador[i]--;
          // Al perder la última fuente, la casilla no vuelve a negro: se recuerda.
          if (contador[i] === 0) vision[i] = Vision.RECORDADO;
        }
      }
    }
  }

  visionEn(bando: Bando, cx: number, cz: number): Vision {
    if (!this.dentro(cx, cz)) return Vision.OCULTO;
    return (this.vision[bando]?.[this.indice(cx, cz)] ?? Vision.OCULTO) as Vision;
  }

  esVisible(bando: Bando, cx: number, cz: number): boolean {
    return this.visionEn(bando, cx, cz) === Vision.VISIBLE;
  }

  esExplorado(bando: Bando, cx: number, cz: number): boolean {
    return this.visionEn(bando, cx, cz) !== Vision.OCULTO;
  }

  /** Revela el mapa entero para un bando. Para la IA y para depurar. */
  revelarTodo(bando: Bando): void {
    this.vision[bando]?.fill(Vision.VISIBLE);
  }

  // --- Búsquedas auxiliares ---

  /**
   * Busca en espiral la casilla libre más próxima a un punto.
   * Es lo que impide que una orden de moverse encima de un edificio deje a la
   * unidad empujando una pared para siempre.
   */
  casillaLibreMasCercana(cx: number, cz: number, radioMaximo = 12): [number, number] | null {
    if (this.transitable(cx, cz)) return [cx, cz];
    for (let r = 1; r <= radioMaximo; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // Solo el perímetro del anillo: el interior ya se miró en vueltas previas.
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (this.transitable(x, z)) return [x, z];
        }
      }
    }
    return null;
  }
}
