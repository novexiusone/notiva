import { Link } from '@tanstack/react-router';
import { Table } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDatabase, useRows, useSetCell } from '@/features/databases/api';
import {
  propertyTypeDefinition,
  type PropertyTypeDefinition,
} from '@/features/databases/properties/registry';
import { isSameValue } from '@/features/databases/table/layout';
import { usePages } from '@/features/pages/api';
import type { CellValue, Property } from '@/lib/commands';
import { cn } from '@/lib/utils';

/**
 * The link from a row's page back to its database. It carries no view of its
 * own, so the database shows the view that was active there last.
 */
export function DatabaseLink({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  // The page list is loaded for every page view, so this costs no request.
  const pages = usePages();
  const title = pages.data?.find((candidate) => candidate.id === databaseId)?.title ?? '';

  return (
    // Placed in the space above the title, so the title sits where it does on any page.
    <div className="-mt-8 mb-2 flex h-6 min-w-0 items-center">
      <Link
        to="/page/$pageId"
        params={{ pageId: databaseId }}
        search={{}}
        className={cn(
          'text-muted-foreground hover:bg-accent hover:text-foreground -mx-1.5 flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-sm outline-none',
          'focus-visible:ring-ring/60 focus-visible:ring-2',
        )}
      >
        <Table size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{title || t('pages.untitled')}</span>
      </Link>
    </div>
  );
}

type Shown = { property: Property; definition: PropertyTypeDefinition };

/**
 * The properties of a row on its page, in the database's order, each editable
 * with the editor its type uses in the table. It reads and writes the same
 * cached rows as the table, so both always show the same values.
 */
export function RowProperties({ rowId, databaseId }: { rowId: string; databaseId: string }) {
  const { t } = useTranslation();
  const database = useDatabase(databaseId);
  const rows = useRows(databaseId);
  const setCell = useSetCell(databaseId);
  const [editing, setEditing] = useState<string | null>(null);

  if (database.isError || rows.isError) {
    return (
      <p role="alert" className="text-muted-foreground mb-6 text-sm">
        {t('databases.row.loadFailed')}
      </p>
    );
  }
  if (!database.isSuccess) return null;

  // A type this version cannot show yet (relation) is left out, as in the table.
  const shown: Shown[] = [...database.data.properties]
    .sort((a, b) => a.position - b.position)
    .flatMap((property) => {
      const definition = propertyTypeDefinition(property.type);
      return definition ? [{ property, definition }] : [];
    });
  if (shown.length === 0) return null;

  const row = rows.data?.find((candidate) => candidate.id === rowId);
  // Loaded, but this row is not among the rows (deleted meanwhile): nothing to edit.
  if (rows.isSuccess && !row) return null;

  return (
    <div
      role="group"
      aria-label={t('databases.row.properties')}
      aria-busy={!row || undefined}
      className="mb-6"
    >
      <dl className="flex flex-col">
        {shown.map(({ property, definition }) => (
          <PropertyLine
            key={property.id}
            property={property}
            definition={definition}
            // While the rows load, the names are there and the values follow.
            value={row ? (row.cells[property.id] ?? null) : undefined}
            editing={editing === property.id}
            onEdit={() => setEditing(property.id)}
            onClose={() => setEditing(null)}
            onCommit={(next, current) => {
              if (!isSameValue(next, current)) setCell(rowId, property.id, next);
            }}
          />
        ))}
      </dl>
    </div>
  );
}

type PropertyLineProps = Shown & {
  /** `undefined` while the rows are still loading. */
  value: CellValue | undefined;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onCommit: (next: CellValue, current: CellValue) => void;
};

/**
 * One property: its name, and its value as a button that opens the editor in
 * place. Events from the editors' popovers reach it through React's portals;
 * they are left alone.
 */
function PropertyLine({
  property,
  definition: { icon: Icon, Display, Editor, isEmpty },
  value,
  editing,
  onEdit,
  onClose,
  onCommit,
}: PropertyLineProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const valueId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const loaded = value !== undefined;

  // A closed editor gives the focus back to its value, unless it went somewhere else.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const focused = document.activeElement;
      const isLost = focused === null || focused === document.body;
      if (isLost || ref.current?.contains(focused)) ref.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (editing || !loaded || !event.currentTarget.contains(event.target as Node)) return;
    onEdit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || editing || !loaded) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'F2') {
      event.preventDefault();
      onEdit();
    }
  };

  return (
    <div className="flex min-h-8 items-start gap-2">
      <dt
        id={nameId}
        title={property.name}
        className="text-muted-foreground flex h-8 w-[min(10rem,35%)] shrink-0 items-center gap-1.5 text-sm"
      >
        <Icon size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{property.name}</span>
      </dt>
      <dd className="min-w-0 flex-1">
        <div
          ref={ref}
          // Nothing to press while the value is loading or being edited.
          role={loaded && !editing ? 'button' : undefined}
          tabIndex={loaded ? (editing ? -1 : 0) : undefined}
          aria-labelledby={loaded && !editing ? `${nameId} ${valueId}` : undefined}
          data-editing={editing || undefined}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className={cn(
            'flex h-8 w-full min-w-0 items-center rounded-sm text-sm outline-none',
            'hover:bg-accent/60 focus-visible:ring-ring/60 focus-visible:ring-2',
            'data-editing:ring-ring/60 data-editing:ring-2 data-editing:hover:bg-transparent',
            !loaded && 'hover:bg-transparent',
          )}
        >
          {editing && loaded ? (
            <div
              className={cn(
                'flex h-full w-full min-w-0 items-center px-1',
                // A popover editor shows the value in its anchor, centred like the display.
                '[&>[data-slot=popover-anchor]]:flex [&>[data-slot=popover-anchor]]:items-center',
              )}
            >
              <Editor
                value={value}
                property={property}
                onCommit={(next) => {
                  // Every editor commits, also when nothing changed.
                  onCommit(next, value);
                  onClose();
                }}
                onCancel={onClose}
              />
            </div>
          ) : (
            <div id={valueId} className="flex h-full w-full min-w-0 items-center px-2">
              {!loaded ? null : isEmpty(value, property) ? (
                <span className="text-muted-foreground/60 truncate">
                  {t('databases.row.empty')}
                </span>
              ) : (
                <Display value={value} property={property} />
              )}
            </div>
          )}
        </div>
      </dd>
    </div>
  );
}
