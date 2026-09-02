/** build-cascade.mjs の型。ビルド用の素の JS なので、ここで形だけ書いておく。 */
export interface ParsedCascade {
  width: number
  height: number
  features: Int32Array
  stageThreshold: Float32Array
  stageCount: Int32Array
  featureIdx: Int32Array
  subsets: Int32Array
  leaves: Float32Array
}
export function parseCascade(xml: string): ParsedCascade
export function toJson(c: ParsedCascade): string
