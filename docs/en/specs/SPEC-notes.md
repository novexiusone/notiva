# Spec: notes

## Objective

Besides its pages, Notiva can work with a folder of plain Markdown files that the user already has: a notes folder. The user chooses one directory; its `.md` files are listed, read, created, edited, renamed and deleted as ordinary files. They are not pages: the database never stores their content, and no file is imported, converted or indexed. This module is the backend only; the top bar that uses it is #133.

## Behaviour

- **Choosing the folder.** The user picks one directory with the system's folder dialog (`tauri-plugin-dialog`, frontend side). `set_notes_folder` checks that it is a readable directory and remembers it. There is at most one notes folder. `clear_notes_folder` forgets it and touches no file.
- **Remembering.** The choice is stored in the app's settings file `settings.json` in the app data directory, next to the database and never inside it. If the remembered directory no longer exists, `get_notes_folder` reports no folder; the setting is kept, so a directory on a drive that is unmounted for a while comes back by itself.
- **Listing.** `list_notes` lists one directory level: the subfolders and the `.md` files (extension compared case-insensitively) of the notes folder or of a subfolder, folders first, each group sorted by name ignoring case. Other files, hidden entries (names starting with a dot, which includes the app's own temporary files) and symbolic links are not listed. Subfolders are listed lazily, one level per call.
- **Reading.** `read_note` returns the file's text and its modified time. A file larger than 5 MiB is not read. A file that is not valid UTF-8 is not read.
- **Creating.** `create_note` creates an empty file at a path whose parent folder exists. It never overwrites.
- **Saving.** `save_note` replaces the content atomically: the text is written to a temporary file in the same directory, flushed, and then renamed over the target, so the file is always either the old or the new content. The rename replaces an existing file on macOS, Linux and Windows. The new content is limited to 5 MiB.
- **External changes.** Every read and write returns the file's modified time in milliseconds. `save_note` takes the time the editor last saw (`expectedModified`). When the file on disk has another modified time, or no longer exists, nothing is written and the command fails with a `conflict`. The frontend then reloads or asks the user. Passing `null` saves without the check. A change within the same millisecond as the last save is not detected.
- **Renaming.** `rename_note` renames a file inside its own folder. The new name must end with `.md` and must not exist yet; the file is never moved to another folder and never overwritten.
- **Deleting.** `delete_note` removes a file. No trash crate is vetted for the project yet, so the deletion is permanent, and the command refuses unless `confirm` is `true`. The frontend must show a confirmation before it sets that flag. Folders are never deleted.
- **Platforms.** Works on macOS, Windows and Linux. Paths cross the command boundary as relative paths with `/` as separator, whatever the platform; the backend converts them.

### Path safety

Nothing outside the chosen folder is ever read, written, listed or renamed. A path from the frontend is untrusted.

1. It must be relative, use `/` only and consist of plain names: no empty parts, no `.` or `..`, no drive or root prefix, no backslash, no NUL or other control characters. The empty path means the notes folder itself, for listing only.
2. Every name must be a valid file name on every platform: at most 255 bytes, none of `\ / : * ? " < > |`, no trailing dot or space, and not a name reserved on Windows (`CON`, `NUL`, `COM1`, and so on, with or without extension).
3. The notes folder and the part of the path that exists are canonicalised; the result must lie inside the canonical notes folder. This catches symbolic links, junctions and case tricks.
4. A file that is written, renamed or deleted must not itself be a symbolic link, even one that points inside the folder.
5. Files that are written or created must end with `.md`; the stem must not be empty.

## Commands

| Command              | Arguments                                                             | Returns          |
| -------------------- | --------------------------------------------------------------------- | ---------------- |
| `get_notes_folder`   |                                                                       | `string \| null` |
| `set_notes_folder`   | `path: string`                                                        | `string`         |
| `clear_notes_folder` |                                                                       |                  |
| `list_notes`         | `folder: string`, `""` for the notes folder                           | `NoteEntry[]`    |
| `read_note`          | `path: string`                                                        | `Note`           |
| `create_note`        | `path: string`                                                        | `Note`           |
| `save_note`          | `path: string`, `content: string`, `expectedModified: number \| null` | `Note`           |
| `rename_note`        | `path: string`, `name: string`                                        | `NoteEntry`      |
| `delete_note`        | `path: string`, `confirm: boolean`                                    |                  |

```ts
type NoteEntry = {
  name: string; // file name, with extension
  path: string; // relative to the notes folder, "/" separated
  kind: 'file' | 'folder';
  modified: number; // ms since the epoch
  size: number; // bytes, 0 for folders
};
type Note = { path: string; content: string; modified: number };
```

`set_notes_folder` returns the path as the user chose it. Errors use `CommandError`; this module adds the kind `conflict`.

## Errors

| Situation                                                   | Kind        |
| ----------------------------------------------------------- | ----------- |
| No notes folder chosen, file or folder missing              | `not_found` |
| Path outside the folder, malformed path or name, not `.md`  | `invalid`   |
| Too large, not UTF-8, target exists, delete without confirm | `invalid`   |
| The file changed on disk since `expectedModified`           | `conflict`  |
| Any other I/O failure (permissions, disk full)              | `internal`  |

Messages are plain English and never contain the notes folder's absolute path. A failed save leaves the old content in place and removes its temporary file.

## Project structure

```
src-tauri/src/notes/
  path.rs       → validation and resolution of relative paths
  settings.rs   → remembering the chosen folder in settings.json
  mod.rs        → list, read, create, save, rename, delete on a root directory
src-tauri/src/commands/notes.rs
src/lib/commands.ts     → bindings
src/test/fakeBackend.ts → in-memory notes folder
```

## Testing strategy

- **Unit tests** for path validation: `..`, absolute paths, backslashes, reserved and invalid names, empty parts, non-`.md` names.
- **Integration tests** in temporary directories: list order and filtering, read, create without overwrite, atomic save leaves no temporary file, conflict detection, rename, delete with and without confirmation, size limit, non-UTF-8 files.
- **Safety tests**: `..` traversal, an absolute path, a symbolic link to a folder outside, a symbolic link to a file outside (read, write, delete, list), a symbolic link inside the folder as write target. Symbolic link tests run on Unix.
- **Settings tests**: remembering, a missing directory, a corrupt settings file.
- **Frontend unit tests** run the same commands against the fake backend's in-memory folder.

## Boundaries

- **Always:** Resolve and check every path before touching the disk. Write atomically.
- **Ask first:** Moving to the OS trash (new crate), recursive folders, other file types.
- **Never:** Store note content in the database. Touch anything outside the notes folder. Return absolute paths of files to the frontend.

## Open questions

- Delete to the OS trash once a small, vetted crate is chosen; `confirm` can then be dropped.
- Watching the folder for changes instead of checking at read and save time.
- Creating and renaming subfolders.
