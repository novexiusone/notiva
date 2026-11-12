/**
 * Small pieces of view state that are remembered on this machine only.
 * Everything here is a convenience: the app works when storage is unavailable.
 */

const LAST_PAGE = 'notiva.lastPage';
const OPEN_PAGES = 'notiva.openPages';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not being able to remember view state is not worth interrupting anyone.
  }
}

export function lastPage(): string | null {
  return read(LAST_PAGE);
}

export function rememberLastPage(id: string | null) {
  write(LAST_PAGE, id);
}

/** Which rows of the page tree are expanded. */
export function openPages(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(read(OPEN_PAGES) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function rememberOpenPage(id: string, open: boolean) {
  const state = openPages();
  if (open) state[id] = true;
  else delete state[id];
  write(OPEN_PAGES, JSON.stringify(state));
}
