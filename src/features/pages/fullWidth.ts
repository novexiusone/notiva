import { useSyncExternalStore } from 'react';

/**
 * Which pages use the whole width of the window instead of the reading column.
 * Remembered on this machine only, like the other view state.
 */
const KEY = 'notiva.fullWidthPages';
const listeners = new Set<() => void>();

function read(): Record<string, true> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, true>) : {};
  } catch {
    return {};
  }
}

let snapshot = read();

export function setFullWidth(pageId: string, full: boolean) {
  const next = { ...snapshot };
  if (full) next[pageId] = true;
  else delete next[pageId];
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember the width is not worth interrupting anyone.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFullWidth(pageId: string) {
  return useSyncExternalStore(subscribe, () => snapshot[pageId] === true);
}
