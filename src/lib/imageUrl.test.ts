import { describe, expect, it } from 'vitest';
import { displayImageUrl } from '@/lib/imageUrl';

const stored = 'notiva-image://localhost/0123456789abcdef0123456789abcdef.png';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15';

describe('displayImageUrl', () => {
  it('keeps a stored image URL on macOS and Linux', () => {
    expect(displayImageUrl(stored, mac)).toBe(stored);
    expect(displayImageUrl(stored, linux)).toBe(stored);
  });

  it('serves a stored image URL through the http form on Windows', () => {
    expect(displayImageUrl(stored, windows)).toBe(
      'http://notiva-image.localhost/0123456789abcdef0123456789abcdef.png',
    );
  });

  it('leaves other URLs alone on every platform', () => {
    for (const url of [
      'gallery:sunset',
      'data:image/png;base64,AAAA',
      'https://example.com/a.png',
    ]) {
      expect(displayImageUrl(url, windows)).toBe(url);
    }
  });
});
