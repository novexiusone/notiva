import { useQuery } from '@tanstack/react-query';
import { Home, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from '@/components/layout/SidebarItem';
import { commands } from '@/lib/commands';

export function Sidebar() {
  const { t } = useTranslation();
  const appInfo = useQuery({ queryKey: ['app-info'], queryFn: commands.appInfo, retry: false });

  return (
    <aside className="bg-sidebar flex w-60 shrink-0 flex-col border-r select-none">
      {/* Leaves room for the window controls and lets the window be dragged. */}
      <div data-tauri-drag-region className="h-11 shrink-0" />

      <nav className="flex flex-col gap-px px-2">
        <SidebarItem icon={Search} label={t('sidebar.search')} hint="⌘K" />
        <SidebarItem icon={Home} label={t('sidebar.home')} />
      </nav>

      <section className="mt-5 flex min-h-0 flex-1 flex-col px-2">
        <h2 className="text-muted-foreground px-2 pb-1 text-xs font-medium">
          {t('sidebar.pages')}
        </h2>
        <p className="text-muted-foreground px-2 py-1 text-sm opacity-70">{t('sidebar.noPages')}</p>
      </section>

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
