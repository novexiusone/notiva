import { mockIPC } from '@tauri-apps/api/mocks';
import { canMove, childIds, descendantIds, movePage } from '@/features/pages/tree';
import {
  SELECT_COLORS,
  type Block,
  type CellValue,
  type CommandError,
  type Database,
  type IncomingRelation,
  type Page,
  type Property,
  type PropertyType,
  type Row,
  type SearchHit,
  type SelectOption,
  type View,
  type ViewConfig,
} from '@/lib/commands';

const STORAGE_KEY = 'notiva.fake.pages';
const BLOCKS_KEY = 'notiva.fake.blocks';
const DATABASES_KEY = 'notiva.fake.databases';

const PROPERTY_TYPES: PropertyType[] = ['text', 'number', 'date', 'select', 'relation'];

type Cells = Record<string, CellValue>;

/** What databases add to the pages: their columns, their views and the values of their rows. */
type DatabaseState = {
  properties: Property[];
  views: View[];
  /** Cell values by row id, then by property id. Empty cells are left out. */
  cells: Record<string, Cells>;
};

type Options = {
  /** Keep the data in localStorage so that it survives a reload. */
  persist?: boolean;
  pages?: Page[];
  /** Documents by page id. */
  blocks?: Record<string, Block[]>;
  properties?: Property[];
  views?: View[];
  /** Cell values by row id, then by property id. */
  cells?: Record<string, Cells>;
};

function byPosition(a: { position: number }, b: { position: number }) {
  return a.position - b.position;
}

/** The position that puts something after everything in `items`. */
function positionAfter(items: readonly { position: number }[]): number {
  return items.reduce((last, item) => Math.max(last, item.position + 1), 0);
}

/** Pages stored before databases existed have neither field. */
function withDatabaseFields(page: Page): Page {
  return { ...page, kind: page.kind ?? 'page', databaseId: page.databaseId ?? null };
}

/** Whether a value is a day of the calendar written as `yyyy-MM-dd`. */
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The number a text stands for, or `null` when it is not one. */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function isEmpty(value: CellValue | undefined): value is null | undefined {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/** The cells of a row with one of them set, or removed when the value is empty. */
function withCell(cells: Cells | undefined, propertyId: string, value: CellValue): Cells {
  const next = { ...cells };
  if (isEmpty(value)) delete next[propertyId];
  else next[propertyId] = value;
  return next;
}

/** A view without any mention of a property that is gone. */
function withoutProperty(config: ViewConfig, propertyId: string): ViewConfig {
  const kept = {
    filters: config.filters.filter((filter) => filter.propertyId !== propertyId),
    sorts: config.sorts.filter((sort) => sort.propertyId !== propertyId),
    properties: config.properties.filter((property) => property.propertyId !== propertyId),
  };

  switch (config.type) {
    case 'table':
      return {
        ...config,
        ...kept,
        groupBy: config.groupBy?.propertyId === propertyId ? null : config.groupBy,
      };
    case 'kanban':
      return config.groupPropertyId === propertyId
        ? { ...config, ...kept, groupPropertyId: null, hiddenGroups: [] }
        : { ...config, ...kept };
    case 'calendar':
      return {
        ...config,
        ...kept,
        datePropertyId: config.datePropertyId === propertyId ? null : config.datePropertyId,
      };
  }
}

/** Removes properties together with their values and what views say about them. */
function dropProperties(state: DatabaseState, gone: ReadonlySet<string>): DatabaseState {
  if (gone.size === 0) return state;

  return {
    properties: state.properties.filter((property) => !gone.has(property.id)),
    views: state.views.map((view) => ({
      ...view,
      config: [...gone].reduce(withoutProperty, view.config),
    })),
    cells: Object.fromEntries(
      Object.entries(state.cells).map(([rowId, cells]) => [
        rowId,
        Object.fromEntries(Object.entries(cells).filter(([propertyId]) => !gone.has(propertyId))),
      ]),
    ),
  };
}

/** Removes rows: their own values, and their id from every relation cell that held it. */
function dropRows(state: DatabaseState, gone: ReadonlySet<string>): DatabaseState {
  const cells: Record<string, Cells> = {};
  for (const [rowId, values] of Object.entries(state.cells)) {
    if (gone.has(rowId)) continue;
    cells[rowId] = Object.entries(values).reduce<Cells>(
      (kept, [propertyId, value]) =>
        withCell(
          kept,
          propertyId,
          Array.isArray(value) ? value.filter((id) => !gone.has(id)) : value,
        ),
      {},
    );
  }
  return { ...state, cells };
}

/** Lower case, without accents, the way the real analyzer folds text. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function blockTexts(document: Block[]): string[] {
  return document.flatMap((block) => {
    const inline = Array.isArray(block.content) ? (block.content as { text?: unknown }[]) : [];
    const text = inline.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
    return [text, ...blockTexts(block.children)];
  });
}

/** A small stand-in for the full-text search: every word has to start some word of the text. */
function search(pages: Page[], blocks: Record<string, Block[]>, query: string): SearchHit[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return [];

  const startsQueryWord = (token: string) => words.some((word) => fold(token).startsWith(word));
  const matches = (text: string) => {
    const tokens = fold(text).split(/[^\p{L}\p{N}]+/u);
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  };
  const excerptOf = (text: string) =>
    text
      .split(/([\p{L}\p{N}]+)/u)
      .filter((part) => part !== '')
      .map((part) => ({ text: part, matched: startsQueryWord(part) }));

  const hits = pages.map((page) => {
    const text = blockTexts(blocks[page.id] ?? []).find(matches);
    return {
      inTitle: matches(page.title),
      hit: { pageId: page.id, title: page.title, excerpt: text ? excerptOf(text) : null },
    };
  });

  return [
    ...hits.filter((entry) => entry.inTitle),
    ...hits.filter((entry) => !entry.inTitle && entry.hit.excerpt !== null),
  ]
    .map((entry) => entry.hit)
    .slice(0, 20);
}

/** Whether any block of a document contains a link to the page. */
function linksTo(document: Block[], pageId: string): boolean {
  const mentions = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(mentions);
    if (typeof value !== 'object' || value === null) return false;
    const node = value as { type?: unknown; props?: { pageId?: unknown } };
    if (node.type === 'pageLink' && node.props?.pageId === pageId) return true;
    return Object.values(value).some(mentions);
  };

  return document.some((block) => mentions(block.content) || linksTo(block.children, pageId));
}

/** Recognises an image by its first bytes, like the real backend. */
function imageType(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }
  return null;
}

function fail(kind: CommandError['kind'], message: string): never {
  // Commands reject with a plain object, exactly like the real backend.
  throw { kind, message } satisfies CommandError;
}

/**
 * An in-memory implementation of the backend commands, following the same
 * rules as the repository layer. For development and tests only.
 */
export function installFakeBackend({
  persist = false,
  pages: initial = [],
  blocks: initialBlocks = {},
  properties: initialProperties = [],
  views: initialViews = [],
  cells: initialCells = {},
}: Options = {}) {
  let pages: Page[] = initial;
  let blocks: Record<string, Block[]> = initialBlocks;
  let databases: DatabaseState = {
    properties: initialProperties,
    views: initialViews,
    cells: initialCells,
  };
  if (persist) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) pages = JSON.parse(stored) as Page[];
    const storedBlocks = window.localStorage.getItem(BLOCKS_KEY);
    if (storedBlocks !== null) blocks = JSON.parse(storedBlocks) as Record<string, Block[]>;
    const storedDatabases = window.localStorage.getItem(DATABASES_KEY);
    if (storedDatabases !== null) databases = JSON.parse(storedDatabases) as DatabaseState;
  }
  pages = pages.map(withDatabaseFields);

  const save = (next: Page[]) => {
    pages = next;
    if (persist) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
  };

  const saveBlocks = (next: Record<string, Block[]>) => {
    blocks = next;
    if (persist) window.localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks));
  };

  const saveDatabases = (next: DatabaseState) => {
    databases = next;
    if (persist) window.localStorage.setItem(DATABASES_KEY, JSON.stringify(databases));
  };

  const require = (id: string) => {
    const page = pages.find((candidate) => candidate.id === id);
    return page ?? fail('not_found', `page ${id} was not found`);
  };

  const requireDatabase = (id: string) => {
    const page = pages.find((candidate) => candidate.id === id);
    return page?.kind === 'database' ? page : fail('not_found', `database ${id} was not found`);
  };

  const requireRow = (id: string) => {
    const page = require(id);
    return page.databaseId === null ? fail('invalid', `page ${id} is not a row`) : page;
  };

  const requireProperty = (id: string) => {
    const property = databases.properties.find((candidate) => candidate.id === id);
    return property ?? fail('not_found', `property ${id} was not found`);
  };

  /** A database has rows, not subpages. */
  const requireParent = (id: string) => {
    if (require(id).kind === 'database') fail('invalid', 'a database cannot have subpages');
  };

  const requirePropertyType = (type: unknown) =>
    PROPERTY_TYPES.includes(type as PropertyType)
      ? (type as PropertyType)
      : fail('invalid', `${String(type)} is not a property type`);

  const propertiesOf = (databaseId: string) =>
    databases.properties.filter((property) => property.databaseId === databaseId).sort(byPosition);

  const rowsOf = (databaseId: string) =>
    pages.filter((page) => page.databaseId === databaseId).sort(byPosition);

  /** Stores a changed property and, with it, changed cells. */
  const saveProperty = (property: Property, cells = databases.cells) =>
    saveDatabases({
      ...databases,
      cells,
      properties: databases.properties.map((candidate) =>
        candidate.id === property.id ? property : candidate,
      ),
    });

  /** The cells of every row of a property's database after `convert` went over that property. */
  const convertCells = (property: Property, convert: (value: CellValue) => CellValue) => {
    const cells = { ...databases.cells };
    // In the order of the rows, so that what `convert` collects comes out in that order.
    for (const row of rowsOf(property.databaseId)) {
      const value = cells[row.id]?.[property.id];
      if (!isEmpty(value)) cells[row.id] = withCell(cells[row.id], property.id, convert(value));
    }
    return cells;
  };

  /**
   * The rows as a reader sees them: values of properties, options and rows
   * that no longer exist are skipped, so a missed clean-up breaks nothing.
   */
  const readRows = (databaseId: string): Row[] => {
    const properties = propertiesOf(databaseId);
    const targetRows = new Map(
      properties
        .filter((property) => property.type === 'relation')
        .map((property) => [
          property.id,
          new Set(rowsOf(property.targetId ?? '').map((row) => row.id)),
        ]),
    );

    return rowsOf(databaseId).map((page) => {
      const stored = databases.cells[page.id] ?? {};
      const cells: Cells = {};

      for (const property of properties) {
        const value = stored[property.id];
        if (isEmpty(value)) continue;
        if (property.type === 'select') {
          if (property.options.some((option) => option.id === value)) cells[property.id] = value;
        } else if (property.type === 'relation') {
          const rows = (value as string[]).filter((id) => targetRows.get(property.id)?.has(id));
          if (rows.length > 0) cells[property.id] = rows;
        } else {
          cells[property.id] = value;
        }
      }

      return { id: page.id, title: page.title, position: page.position, cells };
    });
  };

  /** Refuses a value that does not fit the property and returns what is stored for it. */
  const checkCell = (property: Property, value: unknown): CellValue => {
    if (value === null || value === undefined) return null;

    switch (property.type) {
      case 'text':
        return typeof value === 'string' ? value : fail('invalid', 'a text cell takes a string');
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
          ? value
          : fail('invalid', 'a number cell takes a number');
      case 'date':
        return isDate(value) ? value : fail('invalid', 'a date cell takes a date as yyyy-MM-dd');
      case 'select':
        return property.options.some((option) => option.id === value)
          ? (value as string)
          : fail('invalid', `${String(value)} is not an option of this property`);
      case 'relation': {
        if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
          fail('invalid', 'a relation cell takes a list of row ids');
        }
        const ids = value as string[];
        if (new Set(ids).size !== ids.length) {
          fail('invalid', 'a relation cell holds a row only once');
        }
        for (const id of ids) {
          if (pages.find((page) => page.id === id)?.databaseId !== property.targetId) {
            fail('invalid', `${id} is not a row of the target database`);
          }
        }
        return ids.length > 0 ? ids : null;
      }
    }
  };

  mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;

    switch (command) {
      case 'app_info':
        return { name: 'Notiva', version: '0.0.0-fake' };

      case 'list_pages':
        return [...pages].sort(byPosition);

      case 'create_page': {
        const parentId = (args.parentId as string | null | undefined) ?? null;
        if (parentId !== null) requireParent(parentId);
        const page: Page = {
          id: crypto.randomUUID(),
          title: '',
          parentId,
          position: childIds(pages, parentId).length,
          kind: 'page',
          databaseId: null,
        };
        save([...pages, page]);
        return page;
      }

      case 'rename_page': {
        const page = { ...require(args.id as string), title: args.title as string };
        save(pages.map((candidate) => (candidate.id === page.id ? page : candidate)));
        return page;
      }

      case 'move_page': {
        const id = args.id as string;
        const parentId = (args.parentId as string | null | undefined) ?? null;
        if (require(id).databaseId !== null) fail('invalid', 'a row cannot be moved');
        if (parentId !== null && require(parentId).kind === 'database') {
          fail('invalid', 'a page cannot be moved into a database');
        }
        if (!canMove(pages, id, parentId)) {
          fail('invalid', 'a page cannot be moved into itself or one of its subpages');
        }
        save(movePage(pages, id, parentId, args.index as number));
        return null;
      }

      case 'delete_page': {
        const id = args.id as string;
        require(id);
        const removed = new Set([id, ...descendantIds(pages, id)]);
        save(pages.filter((page) => !removed.has(page.id)));
        saveBlocks(
          Object.fromEntries(Object.entries(blocks).filter(([pageId]) => !removed.has(pageId))),
        );
        // A database takes its properties and views along, and the relations that point at it.
        const lostProperties = new Set(
          databases.properties
            .filter(
              (property) =>
                removed.has(property.databaseId) ||
                (property.targetId !== null && removed.has(property.targetId)),
            )
            .map((property) => property.id),
        );
        const remaining = dropRows(dropProperties(databases, lostProperties), removed);
        saveDatabases({
          ...remaining,
          views: remaining.views.filter((view) => !removed.has(view.databaseId)),
        });
        return null;
      }

      case 'create_database': {
        const parentId = (args.parentId as string | null | undefined) ?? null;
        if (parentId !== null) requireParent(parentId);
        const page: Page = {
          id: crypto.randomUUID(),
          title: '',
          parentId,
          position: childIds(pages, parentId).length,
          kind: 'database',
          databaseId: null,
        };
        const view: View = {
          id: crypto.randomUUID(),
          databaseId: page.id,
          name: 'Table',
          position: 0,
          config: {
            version: 1,
            type: 'table',
            filters: [],
            sorts: [],
            properties: [],
            groupBy: null,
          },
        };
        save([...pages, page]);
        saveDatabases({ ...databases, views: [...databases.views, view] });
        return { page, properties: [], views: [view] } satisfies Database;
      }

      case 'load_database': {
        const page = requireDatabase(args.id as string);
        return {
          page,
          properties: propertiesOf(page.id),
          views: databases.views.filter((view) => view.databaseId === page.id).sort(byPosition),
        } satisfies Database;
      }

      case 'create_property': {
        const database = requireDatabase(args.databaseId as string);
        const type = requirePropertyType(args.type);
        const targetId = (args.targetId as string | null | undefined) ?? null;
        if (type === 'relation') {
          if (targetId === null) fail('invalid', 'a relation needs a target database');
          requireDatabase(targetId);
        } else if (targetId !== null) {
          fail('invalid', 'only a relation has a target database');
        }
        const property: Property = {
          id: crypto.randomUUID(),
          databaseId: database.id,
          name: args.name as string,
          type,
          position: positionAfter(propertiesOf(database.id)),
          options: [],
          targetId,
        };
        saveDatabases({ ...databases, properties: [...databases.properties, property] });
        return property;
      }

      case 'update_property': {
        const property = requireProperty(args.id as string);
        const name = (args.name as string | null | undefined) ?? null;
        const options = (args.options as SelectOption[] | null | undefined) ?? null;
        if (options !== null) {
          if (property.type !== 'select') fail('invalid', 'only a select has options');
          const wellFormed = options.every(
            (option) =>
              typeof option.id === 'string' &&
              option.id !== '' &&
              typeof option.name === 'string' &&
              typeof option.color === 'string',
          );
          if (!wellFormed) fail('invalid', 'an option needs an id, a name and a colour');
          if (new Set(options.map((option) => option.id)).size !== options.length) {
            fail('invalid', 'two options cannot share an id');
          }
        }
        const updated: Property = {
          ...property,
          name: name ?? property.name,
          options:
            options?.map((option) => ({ id: option.id, name: option.name, color: option.color })) ??
            property.options,
        };
        saveProperty(updated);
        return updated;
      }

      case 'delete_property': {
        const property = requireProperty(args.id as string);
        saveDatabases(dropProperties(databases, new Set([property.id])));
        return null;
      }

      case 'delete_select_option': {
        const property = requireProperty(args.propertyId as string);
        const optionId = args.optionId as string;
        if (property.type !== 'select') fail('invalid', 'only a select has options');
        if (!property.options.some((option) => option.id === optionId)) {
          fail('not_found', `option ${optionId} was not found`);
        }
        saveProperty(
          { ...property, options: property.options.filter((option) => option.id !== optionId) },
          convertCells(property, (value) => (value === optionId ? null : value)),
        );
        return null;
      }

      case 'change_property_type': {
        const property = requireProperty(args.id as string);
        const type = requirePropertyType(args.type);
        if (type === property.type) return property;
        if (property.type === 'relation') fail('invalid', 'a relation cannot change its type');
        if (type === 'relation') fail('invalid', 'a property cannot become a relation');

        // Text that becomes a select gets one option per distinct text.
        const options: SelectOption[] = [];
        const optionFor = (name: string) => {
          let option = options.find((candidate) => candidate.name === name);
          if (!option) {
            const color = SELECT_COLORS[options.length % SELECT_COLORS.length]!;
            option = { id: crypto.randomUUID(), name, color };
            options.push(option);
          }
          return option.id;
        };

        const cells = convertCells(property, (value) => {
          if (type === 'text') {
            if (property.type !== 'select') return String(value);
            return property.options.find((option) => option.id === value)?.name || null;
          }
          // Only text can become anything else.
          if (property.type !== 'text' || typeof value !== 'string') return null;
          if (type === 'number') return parseNumber(value);
          if (type === 'date') return isDate(value.trim()) ? value.trim() : null;
          return value === '' ? null : optionFor(value);
        });

        const changed: Property = { ...property, type, options };
        saveProperty(changed, cells);
        return changed;
      }

      case 'list_rows':
        return readRows(requireDatabase(args.databaseId as string).id);

      case 'create_row': {
        const database = requireDatabase(args.databaseId as string);
        const page: Page = {
          id: crypto.randomUUID(),
          title: '',
          parentId: database.id,
          // After the last row, without touching the others.
          position: positionAfter(rowsOf(database.id)),
          kind: 'page',
          databaseId: database.id,
        };
        save([...pages, page]);
        return { id: page.id, title: page.title, position: page.position, cells: {} } satisfies Row;
      }

      case 'set_cell': {
        const row = requireRow(args.rowId as string);
        const property = requireProperty(args.propertyId as string);
        if (property.databaseId !== row.databaseId) {
          fail('invalid', 'the property does not belong to the database of the row');
        }
        const value = checkCell(property, args.value);
        saveDatabases({
          ...databases,
          cells: {
            ...databases.cells,
            [row.id]: withCell(databases.cells[row.id], property.id, value),
          },
        });
        return null;
      }

      case 'list_incoming_relations': {
        const row = requireRow(args.rowId as string);
        return databases.properties
          .filter(
            (property) => property.type === 'relation' && property.targetId === row.databaseId,
          )
          .sort(byPosition)
          .map((property) => ({
            property,
            rows: rowsOf(property.databaseId)
              .filter((source) => {
                const value = databases.cells[source.id]?.[property.id];
                return Array.isArray(value) && value.includes(row.id);
              })
              .map((source) => ({ id: source.id, title: source.title })),
          }))
          .filter((group) => group.rows.length > 0) satisfies IncomingRelation[];
      }

      case 'load_blocks': {
        const pageId = args.pageId as string;
        require(pageId);
        return blocks[pageId] ?? [];
      }

      case 'save_blocks': {
        const pageId = args.pageId as string;
        require(pageId);
        saveBlocks({ ...blocks, [pageId]: structuredClone(args.blocks as Block[]) });
        return null;
      }

      case 'list_backlinks': {
        const pageId = args.pageId as string;
        require(pageId);
        return pages
          .filter((page) => page.id !== pageId && linksTo(blocks[page.id] ?? [], pageId))
          .map((page) => ({ id: page.id, title: page.title }))
          .sort((a, b) => a.title.localeCompare(b.title));
      }

      case 'search':
        return search(pages, blocks, args.query as string);

      // The system folder dialog of the dialog plugin.
      case 'plugin:dialog|open':
        return window.localStorage.getItem('notiva.fake.dialog') === 'cancel'
          ? null
          : '/Users/demo/Documents';

      case 'export_page':
      case 'export_all': {
        if (window.localStorage.getItem('notiva.fake.export') === 'fail') {
          fail('internal', 'could not write the export: the disk is full');
        }
        const exported =
          command === 'export_all'
            ? pages.length
            : 1 + descendantIds(pages, require(args.pageId as string).id).length;
        // Nothing is written here; the real export is covered by the backend tests.
        return {
          directory: `${args.directory as string}/Notiva export`,
          pages: exported,
          images: 0,
        };
      }

      case 'save_image': {
        const bytes = payload as unknown as Uint8Array;
        const type = imageType(bytes);
        if (bytes.length > 20 * 1024 * 1024) fail('invalid', 'the image is larger than 20 MiB');
        if (type === null) {
          fail('invalid', 'only PNG, JPEG, GIF and WebP images are supported');
        }
        // The real backend returns a notiva-image URL; a data URL shows the same picture here.
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return `data:${type};base64,${btoa(binary)}`;
      }

      default:
        return fail('internal', `the fake backend does not implement ${command}`);
    }
  });
}
