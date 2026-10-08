# Contributing

Open an issue to discuss substantial changes before implementing them. For bugs, include the application revision, operating system, steps to reproduce, expected behavior, and actual behavior. Use synthetic files and redact personal paths and contents.

Follow the setup instructions in [README.md](README.md). Use pnpm, strict TypeScript, functional React components, and typed Tauri wrappers in `src/lib/tauri.ts`. Rust owns filesystem access; keep frontend and backend models aligned. Persist UI settings through the Tauri store plugin.

Add behavior-focused regression tests for correctness changes, especially saves, merge/undo, filesystem mutations, encodings, and cancellation. Run frontend unit tests and build, Rust tests, formatting, and strict Clippy. Run browser tests for editor or UI lifecycle changes. Note which native platforms you actually tested.

The first distribution milestone is public source collaboration. Record current check results in [validation](docs/VALIDATION.md) and distinguish browser/Rust checks from native application acceptance. Keep filesystem and security limitations accurate when changing these behaviors.

Use concise conventional commit subjects such as `fix: preserve saved document revisions`. Pull requests should explain the problem, resulting behavior, validation, and remaining limitations. Include screenshots for visible UI changes and platform notes for native behavior.

The Monaco lifecycle patch and sanitizer override are tracked in `pnpm-workspace.yaml`. Review both when upgrading Monaco. Use frozen lockfiles in CI and commit lockfile changes with dependency updates.

Record the origin and license of added code or assets and retain required copyright notices. Update [third-party notices](THIRD_PARTY_NOTICES.md) and their supporting inventory when dependencies or incorporated assets change. Use original or appropriately licensed artwork and synthetic files in screenshots and demos.

Contributions are distributed under this project's [MIT license](LICENSE). Report security issues privately as described in [SECURITY.md](SECURITY.md).
