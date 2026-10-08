# Asset provenance

This inventory covers project-authored artwork and the inline SVGs in `src/`.
Dependency artwork, including Monaco's Codicons, is covered by the dependency
notices and its upstream licence terms.

## Application icon

The editable master is [`assets/justcompare-icon.svg`](../assets/justcompare-icon.svg).
It was created for JustCompare in October 2026 using two document panes,
matching text lines, and amber difference markers. It uses no imported paths,
fonts, screenshots, or third-party logos. The master and its generated variants
are distributed under the project [MIT licence](../LICENSE), including the
project copyright notice.

All 16 existing desktop assets in `src-tauri/icons/` were regenerated from this
master with `tauri-cli 2.10.1`. The generated 32px and 512px PNGs were inspected
visually. The icon is distinct from the default Tauri artwork.

To regenerate the icon assets, run from the repository root:

```sh
pnpm tauri icon assets/justcompare-icon.svg --output src-tauri/icons
```

The CLI also generates optional mobile assets and a 64px PNG. These are not
part of the current desktop icon inventory. Review generated files before
adding extra platform assets to source control.

## Retained Feather icons

These SVGs match [Feather v4.29.2](https://github.com/feathericons/feather/tree/v4.29.2)
and are used under its MIT licence, copyright (c) 2013-2023 Cole Bemis.
The complete upstream copyright and licence notice is included in the project's
third-party notices. Resizing, React attribute names, and equivalent path
syntax do not change the upstream geometry.

| Upstream asset | Application use | Source |
| --- | --- | --- |
| `folder.svg` | Choose-file button in `PaneHeader.tsx` | [Pinned SVG](https://github.com/feathericons/feather/blob/v4.29.2/icons/folder.svg) |
| `save.svg` | Save buttons in `PaneHeader.tsx` and `TabBar.tsx` | [Pinned SVG](https://github.com/feathericons/feather/blob/v4.29.2/icons/save.svg) |
| `alert-triangle.svg` | Error indicator in `FileCompareView.tsx` | [Pinned SVG](https://github.com/feathericons/feather/blob/v4.29.2/icons/alert-triangle.svg) |

Licence source: [Feather v4.29.2 LICENSE](https://github.com/feathericons/feather/blob/v4.29.2/LICENSE).
Keep the full notice when redistributing these icons or application bundles.

## Original inline glyphs

The following small glyphs were drawn from basic SVG shapes for this source
baseline and are covered by the project MIT licence:

- Folder and folded-document glyphs in `FileRow.tsx`.
- Refresh glyph in `TabBar.tsx`.
- Left and right copy arrows in `MergeGutterOverlay.tsx`.

Their previous geometry had no established attribution and was replaced during
the asset review. Functionality, labels, and status colours are unchanged.

## Inventory boundaries

The tracked project image inventory contains the application icon master and
its desktop variants. No reference screenshots, third-party product logos,
custom fonts, or marketing photographs are included. Source review identified
all inline SVGs in the five components listed above. Empty diff padding uses a
CSS stripe pattern; its comment describes the alignment function.

This records asset sources and the review performed. It does not constitute
trademark clearance for the application name or a legal opinion about the UI.
