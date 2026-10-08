# Publication-candidate validation

Date: 8 October 2026 (Pacific/Auckland).
Candidate: reviewed source baseline for the fresh `just-compare` repository. The final Git revision is identified by its GitHub Checks run and the maintainer's publication record.

## Final source checks

The exported source was checked on 8 October 2026. The maintainer's private publication record identifies the exact commit, file inventory, scan reports, CI run, and approval status. GitHub Checks records the current revision's required CI results.

| Check | Result |
| --- | --- |
| Fresh clone and frozen pnpm install | Passed using the committed lockfile and a separately populated dependency store |
| Frontend unit tests | 80 passed |
| Frontend production build | Passed, including a build from the clean clone |
| Chromium browser integration tests | 11 passed |
| Rust tests with locked dependencies | 45 passed; one opt-in workload benchmark ignored |
| Rust formatting and strict Clippy | Passed |
| Third-party notice checks | Five tests and deterministic regeneration passed; 451 inventory entries across four desktop targets |
| JavaScript dependency audit | 219 dependencies, zero reported vulnerabilities |
| Rust dependency audit | Zero vulnerability-classified RustSec entries, seven unmaintained warnings and two unsound warnings; see below |
| Publication snapshot and new-history secret scans | Zero Gitleaks findings in the exported files, separately expanded MPL sources, and single-commit new history |
| Platform CI | Required workflow checks frontend/browser/build, notices, and locked Rust tests/strict Clippy/formatting on macOS, Windows and Linux; inspect [GitHub Checks](https://github.com/gerald-guledew/just-compare/actions/workflows/checks.yml) for the revision under review |

No scan proves the absence of every vulnerability or credential. The source inventory includes seven exact MPL corresponding-source archives. Their expanded contents were scanned separately because generic archive detection did not reliably classify every source file.

## Dependency security review

RustSec and GitHub Advisory Database results were cross-checked. The final lockfile resolves the reported issues in `anyhow` (1.0.103), `event-listener` (5.4.2), `tauri` (2.11.1), and `serde_with` (3.21.0). The JavaScript Tauri API is pinned to 2.11.1, including plugin consumers. Tauri companion dependencies, refreshed notices, locked tests, and the native application build were checked together. Testing used Rust 1.95; the maximum declared dependency minimum across the inventoried targets is 1.88.

The Tauri update fixes [GHSA-7gmj-67g7-phm9](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9), remote-origin misclassification that could expose local-only IPC commands on Windows and Android. The serde_with update fixes [GHSA-7gcf-g7xr-8hxj](https://github.com/jonasbb/serde_with/security/advisories/GHSA-7gcf-g7xr-8hxj), a `KeyValueMap` serialization panic for empty inner entries. GitHub marked both alerts fixed on the exported baseline.

The following advisories remain open. No advisory was suppressed, and the audit is not described as clean:

- [`glib` 0.18.5, RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html): Linux runtime dependency through GTK/WebKit. The fixed version requires an incompatible framework dependency update. No direct project `VariantStrIter` calls were found, but framework non-reachability has not been established.
- [`rand` 0.7.3, RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html): build-only dependency through Tauri's `phf_generator` path. The inspected macOS, Windows and Linux graphs do not enable the optional `log` feature, and the generator uses seeded `SmallRng` rather than the advisory's `thread_rng` trigger. This narrows the identified exposure; retain and reassess the warning on future dependency changes.

## Regression coverage

The existing automated suites exercise filesystem identity and overlapping paths, unsupported symlinks, unreadable traversal, injected cross-device fallback, staged verification, cancellation, rollback, and changing sources/destinations. Document tests cover save/edit races, conflict decisions, document identity, UTF-8/BOM handling, permissions, and changing files. Browser tests exercise real Monaco merge undo/redo, tab lifecycle, lazy folder-only startup, diff ordering, and markup sanitization.

Routine commands are listed in [README.md](../README.md). CI uses the same frontend suites and build, plus Rust tests, formatting, and strict Clippy on macOS, Windows, and Linux. An opt-in large-tree benchmark is excluded from the routine Rust suite.

## Limited macOS native smoke test

A debug `.app` built with production assets and the custom protocol was tested on Apple Silicon, macOS 26.7.1, using synthetic files. Launch, Quick and Verified folder comparison, native Monaco diff rendering, block merge, merge undo, save, and native file-picker cancellation passed. The merged file's saved bytes were checked on disk. The final security dependency combination was subsequently rebuilt and tested again on the same host. The repeat passed the same launch, Quick/Verified comparison, native diff, merge, undo, save and file-picker cancellation checks; saved synthetic bytes were verified on disk. User application settings were restored after testing. All 58 files in the final bundle's license resource directory were verified against the current manifest with no missing files, extra files, or hash mismatches, including all seven MPL source archives.

This is a limited smoke test, not general-user installer acceptance. Browser tests run in Chromium with a test harness and do not prove behavior in every Tauri system webview. Injected filesystem faults do not substitute for physical cross-volume and platform permission tests.

Before distributing a platform installer, verify production worker/IPC/CSP behavior, file-dialog and drag/drop interactions, save conflicts, native replacement behavior, responsiveness, cancellation, permission failures, and real cross-volume moves. Record the OS, application revision, synthetic fixtures, and disk outcomes for each platform tested.

## Known limits

Recovery handles ordinary failures per item. Completed batch items remain completed when a later item fails. Deletion is permanent and can be partial after cancellation or IO errors. There is no durable crash or power-loss recovery journal, no exclusive filesystem locking, and no guarantee of preserving ACLs or extended attributes.

Quick metadata matches do not prove byte equality. Editing supports validated UTF-8 text with optional BOM, up to 10 MB per file. Production CSP is currently disabled; see [SECURITY.md](../SECURITY.md) and [source-publication readiness](PUBLIC_READINESS.md).
