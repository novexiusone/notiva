import { invoke } from '@tauri-apps/api/core';

export type AppInfo = { name: string; version: string };

export type Page = {
  id: string;
  title: string;
  parentId: string | null;
  /** Orders the pages that share a parent. */
  position: number;
};

/** A reference to a page: enough to show it in a list and open it. */
export type PageRef = { id: string; title: string };

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

  /** The pages that link to a page. */
  listBacklinks: (pageId: string) => invoke<PageRef[]>('list_backlinks', { pageId }),

  search: (query: string) => invoke<SearchHit[]>('search', { query }),

  /** Stores an image and resolves to the URL to put into the image block. */
  saveImage: async (file: Blob) =>
    invoke<string>('save_image', new Uint8Array(await file.arrayBuffer())),
};
