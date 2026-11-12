import { invoke } from '@tauri-apps/api/core';

export type AppInfo = { name: string; version: string };

export type Page = {
  id: string;
  title: string;
  parentId: string | null;
  /** Orders the pages that share a parent. */
  position: number;
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
};
