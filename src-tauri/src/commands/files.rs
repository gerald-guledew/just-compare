use crate::services::{
    documents::{self, Document},
    workers,
};
use std::path::Path;

#[tauri::command]
pub async fn read_file_text(path: String) -> Result<Document, String> {
    workers::read(move || documents::read(Path::new(&path))).await
}
#[tauri::command]
pub async fn file_version(path: String) -> Result<Option<String>, String> {
    workers::read(move || documents::disk_version(Path::new(&path))).await
}
