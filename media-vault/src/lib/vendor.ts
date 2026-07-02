/**
 * Absolute URL of the self-hosted runtime assets (public/vendor, populated by
 * scripts/copy-assets.mjs). Must be absolute: the Tesseract worker runs from a
 * blob: URL, where relative paths would not resolve against this origin.
 */
export const vendorUrl = (path: string): string =>
  new URL(`${import.meta.env.BASE_URL}vendor/${path}`, location.origin).href
