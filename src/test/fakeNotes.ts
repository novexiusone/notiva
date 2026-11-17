import type { CommandError, Note, NoteEntry } from '@/lib/commands';

const MAX_BYTES = 5 * 1024 * 1024;

export type NotesOptions = {
  /** The notes folder that is already chosen; `null` for none. */
  folder?: string | null;
  /** Files by relative path. Folders are the parts of these paths. */
  files?: Record<string, string>;
};

function fail(kind: CommandError['kind'], message: string): never {
  throw { kind, message } satisfies CommandError;
}

function validName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/:*?"<>|]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/[. ]$/.test(name)
  );
}

function checkPath(path: string): string[] {
  if (path === '') return [];
  const names = path.split('/');
  if (!names.every(validName)) fail('invalid', 'the path is not valid');
  return names;
}

const isMarkdown = (name: string) => name.length > 3 && name.toLowerCase().endsWith('.md');

/**
 * An in-memory notes folder with the rules of the backend's `notes` module.
 * Returns a handler for the notes commands, or `undefined` for any other.
 */
export function createFakeNotes({ folder = null, files = {} }: NotesOptions = {}) {
  let chosen = folder;
  const contents = new Map<string, { content: string; modified: number }>();
  const folders = new Set<string>();
  let clock = 1_700_000_000_000;

  const addFolders = (path: string) => {
    const parts = path.split('/').slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
  };
  const put = (path: string, content: string) => {
    clock += 1000;
    contents.set(path, { content, modified: clock });
    addFolders(path);
  };
  for (const [path, content] of Object.entries(files)) put(path, content);

  const requireFolder = () => {
    if (chosen === null) fail('not_found', 'no notes folder is chosen');
  };
  const requireFile = (path: string) => {
    requireFolder();
    checkPath(path);
    if (!isMarkdown(path.split('/').pop() ?? '')) {
      fail('invalid', 'only files ending in .md are supported');
    }
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent !== '' && !folders.has(parent)) fail('not_found', 'the folder was not found');
  };
  const existing = (path: string) => {
    requireFile(path);
    return contents.get(path) ?? fail('not_found', `"${path}" was not found`);
  };

  return (command: string, args: Record<string, unknown>): unknown => {
    switch (command) {
      case 'get_notes_folder':
        return chosen;

      case 'set_notes_folder':
        chosen = args.path as string;
        return chosen;

      case 'clear_notes_folder':
        chosen = null;
        return null;

      case 'list_notes': {
        requireFolder();
        const folderPath = args.folder as string;
        checkPath(folderPath);
        if (folderPath !== '' && !folders.has(folderPath)) {
          fail('not_found', `"${folderPath}" was not found`);
        }
        const prefix = folderPath === '' ? '' : `${folderPath}/`;
        const entries: NoteEntry[] = [];
        for (const path of folders) {
          const name = path.slice(prefix.length);
          if (path.startsWith(prefix) && !name.includes('/') && !name.startsWith('.')) {
            entries.push({ name, path, kind: 'folder', modified: clock, size: 0 });
          }
        }
        for (const [path, file] of contents) {
          const name = path.slice(prefix.length);
          if (path.startsWith(prefix) && !name.includes('/') && !name.startsWith('.')) {
            entries.push({
              name,
              path,
              kind: 'file',
              modified: file.modified,
              size: new TextEncoder().encode(file.content).length,
            });
          }
        }
        return entries.sort(
          (a, b) =>
            Number(a.kind === 'file') - Number(b.kind === 'file') ||
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
      }

      case 'read_note': {
        const path = args.path as string;
        const file = existing(path);
        return { path, content: file.content, modified: file.modified } satisfies Note;
      }

      case 'create_note': {
        const path = args.path as string;
        requireFile(path);
        if (contents.has(path)) fail('invalid', 'a file with this name already exists');
        put(path, '');
        return { path, content: '', modified: contents.get(path)!.modified } satisfies Note;
      }

      case 'save_note': {
        const path = args.path as string;
        const content = args.content as string;
        const expected = args.expectedModified as number | null;
        requireFile(path);
        if (new TextEncoder().encode(content).length > MAX_BYTES) {
          fail('invalid', 'the note is larger than 5 MiB');
        }
        if (expected !== null && contents.get(path)?.modified !== expected) {
          fail('conflict', 'the note changed on disk since it was loaded');
        }
        put(path, content);
        return { path, content, modified: contents.get(path)!.modified } satisfies Note;
      }

      case 'rename_note': {
        const path = args.path as string;
        const name = args.name as string;
        const file = existing(path);
        if (!validName(name) || !isMarkdown(name)) {
          fail('invalid', `"${name}" is not a valid note name`);
        }
        const folderPath = path.split('/').slice(0, -1).join('/');
        const target = folderPath === '' ? name : `${folderPath}/${name}`;
        if (target !== path && contents.has(target)) {
          fail('invalid', 'a file with this name already exists');
        }
        contents.delete(path);
        contents.set(target, file);
        return {
          name,
          path: target,
          kind: 'file',
          modified: file.modified,
          size: new TextEncoder().encode(file.content).length,
        } satisfies NoteEntry;
      }

      case 'delete_note': {
        const path = args.path as string;
        if (args.confirm !== true) fail('invalid', 'deleting a note needs a confirmation');
        existing(path);
        contents.delete(path);
        return null;
      }

      default:
        return undefined;
    }
  };
}
