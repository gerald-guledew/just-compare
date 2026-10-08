mod comparison;
mod file_diff;
mod file_entry;

pub use comparison::{ComparisonEntry, ComparisonMode, ComparisonResult, ComparisonStatus};
pub use file_diff::{DiffLine, DiffLineKind, DiffSegment, FileDiffResult};
pub use file_entry::FileEntry;
