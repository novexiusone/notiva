import type { ReactNode } from 'react';

export function MainArea({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </main>
  );
}
