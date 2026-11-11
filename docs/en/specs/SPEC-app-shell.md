# Spec: app-shell

## Objective

A runnable desktop app skeleton that every later module builds on: a Tauri window showing a React app with the final layout (sidebar and main area), the theme, the localisation setup and one end-to-end call from the frontend into Rust. CI builds and tests both sides on every pull request.

No pages, no editor and no database yet. The sidebar tree and the main area show placeholders.

## Tech stack

| Area                     | Choice                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| Shell                    | Tauri 2                                                                        |
| Frontend                 | React 19, TypeScript, Vite                                                     |
| Styling                  | Tailwind CSS 4 (`@tailwindcss/vite`), theme through CSS variables              |
| Components               | shadcn/ui (Radix), copied into `src/components/ui`                             |
| Icons                    | lucide-react, nothing else                                                     |
| Async state for commands | TanStack Query                                                                 |
| Localisation             | i18next + react-i18next, locales `en` (default) and `de`                       |
| Lint and format          | ESLint (flat config, typescript-eslint), Prettier, `cargo fmt`, `cargo clippy` |
| Tests                    | Vitest + Testing Library (frontend), `cargo test` (Rust)                       |

Routing and client state (Zustand) are added by the first module that needs them.

## Commands

```bash
pnpm install            # install frontend dependencies
pnpm tauri dev          # run the desktop app with hot reload
pnpm dev                # run only the frontend on http://localhost:1420
pnpm build              # typecheck and build the frontend
pnpm tauri build        # build the app bundle
pnpm lint               # eslint
pnpm format             # prettier --write
pnpm format:check       # prettier --check
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project structure

```
src/                      → React app
  main.tsx                → entry: providers, i18n, styles
  App.tsx                 → app layout
  components/layout/      → Sidebar, MainArea
  components/ui/          → shadcn/ui components (generated, edited in place)
  lib/commands.ts         → the only place that calls `invoke`
  lib/i18n.ts             → i18next setup
  lib/utils.ts            → `cn` for merging class names
  locales/en.json, de.json
  styles/globals.css      → Tailwind import and theme variables
  test/setup.ts           → Vitest setup
src-tauri/                → Rust backend
  src/main.rs             → binary entry
  src/lib.rs              → Tauri builder, command registration
  src/commands/           → Tauri commands, one file per area
  capabilities/           → Tauri permissions
  tauri.conf.json
.github/workflows/ci.yml  → frontend and Rust checks
```

Tests live next to the code they test (`Sidebar.test.tsx`, `#[cfg(test)]` modules).

## Design

- Background `#0F0F0F` (dark) and `#F2F2F2` (light). Sidebar, hover, card and border colours are derived from the background and defined as CSS variables in `globals.css`.
- The colour scheme follows the system through `prefers-color-scheme` and reacts to changes while the app is running. There is no manual switch yet.
- Left sidebar, top to bottom: search (shows `⌘K`), home, page tree placeholder, settings at the bottom.
- Main area: content column with a narrow reading width (max 720 px), large title.
- Subtle borders instead of shadows, small radii, hardly any accent colour.
- Lucide icons at 16 px in the sidebar and 20 px in toolbars, same stroke width everywhere. No emojis as icons.
- The window uses the macOS overlay title bar so the sidebar reaches the top edge; the top of the sidebar is a drag region.

## Code style

Frontend: function components, named exports, no default exports except where a tool requires one. All user-visible text goes through `t()`. Components never call `invoke` directly.

```tsx
// src/lib/commands.ts
import { invoke } from '@tauri-apps/api/core';

export type AppInfo = { name: string; version: string };

export const commands = {
  appInfo: () => invoke<AppInfo>('app_info'),
};
```

```tsx
// src/components/layout/SidebarItem.tsx
export function SidebarItem({ icon: Icon, label, hint }: SidebarItemProps) {
  return (
    <button className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-sidebar-hover">
      <Icon size={16} aria-hidden />
      <span className="truncate">{label}</span>
      {hint ? <kbd className="ml-auto text-xs text-muted-foreground">{hint}</kbd> : null}
    </button>
  );
}
```

Rust: commands are thin and return serialisable structs; logic lives in plain functions that can be tested without Tauri.

```rust
#[derive(serde::Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo { name: package.name.clone(), version: package.version.to_string() }
}
```

## Testing strategy

- Frontend unit tests with Vitest and Testing Library in jsdom. Tauri commands are mocked with `@tauri-apps/api/mocks`.
- Rust unit tests for logic behind commands.
- The layout is checked by eye in the browser against the frontend dev server in light and dark mode; the Tauri window is started once to confirm it launches.
- End-to-end tests with Playwright start with the first module that has user flows worth protecting (`pages`). They run against the frontend with mocked commands, because WebDriver cannot drive WKWebView on macOS.

## Boundaries

- **Always:** Route user-visible text through `t()` and add it to both locale files. Call Rust only through `src/lib/commands.ts`. Use theme variables instead of literal colours.
- **Ask first:** Adding a UI or state library that is not in the capability map. Enabling additional Tauri permissions or plugins.
- **Never:** Use icons from anything but Lucide. Disable the content security policy for convenience.

## Success criteria

- [ ] `pnpm tauri dev` opens a window showing the React app (#7)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `cargo test` pass (#7)
- [ ] The sidebar shows the app version, fetched from Rust through `invoke` (#7)
- [ ] Background is `#0F0F0F` in dark and `#F2F2F2` in light mode; switching the system setting switches the app (#8)
- [ ] The sidebar shows search, home, a page tree placeholder and settings at the bottom (#8)
- [ ] With the system language set to German the UI is German, otherwise English (#8)
- [ ] The CI workflow runs frontend and Rust checks on every pull request (#9)

## Open questions

- Release builds (`.dmg`) attached to GitHub releases are added together with the release automation (#4).
