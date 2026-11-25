# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-11-23

### Added

- **database-views:** Add drag and drop to database tables (#184)

## [0.12.0] - 2026-11-23

### Added

- **pages:** Add lock controls and read-only editing (#182)

## [0.11.0] - 2026-11-19

### Added

- **app-shell:** Add the owl app icon for macOS, Windows and Linux (#158)
- **pages:** Show a larger page icon across the cover edge (#164)

## [0.10.0] - 2026-11-17

### Added

- **app-shell:** Build, test and bundle on macOS, Windows and Linux (#147)
- **pages:** Lock a page at content or everything, enforced by the backend (#148)

## [0.9.0] - 2026-11-17

### Added

- **databases:** Relation property backend (#149)
- **notes:** Add a notes folder of plain Markdown files (#146)
- **backup:** Backups with safe restore, local schedule and optional encryption (#150)
- **trash:** Add a trash with restore and a version history of page blocks (#155)

### Changed

- **databases:** Delete the rows of a database with set-based cascades (#153)

### Fixed

- **database-embed:** Select rows in the block, soft block selection and no text selection outside the editor (#134)

## [0.8.0] - 2026-11-16

### Added

- **search:** Find rows by the text of their properties (#119)
- **database-views:** Refresh the database toolbar and table (#121)
- **pages:** Reveal cover controls in the top right corner only (#125)
- **pages:** Offer curated icons in categories in the icon picker (#137)

## [0.7.0] - 2026-11-16

### Added

- **pages:** Add cover controls, the cover picker and every Lucide icon (#111)
- **database-embed:** Add the inline database block and its slash menu entry (#117)
- **editor:** Create a subpage from the slash menu (#118)

## [0.6.0] - 2026-11-15

### Added

- **export:** Export databases as tables and rows as files (#91)
- **database-views:** Add view tabs and the filter, sort, group and properties menus (#92)
- **pages:** Add favourites and private sidebar (#98)
- **pages:** Add icons banners and the page header (#99)
- **databases:** Show a row's properties on its page (#93)
- **pages:** Add the top bar with path, icon picker and export panel (#105)

### Fixed

- **databases:** Reject unknown select option colors (#94)
- **editor:** Keep undo out of the title (#100)

## [0.5.0] - 2026-11-14

### Added

- **databases:** Add the table view (#86)
- **databases:** Delete properties and options, change types, delete databases in chunks (#87)

## [0.4.0] - 2026-11-14

### Added

- **databases:** Add properties, rows and cells to the backend (#79)
- **databases:** Add property types with editors, sorting and filtering (#81)
- **database-views:** Store views in the backend (#82)

## [0.3.0] - 2026-11-14

### Added

- **databases:** Add database commands, fake backend and page shell (#75)

## [0.2.0] - 2026-11-14

### Added

- **databases:** Add schema version 5 and database pages (#73)

## [0.1.0] - 2026-11-13

### Added

- **app-shell:** Scaffold the desktop app with layout, theme and ci (#34)
- **storage:** Add embedded surrealdb with migrations and schema v1 (#35)
- **pages:** Add pages with a sidebar tree, routing and page view (#37)
- **editor:** Add the block editor with autosave and the slash menu (#38)
- **editor:** Add images, page links and backlinks (#40)
- **search:** Add full-text search with a dialog on cmd+k (#42)
- **export:** Add markdown export and fix the slow delete cascade (#44)

### Fixed

- **repo-workflow:** Set initial release version (#48)

[0.13.0]: https://github.com/novexiusone/notiva/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/novexiusone/notiva/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/novexiusone/notiva/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/novexiusone/notiva/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/novexiusone/notiva/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/novexiusone/notiva/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/novexiusone/notiva/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/novexiusone/notiva/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/novexiusone/notiva/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/novexiusone/notiva/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/novexiusone/notiva/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/novexiusone/notiva/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/novexiusone/notiva/releases/tag/v0.1.0

