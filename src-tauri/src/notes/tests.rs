use std::fs;

use tempfile::TempDir;

use super::*;

fn folder() -> TempDir {
    tempfile::tempdir().unwrap()
}

fn names(entries: &[NoteEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

fn is_invalid<T: std::fmt::Debug>(result: Result<T, NotesError>) -> bool {
    matches!(result, Err(NotesError::Invalid(_)))
}

#[test]
fn lists_folders_first_then_markdown_files_and_hides_the_rest() {
    let dir = folder();
    let root = dir.path();
    fs::write(root.join("b.md"), "b").unwrap();
    fs::write(root.join("A.md"), "a").unwrap();
    fs::write(root.join("note.txt"), "x").unwrap();
    fs::write(root.join(".hidden.md"), "x").unwrap();
    fs::write(root.join(".notiva-1.tmp"), "x").unwrap();
    fs::create_dir(root.join("zeta")).unwrap();
    fs::create_dir(root.join("Alpha")).unwrap();
    fs::create_dir(root.join(".git")).unwrap();
    fs::write(root.join("Alpha").join("inner.md"), "i").unwrap();

    let entries = list(root, "").unwrap();
    assert_eq!(names(&entries), ["Alpha", "zeta", "A.md", "b.md"]);
    assert_eq!(entries[0].kind, EntryKind::Folder);
    assert_eq!(entries[2].size, 1);

    let inner = list(root, "Alpha").unwrap();
    assert_eq!(inner[0].path, "Alpha/inner.md");
}

#[test]
fn listing_a_file_or_a_missing_folder_fails() {
    let dir = folder();
    fs::write(dir.path().join("a.md"), "").unwrap();

    assert!(is_invalid(list(dir.path(), "a.md")));
    assert!(matches!(
        list(dir.path(), "missing"),
        Err(NotesError::NotFound(_))
    ));
}

#[test]
fn reads_a_note_with_its_modified_time() {
    let dir = folder();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/a.md"), "# Hello\n").unwrap();

    let note = read(dir.path(), "sub/a.md").unwrap();
    assert_eq!(note.content, "# Hello\n");
    assert_eq!(note.path, "sub/a.md");
    assert!(note.modified > 0);
}

#[test]
fn read_refuses_other_extensions_missing_large_and_binary_files() {
    let dir = folder();
    let root = dir.path();
    fs::write(root.join("a.txt"), "x").unwrap();
    fs::write(root.join("bin.md"), [0xff, 0xfe, 0x00]).unwrap();
    fs::write(root.join("big.md"), vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
    fs::write(root.join("limit.md"), vec![b'x'; MAX_BYTES as usize]).unwrap();
    fs::create_dir(root.join("dir.md")).unwrap();

    assert!(is_invalid(read(root, "a.txt")));
    assert!(matches!(
        read(root, "missing.md"),
        Err(NotesError::NotFound(_))
    ));
    assert!(matches!(read(root, "bin.md"), Err(NotesError::NotText)));
    assert!(matches!(read(root, "big.md"), Err(NotesError::TooLarge)));
    assert!(read(root, "limit.md").is_ok());
    assert!(is_invalid(read(root, "dir.md")));
}

#[test]
fn creates_an_empty_note_and_never_overwrites() {
    let dir = folder();
    fs::create_dir(dir.path().join("sub")).unwrap();

    let note = create(dir.path(), "sub/new.md").unwrap();
    assert_eq!(note.content, "");
    assert!(dir.path().join("sub/new.md").is_file());

    fs::write(dir.path().join("sub/new.md"), "mine").unwrap();
    assert!(matches!(
        create(dir.path(), "sub/new.md"),
        Err(NotesError::Exists)
    ));
    assert_eq!(
        fs::read_to_string(dir.path().join("sub/new.md")).unwrap(),
        "mine"
    );

    assert!(matches!(
        create(dir.path(), "nope/new.md"),
        Err(NotesError::NotFound(_))
    ));
    assert!(is_invalid(create(dir.path(), "new.txt")));
    assert!(is_invalid(create(dir.path(), ".md")));
}

#[test]
fn saves_atomically_and_leaves_no_temporary_file() {
    let dir = folder();
    fs::write(dir.path().join("a.md"), "old").unwrap();

    let note = save(dir.path(), "a.md", "new", None).unwrap();
    assert_eq!(note.content, "new");
    assert_eq!(fs::read_to_string(dir.path().join("a.md")).unwrap(), "new");

    let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(leftovers.len(), 1);

    // Saving may also create the file.
    save(dir.path(), "fresh.md", "x", None).unwrap();
    assert!(dir.path().join("fresh.md").is_file());
}

#[test]
fn a_failed_save_keeps_the_old_content_and_cleans_up() {
    let dir = folder();
    fs::create_dir(dir.path().join("a.md")).unwrap();

    // The target is a directory, so the final rename fails.
    assert!(save(dir.path(), "a.md", "new", None).is_err());
    assert!(dir.path().join("a.md").is_dir());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn save_rejects_other_extensions_and_oversized_text() {
    let dir = folder();
    assert!(is_invalid(save(dir.path(), "a.txt", "x", None)));
    assert!(is_invalid(save(dir.path(), "a", "x", None)));
    let big = "x".repeat(MAX_BYTES as usize + 1);
    assert!(matches!(
        save(dir.path(), "a.md", &big, None),
        Err(NotesError::TooLarge)
    ));
    assert!(!dir.path().join("a.md").exists());
}

#[test]
fn detects_an_external_change_by_the_modified_time() {
    let dir = folder();
    let created = create(dir.path(), "a.md").unwrap();
    let saved = save(dir.path(), "a.md", "one", Some(created.modified)).unwrap();

    // Someone else rewrites the file with another time.
    fs::write(dir.path().join("a.md"), "external").unwrap();
    let file = fs::File::options()
        .write(true)
        .open(dir.path().join("a.md"))
        .unwrap();
    file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000))
        .unwrap();
    drop(file);

    assert!(matches!(
        save(dir.path(), "a.md", "two", Some(saved.modified)),
        Err(NotesError::Conflict)
    ));
    assert_eq!(
        fs::read_to_string(dir.path().join("a.md")).unwrap(),
        "external"
    );

    // Reading gives the new time, and then saving works.
    let current = read(dir.path(), "a.md").unwrap();
    save(dir.path(), "a.md", "two", Some(current.modified)).unwrap();

    // A removed file is a conflict too; without the check it is recreated.
    fs::remove_file(dir.path().join("a.md")).unwrap();
    assert!(matches!(
        save(dir.path(), "a.md", "three", Some(current.modified)),
        Err(NotesError::Conflict)
    ));
    save(dir.path(), "a.md", "three", None).unwrap();
}

#[test]
fn renames_inside_the_folder_and_never_overwrites() {
    let dir = folder();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/a.md"), "a").unwrap();
    fs::write(dir.path().join("sub/b.md"), "b").unwrap();

    let entry = rename(dir.path(), "sub/a.md", "c.md").unwrap();
    assert_eq!(entry.path, "sub/c.md");
    assert_eq!(
        fs::read_to_string(dir.path().join("sub/c.md")).unwrap(),
        "a"
    );
    assert!(!dir.path().join("sub/a.md").exists());

    assert!(matches!(
        rename(dir.path(), "sub/c.md", "b.md"),
        Err(NotesError::Exists)
    ));
    assert!(is_invalid(rename(dir.path(), "sub/c.md", "c.txt")));
    assert!(is_invalid(rename(dir.path(), "sub/c.md", "../c.md")));
    assert!(is_invalid(rename(dir.path(), "sub/c.md", "x/c.md")));
    assert!(matches!(
        rename(dir.path(), "sub/zzz.md", "d.md"),
        Err(NotesError::NotFound(_))
    ));

    // Only the case changes.
    rename(dir.path(), "sub/c.md", "C.md").unwrap();
    assert!(names(&list(dir.path(), "sub").unwrap()).contains(&"C.md"));
}

#[test]
fn deletes_only_with_confirmation_and_never_a_folder() {
    let dir = folder();
    fs::write(dir.path().join("a.md"), "a").unwrap();
    fs::create_dir(dir.path().join("dir.md")).unwrap();

    assert!(matches!(
        delete(dir.path(), "a.md", false),
        Err(NotesError::NotConfirmed)
    ));
    assert!(dir.path().join("a.md").exists());

    delete(dir.path(), "a.md", true).unwrap();
    assert!(!dir.path().join("a.md").exists());
    assert!(matches!(
        delete(dir.path(), "a.md", true),
        Err(NotesError::NotFound(_))
    ));
    assert!(is_invalid(delete(dir.path(), "dir.md", true)));
    assert!(dir.path().join("dir.md").is_dir());
}

#[test]
fn checks_the_chosen_folder() {
    let dir = folder();
    fs::write(dir.path().join("a.md"), "").unwrap();

    assert!(check_folder(dir.path()).is_ok());
    assert!(is_invalid(check_folder(&dir.path().join("a.md"))));
    assert!(matches!(
        check_folder(&dir.path().join("missing")),
        Err(NotesError::NotFound(_))
    ));
    assert!(is_invalid(check_folder(Path::new("relative"))));
}

mod safety {
    use super::*;

    /// A notes folder inside a parent that also holds a secret next to it.
    fn setup() -> (TempDir, std::path::PathBuf, std::path::PathBuf) {
        let parent = folder();
        let root = parent.path().join("notes");
        let outside = parent.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.md"), "secret").unwrap();
        fs::write(parent.path().join("secret.md"), "secret").unwrap();
        (parent, root, outside)
    }

    #[test]
    fn rejects_parent_traversal_and_absolute_paths_everywhere() {
        let (parent, root, _) = setup();
        let absolute = parent
            .path()
            .join("secret.md")
            .to_string_lossy()
            .into_owned();

        for bad in [
            "../secret.md",
            "sub/../../secret.md",
            "..",
            "./a.md",
            "/etc/passwd.md",
        ]
        .into_iter()
        .chain([absolute.as_str(), "..\\secret.md", "C:/secret.md"])
        {
            assert!(read(&root, bad).is_err(), "read {bad}");
            assert!(list(&root, bad).is_err(), "list {bad}");
            assert!(create(&root, bad).is_err(), "create {bad}");
            assert!(save(&root, bad, "x", None).is_err(), "save {bad}");
            assert!(rename(&root, bad, "x.md").is_err(), "rename {bad}");
            assert!(delete(&root, bad, true).is_err(), "delete {bad}");
        }
        assert_eq!(
            fs::read_to_string(parent.path().join("secret.md")).unwrap(),
            "secret"
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlinked_folder_out_of_the_folder() {
        let (_parent, root, outside) = setup();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        assert!(is_invalid(list(&root, "escape")));
        assert!(is_invalid(read(&root, "escape/secret.md")));
        assert!(is_invalid(save(&root, "escape/secret.md", "pwned", None)));
        assert!(is_invalid(create(&root, "escape/new.md")));
        assert!(is_invalid(rename(&root, "escape/secret.md", "x.md")));
        assert!(is_invalid(delete(&root, "escape/secret.md", true)));

        assert_eq!(
            fs::read_to_string(outside.join("secret.md")).unwrap(),
            "secret"
        );
        assert!(!outside.join("new.md").exists());
        // The link itself is not listed.
        assert!(list(&root, "").unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlinked_file_out_of_the_folder() {
        let (_parent, root, outside) = setup();
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("link.md")).unwrap();

        assert!(is_invalid(read(&root, "link.md")));
        assert!(is_invalid(save(&root, "link.md", "pwned", None)));
        assert!(is_invalid(rename(&root, "link.md", "x.md")));
        assert!(is_invalid(delete(&root, "link.md", true)));

        assert_eq!(
            fs::read_to_string(outside.join("secret.md")).unwrap(),
            "secret"
        );
        assert!(list(&root, "").unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn never_writes_through_a_symlink_even_inside_the_folder() {
        let (_parent, root, _) = setup();
        fs::write(root.join("real.md"), "real").unwrap();
        std::os::unix::fs::symlink(root.join("real.md"), root.join("link.md")).unwrap();

        assert!(is_invalid(save(&root, "link.md", "x", None)));
        assert!(is_invalid(delete(&root, "link.md", true)));
        assert_eq!(fs::read_to_string(root.join("real.md")).unwrap(), "real");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_notes_folder_itself_is_fine() {
        let (parent, root, _) = setup();
        fs::write(root.join("a.md"), "a").unwrap();
        let link = parent.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();

        assert_eq!(read(&link, "a.md").unwrap().content, "a");
    }
}
