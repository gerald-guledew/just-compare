use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use walkdir::WalkDir;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedItem {
    pub src: String,
    pub dst: String,
    pub source_version: String,
    pub destination_version: Option<String>,
    pub is_directory: bool,
    pub total_bytes: u64,
}

pub fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

/// Resolve an absent destination through its nearest existing parent.
/// Do not normalize '..' lexically: a preceding component may be a symlink.
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Empty path".into());
    }
    match fs::symlink_metadata(path) {
        Ok(_) => fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            let name = path
                .file_name()
                .ok_or_else(|| format!("Invalid path: {}", path.display()))?;
            Ok(resolve(parent)?.join(name))
        }
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn paths_overlap(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}

fn reject_link(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "Symbolic links are unsupported: {}",
            path.display()
        ));
    }
    if !meta.is_file() && !meta.is_dir() {
        return Err(format!("Unsupported file type: {}", path.display()));
    }
    Ok(())
}

/// Content and metadata fingerprint, including directory membership. Any walk
/// or read error fails preflight rather than disappearing from the manifest.
pub fn fingerprint(path: &Path, cancel: &AtomicBool) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
        Ok(_) => {}
    }
    let mut hash = Sha256::new();
    for entry in WalkDir::new(path).follow_links(false).sort_by_file_name() {
        check(cancel)?;
        let entry = entry.map_err(|e| e.to_string())?;
        reject_link(entry.path())?;
        let meta = fs::metadata(entry.path()).map_err(|e| e.to_string())?;
        hash.update(
            entry
                .path()
                .strip_prefix(path)
                .map_err(|e| e.to_string())?
                .as_os_str()
                .as_encoded_bytes(),
        );
        hash.update(crate::services::documents::metadata_token(&meta));
        if meta.is_file() {
            let mut file =
                File::open(entry.path()).map_err(|e| format!("{}: {e}", entry.path().display()))?;
            let mut buf = [0u8; 65536];
            loop {
                check(cancel)?;
                let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buf[..n]);
            }
            let after = file.metadata().map_err(|e| e.to_string())?;
            let at_path = fs::metadata(entry.path()).map_err(|e| e.to_string())?;
            if crate::services::documents::metadata_token(&meta)
                != crate::services::documents::metadata_token(&after)
                || crate::services::documents::metadata_token(&after)
                    != crate::services::documents::metadata_token(&at_path)
            {
                return Err(format!(
                    "File changed while inspecting: {}",
                    entry.path().display()
                ));
            }
        }
    }
    Ok(Some(format!("{:x}", hash.finalize())))
}

pub fn plan_batch(
    pairs: Vec<(String, String)>,
    cancel: &AtomicBool,
) -> Result<Vec<PlannedItem>, String> {
    let mut paths = Vec::new();
    for (src, dst) in pairs {
        check(cancel)?;
        reject_link(Path::new(&src))?;
        if fs::symlink_metadata(&dst).is_ok() {
            reject_link(Path::new(&dst))?;
        }
        let src = resolve(Path::new(&src))?;
        let dst = resolve(Path::new(&dst))?;
        if paths_overlap(&src, &dst)
            || (dst.exists() && same_file::is_same_file(&src, &dst).map_err(|e| e.to_string())?)
        {
            return Err(format!(
                "Source and destination overlap: {} and {}",
                src.display(),
                dst.display()
            ));
        }
        paths.push((src, dst));
    }
    // Collapse a selected descendant only when it maps under the same parent destination.
    let mut kept = Vec::new();
    for (i, (src, dst)) in paths.iter().enumerate() {
        let mut covered = false;
        for (j, (parent_src, parent_dst)) in paths.iter().enumerate() {
            if i != j && src != parent_src && src.starts_with(parent_src) {
                let relative = src.strip_prefix(parent_src).map_err(|e| e.to_string())?;
                if *dst != parent_dst.join(relative) {
                    return Err("Overlapping selections have conflicting destinations".into());
                }
                covered = true;
            }
        }
        if !covered {
            kept.push((src.clone(), dst.clone()));
        }
    }
    let mut destinations = BTreeSet::new();
    for (i, (_, dst)) in kept.iter().enumerate() {
        if !destinations.insert(dst.clone()) {
            return Err(format!("Duplicate destination: {}", dst.display()));
        }
        for (j, (src, other_dst)) in kept.iter().enumerate() {
            if i != j
                && (paths_overlap(dst, src)
                    || paths_overlap(dst, other_dst)
                    || (dst.exists()
                        && other_dst.exists()
                        && same_file::is_same_file(dst, other_dst).map_err(|e| e.to_string())?)
                    || (dst.exists()
                        && same_file::is_same_file(dst, src).map_err(|e| e.to_string())?))
            {
                return Err("Selected operations conflict with one another".into());
            }
        }
    }
    kept.into_iter()
        .map(|(src, dst)| {
            Ok(PlannedItem {
                source_version: fingerprint(&src, cancel)?.ok_or("Source disappeared")?,
                is_directory: src.is_dir(),
                total_bytes: tree_bytes(&src, cancel)?,
                destination_version: fingerprint(&dst, cancel)?,
                src: src.to_string_lossy().into_owned(),
                dst: dst.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

fn remove(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|e| e.to_string())
}

fn cleanup_recovery(recovery: tempfile::TempDir) -> Result<(), String> {
    let path = recovery.keep();
    let cleanup = (|| {
        // Only recovery contents are changed, after rollback or successful commit.
        for entry in WalkDir::new(&path).follow_links(false) {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            if metadata.is_dir() {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(
                    entry.path(),
                    fs::Permissions::from_mode(metadata.permissions().mode() | 0o700),
                )
                .map_err(|e| e.to_string())?;
            }
            #[cfg(windows)]
            if !metadata.file_type().is_symlink() && metadata.permissions().readonly() {
                let mut permissions = metadata.permissions();
                // This Windows-only branch clears the read-only attribute.
                // Unix recovery permissions are handled explicitly above.
                #[allow(clippy::permissions_set_readonly_false)]
                permissions.set_readonly(false);
                fs::set_permissions(entry.path(), permissions).map_err(|e| e.to_string())?;
            }
        }
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    })();
    cleanup.map_err(|error| {
        format!(
            "Recovery cleanup failed: {error}; recovery files: {}",
            path.display()
        )
    })
}

fn copy_tree(
    src: &Path,
    dst: &Path,
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, &Path),
) -> Result<(), String> {
    let mut dirs = Vec::new();
    for entry in WalkDir::new(src).follow_links(false) {
        check(cancel)?;
        let entry = entry.map_err(|e| e.to_string())?;
        reject_link(entry.path())?;
        let relative = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        let target = if relative.as_os_str().is_empty() {
            dst.to_path_buf()
        } else {
            dst.join(relative)
        };
        let meta = fs::metadata(entry.path()).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            fs::create_dir(&target).map_err(|e| e.to_string())?;
            dirs.push((target, meta.permissions()));
        } else {
            let mut input = File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut output = File::create(&target).map_err(|e| e.to_string())?;
            let mut buf = [0u8; 65536];
            loop {
                check(cancel)?;
                let n = input.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                output.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                progress(n as u64, entry.path());
            }
            output
                .set_permissions(meta.permissions())
                .map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
        }
    }
    for (path, permissions) in dirs.into_iter().rev() {
        fs::set_permissions(path, permissions).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn verify(src: &Path, dst: &Path, cancel: &AtomicBool) -> Result<(), String> {
    for entry in WalkDir::new(src).follow_links(false) {
        check(cancel)?;
        let entry = entry.map_err(|e| e.to_string())?;
        reject_link(entry.path())?;
        let relative = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        let target = if relative.as_os_str().is_empty() {
            dst.to_path_buf()
        } else {
            dst.join(relative)
        };
        if entry.file_type().is_file() {
            let mut a = File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut b = File::open(target).map_err(|e| e.to_string())?;
            let mut x = [0u8; 65536];
            let mut y = [0u8; 65536];
            loop {
                check(cancel)?;
                let nx = read_chunk(&mut a, &mut x)?;
                let ny = read_chunk(&mut b, &mut y)?;
                if nx != ny || x[..nx] != y[..ny] {
                    return Err(format!(
                        "Copy verification failed: {}",
                        entry.path().display()
                    ));
                }
                if nx == 0 {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn read_chunk(file: &mut File, buf: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..]).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(filled)
}

#[derive(Default)]
pub struct Faults {
    pub cross_device: bool,
    pub commit: bool,
    pub cleanup: bool,
}

pub fn execute(
    item: &PlannedItem,
    moving: bool,
    overwrite: bool,
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, &Path),
    faults: &Faults,
) -> Result<(), String> {
    check(cancel)?;
    // Re-resolve aliases and relationships on every execution, not just in the UI preflight.
    let fresh = plan_batch(vec![(item.src.clone(), item.dst.clone())], cancel)?.remove(0);
    if fresh.source_version != item.source_version {
        return Err("Source changed; run the operation again".into());
    }
    if fresh.destination_version != item.destination_version {
        return Err("Destination changed; confirm the replacement again".into());
    }
    if item.destination_version.is_some() && !overwrite {
        return Err("destination exists".into());
    }
    let src = Path::new(&item.src);
    let dst = Path::new(&item.dst);
    let parent = dst.parent().ok_or("Destination has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let recovery = tempfile::Builder::new()
        .prefix(".justcompare-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let stage = recovery.path().join("staged");
    let backup = recovery.path().join("previous");
    let mut renamed_source = false;
    if moving && !faults.cross_device {
        match fs::rename(src, &stage) {
            Ok(()) => renamed_source = true,
            Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {}
            Err(e) => return Err(format!("Move failed: {e}")),
        }
    }
    let preparation: Result<(), String> = (|| {
        if !renamed_source {
            copy_tree(src, &stage, cancel, progress)?;
            if moving {
                verify(src, &stage, cancel)?;
            }
            if fingerprint(src, cancel)?.as_deref() != Some(&item.source_version) {
                return Err("Source changed while copying".into());
            }
        }
        check(cancel)?;
        if fingerprint(dst, cancel)? != item.destination_version {
            return Err("Destination changed; confirm the replacement again".into());
        }
        Ok(())
    })();
    if let Err(e) = preparation {
        if renamed_source {
            restore_source(&stage, src, recovery, &e)?;
        } else if let Err(cleanup) = cleanup_recovery(recovery) {
            return Err(format!("{e}; {cleanup}"));
        }
        return Err(e);
    }
    if item.destination_version.is_some() {
        if let Err(e) = fs::rename(dst, &backup) {
            if renamed_source {
                restore_source(&stage, src, recovery, &e.to_string())?;
            } else if let Err(cleanup) = cleanup_recovery(recovery) {
                return Err(format!("{e}; {cleanup}"));
            }
            return Err(e.to_string());
        }
    }
    let commit = if faults.commit {
        Err(std::io::Error::other("Injected commit failure"))
    } else {
        fs::rename(&stage, dst)
    };
    if let Err(e) = commit {
        let mut errors = vec![e.to_string()];
        if backup.exists() {
            if let Err(e) = restore_without_overwrite(&backup, dst) {
                errors.push(format!("Destination restore failed: {e}"));
            }
        }
        if renamed_source {
            if let Err(e) = restore_without_overwrite(&stage, src) {
                errors.push(format!("Source restore failed: {e}"));
            }
        }
        if errors.len() > 1 {
            let saved = recovery.keep();
            return Err(format!(
                "{}; recovery files: {}",
                errors.join("; "),
                saved.display()
            ));
        }
        if let Err(cleanup) = cleanup_recovery(recovery) {
            errors.push(cleanup);
        }
        return Err(errors.join("; "));
    }
    if moving && !renamed_source {
        // Recheck after commit too: never delete source edits made during destination replacement.
        match fingerprint(src, &AtomicBool::new(false)) {
            Ok(Some(version)) if version == item.source_version => {}
            result => {
                let detail = match result {
                    Err(error) => error,
                    _ => "Source changed after destination commit".into(),
                };
                let saved = recovery.keep();
                return Err(format!(
                    "Destination complete, source preserved: {detail}; recovery files: {}",
                    saved.display()
                ));
            }
        }
        // Cancellation after commit must never turn a complete move into an incomplete deletion.
        if faults.cleanup {
            let saved = recovery.keep();
            return Err(format!(
                "Destination complete, source cleanup failed; source preserved; recovery files: {}",
                saved.display()
            ));
        }
        if let Err(e) = remove(src) {
            let saved = recovery.keep();
            return Err(format!(
                "Destination complete, source cleanup failed: {e}; recovery files: {}",
                saved.display()
            ));
        }
    }
    cleanup_recovery(recovery).map_err(|e| format!("Operation completed; {e}"))
}

fn restore_source(
    stage: &Path,
    src: &Path,
    recovery: tempfile::TempDir,
    original: &str,
) -> Result<(), String> {
    if fs::symlink_metadata(src).is_ok() {
        let saved = recovery.keep();
        return Err(format!(
            "{original}; source path was recreated; recovery files: {}",
            saved.display()
        ));
    }
    if let Err(e) = fs::rename(stage, src) {
        let saved = recovery.keep();
        return Err(format!(
            "{original}; source restore failed: {e}; recovery files: {}",
            saved.display()
        ));
    }
    Ok(())
}

pub fn delete(
    paths: &[String],
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, &Path),
) -> Result<(), String> {
    // Enumerate the entire batch before removing anything. Links are removed as links.
    let mut targets = Vec::new();
    for path in paths {
        for entry in WalkDir::new(path)
            .follow_links(false)
            .follow_root_links(false)
            .contents_first(true)
        {
            check(cancel)?;
            targets.push(entry.map_err(|e| e.to_string())?.into_path());
        }
    }
    let mut seen = BTreeSet::new();
    for path in targets {
        check(cancel)?;
        if !seen.insert(path.clone()) {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            fs::remove_dir(&path)
        } else {
            fs::remove_file(&path)
        }
        .map_err(|e| format!("{}: {e}", path.display()))?;
        progress(meta.len(), &path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cancel() -> AtomicBool {
        AtomicBool::new(false)
    }
    fn pair(src: &Path, dst: &Path) -> Vec<(String, String)> {
        vec![(src.display().to_string(), dst.display().to_string())]
    }
    #[test]
    fn reject_identity_nested_and_hardlink() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        assert!(plan_batch(pair(&src, &src), &cancel()).is_err());
        assert!(plan_batch(pair(&src, &src.join("nested/new")), &cancel()).is_err());
        let a = d.path().join("a");
        let b = d.path().join("b");
        fs::write(&a, "a").unwrap();
        fs::hard_link(&a, &b).unwrap();
        assert!(plan_batch(pair(&a, &b), &cancel()).is_err());
    }
    #[test]
    fn collapse_and_reject_conflicting_batches() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a"), "a").unwrap();
        let dst = d.path().join("dst");
        let mut pairs = pair(&src, &dst);
        pairs.extend(pair(&src.join("a"), &dst.join("a")));
        assert_eq!(plan_batch(pairs, &cancel()).unwrap().len(), 1);
        let mut pairs = pair(&src, &dst);
        pairs.extend(pair(&src.join("a"), &dst));
        assert!(plan_batch(pairs, &cancel()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn reject_symlinks_before_mutation() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        std::os::unix::fs::symlink("missing", src.join("link")).unwrap();
        assert!(plan_batch(pair(&src, &d.path().join("dst")), &cancel())
            .unwrap_err()
            .contains("Symbolic"));
    }
    #[test]
    fn failure_restores_both_sides_and_cross_device_copy_is_verified() {
        for moving in [false, true] {
            for cross_device in [false, true] {
                let d = tempfile::tempdir().unwrap();
                let src = d.path().join("src");
                let dst = d.path().join("dst");
                fs::write(&src, "new").unwrap();
                fs::write(&dst, "old").unwrap();
                let item = plan_batch(pair(&src, &dst), &cancel()).unwrap().remove(0);
                assert!(execute(
                    &item,
                    moving,
                    true,
                    &cancel(),
                    &mut |_, _| {},
                    &Faults {
                        commit: true,
                        cross_device,
                        ..Default::default()
                    }
                )
                .is_err());
                assert_eq!(fs::read_to_string(&src).unwrap(), "new");
                assert_eq!(fs::read_to_string(&dst).unwrap(), "old");
            }
        }
    }
    #[test]
    fn cancelled_copy_preserves_destination() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        let dst = d.path().join("dst");
        fs::write(&src, vec![1u8; 200000]).unwrap();
        fs::write(&dst, "old").unwrap();
        let c = cancel();
        let item = plan_batch(pair(&src, &dst), &c).unwrap().remove(0);
        assert!(execute(
            &item,
            false,
            true,
            &c,
            &mut |_, _| c.store(true, Ordering::Relaxed),
            &Faults::default()
        )
        .is_err());
        assert_eq!(fs::read_to_string(dst).unwrap(), "old");
    }
    #[test]
    fn changed_destination_and_cleanup_failure_preserve_source() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        let dst = d.path().join("dst");
        fs::write(&src, "new").unwrap();
        fs::write(&dst, "old").unwrap();
        let item = plan_batch(pair(&src, &dst), &cancel()).unwrap().remove(0);
        fs::write(&dst, "changed").unwrap();
        assert!(execute(
            &item,
            true,
            true,
            &cancel(),
            &mut |_, _| {},
            &Faults::default()
        )
        .is_err());
        let item = plan_batch(pair(&src, &dst), &cancel()).unwrap().remove(0);
        assert!(execute(
            &item,
            true,
            true,
            &cancel(),
            &mut |_, _| {},
            &Faults {
                cross_device: true,
                cleanup: true,
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(src).unwrap(), "new");
        assert_eq!(fs::read_to_string(dst).unwrap(), "new");
    }
}

fn tree_bytes(path: &Path, cancel: &AtomicBool) -> Result<u64, String> {
    let mut total = 0;
    for entry in WalkDir::new(path)
        .follow_links(false)
        .follow_root_links(false)
    {
        check(cancel)?;
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            total += entry.metadata().map_err(|e| e.to_string())?.len();
        }
    }
    Ok(total)
}

fn restore_without_overwrite(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(std::io::Error::other(
            "Path was recreated; refusing to overwrite during rollback",
        ));
    }
    fs::rename(from, to)
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    fn pairs(a: &Path, b: &Path) -> Vec<(String, String)> {
        vec![(a.display().to_string(), b.display().to_string())]
    }
    #[test]
    fn source_change_during_copy_aborts_without_replacement() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        fs::write(&a, "original").unwrap();
        fs::write(&b, "destination").unwrap();
        let c = AtomicBool::new(false);
        let item = plan_batch(pairs(&a, &b), &c).unwrap().remove(0);
        let mut changed = false;
        assert!(execute(
            &item,
            true,
            true,
            &c,
            &mut |_, _| {
                if !changed {
                    changed = true;
                    fs::write(&a, "externally changed").unwrap();
                }
            },
            &Faults {
                cross_device: true,
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(a).unwrap(), "externally changed");
        assert_eq!(fs::read_to_string(b).unwrap(), "destination");
    }
    #[test]
    fn verification_detects_corruption_and_move_succeeds() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        fs::write(&a, "original").unwrap();
        fs::write(&b, "corrupted").unwrap();
        let c = AtomicBool::new(false);
        assert!(verify(&a, &b, &c).is_err());
        let item = plan_batch(pairs(&a, &b), &c).unwrap().remove(0);
        execute(
            &item,
            true,
            true,
            &c,
            &mut |_, _| {},
            &Faults {
                cross_device: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(b).unwrap(), "original");
    }
    #[test]
    fn duplicate_destinations_are_rejected() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        let dst = d.path().join("dst");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let mut batch = pairs(&a, &dst);
        batch.extend(pairs(&b, &dst));
        assert!(plan_batch(batch, &AtomicBool::new(false)).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn deleting_root_link_does_not_follow_it() {
        let d = tempfile::tempdir().unwrap();
        let real = d.path().join("real");
        let link = d.path().join("link");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("a"), "safe").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        delete(
            &[link.display().to_string()],
            &AtomicBool::new(false),
            &mut |_, _| {},
        )
        .unwrap();
        assert_eq!(fs::read_to_string(real.join("a")).unwrap(), "safe");
    }
    #[cfg(unix)]
    #[test]
    fn unreadable_source_tree_fails_preflight() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        fs::create_dir(&a).unwrap();
        fs::write(a.join("private"), "data").unwrap();
        fs::set_permissions(&a, fs::Permissions::from_mode(0o0)).unwrap();
        let result = plan_batch(pairs(&a, &d.path().join("dst")), &AtomicBool::new(false));
        fs::set_permissions(&a, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
    }
}

#[cfg(all(test, unix))]
mod recovery_permission_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn failed_copy_cleans_readonly_staging_without_changing_original_permissions() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("new"), "new").unwrap();
        fs::write(destination.join("old"), "old").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o555)).unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o555)).unwrap();
        let cancel = AtomicBool::new(false);
        let item = plan_batch(
            vec![(
                source.display().to_string(),
                destination.display().to_string(),
            )],
            &cancel,
        )
        .unwrap()
        .remove(0);
        assert!(execute(
            &item,
            false,
            true,
            &cancel,
            &mut |_, _| {},
            &Faults {
                commit: true,
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(destination.join("old")).unwrap(), "old");
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
            0o555
        );
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o755)).unwrap();
    }
}
