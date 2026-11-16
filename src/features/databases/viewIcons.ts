import { useSyncExternalStore } from 'react';

/**
 * The icon or emoji chosen for a view, by view id. Remembered on this machine
 * only: a view's stored settings have no field for it yet.
 */
const KEY = 'notiva.viewIcons';
const listeners = new Set<() => void>();

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let snapshot = read();

/** `null` goes back to the icon of the view's type. */
export function setViewIcon(viewId: string, icon: string | null) {
  const next = { ...snapshot };
  if (icon === null) delete next[viewId];
  else next[viewId] = icon;
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember an icon is not worth interrupting anyone.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewIcon(viewId: string): string | null {
  return useSyncExternalStore(subscribe, () => snapshot[viewId] ?? null);
}
