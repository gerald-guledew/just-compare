# JustCompare

[![Checks](https://github.com/gerald-guledew/just-compare/actions/workflows/checks.yml/badge.svg)](https://github.com/gerald-guledew/just-compare/actions/workflows/checks.yml)

A desktop application for comparing folders and text files side by side, with editing and merge tools. Built with Tauri v2, Rust, React 19, TypeScript, and Monaco. Licensed under MIT.

JustCompare is early-stage software (0.1.0), intended for developers and contributors building from source. No packaged releases are currently published.

## Features

- Folder comparison with a virtualized tree, filters, and separate results for modified, missing, metadata-matching, and verified identical files.
- Quick mode for fast metadata checks, or Verified mode for byte comparisons. A metadata match does not prove identical contents.
- Side-by-side text diffs with word highlights, line numbers, a minimap, and aligned word wrapping.
- Edit either pane and copy changed blocks between files, with Monaco undo and redo.
- Save conflict detection and external-edit awareness. Edits made while saving remain unsaved until their own save completes.
- Copy, move, and delete selected filesystem entries, with path validation, progress, cancellation, and recovery for handled copy/move failures.
- Drop folders or files from Finder or Explorer. Drag between folder panes to copy, or hold Shift to move.

## Build and run

Install these prerequisites first:

- Node.js 22.12 or later (CI uses Node.js 22).
- pnpm 10.33.0, pinned in `package.json`.
- [Rust](https://www.rust-lang.org/tools/install) 1.88 or later, using the stable toolchain.
- [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows; WebKitGTK 4.1 and the documented system libraries on Linux.

```bash
git clone https://github.com/gerald-guledew/just-compare.git
cd just-compare
pnpm install --frozen-lockfile
pnpm tauri dev
```

To create a local bundle for development on your host platform:

```bash
pnpm tauri build
```

Bundles are written to `src-tauri/target/release/bundle/`. Build each platform on that platform. Local builds have not completed the acceptance and signing process required for a general-user release; see [validation](docs/VALIDATION.md).

## Using the application

Choose a left and right folder to compare, then select Quick or Verified mode. Open a file pair to inspect its diff. Edit either side or use the merge arrows, then save. If another application changes the file, resolve the reload/overwrite conflict before saving.

## Current limitations

- Editing supports valid UTF-8 text, with optional UTF-8 BOM, up to 10 MB per file. Binary, UTF-16, and legacy encodings are rejected. Existing BOM and target newline conventions are preserved.
- Copy/move preflight rejects symlinks and special files. Folder scanning reports skipped symlinks.
- Delete permanently removes entries and can be partial after cancellation or an IO failure. Keep backups of important files.
- Recovery is per item and covers handled errors. Batches are not atomic, and there is no crash or power-loss recovery journal.
- Version checks cannot exclude every race with an uncooperative external writer. ACLs and extended attributes are not guaranteed preserved.
- Browser tests do not replace native webview testing. Real cross-volume moves and platform-specific behavior need more validation.
- Production Content Security Policy is currently disabled. Native webview and capability hardening are planned before general-user installers.

See [architecture](docs/PROJECT.md), [validation evidence](docs/VALIDATION.md), and [source-publication readiness](docs/PUBLIC_READINESS.md) for details and planned improvements.

## Development

```bash
pnpm dev                  # Frontend preview; filesystem features require Tauri
pnpm test                 # Frontend unit tests
pnpm build                # Type check and production frontend build
pnpm exec playwright install chromium
pnpm test:browser         # Monaco and app browser integration tests
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

The frontend lives in `src/`; Rust commands, models, and services live in `src-tauri/src/`. Filesystem access and comparison results come from Rust through typed wrappers. Persistent UI settings use the Tauri store plugin.

## Contributing and security

Bug reports and contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review expectations. Report vulnerabilities privately using the process in [SECURITY.md](SECURITY.md). Remove private filenames and contents from shared screenshots and logs.

## License

[MIT](LICENSE), copyright 2026 Gerald Guledew. Dependencies and incorporated assets retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
