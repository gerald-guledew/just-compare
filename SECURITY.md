# Security policy

JustCompare is early-stage software distributed as source for developers and contributors. No maintained installer release is currently offered. Security fixes target the latest source on the default branch; older revisions do not receive separate maintenance.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/gerald-guledew/just-compare/security/advisories/new) when enabled. If unavailable, email the maintainer at gerald.guledew@gmail.com with the subject `JustCompare security report`.

Include the affected revision, platform, impact, and a minimal reproduction using synthetic files. Do not post exploitable details, credentials, or private file contents in public issues. There is no guaranteed response time or service-level agreement.

## Security scope and limits

The application reads and can modify files selected by the user. Deletion is permanent. Copy/move recovery handles ordinary failures per item, without a durable crash-recovery journal. Version checks do not provide exclusive filesystem locking.

The UI bundles Monaco and its workers locally. Tauri's production Content Security Policy is currently disabled; restricting it and testing editor workers and IPC in native webviews is an outstanding hardening task. No remote content should be added without reviewing Tauri capabilities and the webview security boundary.

The trusted main window can invoke custom filesystem commands with supplied paths. Plugin capability scopes do not restrict these application commands to the directories selected in the UI. Capability minimization and explicit application-command permissions remain follow-up work.

See [source-publication readiness](docs/PUBLIC_READINESS.md) and [validation](docs/VALIDATION.md) for dated dependency audit results and remaining work. General-user installers require native security and filesystem acceptance in addition to automated checks.
