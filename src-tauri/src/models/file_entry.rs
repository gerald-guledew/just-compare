use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: i64,
    pub children: Option<Vec<FileEntry>>,
}
