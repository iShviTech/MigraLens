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

export interface ClassifiedLink {
  kind: LinkKind;
  /** Absolute normalized URL when the link should be probed or tracked. */
  url: string | null;
}

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

/**
 * Classify an absolute `a[href]` for broken-link checking.
 * External http(s) links are kept when `includeExternal` is true.
 */
export function classifyLinkForCheck(
  href: string,
  origin: string,
  options: { includeQuery: boolean; includeExternal: boolean }
): ClassifiedLink {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#" || trimmed.startsWith("#")) {
    return { kind: "skip", url: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: "skip", url: null };
  }

  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) {
    return { kind: "non-http", url: parsed.toString() };
  }

  if (ASSET_EXTENSIONS.test(parsed.pathname)) {
    return { kind: "skip", url: null };
  }

  const url = normalizeUrl(parsed.toString(), options.includeQuery);
  const isExternal = parsed.origin !== origin;

  if (DOCUMENT_EXTENSIONS.test(parsed.pathname)) {
    if (isExternal && !options.includeExternal) {
      return { kind: "skip", url: null };
    }
    return { kind: "document", url };
  }

  if (isExternal) {
    if (!options.includeExternal) {
      return { kind: "skip", url: null };
    }
    return { kind: "external", url };
  }

  return { kind: "internal", url };
}
