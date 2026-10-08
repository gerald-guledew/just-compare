use crate::commands::diff::MAX_FILE_BYTES;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, Metadata};
use std::io::{Read, Write};
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
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved {
        disk_version: String,
        mtime_ms: u64,
    },
    Conflict {
        disk_version: Option<String>,
        message: String,
    },
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
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let before = file.metadata().map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("File grew beyond the 10 MB limit".into());
    }
    after_read();
    let after = file.metadata().map_err(|e| e.to_string())?;
    let at_path = fs::metadata(path).map_err(|e| e.to_string())?;
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
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
        Ok(_) => {
            let (bytes, meta) = snapshot(path)?;
            Ok(Some(version(&bytes, &meta)))
        }
    }
}

pub fn read(path: &Path) -> Result<Document, String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
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
    if text.len() as u64 + if bom { 3 } else { 0 } > MAX_FILE_BYTES {
        return Err("File too large (maximum 10 MB)".into());
    }
    if text.contains('\0') {
        return Err("Cannot save binary text".into());
    }
    let current = disk_version(path)?;
    if current.as_deref() != expected {
        return Ok(SaveOutcome::Conflict {
            disk_version: current,
            message: "File changed or disappeared on disk".into(),
        });
    }
    let parent = path.parent().ok_or("File has no parent directory")?;
    let mut temp = tempfile::Builder::new()
        .prefix(".justcompare-save-")
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    if bom {
        temp.write_all(&[0xef, 0xbb, 0xbf])
            .map_err(|e| e.to_string())?;
    }
    temp.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| e.to_string())?;
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    let current = disk_version(path)?;
    if current.as_deref() != expected {
        return Ok(SaveOutcome::Conflict {
            disk_version: current,
            message: "File changed during save preparation".into(),
        });
    }
    temp.persist(path).map_err(|e| e.to_string())?;
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
            SaveOutcome::Conflict { .. }
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
}
