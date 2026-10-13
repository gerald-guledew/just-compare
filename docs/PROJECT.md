# JustCompare architecture

JustCompare compares folders and UTF-8 files with React 19, TypeScript, Zustand, Tauri v2, Rust, and Monaco. Rust owns filesystem access; the frontend uses typed wrappers in `src/lib/tauri.ts`. Settings use the Tauri store plugin.

## Development status

The 0.1.0 source baseline includes folder comparison, file diffing and editing, block merges, version-aware saves, and copy/move/delete operations. The current workspace starts with a neutral **Compare** tab and accepts either files or folders directly. General-user installers, signing, broader native platform acceptance, and webview security hardening remain outstanding. Recorded validation and its limits are in [VALIDATION.md](VALIDATION.md).

## Source layout

- `src/components`: folder panes, toolbar, dialogs, tabs, lazy file comparison view, Monaco panes.
- `src/hooks`: comparison requests, visible tree flattening, document loading, debounced diffing, and filesystem batch orchestration.
- `src/lib/documents.ts`: shared save, reload, conflict, and external-change lifecycle.
- `src/lib/monaco/setup.ts`: local workers and model retention, loaded with the file view.
- `src/stores/appStore.ts`: tabs, document buffers, comparison results, mode, selection, and operation state.
- `src-tauri/src/commands`: async Tauri entry points and event adapters.
- `src-tauri/src/services`: testable filesystem operations, document IO, scanning, indexing, and bounded blocking workers.
- `src-tauri/src/models` and `src/types`: matching serialized interfaces.

## Folder comparison

Quick is the persisted default. Size differences mean Modified. Matching sizes and timestamps mean MetadataMatch. Equal sizes with different timestamps trigger streaming byte comparison. Verified compares bytes regardless of timestamp, with size differences as an early rejection. Identical means a byte comparison succeeded. Unreadable or changing files produce warnings and are never verified identical.

The result envelope contains entries, completed mode, and warnings. Frontend requests capture roots, mode, and generation. Changing roots or mode clears results; outdated completions are discarded. Status counts distinguish metadata matches from verified identical files.

The app opens with one neutral **Compare** tab and lightweight left and right panels. Shared path headers accept a picker selection, pasted path, or native drop. Rust checks the selected path's metadata to distinguish a regular file from a folder, rejecting missing and special paths. The first valid item changes that tab to the corresponding comparison type in place. The other side must use the same type.

**+** adds an independent neutral tab. Each folder tab snapshots its roots, results, mode, expansion, selection, warnings, and errors while the active folder remains available through existing store selectors. Scroll offsets are cached per live folder tab and root pair. A separate tab lifecycle version rejects path checks from closed, replaced, or switched-away tabs. Folder scan generations also capture the active tab and comparison context. Tab changes are locked during mutating filesystem batches. Closing the last tab creates one blank comparison. Startup restores mode and wrapping preferences, with no automatic path selection or scans.

Folder headers use the same compact path-field layout as file headers. Quick/Verified sits beside Compare, and folder operations remain in the folder toolbar. File-only controls appear after selecting a file.

Shared scanning reads metadata once per entry and reports traversal errors. A set deduplicates keys; a parent-to-children index replaces repeated full-map searches. Sorting remains directory-first and case-insensitive. Descendant difference flags are computed once by Rust. The frontend flattens expanded rows and virtualizes their rendering.

## File comparison

Selecting a file in a neutral tab opens the lazy file comparison view with independent left and right paths. Each pane accepts a native file-picker selection, a pasted path, or a file dropped from Finder or Explorer. Files may have different names and locations. Loading both documents starts the existing debounced text diff automatically; folder Quick/Verified modes do not apply to the text editor.

Double-clicking a file in folder results opens the pair with matching relative paths. Either pane can then select a different file. Changing a pane's file confirms discarding any unsaved edits on that side. File comparison uses the same document, diff, merge, and save lifecycle regardless of how the tab was opened.

The file tab's **Wrap Text** toggle (Alt+Z) controls both editors and persists through the Tauri settings store. Wrapping defaults to off. Alignment zones use measured line heights, including wrapped continuations, and recalculate when the editors resize. Merge arrows and minimap markers follow actual editor positions. Wrapping changes the display without editing document text.

## Filesystem operations

`start_fs_op` reserves one mutating batch. `plan_fs_batch` resolves paths, validates filesystem identity and component ancestry, rejects hard-link aliases and batch conflicts, collapses redundant selected descendants, and preflights entire copy/move trees. Symlinks, special files, and traversal errors fail before mutation. Confirmations remain in the frontend; dirty checks cover documents beneath selected directories.

`execute_fs_item` revalidates each planned item. Copy stages into a unique sibling recovery directory, with cancellable chunked IO and preserved permissions. Moves use rename first and copy only for cross-device errors. Cross-device staging is byte-verified and the source fingerprint is rechecked before commit.

An existing destination moves into a recovery backup before the staged item is committed. Handled failures restore the previous destination and, for renamed moves, the source. Rollback failures retain recovery files and report their location. Source cleanup failures retain the completed destination and backup, with an explicit error. Cancellation during staging leaves the original destination intact. Committed cross-device source cleanup runs to completion rather than accepting cancellation halfway through deletion.

Frontend toolbar, keyboard, and context-menu mutation entry points share the batch guard. Operations finish by refreshing comparison results and checking every open document. `delete_paths` preflights traversal and supports cancellation, but deletion remains irreversible and a cancelled deletion can be partial.

## Documents and saving

Read results contain validated text, UTF-8 BOM flag, canonical path, opaque disk-version token, size, and modification time. Reads use one handle, enforce the 10 MB limit, validate UTF-8 strictly, and reject changes observed during reading. BOM is stripped from editor text and restored on save. Binary and unsupported encodings display errors.

Each buffer carries document identity, edit revision, canonical path, disk version, BOM, exact diskText, and save/error state. Edits, merges, and reloads advance revisions. Async completions are guarded by identity and revision; reload creates a new identity. Closed tabs and replaced documents cannot receive old completions.

The shared document service serializes saves per canonical path and coalesces requests for one document revision. Save records the exact submitted text as diskText, so edits made during saving remain dirty. Rust compares the expected disk version, writes a unique sibling temporary file, preserves permissions, and replaces the destination with a platform-aware operation.

Conflicts offer Reload from disk, Overwrite, and Cancel, with Cancel as default. Reload confirms discarding local edits. Overwrite uses the version shown by the conflict and conflicts again if another change intervenes. Focus, tab activation, and operation completion check all documents using version equality, including timestamps moving backward. Clean documents reload automatically; dirty documents become stale.

## Diffing, editing, and startup

Read and diff jobs share two blocking workers; mutations share one. Cancellation commands stay on the async command path. Diff requests include tab identity and generation, coalesce queued work per tab, and discard superseded results. The frontend retains the 50 ms debounce and disables merge actions while their diff is stale.

Line, word, and alignment computation share a one-second deadline plus the alignment budget. Budget exhaustion uses a simpler valid positional alignment that reconstructs both inputs.

Merges use Monaco `executeEdits` with explicit undo boundaries. Store text comes from the resulting Monaco model. EOF insertion/deletion handles empty files and missing trailing newlines while preserving the target line-ending and trailing-newline convention. Models use document identity and survive tab switches; retired models are disposed after detachment.

The file comparison view, Monaco setup, and local workers load on the first file tab. Folder-only startup does not initialize Monaco. Suspense and an error boundary provide visible loading and failure states. The editor chunk remains large, but is no longer in the initial entry bundle.

## Commands and interfaces

| Command                                                   | Result or role                                |
| --------------------------------------------------------- | --------------------------------------------- |
| `compare_folders(left_path, right_path, mode)`            | ComparisonResult with entries, mode, warnings |
| `diff_text(left, right, tab_id, generation)`              | FileDiffResult                                |
| `read_file_text(path)`                                    | Validated document snapshot                   |
| `file_version(path)`                                      | Disk token or missing-file null               |
| `comparison_path_kind(path)`                              | Regular file or folder kind, or access error  |
| `save_document(target_path, text, bom, expected_version)` | Saved version or structured conflict          |
| `start_fs_op`, `cancel_fs_op`, `end_fs_op`                | Batch reservation and cancellation            |
| `plan_fs_batch`, `execute_fs_item`                        | Preflight plan and recoverable replacement    |
| `delete_paths`, `resolve_paths`, `is_directory`           | Supporting filesystem commands                |

## Validation and limits

Unit tests cover store and lifecycle races, comparison modes, disk versions, encoding, cancellation, path aliases, injected IO failures, and diff fallback. Vitest Browser Mode with Playwright exercises real Monaco merge/undo behavior and folder-only lazy startup. CI includes frontend/browser checks and Rust checks on macOS, Windows, and Linux.

See [validation](VALIDATION.md) for current check results and outstanding acceptance work. Recovery covers handled failures, not process crashes or power loss; durable recovery needs a transaction journal. Version checks do not exclusively lock out uncooperative external writers during final replacement. Native responsiveness, physical cross-volume moves, and Windows/Linux runtime replacement behavior still need platform validation.

Production CSP is disabled. The main window uses default core, dialog, store, and opener capabilities; custom application commands are registered without explicit application-command permissions. Local Monaco assets remove the need for a CDN, but native verification is required when tightening CSP, worker loading, and IPC permissions. These are release-hardening tasks, tracked separately from the initial source-collaboration milestone.
