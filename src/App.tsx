import { Outlet } from '@tanstack/react-router';
import { MainArea } from '@/components/layout/MainArea';
import { Sidebar } from '@/components/layout/Sidebar';

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <MainArea>
        <Outlet />
      </MainArea>
    </div>
  );
}
