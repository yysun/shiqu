# Windows desktop distribution

The desktop runtime already recognizes Windows, but releases only ship macOS DMGs. Windows users need installable Standard and Lite editions and accurate download/setup guidance.

- [ ] Native Windows x64 packaging produces unsigned NSIS installers for Standard (pinned Node plus license) and Lite (system Node 24).
- [x] A single release publisher waits for both native platforms and both editions, uploads four installers and their SHA-256 sums, and preserves draft/retry safeguards.
- [ ] Windows CI runs relevant JavaScript/native checks and installs each edition into a temporary directory for relocated runtime smoke checks.
- [x] README and desktop documentation explain Windows requirements, installation, stable asset names, Gemini-only generation, and local build instructions; preserve existing README edits.
- [x] Applicable local checks and independent review pass; report Windows installation/runtime verification as pending until native CI executes it.

Constraints: use pinned pnpm/Node/Rust; preserve macOS builds and shared data identity. No Docker build, local desktop preparation/packaging, dependency changes, release publication, or push. No Windows Codex integration, Windows ARM64, Linux installers, code signing, or MSI.

Implementation is ready. Native packaging/install evidence remains pending Windows CI; unchecked criteria are not claims of observed Windows execution.
