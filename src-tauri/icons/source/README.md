# App icon sources

- `icon-dark.png` is the app icon (1024 × 1024, transparent corners, the squircle sits in the 824 px safe area of Apple's template). `icon-light.png` is its light variant for places that need one (docs, store pages); the app itself ships the dark one.
- macOS uses the file as it is, because the template margin is what the Dock expects.
- Windows and Linux do not add a margin, so `crop.swift` cuts the squircle to its bounds and scales it back to 1024 px; that file feeds `icon.ico` and the PNGs.

Regenerate (macOS, from the repository root; `<tmp>` is any empty folder):

```bash
pnpm exec tauri icon src-tauri/icons/source/icon-dark.png -o <tmp>/mac
swift src-tauri/icons/source/crop.swift src-tauri/icons/source/icon-dark.png <tmp>/tight.png 1024
pnpm exec tauri icon <tmp>/tight.png -o <tmp>/tight
# icon.icns from <tmp>/mac; icon.ico, icon.png, 32x32.png, 128x128.png and 128x128@2x.png from <tmp>/tight
```
