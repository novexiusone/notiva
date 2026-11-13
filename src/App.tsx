import { Outlet } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { MainArea } from '@/components/layout/MainArea';
import { Sidebar } from '@/components/layout/Sidebar';
import { SearchDialog } from '@/features/search/SearchDialog';
import { useSearchShortcut } from '@/features/search/useSearchShortcut';

export function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(useCallback(() => setSearchOpen((open) => !open), []));

  return (
    <div className="flex h-full">
      <Sidebar onSearch={() => setSearchOpen(true)} />
      <MainArea>
        <Outlet />
      </MainArea>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
