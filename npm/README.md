# 拾趣 · Shiqu

Turn Chinese classics into your own illustrated storybooks. Read in your browser, generate with a logged-in Codex CLI, OpenAI API, or Gemini, and keep stories, images, and reading progress on your computer.

## CLI or desktop app?

**Choose the desktop app for everyday use; choose the CLI if you already have Node 24, prefer a terminal, or need scripted startup.**

| Your situation | Recommended entry point |
| --- | --- |
| You want graphical settings, library and queue management, and no separate Node installation | Desktop app: includes Node 24 and service controls |
| You already have Node 24 and want one-command startup without installing a desktop app | CLI: `npx @apprun/shiqu`; keep the terminal running and press Ctrl+C to stop |
| You want generation and reading access to continue after closing the control window | Desktop app: stays in the system tray until you stop the service or quit the app |
| You need startup parameters, environment overrides, or non-interactive operation | CLI: prepare provider configuration and a library path in advance |
| You use Linux, an Intel Mac, or Windows ARM64 | CLI: install Node 24 yourself; no desktop installer is provided for these platforms. Windows supports API providers or read-only mode |
| You want phone access on the same Wi-Fi | Both entries: CLI prints phone QR codes on startup; desktop shows them in its control window |
| You need built-in internet tunnel controls | Desktop app: requires a separate cloudflared installation. CLI has no built-in internet tunnel |

**Shared features:** Both entry points provide the same browser interface for story creation, generation queues, pause/resume, reading, library organization, and PDF / PNG export. The desktop window adds library, queue, settings, and service controls; full reading and story creation happen in the browser. Both support OpenAI API, Gemini, and read-only mode. Codex generation is supported on macOS / Linux and requires a separately installed, logged-in Codex CLI; the Shiqu CLI and Codex CLI are different tools.

**Shared settings and data:** Under the same local user account, both entry points reuse saved provider settings and API keys. With the same library directory, they share stories, images, and reading progress. Neither requires the other to be running.

### Switching between CLI and desktop

1. **Stop the current service.** Press Ctrl+C in the CLI, or stop the service / quit the desktop app. Closing the desktop window alone does not stop the service.
2. **Use matching versions and the same library directory.** Check the CLI version with `npx @apprun/shiqu --version`; use `npx @apprun/shiqu@<version>` to select a published version matching the desktop app. Explicit `--data-dir` / `SHIQU_DATA_DIR` overrides apply only to that invocation and do not change the saved directory.
3. **Start the other entry point.** Saved provider settings and keys are reused. Changes to shared settings take effect in an already-running service only after it restarts.

**Only one service can run against a library at a time, even on different ports.** Switching entry points needs no data copy. Choosing another directory opens another library; it does not move or merge data. Back up before upgrading or downgrading, as older versions may not read newer settings or data. See the [full user guide](https://github.com/yysun/shiqu/blob/main/.docs/user-guide.md).

## Run

Requires **Node 24** (recommended: 24.22.1) and its bundled npm / npx. No separate pnpm installation is needed:

```bash
npx @apprun/shiqu
```

On first use, npx may ask to download the package; confirm to continue. Open the printed URL, normally `http://127.0.0.1:3000`, or scan a terminal QR code from a phone on the same trusted Wi-Fi. LAN access is enabled by default. Keep the terminal running; stop with Ctrl+C. No checkout, build, Docker, or desktop app is needed.

If you already use pnpm, `pnpm dlx @apprun/shiqu` starts the same app. You can also install it globally with pnpm for a permanent `shiqu` command:

```bash
pnpm add -g @apprun/shiqu
shiqu --help
```

## First-run provider setup

No environment variables are required for interactive setup. After finding or choosing a library, the CLI reuses saved settings. If none are configured, choose **Codex / OpenAI API / Gemini / Read only**. Enter API keys at the hidden terminal prompt; model prompts accept the saved/default value on Enter. Codex needs an installed, logged-in CLI instead of an API key. Windows supports the API providers and read-only mode.

Settings and provider-specific keys are shared with the desktop app in the separate private `desktop.sqlite`, outside story libraries. Saved configurations do not prompt again. Keys are plaintext protected by local filesystem permissions (0700 directory / 0600 database on Unix); do not share settings backups. Keys never appear in HTTP responses or settings views.

```bash
npx @apprun/shiqu --configure
npx @apprun/shiqu --reset-providers
```

`--configure` selects/edits a profile, retains that profile's saved key on blank input, saves only a completed setup, and exits. Switching profiles preserves other providers' models/keys. `--reset-providers` removes saved provider settings and keys, preserving libraries/network settings and all stories. It reopens setup in a terminal, or exits with guidance when non-interactive. Already-running servers keep their startup snapshot until restarted.

OpenAI uses the official Responses API for text and Images API for illustrations, including saved reference images. Defaults: `gpt-6.1-sol` / `gpt-image-2.5-sunburst`; access/quota depend on your API project. OpenAI API billing is separate from Codex subscription quota. Public webpage URL discovery remains Gemini-only. Read-only never dispatches generation.

### Invocation-only overrides

Environment variables or an explicitly selected env file override saved configuration without being imported or persisted:

```dotenv
SHIQU_AI_PROVIDER=openai
OPENAI_API_KEY=your-key
# Optional model overrides:
OPENAI_TEXT_MODEL=gpt-6.1-sol
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

Other choices: `SHIQU_AI_PROVIDER=codex` after `codex login`, `SHIQU_AI_PROVIDER=gemini` with `GEMINI_API_KEY`, or `SHIQU_AI_PROVIDER=readonly` with no key.

```bash
npx @apprun/shiqu --config /path/to/shiqu.env
```

No `.env` is loaded automatically. Existing shell variables beat the selected file; CLI flags beat both. Non-interactive startup requires saved settings or a complete provider override, and a discoverable/explicit library path. No prompt waits indefinitely. The package includes `.env.example` with optional settings.

## Options and data

```bash
npx @apprun/shiqu --port 3100 --data-dir ./my-library
pnpm dlx @apprun/shiqu --host 127.0.0.1
npx @apprun/shiqu --version
```

| Option | Environment | Default |
| --- | --- | --- |
| `--port` | `PORT` | `3000` |
| `--host` | `SHIQU_BIND_IP` | `0.0.0.0` (LAN access) |
| `--data-dir` | `SHIQU_DATA_DIR` | Saved desktop library; otherwise find or ask below |
| `--config` | — | No env file |

Library selection:

1. An explicit `--data-dir` wins over `SHIQU_DATA_DIR` from the shell or selected env file.
2. Otherwise reuse the library directory saved in the shared CLI / desktop settings, creating it if necessary. Provider settings and keys are reused separately during provider setup; they are not stored in the story library.
3. Without shared saved settings, import a prior CLI `cli-library.json` directory if present, otherwise look for an existing database in the desktop default library directory.
4. If none is found, ask which directory to use or create. Enter accepts the suggested desktop default. Cancel/EOF creates no library; non-interactive first use must supply `--data-dir`.

Suggested desktop-compatible defaults:

- macOS: `~/Library/Application Support/com.shiqu.desktop/library`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/com.shiqu.desktop/library`
- Windows: `%APPDATA%\com.shiqu.desktop\library`

Confirmed library choices now live in the shared settings database; legacy `cli-library.json` choices are imported when needed and the old file is retained. Desktop and CLI use the same directory when either configures it first. Explicit `--data-dir` / `SHIQU_DATA_DIR` overrides are invocation-only. New settings databases created by `--configure` do not treat the unconfirmed default library path as a saved choice.
Relative paths resolve from the launch directory. Both entries use the same SQLite/media format; use matching versions and stop one before starting the other. A busy library is rejected even on a different port. Database and media survive package updates and npm-cache cleanup. Back up the entire library while stopped.

Older CLI releases used `shiqu/library` rather than `com.shiqu.desktop/library` (Windows used LOCALAPPDATA, falling back to APPDATA). Existing data is never moved or merged automatically; pass the old directory with `--data-dir` to continue using it. CLI and desktop now share saved credentials; explicit invocation overrides remain separate and are not saved.

The CLI listens on `0.0.0.0` by default and prints LAN URLs and phone QR codes when a network interface is available. Every connected device shares the library and generation permissions; use a trusted LAN. Use `--host 127.0.0.1` (or `SHIQU_BIND_IP=127.0.0.1`) for local-only access without phone QR codes. Keep the computer awake while reading from a phone. This CLI does not provide the desktop app's internet tunnel or native control window.

## Sources and license

The package includes all 24 classical texts, their catalog, and source notices, so first use needs no separate book download. Original project code is Apache-2.0; book sources retain their applicable terms. See `LICENSE`, `NOTICE`, `data/library/source-notices.md`, and `data/library/catalog.json`. Generated stories and illustrations do not inherit the code license automatically.

[Project and full documentation](https://github.com/yysun/shiqu)
