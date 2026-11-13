import { invoke } from '@tauri-apps/api/core';

export type AppInfo = { name: string; version: string };

export type Page = {
  id: string;
  title: string;
  parentId: string | null;
  /** Orders the pages that share a parent. */
  position: number;
  /** A database is a page whose body is a table. */
  kind: 'page' | 'database';
  /** Set on the rows of a database, where it equals `parentId`. */
  databaseId: string | null;
};

/** A reference to a page: enough to show it in a list and open it. */
export type PageRef = { id: string; title: string };

/** What an export wrote. */
export type ExportSummary = { directory: string; pages: number; images: number };

/** A page found by search. */
export type SearchHit = {
  pageId: string;
  title: string;
  /** Text from the page that matches; `null` when only the title matched. */
  excerpt: { text: string; matched: boolean }[] | null;
};

/**
 * A block in the shape the editor uses. The frontend passes documents through
 * without interpreting them; how blocks are stored is the backend's business.
 */
export type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  /** Inline content. Absent for blocks without text. */
  content?: unknown;
  children: Block[];
};

export type PropertyType = 'text' | 'number' | 'date' | 'select' | 'relation';

/** The tints an option of a select can have. Each one is a theme variable. */
export const SELECT_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'red',
] as const;

/** `color` is one of `SELECT_COLORS`. */
export type SelectOption = { id: string; name: string; color: string };

/** A column of a database. The title of a row is not a property. */
export type Property = {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  position: number;
  /** Only filled for `select`. */
  options: SelectOption[];
  /** The database a `relation` points at, otherwise `null`. */
  targetId: string | null;
};

/**
 * text: string · number: number · date: `yyyy-MM-dd` · select: the id of an
 * option · relation: the ids of rows of the target database.
 */
export type CellValue = string | number | string[] | null;

export type Row = {
  id: string;
  title: string;
  position: number;
  /** Values by property id. An empty cell is `null` or left out. */
  cells: Record<string, CellValue>;
};

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'greaterThan'
  | 'lessThan'
  | 'before'
  | 'after'
  | 'isEmpty'
  | 'isNotEmpty';

export type ViewFilter = {
  propertyId: string;
  operator: FilterOperator;
  /** A date as `yyyy-MM-dd`, a select as the id of an option, a relation as the id of a row. */
  value: string | number | null;
};

export type ViewSort = { propertyId: string; direction: 'asc' | 'desc' };

/** The order of these entries is the order in which the properties are shown. */
export type ViewProperty = { propertyId: string; visible: boolean; width: number | null };

type ViewBase = {
  version: 1;
  filters: ViewFilter[];
  sorts: ViewSort[];
  properties: ViewProperty[];
};

export type ViewConfig =
  | (ViewBase & { type: 'table'; groupBy: { propertyId: string; collapsed: string[] } | null })
  | (ViewBase & { type: 'kanban'; groupPropertyId: string | null; hiddenGroups: string[] })
  | (ViewBase & { type: 'calendar'; datePropertyId: string | null });

/** One stored way of looking at a database. The title column has the property id `title`. */
export type View = {
  id: string;
  databaseId: string;
  name: string;
  position: number;
  config: ViewConfig;
};

export type Database = { page: Page; properties: Property[]; views: View[] };

/** The rows that point at a row through one relation property. */
export type IncomingRelation = { property: Property; rows: PageRef[] };

/** What a failed command rejects with. */
export type CommandError = {
  kind: 'not_found' | 'invalid' | 'internal';
  message: string;
};

/** The only place that calls into the Rust backend. */
export const commands = {
  appInfo: () => invoke<AppInfo>('app_info'),

  listPages: () => invoke<Page[]>('list_pages'),
  createPage: (parentId: string | null) => invoke<Page>('create_page', { parentId }),
  renamePage: (id: string, title: string) => invoke<Page>('rename_page', { id, title }),
  movePage: (id: string, parentId: string | null, index: number) =>
    invoke<void>('move_page', { id, parentId, index }),
  deletePage: (id: string) => invoke<void>('delete_page', { id }),

  loadBlocks: (pageId: string) => invoke<Block[]>('load_blocks', { pageId }),
  saveBlocks: (pageId: string, blocks: Block[]) => invoke<void>('save_blocks', { pageId, blocks }),

  createDatabase: (parentId: string | null) => invoke<Database>('create_database', { parentId }),
  loadDatabase: (id: string) => invoke<Database>('load_database', { id }),

  createProperty: (databaseId: string, name: string, type: PropertyType, targetId: string | null) =>
    invoke<Property>('create_property', { databaseId, name, type, targetId }),
  /** `null` leaves the name or the options as they are; `options` replaces the whole list. */
  updateProperty: (id: string, name: string | null, options: SelectOption[] | null) =>
    invoke<Property>('update_property', { id, name, options }),
  /** Removes the property and its value in every row. */
  deleteProperty: (id: string) => invoke<void>('delete_property', { id }),
  /** Removes the option; cells that held it become empty. */
  deleteSelectOption: (propertyId: string, optionId: string) =>
    invoke<void>('delete_select_option', { propertyId, optionId }),
  /** Converts every cell; values that cannot be converted are dropped. */
  changePropertyType: (id: string, type: PropertyType) =>
    invoke<Property>('change_property_type', { id, type }),

  /** The rows of a database in their manual order. */
  listRows: (databaseId: string) => invoke<Row[]>('list_rows', { databaseId }),
  createRow: (databaseId: string) => invoke<Row>('create_row', { databaseId }),
  /** `null` empties the cell. */
  setCell: (rowId: string, propertyId: string, value: CellValue) =>
    invoke<void>('set_cell', { rowId, propertyId, value }),
  /** The rows that point at a row, grouped by relation property. */
  listIncomingRelations: (rowId: string) =>
    invoke<IncomingRelation[]>('list_incoming_relations', { rowId }),

  /** The pages that link to a page. */
  listBacklinks: (pageId: string) => invoke<PageRef[]>('list_backlinks', { pageId }),

  search: (query: string) => invoke<SearchHit[]>('search', { query }),

  /** Exports a page with its subpages into a new folder inside `directory`. */
  exportPage: (pageId: string, directory: string) =>
    invoke<ExportSummary>('export_page', { pageId, directory }),
  /** Exports every page into a new folder inside `directory`. */
  exportAll: (directory: string) => invoke<ExportSummary>('export_all', { directory }),

  /** Stores an image and resolves to the URL to put into the image block. */
  saveImage: async (file: Blob) =>
    invoke<string>('save_image', new Uint8Array(await file.arrayBuffer())),
};
