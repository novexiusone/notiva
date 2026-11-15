import { useEffect } from 'react';

/**
 * Backspace with the focus on something that cannot be typed into makes
 * WebKit go back a page. Nothing in the app wants that: after a click on a
 * button or after a drag the focus is often on the page itself.
 */
export function useNoBackNavigation() {
  useEffect(() => {
    const guard = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' || event.defaultPrevented) return;
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select'));
      if (!editable) event.preventDefault();
    };

    document.addEventListener('keydown', guard);
    return () => document.removeEventListener('keydown', guard);
  }, []);
}
