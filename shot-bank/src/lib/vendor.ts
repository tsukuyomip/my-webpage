/**
 * 自前配信している実行資材（public/vendor、scripts/copy-assets.mjs が置く）の絶対 URL。
 * 絶対でなければならない。tesseract のワーカは blob: URL から動くので、
 * 相対パスだとこのオリジンに解決されない。
 */
export const vendorUrl = (path: string): string =>
  new URL(`${import.meta.env.BASE_URL}vendor/${path}`, location.origin).href
