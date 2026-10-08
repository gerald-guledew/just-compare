use crate::services::{
    documents::{self, SaveOutcome},
    workers,
};
use std::path::Path;

#[tauri::command]
pub async fn save_document(
    target_path: String,
    text: String,
    bom: bool,
    expected_version: Option<String>,
) -> Result<SaveOutcome, String> {
    workers::mutate(move || {
        documents::save(
            Path::new(&target_path),
            &text,
            bom,
            expected_version.as_deref(),
        )
    })
    .await
}
