import { Outlet } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { MainArea } from '@/components/layout/MainArea';
import { Sidebar } from '@/components/layout/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUndoFocusGuard } from '@/features/editor/useUndoFocusGuard';
import { useNoBackNavigation } from '@/lib/useNoBackNavigation';
import { SearchDialog } from '@/features/search/SearchDialog';
import { useSearchShortcut } from '@/features/search/useSearchShortcut';

export function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(useCallback(() => setSearchOpen((open) => !open), []));
  useUndoFocusGuard();
  useNoBackNavigation();

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <Sidebar onSearch={() => setSearchOpen(true)} />
        <MainArea>
          <Outlet />
        </MainArea>
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
