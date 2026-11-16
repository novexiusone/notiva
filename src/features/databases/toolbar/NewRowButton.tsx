import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const part =
  'flex h-7 items-center bg-blue-600 text-sm font-medium text-white outline-none hover:bg-blue-500 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-blue-500';

/**
 * "New" adds a row. The arrow beside it is where templates will be chosen and
 * created; the menu is there, but offers nothing yet.
 */
export function NewRowButton({ onNewRow }: { onNewRow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="ml-1 flex items-center overflow-hidden rounded-md">
      <button
        type="button"
        aria-label={t('databases.toolbar.newRowLabel')}
        onClick={onNewRow}
        className={`${part} px-3`}
      >
        {t('databases.toolbar.newRow')}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`${part} border-l border-white/30 px-1.5`}
          aria-label={t('databases.toolbar.templates')}
        >
          <ChevronDown size={16} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-44">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {t('databases.toolbar.templates')}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled>{t('databases.toolbar.noTemplates')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>{t('databases.toolbar.newTemplate')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
