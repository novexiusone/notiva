import { useState, type ReactNode } from 'react';
import { TopBarSlot } from '@/components/layout/topBarSlot';

export function MainArea({ children }: { children: ReactNode }) {
  const [topBar, setTopBar] = useState<HTMLElement | null>(null);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* Also leaves room for the window controls and lets the window be dragged. */}
      <div data-tauri-drag-region ref={setTopBar} className="flex h-11 shrink-0 items-center" />
      <TopBarSlot.Provider value={topBar}>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </TopBarSlot.Provider>
    </main>
  );
}
