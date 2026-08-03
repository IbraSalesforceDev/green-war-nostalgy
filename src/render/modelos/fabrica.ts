import type * as THREE from 'three';
import type { Bando, TipoEdificio, TipoUnidad } from '../../sim/tipos';
import type { FabricaModelos, ModeloEdificio, ModeloUnidad } from './contrato';
import { BancoMateriales } from './materiales';
import { crearFabricaUnidades } from './unidades';
import { crearFabricaEdificios } from './edificios';
import { crearFabricaAdornos } from './adornos';

/**
 * Fábrica de modelos definitiva.
 *
 * Junta los tres catálogos —unidades, edificios y adornos— sobre un único
 * `BancoMateriales` compartido: los cinco materiales de la escena (mate, facetado,
 * metal, piel, brillo) se crean una sola vez y los reutilizan tanto un campesino
 * como un ayuntamiento como un pino. `liberar()` tira de todas las geometrías de
 * plantilla y de los materiales al cerrar la partida o al cambiar de fábrica.
 */
export function crearFabricaModelos(): FabricaModelos {
  const banco = new BancoMateriales();
  const unidades = crearFabricaUnidades(banco);
  const edificios = crearFabricaEdificios(banco);
  const adornos = crearFabricaAdornos(banco);

  return {
    crearUnidad(tipo: TipoUnidad, bando: Bando): ModeloUnidad {
      return unidades.crear(tipo, bando);
    },
    crearEdificio(tipo: TipoEdificio, bando: Bando): ModeloEdificio {
      return edificios.crear(tipo, bando);
    },
    crearAdorno(clave: string, semilla: number): THREE.Object3D {
      return adornos.crear(clave, semilla);
    },
    liberar(): void {
      unidades.liberar();
      edificios.liberar();
      adornos.liberar();
      banco.liberar();
    },
  };
}
