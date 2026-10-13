# JustCompare

[![Checks](https://github.com/gerald-guledew/just-compare/actions/workflows/checks.yml/badge.svg)](https://github.com/gerald-guledew/just-compare/actions/workflows/checks.yml)

A desktop application for comparing folders and text files side by side, with editing and merge tools. Built with Tauri v2, Rust, React 19, TypeScript, and Monaco. Licensed under MIT.

JustCompare is early-stage software (0.1.0), intended for developers and contributors building from source. No packaged releases are currently published.

## Features

- Folder comparison with a virtualized tree, filters, and separate results for modified, missing, metadata-matching, and verified identical files.
- Quick mode for fast metadata checks, or Verified mode for byte comparisons. A metadata match does not prove identical contents.
- Unified comparison tabs that become file or folder comparisons after the first selection. Each tab keeps its own paths and results.
- Direct file comparison with independently selected left and right files, including files with different names or locations.
- Side-by-side text diffs with word highlights, line numbers, a minimap, and aligned word wrapping.
- Edit either pane and copy changed blocks between files, with Monaco undo and redo.
- Save conflict detection and external-edit awareness. Edits made while saving remain unsaved until their own save completes.
- Copy, move, and delete selected filesystem entries, with path validation, progress, cancellation, and recovery for handled copy/move failures.
- Drop files or folders from Finder or Explorer into either comparison pane. Drag between folder panes to copy, or hold Shift to move.

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

The app starts with one **Compare** tab and two empty panes. Select a file or folder in either pane, paste its path above, or drop it onto the pane. The first valid selection chooses the comparison type and shows its controls. Choose the same type on the other side. The picker offers a file or folder choice before opening the native dialog.

For folders, select Quick or Verified beside **Compare**, then click Compare. Double-click a file in the results to inspect the matching file pair. For files, the diff appears automatically once both load, including when their names or folders differ.

Click **+** to start another comparison. Tabs preserve their independent paths, folder results, selection and scroll positions, and file edits. Closing the last tab returns to one blank Compare tab. New launches start blank, while wrapping and comparison-mode preferences are remembered.

Click **Wrap Text** (or press Alt+Z) to fit long lines within both panes. Matching diff rows stay aligned when their wrapped heights differ. The setting is remembered between launches and does not change file contents.

Edit either pane or use the merge arrows, then save. If another application changes the file, resolve the reload/overwrite conflict before saving.

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
