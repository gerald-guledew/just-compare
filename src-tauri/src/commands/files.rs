use crate::services::{
    documents::{self, Document},
    workers,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

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

    #[cfg(unix)]
    #[test]
    fn rejects_special_files() {
        assert!(path_kind(Path::new("/dev/null"))
            .unwrap_err()
            .contains("not a regular file or folder"));
    }
}
