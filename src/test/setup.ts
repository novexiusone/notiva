import '@testing-library/jest-dom/vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import '@/lib/i18n';

// jsdom leaves out a few browser APIs that Radix and the page tree rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) satisfies MediaQueryList;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.scrollTo ??= () => {};

// jsdom lays nothing out, so every element is 0 pixels in size. A scroll
// container (marked by an inline `overflow: auto`) gets the size of a window,
// so that the table's virtualiser renders the rows that would be visible.
for (const [name, size] of [
  ['clientWidth', 1024],
  ['clientHeight', 768],
] as const) {
  const native = Object.getOwnPropertyDescriptor(Element.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return this.style.overflow === 'auto' ? size : (native?.get?.call(this) ?? 0);
    },
  });
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  clearMocks();
  window.localStorage.clear();
});
