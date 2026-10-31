# Windows desktop verification

1. Local configuration/automation: from the checkout with pinned toolchains, validate Windows NSIS configuration against the installed Tauri schema and inspect both native jobs plus the publisher. Expect four distinct assets, one publisher gated on every build, and no release on PR/manual runs.
2. Native Windows CI: on Windows x64 with pinned Node/pnpm/Rust and MSVC, run desktop JavaScript tests and both native edition tests. Package each edition, silently install it into a temporary path containing spaces, and smoke-test the installed runtime. Expect a 24-book empty library, working local/LAN APIs, restart and shutdown; Standard verifies bundled node.exe and license hashes without system Node on PATH, Lite has no bundled Node and uses installed Node 24. No paid generation.
3. Release: for a matching vX.Y.Z source tag, both platforms must finish before publishing. Expect two DMGs, two EXEs, and a checksum file covering all four. A failed platform prevents publication; manual/PR runs only upload artifacts. Inspect this contract locally; do not push or publish during this task.

Scenario 2 and live release execution require GitHub/native Windows and are explicitly pending until that environment runs. No local package build is authorized as routine verification.
