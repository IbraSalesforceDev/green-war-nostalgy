/**
 * Fases de la partida vistas por la IA.
 *
 * Vive en su propio fichero y no dentro de `director.ts` porque los demás módulos
 * (`economia.ts`, `produccion.ts`, `combate.ts`) necesitan comparar contra estos
 * valores en tiempo de ejecución, no solo como tipo. Si el enum viviera en
 * `director.ts`, esos módulos tendrían que importar de vuelta al propio director,
 * y ese ciclo de módulos no aporta nada que este fichero de una línea no resuelva ya.
 */
export enum FaseIA {
  /** Solo economía: cuadrillas trabajando y las primeras obras. Sin ejército todavía. */
  ARRANQUE = 0,
  /** Barracón en pie y tropa empezando a salir, sin comprometerse aún a atacar. */
  CRECIMIENTO = 1,
  /** Acumulando una fuerza libre suficiente para la primera ofensiva. */
  MILICIA = 2,
  /** Presión sostenida: ataca en cuanto reúne una fuerza mínima. */
  ASALTO = 3,
}
