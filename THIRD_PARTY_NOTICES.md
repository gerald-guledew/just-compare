# Third-party software and asset notices

JustCompare's original application source is distributed under the [MIT license](LICENSE). Third-party code, the Monaco patch and attributed icons retain their original copyright and license terms.

The versioned [inventory](third_party/inventory.json) records exact package versions, selected SPDX license branches, desktop target membership, source locations and notice hashes. The complete [notices](third_party/notices.txt) preserve package-supplied copyright, license and NOTICE material, including Monaco's entire `LICENSE` and `ThirdPartyNotices.txt`. Full selected license terms are retained in `third_party/licenses/`.

## Selection and provenance

- MIT is preferred when a package offers it as a genuine alternative. Mandatory AND terms are retained together. The reviewed legacy `BSD-3-Clause/MIT` expression is conservatively treated as requiring both notices. DOMPurify 3.4.16 is used under its Apache-2.0 option.
- Feather icons 4.29.2 supplies the inline folder, save and alert-triangle SVG geometry. Its complete Cole Bemis copyright and MIT notice are included. See [asset provenance](docs/ASSET_PROVENANCE.md).
- Monaco 0.55.1 has a tracked patch that catches word-highlighter cancellation errors and imports DOMPurify 3.4.16 instead of its older vendored sanitizer. The changed files and exact diff are retained in `patches/monaco-editor@0.55.1.patch`. These changes do not replace Microsoft's copyright or Monaco's upstream notices.
- Some crates omit license text from their published package. `third_party/supplements/catalog.json` records immutable upstream locations and hashes for supplemental notices. Where an old package provides only a published license declaration or an in-source notice, that original material is retained with the full selected license terms. These records are explicit, not inferred from the project's MIT license.

## MPL corresponding source

The inventory conservatively includes normal, build and test dependencies for all configured desktop targets, rather than assuming a build-time component cannot contribute code to an executable. Every included MPL-2.0 crate has its exact unmodified crates.io Source Code Form archive in [third_party/sources/](third_party/sources/). Archive SHA-256 values are verified against Cargo's published package checksum and recorded in the inventory. The archives contain original source, headers and package manifests and can be extracted with a gzip/tar archive tool.

These archives travel with the notices in generated applications. Recipients can obtain the corresponding source offline without relying on an upstream URL remaining available. When modifying covered MPL source, retain its notices, publish the corresponding modified files and update the source archive/inventory. The MPL does not change the license of unrelated application files.

## Reproducing and distributing notices

After changing dependencies, patches, the policy or this document:

```sh
pnpm install --frozen-lockfile
cargo fetch --manifest-path src-tauri/Cargo.toml --locked
pnpm notices:generate
pnpm notices:check
```

Generation uses the installed production dependency graph and offline locked Cargo metadata for Apple Silicon macOS, Intel macOS, Windows x64 MSVC and Linux x64. The frontend runtime dependency closure conservatively retains type-only transitive dependencies. Tailwind and its Vite plugin are classified as build tools and are not included as application runtime code. A new direct dependency or unreviewed license stops generation until the policy is updated.

CI regenerates and compares all notices and source archives. Every frontend production build verifies the recorded inputs and generated file hashes, then copies the notice tree to `dist/licenses/`. Tauri also maps the same tree to the installed application's `licenses/` resource directory. On macOS this is `JustCompare.app/Contents/Resources/licenses/`; other platforms use Tauri's resource directory. Open `index.html` or `notices.txt` there to read the notices offline.

This is a conservative dependency/source inventory, not a claim that every listed component appears in every installer. Before publishing binary releases, inspect each actual package for bundled native libraries and runtime components, preserve their applicable terms and meet any corresponding-source or relinking obligations. In particular, audit Windows WebView2 loader/runtime redistribution and Linux packages that bundle WebKitGTK, GTK or related shared libraries. These obligations are separate from publishing the application's source.
