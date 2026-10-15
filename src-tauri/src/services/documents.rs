use crate::commands::diff::MAX_FILE_BYTES;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub text: String,
    pub bom: bool,
    pub canonical_path: String,
    pub disk_version: String,
    pub mtime_ms: u64,
    pub size: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SaveConflictReason {
    Changed,
    MissingFile,
    MissingFolder,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved {
        disk_version: String,
        mtime_ms: u64,
    },
    Conflict {
        disk_version: Option<String>,
        message: String,
        reason: SaveConflictReason,
    },
}

#[derive(Clone, Copy)]
enum FileOperation {
    Read,
    Access,
    Save,
}

fn file_io_error(path: &Path, operation: FileOperation, error: &io::Error) -> String {
    let action = match operation {
        FileOperation::Read => "read",
        FileOperation::Access => "access",
        FileOperation::Save => "save",
    };
    match error.kind() {
        io::ErrorKind::NotFound => match operation {
            FileOperation::Save => format!(
                "Cannot save {}: the file or its folder could not be found. Choose an existing folder and try again.",
                path.display()
            ),
            FileOperation::Read | FileOperation::Access => format!(
                "File not found: {}. It may have been moved or deleted. Choose the file again.",
                path.display()
            ),
        },
        io::ErrorKind::PermissionDenied => format!(
            "Cannot {action} {}: permission denied. Check the file and folder permissions and try again.",
            path.display()
        ),
        _ => format!(
            "Cannot {action} {}. Check that the file and its folder are available and try again.",
            path.display()
        ),
    }
}

pub fn metadata_token(meta: &Metadata) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{modified:?}:{}:{}:{}:{}:{}",
            meta.len(),
            meta.dev(),
            meta.ino(),
            meta.ctime(),
            meta.ctime_nsec(),
            meta.mode()
        )
    }
    #[cfg(not(unix))]
    {
        format!(
            "{}:{modified:?}:{:?}:{:?}",
            meta.len(),
            meta.created(),
            meta.permissions()
        )
    }
}
fn version(bytes: &[u8], meta: &Metadata) -> String {
    let mut hash = Sha256::new();
    hash.update(metadata_token(meta));
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}
fn mtime(meta: &Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn snapshot(path: &Path) -> Result<(Vec<u8>, Metadata), String> {
    snapshot_with(path, || {})
}
fn snapshot_with(path: &Path, after_read: impl FnOnce()) -> Result<(Vec<u8>, Metadata), String> {
    let file = File::open(path).map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    let before = file
        .metadata()
        .map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    if !before.is_file() {
        return Err(format!("Not a regular file: {}", path.display()));
    }
    if before.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File too large (maximum 10 MB): {}",
            path.display()
        ));
    }
    let mut bytes = Vec::new();
    (&file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("File grew beyond the 10 MB limit".into());
    }
    after_read();
    let after = file
        .metadata()
        .map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    let at_path = fs::metadata(path).map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    if metadata_token(&before) != metadata_token(&after)
        || metadata_token(&after) != metadata_token(&at_path)
        || bytes.len() as u64 != after.len()
    {
        return Err("File changed while reading; reload it".into());
    }
    Ok((bytes, after))
}

pub fn disk_version(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e)
            if matches!(
                e.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(None)
        }
        Err(e) => Err(file_io_error(path, FileOperation::Access, &e)),
        Ok(_) => {
            let (bytes, meta) = snapshot(path)?;
            Ok(Some(version(&bytes, &meta)))
        }
    }
}

pub fn read(path: &Path) -> Result<Document, String> {
    let canonical =
        fs::canonicalize(path).map_err(|e| file_io_error(path, FileOperation::Read, &e))?;
    let (bytes, meta) = snapshot(&canonical)?;
    if bytes.contains(&0) {
        return Err("Cannot edit binary or UTF-16 files; only UTF-8 text is supported".into());
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { &bytes })
        .map_err(|_| "Unsupported encoding; editing requires valid UTF-8")?
        .to_string();
    Ok(Document {
        text,
        bom,
        canonical_path: canonical.to_string_lossy().into_owned(),
        disk_version: version(&bytes, &meta),
        mtime_ms: mtime(&meta),
        size: meta.len(),
    })
}

pub fn save(
    path: &Path,
    text: &str,
    bom: bool,
    expected: Option<&str>,
) -> Result<SaveOutcome, String> {
    save_with(path, text, bom, expected, || {}, || {})
}

fn parent_is_available(path: &Path) -> Result<bool, String> {
    let parent = path.parent().ok_or("File has no parent directory")?;
    match fs::metadata(parent) {
        Ok(metadata) => Ok(metadata.is_dir()),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(file_io_error(parent, FileOperation::Access, &error)),
    }
}

fn missing_folder_conflict() -> SaveOutcome {
    SaveOutcome::Conflict {
        disk_version: None,
        reason: SaveConflictReason::MissingFolder,
        message: "The folder containing this file is no longer available. Save your edits in an existing folder.".into(),
    }
}

fn save_conflict(path: &Path, current: Option<String>) -> Result<SaveOutcome, String> {
    if current.is_some() {
        return Ok(SaveOutcome::Conflict {
            disk_version: current,
            reason: SaveConflictReason::Changed,
            message: "File changed on disk. Choose whether to reload it or replace it with your unsaved edits.".into(),
        });
    }
    if !parent_is_available(path)? {
        return Ok(missing_folder_conflict());
    }
    Ok(SaveOutcome::Conflict {
        disk_version: None,
        reason: SaveConflictReason::MissingFile,
        message: "The file is no longer at this location. Its folder still exists, so you can recreate the file here or save your edits elsewhere.".into(),
    })
}

fn failed_save(path: &Path, error: &io::Error) -> Result<SaveOutcome, String> {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    ) && !parent_is_available(path)?
    {
        return Ok(missing_folder_conflict());
    }
    Err(file_io_error(path, FileOperation::Save, error))
}

fn save_with(
    path: &Path,
    text: &str,
    bom: bool,
    expected: Option<&str>,
    before_prepare: impl FnOnce(),
    before_persist: impl FnOnce(),
) -> Result<SaveOutcome, String> {
    if text.len() as u64 + if bom { 3 } else { 0 } > MAX_FILE_BYTES {
        return Err("File too large (maximum 10 MB)".into());
    }
    if text.contains('\0') {
        return Err("Cannot save binary text".into());
    }
    let current = disk_version(path)?;
    if current.as_deref() != expected {
        return save_conflict(path, current);
    }
    if !parent_is_available(path)? {
        return Ok(missing_folder_conflict());
    }
    let parent = path.parent().ok_or("File has no parent directory")?;
    before_prepare();
    let mut temp = match tempfile::Builder::new()
        .prefix(".justcompare-save-")
        .tempfile_in(parent)
    {
        Ok(temp) => temp,
        Err(error) => return failed_save(path, &error),
    };
    if bom {
        temp.write_all(&[0xef, 0xbb, 0xbf])
            .map_err(|e| file_io_error(path, FileOperation::Save, &e))?;
    }
    temp.write_all(text.as_bytes())
        .map_err(|e| file_io_error(path, FileOperation::Save, &e))?;
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| file_io_error(path, FileOperation::Save, &e))?;
    }
    temp.as_file()
        .sync_all()
        .map_err(|e| file_io_error(path, FileOperation::Save, &e))?;
    let current = disk_version(path)?;
    if current.as_deref() != expected {
        return save_conflict(path, current);
    }
    if !parent_is_available(path)? {
        return Ok(missing_folder_conflict());
    }
    before_persist();
    // Creation must not replace a file that appeared after the last version check.
    let persisted = if expected.is_none() {
        temp.persist_noclobber(path)
    } else {
        temp.persist(path)
    };
    if let Err(error) = persisted {
        if expected.is_none() && error.error.kind() == io::ErrorKind::AlreadyExists {
            return save_conflict(path, disk_version(path)?);
        }
        return failed_save(path, &error.error);
    }
    let (bytes, meta) = snapshot(path)?;
    // Return the version of the bytes actually submitted, not a later external write.
    let mut written = Vec::new();
    if bom {
        written.extend([0xef, 0xbb, 0xbf]);
    }
    written.extend(text.as_bytes());
    if bytes != written {
        return Err("File changed immediately after saving; reload to check its contents".into());
    }
    Ok(SaveOutcome::Saved {
        disk_version: version(&written, &meta),
        mtime_ms: mtime(&meta),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_has_actionable_reload_error() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.md");
        let error = read(&path).unwrap_err();
        assert_eq!(
            error,
            format!(
                "File not found: {}. It may have been moved or deleted. Choose the file again.",
                path.display()
            )
        );
        assert_eq!(disk_version(&path).unwrap(), None);
    }

    #[test]
    fn moved_file_reload_preserves_saved_content_and_save_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("original.md");
        let moved = directory.path().join("moved.md");
        fs::write(&path, "saved text").unwrap();
        let document = read(&path).unwrap();
        fs::rename(&path, &moved).unwrap();

        assert!(read(&path).unwrap_err().starts_with("File not found:"));
        assert_eq!(fs::read_to_string(&moved).unwrap(), "saved text");
        assert!(matches!(
            save(&path, "unsaved text", false, Some(&document.disk_version)).unwrap(),
            SaveOutcome::Conflict {
                disk_version: None,
                reason: SaveConflictReason::MissingFile,
                ..
            }
        ));
        assert!(!path.exists());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "saved text");
    }

    #[test]
    fn permission_errors_identify_operation_and_remedy() {
        let path = Path::new("restricted.md");
        let error = io::Error::from(io::ErrorKind::PermissionDenied);
        for (operation, action) in [
            (FileOperation::Read, "read"),
            (FileOperation::Access, "access"),
            (FileOperation::Save, "save"),
        ] {
            assert_eq!(
                file_io_error(path, operation, &error),
                format!(
                    "Cannot {action} restricted.md: permission denied. Check the file and folder permissions and try again."
                )
            );
        }
    }

    #[test]
    fn other_io_errors_do_not_expose_operating_system_details() {
        let error = io::Error::other("low-level failure (os error 2)");
        assert_eq!(
            file_io_error(Path::new("document.md"), FileOperation::Read, &error),
            "Cannot read document.md. Check that the file and its folder are available and try again."
        );
    }

    #[test]
    fn save_to_missing_folder_returns_recoverable_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing-folder/document.md");
        match save(&path, "text", false, None).unwrap() {
            SaveOutcome::Conflict {
                disk_version: None,
                reason: SaveConflictReason::MissingFolder,
                message,
            } => assert_eq!(message, "The folder containing this file is no longer available. Save your edits in an existing folder."),
            outcome => panic!("Expected missing folder conflict, got {outcome:?}"),
        }
        assert!(!path.exists());
        assert!(!path.parent().unwrap().exists());
    }

    #[test]
    fn deleted_parent_is_distinguished_from_deleted_file() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("removed-folder");
        fs::create_dir(&parent).unwrap();
        let path = parent.join("document.md");
        fs::write(&path, "saved text").unwrap();
        let document = read(&path).unwrap();
        fs::remove_dir_all(&parent).unwrap();

        assert!(matches!(
            save(&path, "unsaved text", false, Some(&document.disk_version)).unwrap(),
            SaveOutcome::Conflict {
                disk_version: None,
                reason: SaveConflictReason::MissingFolder,
                ..
            }
        ));
        assert!(!parent.exists());
    }

    #[test]
    fn parent_replaced_by_file_returns_missing_folder_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("former-folder");
        fs::write(&parent, "other file").unwrap();
        let path = parent.join("document.md");

        assert!(matches!(
            save(&path, "unsaved text", false, None).unwrap(),
            SaveOutcome::Conflict {
                reason: SaveConflictReason::MissingFolder,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(&parent).unwrap(), "other file");
    }

    #[test]
    fn explicit_recreation_preserves_text_and_bom() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.md");
        fs::write(&path, b"\xef\xbb\xbfsaved\r\n").unwrap();
        let document = read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        let conflict = save(
            &path,
            "unsaved\r\n",
            document.bom,
            Some(&document.disk_version),
        )
        .unwrap();
        assert!(matches!(
            conflict,
            SaveOutcome::Conflict {
                reason: SaveConflictReason::MissingFile,
                ..
            }
        ));
        assert!(!path.exists());
        assert!(matches!(
            save(&path, "unsaved\r\n", document.bom, None).unwrap(),
            SaveOutcome::Saved { .. }
        ));
        assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbfunsaved\r\n");
    }

    #[test]
    fn recreated_file_requires_new_confirmation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.md");
        fs::write(&path, "another application's content").unwrap();

        assert!(matches!(
            save(&path, "unsaved text", false, None).unwrap(),
            SaveOutcome::Conflict {
                disk_version: Some(_),
                reason: SaveConflictReason::Changed,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "another application's content"
        );
    }

    #[test]
    fn recreation_does_not_overwrite_file_appearing_during_commit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.md");
        let outcome = save_with(
            &path,
            "unsaved text",
            false,
            None,
            || {},
            || fs::write(&path, "new external file").unwrap(),
        )
        .unwrap();
        assert!(matches!(
            outcome,
            SaveOutcome::Conflict {
                disk_version: Some(_),
                reason: SaveConflictReason::Changed,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "new external file");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn deleted_parent_during_preparation_returns_recoverable_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("removed-folder");
        fs::create_dir(&parent).unwrap();
        let path = parent.join("document.md");
        fs::write(&path, "saved text").unwrap();
        let document = read(&path).unwrap();
        let outcome = save_with(
            &path,
            "unsaved text",
            false,
            Some(&document.disk_version),
            || fs::remove_dir_all(&parent).unwrap(),
            || {},
        )
        .unwrap();
        assert!(matches!(
            outcome,
            SaveOutcome::Conflict {
                reason: SaveConflictReason::MissingFolder,
                ..
            }
        ));
        assert!(!parent.exists());
    }

    #[test]
    fn deleted_parent_during_commit_returns_recoverable_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("removed-folder");
        fs::create_dir(&parent).unwrap();
        let path = parent.join("document.md");
        let outcome = save_with(
            &path,
            "unsaved text",
            false,
            None,
            || {},
            || fs::remove_dir_all(&parent).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            outcome,
            SaveOutcome::Conflict {
                reason: SaveConflictReason::MissingFolder,
                ..
            }
        ));
        assert!(!parent.exists());
    }

    #[test]
    fn conflict_reasons_are_serialized_for_frontend() {
        for (reason, serialized) in [
            (SaveConflictReason::Changed, "changed"),
            (SaveConflictReason::MissingFile, "missingFile"),
            (SaveConflictReason::MissingFolder, "missingFolder"),
        ] {
            let json = serde_json::to_value(SaveOutcome::Conflict {
                disk_version: None,
                message: "Recovery details".into(),
                reason,
            })
            .unwrap();
            assert_eq!(json["kind"], "conflict");
            assert_eq!(json["reason"], serialized);
        }
    }

    #[test]
    fn utf8_bom_and_conflicts() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a");
        fs::write(&p, b"\xef\xbb\xbfhello\r\n").unwrap();
        let doc = read(&p).unwrap();
        assert!(doc.bom);
        assert_eq!(doc.text, "hello\r\n");
        assert!(matches!(
            save(&p, "new\r\n", doc.bom, Some(&doc.disk_version)).unwrap(),
            SaveOutcome::Saved { .. }
        ));
        assert_eq!(fs::read(&p).unwrap(), b"\xef\xbb\xbfnew\r\n");
        assert!(matches!(
            save(&p, "bad", false, Some(&doc.disk_version)).unwrap(),
            SaveOutcome::Conflict {
                disk_version: Some(_),
                reason: SaveConflictReason::Changed,
                ..
            }
        ));
        assert_eq!(fs::read(&p).unwrap(), b"\xef\xbb\xbfnew\r\n");
    }
    #[test]
    fn invalid_binary_large_and_empty() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a");
        for bytes in [
            vec![0xff],
            vec![0, 1],
            vec![b'x'; MAX_FILE_BYTES as usize + 1],
        ] {
            fs::write(&p, bytes).unwrap();
            assert!(read(&p).is_err());
        }
        fs::write(&p, "").unwrap();
        assert_eq!(read(&p).unwrap().text, "");
    }
    #[test]
    fn missing_and_backward_timestamp_conflict() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a");
        fs::write(&p, "old").unwrap();
        let doc = read(&p).unwrap();
        fs::write(&p, "new").unwrap();
        filetime::set_file_mtime(&p, filetime::FileTime::from_unix_time(1, 0)).unwrap();
        assert!(matches!(
            save(&p, "local", false, Some(&doc.disk_version)).unwrap(),
            SaveOutcome::Conflict { .. }
        ));
        fs::remove_file(&p).unwrap();
        assert!(matches!(
            save(&p, "local", false, Some(&doc.disk_version)).unwrap(),
            SaveOutcome::Conflict {
                disk_version: None,
                ..
            }
        ));
        assert!(matches!(
            save(&p, "local", false, None).unwrap(),
            SaveOutcome::Saved { .. }
        ));
    }
    #[cfg(unix)]
    #[test]
    fn preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a");
        fs::write(&p, "old").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o751)).unwrap();
        let doc = read(&p).unwrap();
        save(&p, "new", false, Some(&doc.disk_version)).unwrap();
        assert_eq!(
            fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o751
        );
    }
}

#[cfg(test)]
mod read_race_tests {
    use super::*;
    #[test]
    fn changed_during_read_is_rejected() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a");
        fs::write(&p, "old").unwrap();
        assert!(snapshot_with(&p, || fs::write(&p, "different").unwrap()).is_err());
    }

    #[test]
    fn deleted_during_read_has_actionable_error() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("deleted.md");
        fs::write(&path, "text").unwrap();
        let error = snapshot_with(&path, || fs::remove_file(&path).unwrap()).unwrap_err();
        assert_eq!(
            error,
            format!(
                "File not found: {}. It may have been moved or deleted. Choose the file again.",
                path.display()
            )
        );
    }
}
