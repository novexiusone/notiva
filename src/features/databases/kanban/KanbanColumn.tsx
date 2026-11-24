import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SelectBadge } from '@/features/databases/properties/SelectBadge';
import type { TableColumn } from '@/features/databases/useDatabaseTable';
import type { Row, SelectOption } from '@/lib/commands';
import { KanbanCard } from './KanbanCard';

export function KanbanColumn({
  name,
  option,
  rows,
  properties,
  readOnly,
  onNew,
}: {
  name: string;
  option: SelectOption | null;
  rows: readonly Row[];
  properties: readonly TableColumn[];
  readOnly: boolean;
  onNew: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={name}
      className="bg-muted/40 border-border flex max-h-full w-72 shrink-0 flex-col rounded-lg border"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        {option ? (
          <SelectBadge option={option} />
        ) : (
          <span className="text-muted-foreground truncate text-sm font-medium">{name}</span>
        )}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">{rows.length}</span>
      </header>
      <div
        role="list"
        aria-label={name}
        className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2"
      >
        {rows.map((row) => (
          <KanbanCard key={row.id} row={row} properties={properties} />
        ))}
      </div>
      <button
        type="button"
        disabled={readOnly}
        onClick={onNew}
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 m-2 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus size={16} aria-hidden />
        {t('databases.table.newRow')}
      </button>
    </section>
  );
}
