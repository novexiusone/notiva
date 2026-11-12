import { useLayoutEffect, useState } from 'react';

type Size = { width: number; height: number };

/** Tracks the size of an element. The size is 0 while there is no element. */
export function useElementSize(element: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return size;
}
