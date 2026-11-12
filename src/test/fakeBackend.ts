import { mockIPC } from '@tauri-apps/api/mocks';
import { canMove, childIds, descendantIds, movePage } from '@/features/pages/tree';
import type { CommandError, Page } from '@/lib/commands';

const STORAGE_KEY = 'notiva.fake.pages';

type Options = {
  /** Keep the data in localStorage so that it survives a reload. */
  persist?: boolean;
  pages?: Page[];
};

function fail(kind: CommandError['kind'], message: string): never {
  // Commands reject with a plain object, exactly like the real backend.
  throw { kind, message } satisfies CommandError;
}

/**
 * An in-memory implementation of the backend commands, following the same
 * rules as the repository layer. For development and tests only.
 */
export function installFakeBackend({ persist = false, pages: initial = [] }: Options = {}) {
  let pages: Page[] = initial;
  if (persist) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) pages = JSON.parse(stored) as Page[];
  }

  const save = (next: Page[]) => {
    pages = next;
    if (persist) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
  };

  const require = (id: string) => {
    const page = pages.find((candidate) => candidate.id === id);
    return page ?? fail('not_found', `page ${id} was not found`);
  };

  mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;

    switch (command) {
      case 'app_info':
        return { name: 'Notiva', version: '0.0.0-fake' };

      case 'list_pages':
        return [...pages].sort((a, b) => a.position - b.position);

      case 'create_page': {
        const parentId = (args.parentId as string | null | undefined) ?? null;
        if (parentId !== null) require(parentId);
        const page: Page = {
          id: crypto.randomUUID(),
          title: '',
          parentId,
          position: childIds(pages, parentId).length,
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
        require(id);
        if (parentId !== null) require(parentId);
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
        return null;
      }

      default:
        return fail('internal', `the fake backend does not implement ${command}`);
    }
  });
}
