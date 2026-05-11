/**
 * @module icon-registry
 * @role Client-side SVG icon cache for customizable icons loaded from Fusion Home.
 *
 * Fusion Home stores the full Material Symbols set at material-symbols/{style}/.
 * This module fetches them on demand and caches the SVG strings in RAM so
 * renders are instant after the first load.
 *
 * Non-customizable icons (panels, UI chrome, agents) stay font-based.
 * Only workspace icons and future customizable surfaces use this registry.
 */

const SVG_CACHE = new Map<string, string>();
const PENDING = new Map<string, Promise<string | null>>();

const DEFAULT_STYLE = 'outlined';

function cacheKey(name: string, style: string, filled: boolean): string {
  return `${style}:${name}${filled ? '-fill' : ''}`;
}

function svgUrl(name: string, style: string, filled: boolean): string {
  const variant = filled ? `${name}-fill` : name;
  return `/material-symbols/${style}/${variant}.svg`;
}

/**
 * Fetch a single SVG and cache it.
 */
async function fetchSvg(name: string, style: string, filled: boolean): Promise<string | null> {
  const key = cacheKey(name, style, filled);
  if (SVG_CACHE.has(key)) return SVG_CACHE.get(key)!;

  const url = svgUrl(name, style, filled);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const svg = await res.text();
    SVG_CACHE.set(key, svg);
    return svg;
  } catch {
    return null;
  }
}

/**
 * Load an icon into the cache. Returns the cached SVG string or null.
 * Safe to call repeatedly — deduped by pending promise.
 */
export async function loadIcon(name: string, style = DEFAULT_STYLE, filled = false): Promise<string | null> {
  const key = cacheKey(name, style, filled);
  const cached = SVG_CACHE.get(key);
  if (cached !== undefined) return cached;

  const existing = PENDING.get(key);
  if (existing) return existing;

  const promise = fetchSvg(name, style, filled).finally(() => {
    PENDING.delete(key);
  });
  PENDING.set(key, promise);
  return promise;
}

/**
 * Preload a batch of icons in parallel. Use on workspace:init or switch
 * so icons are in RAM before the UI tries to render them.
 */
export function preloadIcons(names: string[], style = DEFAULT_STYLE, filled = false): Promise<(string | null)[]> {
  return Promise.all(names.map((n) => loadIcon(n, style, filled)));
}

/**
 * Get a cached icon synchronously. Returns null if not yet loaded.
 * The caller should trigger loadIcon() and re-render when it resolves.
 */
export function getCachedIcon(name: string, style = DEFAULT_STYLE, filled = false): string | null {
  return SVG_CACHE.get(cacheKey(name, style, filled)) ?? null;
}

/**
 * Check if an icon is already cached.
 */
export function hasIcon(name: string, style = DEFAULT_STYLE, filled = false): boolean {
  return SVG_CACHE.has(cacheKey(name, style, filled));
}

/**
 * Clear the entire cache. Useful when the user swaps icon sets.
 */
export function clearIconCache(): void {
  SVG_CACHE.clear();
  PENDING.clear();
}
