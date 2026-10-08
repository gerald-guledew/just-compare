use serde::{Deserialize, Serialize};

use super::FileEntry;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum ComparisonStatus {
    Identical,
    MetadataMatch,
    Modified,
    LeftOnly,
    RightOnly,
    DirectoryBoth,
    DirectoryLeftOnly,
    DirectoryRightOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ComparisonEntry {
    pub left: Option<FileEntry>,
    pub right: Option<FileEntry>,
    pub status: ComparisonStatus,
    pub children: Option<Vec<ComparisonEntry>>,
    pub has_orphan_children: bool,
    pub has_modified_children: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ComparisonMode {
    #[default]
    Quick,
    Verified,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ComparisonResult {
    pub entries: Vec<ComparisonEntry>,
    pub mode: ComparisonMode,
    pub warnings: Vec<String>,
}
