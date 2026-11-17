const STORED = 'notiva-image://localhost/';

/**
 * The URL a stored image is loaded from. Images are stored as
 * `notiva-image://localhost/<name>`, which is the same on every platform.
 * WebView2 on Windows cannot load a custom scheme directly; it serves it as
 * `http://notiva-image.localhost/<name>`. Other URLs are returned unchanged.
 */
export function displayImageUrl(
  url: string,
  userAgent: string = globalThis.navigator?.userAgent ?? '',
): string {
  if (!url.startsWith(STORED) || !/\bWindows\b/.test(userAgent)) {
    return url;
  }
  return `http://notiva-image.localhost/${url.slice(STORED.length)}`;
}
