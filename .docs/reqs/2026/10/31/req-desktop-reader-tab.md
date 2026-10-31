# Desktop reader tab

The desktop console already ships the browser reader but sends users outside the app to read or create. Add a “阅读与创作” tab that embeds the same frontend and local server; retain the shelf, queue, settings, and sharing controls.

## Acceptance criteria

- [x] A keyboard-accessible “阅读与创作” tab displays the existing reader frontend inside the desktop shell, without a second reader implementation.
- [x] The native reader uses only the running supervisor's loopback URL. Stopped service shows a clear start instruction; stop removes the frame and restart creates a fresh one.
- [x] Switching desktop tabs preserves the mounted reader and its current screen. Reload is explicit. Existing shelf, queue, settings, browser opening, and sharing controls remain available.
- [x] The frame retains its own origin for API writes, media, and browser storage; it cannot navigate the shell or receive native settings permissions. CSP admits loopback frames without broadening native IPC capabilities.
- [x] Browser preview can embed an explicitly configured loopback reader. Verify real reader navigation, an API write, tab persistence, reload, and narrow layout using a disposable library and no paid generation.
- [x] Local regression checks pass and documentation explains preview setup and native verification limits.

## Constraints and non-goals

Use Node 24.22.1 and pnpm 11.25.0. Preview through `pnpm desktop:preview` in the in-app browser. No Docker image, desktop preparation, native app packaging, new dependencies, backend duplication, credential changes, or automatic generation. No changes to phone access or server authentication contracts. Native WebKit/WebView2 behavior must be reported separately from browser evidence.
