use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum DiffLineKind {
    Equal,
    Insert,
    Delete,
    Replace,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffSegment {
    pub text: String,
    pub changed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub left_num: Option<u32>,
    pub right_num: Option<u32>,
    pub left: Option<Vec<DiffSegment>>,
    pub right: Option<Vec<DiffSegment>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileDiffResult {
    pub binary: bool,
    pub too_large: bool,
    pub lines: Vec<DiffLine>,
}
