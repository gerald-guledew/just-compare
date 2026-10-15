use crate::services::{
    documents::{self, Document},
    workers,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Semaphore;

const DIALOG_LOOKUP_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ComparisonPathKind {
    File,
    Folder,
}

fn path_kind(path: &Path) -> Result<ComparisonPathKind, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Unable to access {}: {error}", path.display()))?;
    if metadata.is_dir() {
        Ok(ComparisonPathKind::Folder)
    } else if metadata.is_file() {
        Ok(ComparisonPathKind::File)
    } else {
        Err(format!(
            "{} is not a regular file or folder",
            path.display()
        ))
    }
}

#[tauri::command]
pub async fn comparison_path_kind(path: String) -> Result<ComparisonPathKind, String> {
    workers::read(move || path_kind(Path::new(&path))).await
}

fn default_dialog_path(path: &Path) -> Option<String> {
    if path.as_os_str().is_empty() {
        return None;
    }

    let path: PathBuf = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    // Only inspect this path and its parents. An inaccessible location should
    // not prevent the user from opening the picker to choose a replacement.
    for (index, candidate) in path.ancestors().enumerate() {
        if let Ok(metadata) = std::fs::metadata(candidate) {
            if metadata.is_dir() || (index == 0 && metadata.is_file()) {
                return candidate.to_str().map(str::to_owned);
            }
        }
    }
    None
}

async fn optional_dialog_lookup(
    gate: Arc<Semaphore>,
    timeout: Duration,
    job: impl FnOnce() -> Option<String> + Send + 'static,
) -> Option<String> {
    let permit = gate.try_acquire_owned().ok()?;
    let lookup = tauri::async_runtime::spawn_blocking(move || {
        // A timed-out filesystem call may still be running. Keep its permit
        // until it finishes so repeated picker clicks cannot add stuck jobs.
        let _permit = permit;
        job()
    });
    tokio::time::timeout(timeout, lookup)
        .await
        .ok()
        .and_then(Result::ok)
        .flatten()
}

#[tauri::command]
pub async fn dialog_default_path(path: String) -> Result<Option<String>, String> {
    // This optional lookup has its own limit so a stalled cloud location
    // cannot occupy the regular comparison and document read workers.
    static LOOKUPS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    Ok(optional_dialog_lookup(
        LOOKUPS.get_or_init(|| Arc::new(Semaphore::new(1))).clone(),
        DIALOG_LOOKUP_TIMEOUT,
        move || default_dialog_path(Path::new(&path)),
    )
    .await)
}

#[tauri::command]
pub async fn read_file_text(path: String) -> Result<Document, String> {
    workers::read(move || documents::read(Path::new(&path))).await
}
#[tauri::command]
pub async fn file_version(path: String) -> Result<Option<String>, String> {
    workers::read(move || documents::disk_version(Path::new(&path))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_files_and_folders_without_reading_contents() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("different name.md");
        std::fs::write(&file, b"text").unwrap();
        assert_eq!(
            path_kind(directory.path()).unwrap(),
            ComparisonPathKind::Folder
        );
        assert_eq!(path_kind(&file).unwrap(), ComparisonPathKind::File);
    }

    #[test]
    fn missing_path_is_an_error_instead_of_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing.md");
        assert!(path_kind(&missing)
            .unwrap_err()
            .contains("Unable to access"));
    }

    #[test]
    fn retains_existing_file_and_folder_dialog_paths() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("different name.md");
        std::fs::write(&file, b"text").unwrap();

        assert_eq!(
            default_dialog_path(directory.path()).as_deref(),
            directory.path().to_str()
        );
        assert_eq!(default_dialog_path(&file).as_deref(), file.to_str());
    }

    #[test]
    fn missing_file_dialog_starts_in_its_own_parent() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing.md");

        assert_eq!(
            default_dialog_path(&missing).as_deref(),
            directory.path().to_str()
        );
    }

    #[test]
    fn missing_folders_dialog_starts_in_nearest_existing_parent() {
        let directory = tempfile::tempdir().unwrap();
        let existing = directory.path().join("existing");
        std::fs::create_dir(&existing).unwrap();
        let missing = existing.join("moved/deleted/missing.md");

        assert_eq!(default_dialog_path(&missing).as_deref(), existing.to_str());
    }

    #[test]
    fn file_ancestor_is_skipped_when_choosing_a_directory() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("file.md");
        std::fs::write(&file, b"text").unwrap();
        let missing = file.join("missing.md");

        assert_eq!(
            default_dialog_path(&missing).as_deref(),
            directory.path().to_str()
        );
    }

    #[test]
    fn empty_dialog_path_has_no_default() {
        assert_eq!(default_dialog_path(Path::new("")), None);
    }

    #[test]
    fn relative_dialog_path_is_anchored_to_current_directory() {
        let current = std::env::current_dir().unwrap();
        assert_eq!(
            default_dialog_path(Path::new(".")).as_deref(),
            current.join(".").to_str()
        );
        let missing = Path::new("__justcompare_missing_dialog_path__/missing.md");
        assert_eq!(default_dialog_path(missing).as_deref(), current.to_str());
    }

    #[test]
    fn optional_dialog_lookup_returns_completed_result() {
        let result = tauri::async_runtime::block_on(optional_dialog_lookup(
            Arc::new(Semaphore::new(1)),
            DIALOG_LOOKUP_TIMEOUT,
            || Some("/existing".to_owned()),
        ));
        assert_eq!(result.as_deref(), Some("/existing"));
    }

    #[test]
    fn stalled_dialog_lookup_times_out_and_later_lookup_skips_busy_worker() {
        let gate = Arc::new(Semaphore::new(1));
        let (release, wait) = std::sync::mpsc::channel::<()>();

        tauri::async_runtime::block_on(async {
            let result =
                optional_dialog_lookup(gate.clone(), Duration::from_millis(20), move || {
                    let _ = wait.recv();
                    Some("/late".to_owned())
                })
                .await;
            assert_eq!(result, None);
            assert_eq!(gate.available_permits(), 0);

            let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let job_called = called.clone();
            let next = tokio::time::timeout(
                Duration::from_millis(50),
                optional_dialog_lookup(gate.clone(), DIALOG_LOOKUP_TIMEOUT, move || {
                    job_called.store(true, std::sync::atomic::Ordering::SeqCst);
                    Some("/queued".to_owned())
                }),
            )
            .await
            .expect("busy optional lookup should return without queuing");
            assert_eq!(next, None);
            assert!(!called.load(std::sync::atomic::Ordering::SeqCst));

            drop(release);
            let permit = tokio::time::timeout(DIALOG_LOOKUP_TIMEOUT, gate.clone().acquire_owned())
                .await
                .expect("completed lookup should release its permit")
                .unwrap();
            drop(permit);
            let recovered = optional_dialog_lookup(gate, DIALOG_LOOKUP_TIMEOUT, || {
                Some("/recovered".to_owned())
            })
            .await;
            assert_eq!(recovered.as_deref(), Some("/recovered"));
        });
    }

    #[test]
    fn failed_optional_dialog_worker_falls_back_without_an_error() {
        let gate = Arc::new(Semaphore::new(1));
        let result = tauri::async_runtime::block_on(optional_dialog_lookup(
            gate.clone(),
            DIALOG_LOOKUP_TIMEOUT,
            || panic!("simulated worker failure"),
        ));
        assert_eq!(result, None);
        assert_eq!(gate.available_permits(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn root_dialog_path_terminates_at_root() {
        assert_eq!(default_dialog_path(Path::new("/")).as_deref(), Some("/"));
    }

    #[cfg(unix)]
    #[test]
    fn special_file_dialog_starts_in_its_parent_directory() {
        assert_eq!(
            default_dialog_path(Path::new("/dev/null")).as_deref(),
            Some("/dev")
        );
    }

    #[cfg(unix)]
    #[test]
    fn broken_symlink_dialog_starts_in_its_parent_directory() {
        let directory = tempfile::tempdir().unwrap();
        let link = directory.path().join("moved.md");
        std::os::unix::fs::symlink(directory.path().join("missing.md"), &link).unwrap();
        assert_eq!(
            default_dialog_path(&link).as_deref(),
            directory.path().to_str()
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_special_files() {
        assert!(path_kind(Path::new("/dev/null"))
            .unwrap_err()
            .contains("not a regular file or folder"));
    }
}
