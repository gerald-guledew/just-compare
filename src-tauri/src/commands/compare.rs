use crate::models::{
    ComparisonEntry, ComparisonMode, ComparisonResult, ComparisonStatus, FileEntry,
};
use crate::services::{
    scanning::{self, ChildIndex, FlatTree},
    workers,
};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

#[tauri::command]
pub async fn compare_folders(
    left_path: String,
    right_path: String,
    mode: ComparisonMode,
) -> Result<ComparisonResult, String> {
    workers::read(move || compare(&left_path, &right_path, mode)).await
}
pub fn compare(left: &str, right: &str, mode: ComparisonMode) -> Result<ComparisonResult, String> {
    let mut warnings = Vec::new();
    let l = scanning::scan(Path::new(left), &mut warnings)?;
    let r = scanning::scan(Path::new(right), &mut warnings)?;
    let index = scanning::index(l.keys().chain(r.keys()));
    let entries = children(
        "",
        &l,
        &r,
        &index,
        &Roots {
            left: Path::new(left),
            right: Path::new(right),
            mode,
        },
        &mut warnings,
    );
    Ok(ComparisonResult {
        entries,
        mode,
        warnings,
    })
}
struct Roots<'a> {
    left: &'a Path,
    right: &'a Path,
    mode: ComparisonMode,
}
fn children(
    parent: &str,
    left: &FlatTree,
    right: &FlatTree,
    index: &ChildIndex,
    roots: &Roots,
    warnings: &mut Vec<String>,
) -> Vec<ComparisonEntry> {
    let mut out: Vec<_> = index
        .get(parent)
        .into_iter()
        .flatten()
        .map(|key| {
            let l = left.get(key).cloned();
            let r = right.get(key).cloned();
            let is_dir = l.as_ref().is_some_and(|e| e.is_directory)
                || r.as_ref().is_some_and(|e| e.is_directory);
            let status = status(&l, &r, roots, warnings);
            let children = is_dir.then(|| children(key, left, right, index, roots, warnings));
            let has_orphan_children = children.as_ref().is_some_and(|c| {
                c.iter().any(|e| {
                    e.has_orphan_children
                        || matches!(
                            e.status,
                            ComparisonStatus::LeftOnly
                                | ComparisonStatus::RightOnly
                                | ComparisonStatus::DirectoryLeftOnly
                                | ComparisonStatus::DirectoryRightOnly
                        )
                })
            });
            let has_modified_children = children.as_ref().is_some_and(|c| {
                c.iter()
                    .any(|e| e.has_modified_children || e.status == ComparisonStatus::Modified)
            });
            ComparisonEntry {
                left: l,
                right: r,
                status,
                children,
                has_orphan_children,
                has_modified_children,
            }
        })
        .collect();
    out.sort_by_cached_key(|e| {
        let f = e.left.as_ref().or(e.right.as_ref());
        (
            e.children.is_none(),
            f.map(|f| f.name.to_lowercase()),
            f.map(|f| f.name.clone()),
        )
    });
    out
}
fn status(
    left: &Option<FileEntry>,
    right: &Option<FileEntry>,
    roots: &Roots,
    warnings: &mut Vec<String>,
) -> ComparisonStatus {
    use ComparisonStatus::*;
    match (left, right) {
        (Some(l), Some(r)) if l.is_directory && r.is_directory => DirectoryBoth,
        (Some(l), Some(r)) if !l.is_directory && !r.is_directory && l.size == r.size => {
            if roots.mode == ComparisonMode::Quick && l.modified >= 0 && l.modified == r.modified {
                return MetadataMatch;
            }
            match compare_bytes(
                &roots.left.join(&l.relative_path),
                &roots.right.join(&r.relative_path),
            ) {
                Ok(true) => Identical,
                Ok(false) => Modified,
                Err(e) => {
                    warnings.push(format!("Could not verify {}: {e}", l.relative_path));
                    Modified
                }
            }
        }
        (Some(_), Some(_)) => Modified,
        (Some(l), None) => {
            if l.is_directory {
                DirectoryLeftOnly
            } else {
                LeftOnly
            }
        }
        (None, Some(r)) => {
            if r.is_directory {
                DirectoryRightOnly
            } else {
                RightOnly
            }
        }
        _ => Modified,
    }
}
fn compare_bytes(left: &Path, right: &Path) -> Result<bool, String> {
    let mut a = BufReader::new(File::open(left).map_err(|e| e.to_string())?);
    let mut b = BufReader::new(File::open(right).map_err(|e| e.to_string())?);
    let before_a = crate::services::documents::metadata_token(
        &a.get_ref().metadata().map_err(|e| e.to_string())?,
    );
    let before_b = crate::services::documents::metadata_token(
        &b.get_ref().metadata().map_err(|e| e.to_string())?,
    );
    let mut x = [0u8; 65536];
    let mut y = [0u8; 65536];
    loop {
        let nx = read_full(&mut a, &mut x).map_err(|e| e.to_string())?;
        let ny = read_full(&mut b, &mut y).map_err(|e| e.to_string())?;
        if nx != ny || x[..nx] != y[..ny] {
            return Ok(false);
        }
        if nx == 0 {
            break;
        }
    }
    if before_a
        != crate::services::documents::metadata_token(
            &std::fs::metadata(left).map_err(|e| e.to_string())?,
        )
        || before_b
            != crate::services::documents::metadata_token(
                &std::fs::metadata(right).map_err(|e| e.to_string())?,
            )
    {
        return Err("File changed while comparing".into());
    }
    Ok(true)
}
fn read_full(reader: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = reader.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(filled)
}
#[cfg(test)]
fn same_contents(left: &Path, right: &Path) -> bool {
    compare_bytes(left, right).unwrap_or(false)
}
#[cfg(test)]
fn compare_entries(left: String, right: String) -> Result<Vec<ComparisonEntry>, String> {
    Ok(compare(&left, &right, ComparisonMode::Quick)?.entries)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn compare_identical_folders() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();

        fs::write(left.path().join("a.txt"), "hello").unwrap();
        fs::write(right.path().join("a.txt"), "hello").unwrap();

        // Copy modified time from left to right so they match
        let meta = fs::metadata(left.path().join("a.txt")).unwrap();
        let mtime = meta.modified().unwrap();
        filetime::set_file_mtime(
            right.path().join("a.txt"),
            filetime::FileTime::from_system_time(mtime),
        )
        .unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, ComparisonStatus::MetadataMatch);
    }

    #[test]
    fn compare_detects_left_only_and_right_only() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();

        fs::write(left.path().join("only_left.txt"), "L").unwrap();
        fs::write(right.path().join("only_right.txt"), "R").unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(result.len(), 2);

        let left_only = result
            .iter()
            .find(|e| e.left.as_ref().is_some_and(|l| l.name == "only_left.txt"));
        let right_only = result
            .iter()
            .find(|e| e.right.as_ref().is_some_and(|r| r.name == "only_right.txt"));

        assert!(left_only.is_some());
        assert_eq!(left_only.unwrap().status, ComparisonStatus::LeftOnly);
        assert!(right_only.is_some());
        assert_eq!(right_only.unwrap().status, ComparisonStatus::RightOnly);
    }

    #[test]
    fn compare_detects_modified_files() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();

        fs::write(left.path().join("file.txt"), "short").unwrap();
        fs::write(right.path().join("file.txt"), "much longer content").unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, ComparisonStatus::Modified);
    }

    /// Compare two temp folders that each hold one `file.txt` with the given
    /// contents, saved at different times.
    fn status_with_different_mtimes(left_text: &str, right_text: &str) -> ComparisonStatus {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();
        fs::write(left.path().join("file.txt"), left_text).unwrap();
        fs::write(right.path().join("file.txt"), right_text).unwrap();
        filetime::set_file_mtime(
            left.path().join("file.txt"),
            filetime::FileTime::from_unix_time(1_700_000_000, 0),
        )
        .unwrap();
        filetime::set_file_mtime(
            right.path().join("file.txt"),
            filetime::FileTime::from_unix_time(1_700_000_600, 0),
        )
        .unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(result.len(), 1);
        result[0].status.clone()
    }

    // Regression: merging one side into the other and saving made the files
    // the same but gave one a newer modified time, and the folder view kept
    // flagging the pair as different.
    #[test]
    fn compare_same_content_saved_at_different_times_is_identical() {
        assert_eq!(
            status_with_different_mtimes("same text\n", "same text\n"),
            ComparisonStatus::Identical
        );
    }

    #[test]
    fn compare_same_size_different_content_is_modified() {
        assert_eq!(
            status_with_different_mtimes("same size A\n", "same size B\n"),
            ComparisonStatus::Modified
        );
    }

    #[test]
    fn same_contents_compares_across_chunk_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut last_byte_differs = big.clone();
        *last_byte_differs.last_mut().unwrap() ^= 1;

        fs::write(dir.path().join("a"), &big).unwrap();
        fs::write(dir.path().join("b"), &big).unwrap();
        fs::write(dir.path().join("c"), &last_byte_differs).unwrap();
        fs::write(dir.path().join("empty1"), "").unwrap();
        fs::write(dir.path().join("empty2"), "").unwrap();

        assert!(same_contents(&dir.path().join("a"), &dir.path().join("b")));
        assert!(!same_contents(&dir.path().join("a"), &dir.path().join("c")));
        assert!(same_contents(
            &dir.path().join("empty1"),
            &dir.path().join("empty2")
        ));
        assert!(!same_contents(
            &dir.path().join("a"),
            &dir.path().join("missing")
        ));
    }

    #[test]
    fn compare_filters_ds_store_files() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();

        fs::write(left.path().join("real.txt"), "hello").unwrap();
        fs::write(left.path().join(".DS_Store"), "").unwrap();
        fs::write(right.path().join("real.txt"), "hello").unwrap();
        fs::write(right.path().join(".DS_Store"), "").unwrap();

        // Copy modified time so real.txt is identical
        let meta = fs::metadata(left.path().join("real.txt")).unwrap();
        let mtime = meta.modified().unwrap();
        filetime::set_file_mtime(
            right.path().join("real.txt"),
            filetime::FileTime::from_system_time(mtime),
        )
        .unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].left.as_ref().unwrap().name, "real.txt");
    }

    #[test]
    fn compare_handles_nested_directories() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();

        fs::create_dir(left.path().join("sub")).unwrap();
        fs::write(left.path().join("sub/a.txt"), "a").unwrap();
        fs::create_dir(right.path().join("sub")).unwrap();
        fs::write(right.path().join("sub/b.txt"), "b").unwrap();

        let result = compare_entries(
            left.path().to_string_lossy().to_string(),
            right.path().to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, ComparisonStatus::DirectoryBoth);

        let children = result[0].children.as_ref().unwrap();
        assert_eq!(children.len(), 2);

        let a = children
            .iter()
            .find(|c| c.left.as_ref().is_some_and(|l| l.name == "a.txt"));
        let b = children
            .iter()
            .find(|c| c.right.as_ref().is_some_and(|r| r.name == "b.txt"));

        assert_eq!(a.unwrap().status, ComparisonStatus::LeftOnly);
        assert_eq!(b.unwrap().status, ComparisonStatus::RightOnly);
    }
}

#[cfg(test)]
mod mode_tests {
    use super::*;
    #[test]
    fn quick_metadata_and_verified_bytes_are_distinct() {
        let l = tempfile::tempdir().unwrap();
        let r = tempfile::tempdir().unwrap();
        std::fs::write(l.path().join("a"), "AAA").unwrap();
        std::fs::write(r.path().join("a"), "BBB").unwrap();
        for root in [l.path(), r.path()] {
            filetime::set_file_mtime(root.join("a"), filetime::FileTime::from_unix_time(100, 0))
                .unwrap();
        }
        let quick = compare(
            l.path().to_str().unwrap(),
            r.path().to_str().unwrap(),
            ComparisonMode::Quick,
        )
        .unwrap();
        let verified = compare(
            l.path().to_str().unwrap(),
            r.path().to_str().unwrap(),
            ComparisonMode::Verified,
        )
        .unwrap();
        assert_eq!(quick.entries[0].status, ComparisonStatus::MetadataMatch);
        assert_eq!(verified.entries[0].status, ComparisonStatus::Modified);
        std::fs::write(r.path().join("a"), "AAA").unwrap();
        let verified = compare(
            l.path().to_str().unwrap(),
            r.path().to_str().unwrap(),
            ComparisonMode::Verified,
        )
        .unwrap();
        assert_eq!(verified.entries[0].status, ComparisonStatus::Identical);
    }
    #[test]
    fn failed_content_read_is_not_identical() {
        let entry = FileEntry {
            name: "missing".into(),
            relative_path: "missing".into(),
            is_directory: false,
            size: 1,
            modified: 1,
            children: None,
        };
        let mut warnings = Vec::new();
        let result = status(
            &Some(entry.clone()),
            &Some(entry),
            &Roots {
                left: Path::new("/nonexistent"),
                right: Path::new("/nonexistent"),
                mode: ComparisonMode::Verified,
            },
            &mut warnings,
        );
        assert_eq!(result, ComparisonStatus::Modified);
        assert!(!warnings.is_empty());
    }
}

#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs::{self, FileTimes};
    use std::time::{Duration, Instant, UNIX_EPOCH};

    fn original_index(keys: &[String]) -> ChildIndex {
        let parents: BTreeSet<_> = keys
            .iter()
            .map(|key| key.rsplit_once('/').map_or("", |(parent, _)| parent))
            .collect();
        let mut index = ChildIndex::new();
        for parent in parents {
            let mut children = Vec::new();
            for key in keys.iter().chain(keys.iter()) {
                if key.rsplit_once('/').map_or("", |(p, _)| p) == parent && !children.contains(key)
                {
                    children.push(key.clone());
                }
            }
            index.insert(parent.into(), children);
        }
        index
    }
    fn count_matches(entries: &[ComparisonEntry]) -> usize {
        entries
            .iter()
            .map(|entry| {
                if let Some(children) = &entry.children {
                    count_matches(children)
                } else {
                    assert_eq!(entry.status, ComparisonStatus::MetadataMatch);
                    1
                }
            })
            .sum()
    }

    // Opt-in workload test, excluded from routine CI because it creates 440,000 files.
    #[test]
    #[ignore = "generated 10k/100k disk-tree benchmark"]
    fn benchmark_generated_disk_trees() {
        let algorithm = std::env::var("JUSTCOMPARE_BENCH_ALGORITHM").ok();
        for n in [10_000, 100_000] {
            for nested in [false, true] {
                let temp = tempfile::tempdir().unwrap();
                let left = temp.path().join("left");
                let right = temp.path().join("right");
                let modified = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
                for root in [&left, &right] {
                    fs::create_dir(root).unwrap();
                    for i in 0..n {
                        let key = if nested {
                            format!("group{:04}/sub/file{i:06}", i / 100)
                        } else {
                            format!("file{i:06}")
                        };
                        let path = root.join(key);
                        fs::create_dir_all(path.parent().unwrap()).unwrap();
                        fs::write(&path, b"same\n").unwrap();
                        File::open(&path)
                            .unwrap()
                            .set_times(FileTimes::new().set_modified(modified))
                            .unwrap();
                    }
                }
                let mut previous = None;
                for variant in ["baseline", "indexed"] {
                    if algorithm.as_deref().is_some_and(|chosen| chosen != variant) {
                        continue;
                    }
                    let start = Instant::now();
                    let mut warnings = Vec::new();
                    let l = scanning::scan(&left, &mut warnings).unwrap();
                    let r = scanning::scan(&right, &mut warnings).unwrap();
                    let index = if variant == "baseline" {
                        let keys: Vec<_> = l
                            .keys()
                            .chain(r.keys())
                            .cloned()
                            .collect::<BTreeSet<_>>()
                            .into_iter()
                            .collect();
                        original_index(&keys)
                    } else {
                        scanning::index(l.keys().chain(r.keys()))
                    };
                    let result = children(
                        "",
                        &l,
                        &r,
                        &index,
                        &Roots {
                            left: &left,
                            right: &right,
                            mode: ComparisonMode::Quick,
                        },
                        &mut warnings,
                    );
                    let elapsed = start.elapsed();
                    assert!(warnings.is_empty());
                    assert_eq!(count_matches(&result), n);
                    let serialized = serde_json::to_vec(&result).unwrap();
                    if let Some(previous) = &previous {
                        assert_eq!(previous, &serialized);
                    }
                    if algorithm.is_none() {
                        previous = Some(serialized);
                    }
                    println!("{n} files per side, {}: {variant} scan/index/build {:.3}s, correct results", if nested { "nested" } else { "wide" }, elapsed.as_secs_f64());
                }
            }
        }
    }
}
