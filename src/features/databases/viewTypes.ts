import { CalendarDays, SquareKanban, Table2, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { KanbanView } from '@/features/databases/kanban/KanbanView';
import { CalendarView } from '@/features/databases/calendar/CalendarView';
import { TableView } from '@/features/databases/table/TableView';
import type { Database, Row, View, ViewConfig } from '@/lib/commands';

export type ViewType = ViewConfig['type'];

/** What every view type's renderer gets. */
export type ViewRendererProps = {
  database: Database;
  rows: Row[];
  view: View | null;
  readOnly?: boolean;
  onConfigChange: (config: ViewConfig) => void;
};

/** The icon of each type, also of one this version cannot show yet. */
export const viewTypeIcons: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: SquareKanban,
  calendar: CalendarDays,
};

type ViewTypeDefinition = {
  Renderer: ComponentType<ViewRendererProps>;
  /** Whether the toolbar offers grouping; kanban and calendar have their own. */
  grouping: boolean;
};

/**
 * The view types this version can show. A stored view of another type is
 * listed in the tabs but shows a notice. #66 (calendar) adds its entry separately.
 */
const definitions: Partial<Record<ViewType, ViewTypeDefinition>> = {
  table: { Renderer: TableView, grouping: true },
  kanban: { Renderer: KanbanView, grouping: false },
  calendar: { Renderer: CalendarView, grouping: false },
};

/** The types that can be added, in the order they are offered. */
export const viewTypes = Object.keys(definitions) as ViewType[];

/** `undefined` for a type this version cannot show yet. */
export function viewTypeDefinition(type: ViewType): ViewTypeDefinition | undefined {
  return definitions[type];
}
