import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Home, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from '@/components/layout/SidebarItem';
import { PageTree } from '@/features/pages/PageTree';
import { commands } from '@/lib/commands';

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const appInfo = useQuery({ queryKey: ['app-info'], queryFn: commands.appInfo, retry: false });

  return (
    <aside className="bg-sidebar flex w-60 shrink-0 flex-col border-r select-none">
      {/* Leaves room for the window controls and lets the window be dragged. */}
      <div data-tauri-drag-region className="h-11 shrink-0" />

      <nav className="flex flex-col gap-px px-2">
        <SidebarItem icon={Search} label={t('sidebar.search')} hint="⌘K" onClick={onSearch} />
        <SidebarItem icon={Home} label={t('sidebar.home')} onClick={() => navigate({ to: '/' })} />
      </nav>

      <PageTree />

      <footer className="flex items-center gap-2 border-t p-2">
        <div className="min-w-0 flex-1">
          <SidebarItem icon={Settings} label={t('sidebar.settings')} />
        </div>
        {appInfo.data ? (
          <span className="text-muted-foreground pr-2 text-xs tabular-nums opacity-70">
            v{appInfo.data.version}
          </span>
        ) : null}
      </footer>
    </aside>
  );
}
