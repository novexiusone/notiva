import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

/** The system colour scheme, for components that need it as a value rather than through CSS. */
export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () =>
    window.matchMedia?.(QUERY).matches ? 'dark' : 'light',
  );
}
