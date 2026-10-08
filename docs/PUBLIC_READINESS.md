# Source-publication readiness

Review date: 8 October 2026 (Pacific/Auckland).

## Publication milestone

JustCompare 0.1.0 is being prepared for developer source collaboration under MIT. Source publication and a general-user installer release have separate acceptance criteria. The application remains early-stage software, with native platform and security-hardening work outstanding.

Current validation of the publication candidate is recorded in [VALIDATION.md](VALIDATION.md). Pending checks must be completed and recorded against the final source tree before changing repository visibility. This review does not certify trademark availability or guarantee that every security or licensing issue has been identified.

## Source-publication gate

- Use the reviewed implementation with its filesystem identity checks, staged copy/move recovery, version-aware saves, strict UTF-8 editing, and local Monaco workers.
- Replace starter branding with original application artwork and retain notices for incorporated third-party assets and dependencies. See [third-party notices](../THIRD_PARTY_NOTICES.md).
- Review the exact source snapshot and its new Git history for credentials, personal paths, unrelated material, and unintended assets. Retain required copyright, license, and contributor attribution.
- Validate a fresh checkout using frozen lockfiles, frontend unit/browser tests and build, Rust tests, formatting, and strict Clippy. Obtain successful CI on the publication candidate.
- Run current JavaScript and Rust dependency audits. Record the date, vulnerabilities, maintenance/unsound warnings, and any justified follow-up rather than relying on a previous audit. The current Rust warnings, including the unresolved Linux runtime `glib` advisory, are recorded in [validation](VALIDATION.md).
- Keep setup instructions, limitations, contribution guidance, and vulnerability reporting current. Publish source with no claim of installer validation, exclusive filesystem locking, transactional batches, or crash recovery.

Package metadata remains `private: true` to prevent accidental npm publication. This setting is independent of GitHub repository visibility.

## Deferred installer gates

1. Restrict production [Content Security Policy](https://v2.tauri.app/security/csp/) to the assets, workers, styles, and IPC actually required. Minimize plugin capabilities and review explicit application-command permissions. Verify editor workers, dialogs, persistence, and IPC in production native webviews.
2. Validate native save replacement, dirty-document conflicts, drag/drop, permission failures, cancellation, and physical cross-volume moves on each distributed platform. Record actual disk outcomes with synthetic fixtures.
3. Resolve or explicitly assess outstanding runtime advisories for each distributed platform. Package complete target-specific dependency and system-library notices with installers. Validate the resulting artifacts, establish signing/notarization where applicable, publish checksums, and document a versioned release process.
4. Implement durable journaling and restart recovery before offering crash-safe or transactional guarantees. Until then, preserve the documented limits on per-item recovery and permanent, potentially partial deletion.

Browser and Rust CI checks are useful evidence but do not establish native UI acceptance. See [SECURITY.md](../SECURITY.md) for the current webview and filesystem security boundary.
