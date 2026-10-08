pub use super::tree_index::{index, ChildIndex};
use crate::models::FileEntry;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub type FlatTree = BTreeMap<String, FileEntry>;
pub fn scan(root: &Path, warnings: &mut Vec<String>) -> Result<FlatTree, String> {
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    let mut flat = BTreeMap::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(e.to_string());
                continue;
            }
        };
        if entry.path() == root || entry.file_name() == ".DS_Store" {
            continue;
        }
        if entry.path_is_symlink() {
            warnings.push(format!("Skipped symbolic link: {}", entry.path().display()));
            continue;
        }
        if !entry.file_type().is_file() && !entry.file_type().is_dir() {
            warnings.push(format!(
                "Skipped unsupported file type: {}",
                entry.path().display()
            ));
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                warnings.push(e.to_string());
                continue;
            }
        };
        let relative = entry.path().strip_prefix(root).map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str() else {
            warnings.push(format!(
                "Skipped non-Unicode path: {}",
                entry.path().display()
            ));
            continue;
        };
        if relative.to_str().is_none() {
            warnings.push(format!(
                "Skipped non-Unicode path: {}",
                entry.path().display()
            ));
            continue;
        }
        let relative_path = relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let modified = match meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        {
            Some(d) => d.as_millis() as i64,
            None => {
                warnings.push(format!(
                    "Modification time unavailable: {}",
                    entry.path().display()
                ));
                -1
            }
        };
        flat.insert(
            relative_path.clone(),
            FileEntry {
                name: name.into(),
                relative_path,
                is_directory: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified,
                children: None,
            },
        );
    }
    Ok(flat)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scan_returns_error_for_nonexistent_path() {
        let temp = tempfile::tempdir().unwrap();
        assert!(scan(&temp.path().join("missing"), &mut Vec::new()).is_err());
    }

    #[test]
    fn comparison_returns_sorted_tree_from_scanned_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("subdir")).unwrap();
        fs::write(root.join("subdir/nested.txt"), "nested").unwrap();
        fs::write(root.join("alpha.txt"), "aaa").unwrap();
        fs::write(root.join("beta.txt"), "bb").unwrap();
        let path = root.to_str().unwrap();
        let result =
            crate::commands::compare::compare(path, path, crate::models::ComparisonMode::Quick)
                .unwrap();
        assert!(result.warnings.is_empty());
        let entries = result.entries;
        assert_eq!(entries[0].left.as_ref().unwrap().name, "subdir");
        assert!(entries[0].left.as_ref().unwrap().is_directory);
        assert_eq!(entries[0].children.as_ref().unwrap().len(), 1);
        assert_eq!(
            entries[0].children.as_ref().unwrap()[0]
                .left
                .as_ref()
                .unwrap()
                .name,
            "nested.txt"
        );
        assert_eq!(entries[1].left.as_ref().unwrap().name, "alpha.txt");
        assert_eq!(entries[2].left.as_ref().unwrap().name, "beta.txt");
        assert_eq!(entries[1].left.as_ref().unwrap().size, 3);
        assert_eq!(entries[2].left.as_ref().unwrap().size, 2);
    }

    #[cfg(unix)]
    #[test]
    fn scan_reports_skipped_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("real.txt"), "data").unwrap();
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("link.txt")).unwrap();
        let mut warnings = Vec::new();
        let flat = scan(root, &mut warnings).unwrap();
        assert!(flat.contains_key("real.txt"));
        assert!(!flat.contains_key("link.txt"));
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("link.txt"));
    }

    #[test]
    fn scan_uses_forward_slashes_in_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("a")).unwrap();
        fs::write(dir.path().join("a/b.txt"), "x").unwrap();
        let flat = scan(dir.path(), &mut Vec::new()).unwrap();
        assert_eq!(flat["a/b.txt"].relative_path, "a/b.txt");
    }
}
