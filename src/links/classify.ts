/** Binary / office docs. */
export const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)/i;
/** Static assets — not useful as page links. */
export const ASSET_EXTENSIONS = /\.(jpe?g|png|gif|webp|svg|mp4|mp3|css|js|ico|woff2?|ttf)(\?|$)/i;

export type LinkKind =
  | "internal"
  | "external"
  | "document"
  | "image"
  | "asset"
  | "other"
  | "non-http"
  | "skip";

/** Image file extensions (for scrape-all / check-links tagging). */
export const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|svg|ico|avif|bmp)(\?|$)/i;

export function normalizeUrl(url: string, includeQuery: boolean): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (!includeQuery) {
    parsed.search = "";
  }
  let pathname = parsed.pathname;
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, "");
  }
  parsed.pathname = pathname || "/";
  return parsed.toString();
}
