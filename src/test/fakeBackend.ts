import { mockIPC } from '@tauri-apps/api/mocks';
import { canMove, childIds, descendantIds, movePage } from '@/features/pages/tree';
import type { Block, CommandError, Page } from '@/lib/commands';

const STORAGE_KEY = 'notiva.fake.pages';
const BLOCKS_KEY = 'notiva.fake.blocks';

type Options = {
  /** Keep the data in localStorage so that it survives a reload. */
  persist?: boolean;
  pages?: Page[];
  /** Documents by page id. */
  blocks?: Record<string, Block[]>;
};

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
}: Options = {}) {
  let pages: Page[] = initial;
  let blocks: Record<string, Block[]> = initialBlocks;
  if (persist) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) pages = JSON.parse(stored) as Page[];
    const storedBlocks = window.localStorage.getItem(BLOCKS_KEY);
    if (storedBlocks !== null) blocks = JSON.parse(storedBlocks) as Record<string, Block[]>;
  }

  const save = (next: Page[]) => {
    pages = next;
    if (persist) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
  };

  const saveBlocks = (next: Record<string, Block[]>) => {
    blocks = next;
    if (persist) window.localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks));
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
        saveBlocks(
          Object.fromEntries(Object.entries(blocks).filter(([pageId]) => !removed.has(pageId))),
        );
        return null;
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
