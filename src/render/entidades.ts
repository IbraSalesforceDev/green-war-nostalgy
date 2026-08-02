import * as THREE from 'three';
import { Clase, EstadoUnidad, TipoUnidad, generacionDe } from '../sim/tipos';
import { Bando, TipoEdificio, TipoYacimiento } from '../sim/tipos';
import type { Mundo } from '../sim/mundo';
import type { CalidadRender } from './renderizador';
import type { FabricaModelos, ModeloEdificio, ModeloUnidad } from './modelos/contrato';
import { mezclarAngulo } from '../core/math';

/**
 * Puente entre la simulación y la escena.
 *
 * La simulación no sabe que existe Three.js: solo mueve números en arrays. Este
 * módulo recorre esos arrays cada fotograma y mantiene sincronizado un objeto 3D
 * por entidad viva, creando los que aparecen y retirando los que mueren.
 *
 * Dos decisiones que gobiernan el diseño:
 *
 * 1. **Interpolación.** La simulación avanza a 20 Hz y el render puede ir a 120.
 *    Si copiásemos la posición del último tick, el movimiento se vería a tirones.
 *    Se interpola entre la posición anterior y la actual con el factor `alfa` que
 *    entrega el bucle, y así 20 ticks por segundo se ven completamente fluidos.
 *
 * 2. **Fábrica inyectable.** Los modelos definitivos los produce una `FabricaModelos`.
 *    Mientras no esté lista, se usa una fábrica de reserva con formas simples: el
 *    juego es jugable y depurable desde el primer día, y sustituirla es cambiar un
 *    argumento, no reescribir este módulo.
 */

interface VisualUnidad {
  modelo: ModeloUnidad;
  /** Desfase por unidad para desincronizar los ciclos de reposo. */
  desfase: number;
}

interface VisualEdificio {
  modelo: ModeloEdificio;
  ultimoProgreso: number;
  ultimoDanio: number;
}

export interface RenderEntidades {
  /** Sincroniza la escena con el mundo. `alfa` interpola entre el tick previo y el actual. */
  actualizar(alfa: number, dt: number): void;
  /** Cambia la fábrica de modelos y reconstruye lo visible. */
  fijarFabrica(fabrica: FabricaModelos): void;
  liberar(): void;
}

export function crearRenderEntidades(
  escena: THREE.Scene,
  mundo: Mundo,
  calidad: CalidadRender,
  fabrica?: FabricaModelos,
): RenderEntidades {
  const raiz = new THREE.Group();
  raiz.name = 'entidades';
  escena.add(raiz);

  let fabricaActual: FabricaModelos = fabrica ?? crearFabricaProvisional();

  const unidades = new Map<number, VisualUnidad>();
  const edificios = new Map<number, VisualEdificio>();
  const adornos = new Map<number, THREE.Object3D>();

  /** Generación con la que se creó cada visual, para detectar índices reciclados. */
  const generaciones = new Map<number, number>();

  let tiempoGlobal = 0;

  /** En dispositivos modestos se simplifican los modelos desde el principio. */
  const detalleBase: 0 | 1 | 2 =
    calidad.nivel === 'alto' ? 0 : calidad.nivel === 'medio' ? 1 : 2;

  function retirar(indice: number): void {
    const unidad = unidades.get(indice);
    if (unidad) {
      raiz.remove(unidad.modelo.raiz);
      unidad.modelo.liberar();
      unidades.delete(indice);
    }
    const edificio = edificios.get(indice);
    if (edificio) {
      raiz.remove(edificio.modelo.raiz);
      edificio.modelo.liberar();
      edificios.delete(indice);
    }
    const adorno = adornos.get(indice);
    if (adorno) {
      raiz.remove(adorno);
      adornos.delete(indice);
    }
    generaciones.delete(indice);
  }

  function limpiarTodo(): void {
    for (const indice of [...generaciones.keys()]) retirar(indice);
  }

  return {
    actualizar(alfa: number, dt: number): void {
      tiempoGlobal += dt;

      for (let i = 1; i <= mundo.indiceMaximo; i++) {
        const vivo = mundo.activos[i] === 1;

        // Un índice reciclado es una entidad distinta con el mismo hueco: hay que
        // tirar el visual antiguo o veríamos un campesino con cuerpo de catapulta.
        const generacionVista = generaciones.get(i);
        const entidad = vivo ? mundo.entidadDeIndice(i) : 0;
        const generacionActual = vivo ? generacionDe(entidad) : -1;

        if (generacionVista !== undefined && generacionVista !== generacionActual) {
          retirar(i);
        }

        if (!vivo) {
          if (generaciones.has(i)) retirar(i);
          continue;
        }

        const clase = mundo.clase[i];

        // Posición interpolada entre el tick anterior y el actual.
        const x = mundo.xPrevio[i] + (mundo.x[i] - mundo.xPrevio[i]) * alfa;
        const z = mundo.zPrevio[i] + (mundo.z[i] - mundo.zPrevio[i]) * alfa;
        const y = mundo.mapa.alturaEnMundo(x, z);

        if (clase === Clase.UNIDAD) {
          let visual = unidades.get(i);
          if (!visual) {
            const modelo = fabricaActual.crearUnidad(
              mundo.tipo[i] as TipoUnidad,
              mundo.bando[i] as Bando,
            );
            modelo.fijarDetalle(detalleBase);
            raiz.add(modelo.raiz);
            // Desfase estable por índice: mismo valor entre fotogramas, sin azar.
            visual = { modelo, desfase: ((i * 2654435761) % 1000) / 1000 };
            unidades.set(i, visual);
            generaciones.set(i, generacionActual);
          }

          visual.modelo.raiz.position.set(x, y, z);
          visual.modelo.raiz.rotation.y = mezclarAngulo(
            mundo.anguloPrevio[i],
            mundo.angulo[i],
            alfa,
          );

          const rapidez = Math.hypot(mundo.vx[i], mundo.vz[i]);
          visual.modelo.aplicarPose({
            estado: mundo.estado[i] as EstadoUnidad,
            tiempoEstado: mundo.tiempoEstado[i],
            rapidez,
            saludNormalizada: mundo.vida[i] / Math.max(1, mundo.vidaMaxima[i]),
            tiempoGlobal,
            desfase: visual.desfase,
          });
        } else if (clase === Clase.EDIFICIO) {
          let visual = edificios.get(i);
          if (!visual) {
            const modelo = fabricaActual.crearEdificio(
              mundo.tipo[i] as TipoEdificio,
              mundo.bando[i] as Bando,
            );
            modelo.fijarDetalle(detalleBase);
            raiz.add(modelo.raiz);
            visual = { modelo, ultimoProgreso: -1, ultimoDanio: -1 };
            edificios.set(i, visual);
            generaciones.set(i, generacionActual);
            modelo.raiz.position.set(mundo.x[i], mundo.alturaDe(i), mundo.z[i]);
          }

          // Un edificio no se mueve: solo se actualiza cuando algo cambia de verdad.
          const progreso = mundo.progresoObra[i];
          if (Math.abs(progreso - visual.ultimoProgreso) > 0.01) {
            visual.modelo.fijarProgresoObra(progreso);
            visual.ultimoProgreso = progreso;
          }

          const danio = 1 - mundo.vida[i] / Math.max(1, mundo.vidaMaxima[i]);
          if (Math.abs(danio - visual.ultimoDanio) > 0.05) {
            visual.modelo.fijarDanio(danio);
            visual.ultimoDanio = danio;
          }
        } else if (clase === Clase.YACIMIENTO || clase === Clase.ADORNO) {
          if (!adornos.has(i)) {
            const clave = claveAdorno(clase, mundo.tipo[i]);
            const objeto = fabricaActual.crearAdorno(clave, i);
            objeto.position.set(mundo.x[i], mundo.alturaDe(i), mundo.z[i]);
            // Giro estable por índice: variedad visual sin romper el determinismo.
            objeto.rotation.y = ((i * 40503) % 628) / 100;
            raiz.add(objeto);
            adornos.set(i, objeto);
            generaciones.set(i, generacionActual);
          }
        }
      }
    },

    fijarFabrica(nueva: FabricaModelos): void {
      limpiarTodo();
      fabricaActual.liberar();
      fabricaActual = nueva;
    },

    liberar(): void {
      limpiarTodo();
      fabricaActual.liberar();
      escena.remove(raiz);
    },
  };

  function claveAdorno(clase: Clase, tipo: number): string {
    if (clase === Clase.YACIMIENTO) {
      return tipo === TipoYacimiento.MINA_ORO ? 'mina' : 'arbol';
    }
    return 'roca';
  }
}

// --- Fábrica de reserva ---

/**
 * Modelos provisionales con formas primitivas.
 *
 * No pretenden ser bonitos: pretenden que el juego se pueda ver, depurar y jugar
 * mientras se construyen los modelos definitivos. Aun así respetan lo que de verdad
 * importa para leer una partida: silueta distinta por tipo, color de bando claro y
 * tamaño proporcionado a la ficha de la unidad.
 */
export function crearFabricaProvisional(): FabricaModelos {
  const geometrias: THREE.BufferGeometry[] = [];
  const materiales: THREE.Material[] = [];

  const registrarGeometria = <T extends THREE.BufferGeometry>(g: T): T => {
    geometrias.push(g);
    return g;
  };
  const registrarMaterial = <T extends THREE.Material>(m: T): T => {
    materiales.push(m);
    return m;
  };

  const COLOR_BANDO: Record<number, number> = {
    [Bando.NEUTRAL]: 0x8a8378,
    [Bando.HUMANOS]: 0x3f6fc4,
    [Bando.ORCOS]: 0xa33228,
  };

  // Una geometría por tipo, compartida por todas las instancias.
  const cuerpoUnidad = new Map<TipoUnidad, THREE.BufferGeometry>();
  const cuerpoEdificio = new Map<TipoEdificio, THREE.BufferGeometry>();
  const materialBando = new Map<number, THREE.Material>();

  function materialDe(bando: number): THREE.Material {
    let material = materialBando.get(bando);
    if (!material) {
      material = registrarMaterial(
        new THREE.MeshStandardMaterial({
          color: COLOR_BANDO[bando] ?? 0x888888,
          roughness: 0.72,
          metalness: 0.08,
        }),
      );
      materialBando.set(bando, material);
    }
    return material;
  }

  function geometriaUnidad(tipo: TipoUnidad): THREE.BufferGeometry {
    let g = cuerpoUnidad.get(tipo);
    if (!g) {
      switch (tipo) {
        case TipoUnidad.JINETE:
          g = registrarGeometria(new THREE.CapsuleGeometry(0.26, 0.62, 4, 8));
          break;
        case TipoUnidad.CATAPULTA:
          g = registrarGeometria(new THREE.BoxGeometry(0.8, 0.55, 0.9));
          break;
        case TipoUnidad.ARQUERO:
          g = registrarGeometria(new THREE.ConeGeometry(0.26, 0.86, 7));
          break;
        case TipoUnidad.SOLDADO:
          g = registrarGeometria(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8));
          break;
        default:
          g = registrarGeometria(new THREE.CapsuleGeometry(0.18, 0.42, 4, 6));
          break;
      }
      cuerpoUnidad.set(tipo, g);
    }
    return g;
  }

  function geometriaEdificio(tipo: TipoEdificio): THREE.BufferGeometry {
    let g = cuerpoEdificio.get(tipo);
    if (!g) {
      const lados: Record<TipoEdificio, [number, number, number]> = {
        [TipoEdificio.AYUNTAMIENTO]: [3.4, 2.4, 3.4],
        [TipoEdificio.GRANJA]: [1.7, 1.1, 1.7],
        [TipoEdificio.BARRACON]: [2.5, 1.8, 2.5],
        [TipoEdificio.ASERRADERO]: [2.5, 1.5, 2.5],
        [TipoEdificio.TORRE]: [1.3, 3.2, 1.3],
        [TipoEdificio.HERRERIA]: [2.5, 1.7, 2.5],
      };
      const [ancho, alto, fondo] = lados[tipo] ?? [2, 1.5, 2];
      g = registrarGeometria(new THREE.BoxGeometry(ancho, alto, fondo));
      // El origen del edificio está en su base, no en su centro.
      g.translate(0, alto / 2, 0);
      cuerpoEdificio.set(tipo, g);
    }
    return g;
  }

  const materialTronco = registrarMaterial(
    new THREE.MeshStandardMaterial({ color: 0x4a3421, roughness: 0.95 }),
  );
  const materialCopa = registrarMaterial(
    new THREE.MeshStandardMaterial({ color: 0x2c4a1e, roughness: 0.92 }),
  );
  const materialOro = registrarMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xb98b2a,
      roughness: 0.5,
      metalness: 0.55,
      emissive: 0x3a2a05,
    }),
  );
  const materialRoca = registrarMaterial(
    new THREE.MeshStandardMaterial({ color: 0x5b5750, roughness: 0.95 }),
  );

  const geoTronco = registrarGeometria(new THREE.CylinderGeometry(0.11, 0.16, 0.9, 6));
  const geoCopa = registrarGeometria(new THREE.ConeGeometry(0.55, 1.5, 7));
  const geoMina = registrarGeometria(new THREE.DodecahedronGeometry(0.75, 0));
  const geoRoca = registrarGeometria(new THREE.DodecahedronGeometry(0.42, 0));

  return {
    crearUnidad(tipo: TipoUnidad, bando: Bando): ModeloUnidad {
      const malla = new THREE.Mesh(geometriaUnidad(tipo), materialDe(bando));
      malla.castShadow = true;
      const altura = tipo === TipoUnidad.CATAPULTA ? 0.7 : 0.95;
      malla.position.y = altura * 0.5;

      const raiz = new THREE.Group();
      raiz.add(malla);

      return {
        raiz,
        altura,
        aplicarPose(pose) {
          // Animación mínima pero legible: rebote al andar, respiración al parar
          // y desplome al morir. Suficiente para leer el estado de una unidad.
          if (pose.estado === EstadoUnidad.CAMINANDO) {
            const paso = pose.tiempoGlobal * pose.rapidez * 5 + pose.desfase * 6.28;
            malla.position.y = altura * 0.5 + Math.abs(Math.sin(paso)) * 0.07;
            malla.rotation.z = Math.sin(paso) * 0.06;
          } else if (pose.estado === EstadoUnidad.MURIENDO) {
            const t = Math.min(1, pose.tiempoEstado * 2.5);
            malla.rotation.z = t * Math.PI * 0.5;
            malla.position.y = altura * 0.5 * (1 - t * 0.8);
          } else {
            const respirar = pose.tiempoGlobal * 1.6 + pose.desfase * 6.28;
            malla.position.y = altura * 0.5 + Math.sin(respirar) * 0.012;
            malla.rotation.z = 0;
          }
        },
        fijarDetalle(nivel) {
          malla.castShadow = nivel === 0;
        },
        liberar() {
          raiz.clear();
        },
      };
    },

    crearEdificio(tipo: TipoEdificio, bando: Bando): ModeloEdificio {
      const malla = new THREE.Mesh(geometriaEdificio(tipo), materialDe(bando));
      malla.castShadow = true;
      malla.receiveShadow = true;

      const raiz = new THREE.Group();
      raiz.add(malla);
      const altura = malla.geometry.boundingBox?.max.y ?? 2;

      return {
        raiz,
        altura,
        fijarProgresoObra(progreso) {
          // El edificio emerge del suelo conforme avanza la obra.
          malla.scale.y = Math.max(0.06, progreso);
        },
        fijarDanio(fraccion) {
          const material = malla.material as THREE.MeshStandardMaterial;
          // Se oscurece y se tiñe conforme lo van demoliendo.
          material.emissive.setRGB(fraccion * 0.12, 0, 0);
        },
        fijarDetalle() {},
        liberar() {
          raiz.clear();
        },
      };
    },

    crearAdorno(clave: string): THREE.Object3D {
      if (clave === 'mina') {
        const malla = new THREE.Mesh(geoMina, materialOro);
        malla.castShadow = true;
        malla.position.y = 0.35;
        return malla;
      }
      if (clave === 'roca') {
        const malla = new THREE.Mesh(geoRoca, materialRoca);
        malla.castShadow = true;
        malla.position.y = 0.2;
        return malla;
      }

      const grupo = new THREE.Group();
      const tronco = new THREE.Mesh(geoTronco, materialTronco);
      tronco.position.y = 0.45;
      tronco.castShadow = true;
      const copa = new THREE.Mesh(geoCopa, materialCopa);
      copa.position.y = 1.4;
      copa.castShadow = true;
      grupo.add(tronco, copa);
      return grupo;
    },

    liberar(): void {
      for (const g of geometrias) g.dispose();
      for (const m of materiales) m.dispose();
      geometrias.length = 0;
      materiales.length = 0;
    },
  };
}
