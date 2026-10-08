use std::cmp::Ordering;

use similar::{ChangeTag, DiffTag, TextDiff};

use crate::models::{DiffLine, DiffLineKind, DiffSegment, FileDiffResult};

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

#[tauri::command]
pub async fn diff_text(
    left: String,
    right: String,
    tab_id: String,
    generation: u64,
) -> Result<FileDiffResult, String> {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex, OnceLock};
    static REQUESTS: OnceLock<Mutex<HashMap<String, Arc<AtomicU64>>>> = OnceLock::new();
    let requests = REQUESTS.get_or_init(|| Mutex::new(HashMap::new()));
    let latest = {
        let mut map = requests.lock().map_err(|e| e.to_string())?;
        let latest = map
            .entry(tab_id.clone())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone();
        latest.fetch_max(generation, AtomicOrdering::Relaxed);
        latest
    };
    let result = crate::services::workers::read(move || {
        if latest.load(AtomicOrdering::Relaxed) != generation {
            return Err("Superseded diff".into());
        }
        if left.len() as u64 > MAX_FILE_BYTES || right.len() as u64 > MAX_FILE_BYTES {
            return Err("Diff exceeds the 10 MB limit".into());
        }
        let lines = build_diff_lines(&left, &right);
        if latest.load(AtomicOrdering::Relaxed) != generation {
            return Err("Superseded diff".into());
        }
        Ok(FileDiffResult {
            binary: false,
            too_large: false,
            lines,
        })
    })
    .await;
    // Remove only the completed generation, so a newer request keeps its slot.
    let mut map = requests.lock().map_err(|e| e.to_string())?;
    if map
        .get(&tab_id)
        .is_some_and(|n| n.load(AtomicOrdering::Relaxed) == generation)
    {
        map.remove(&tab_id);
    }
    result
}

fn build_diff_lines(left: &str, right: &str) -> Vec<DiffLine> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    build_diff_with_deadline(left, right, deadline)
}

fn build_diff_with_deadline(
    left: &str,
    right: &str,
    deadline: std::time::Instant,
) -> Vec<DiffLine> {
    let diff = TextDiff::configure()
        .deadline(deadline)
        .diff_lines(left, right);
    let old = diff.old_slices();
    let new = diff.new_slices();
    let ops = diff.ops();

    let mut rows = RowWriter::new();
    rows.deadline = deadline;
    let mut i = 0;
    while i < ops.len() {
        if ops[i].tag() == DiffTag::Equal {
            for line in &old[ops[i].old_range()] {
                rows.equal(line);
            }
            i += 1;
            continue;
        }

        // A change hunk starts here. Extend it across "weak" equal runs (blank
        // lines, a lone `---` or `}`) that are followed by another change. Any
        // blank line equals any other, so the line diff has many equally short
        // ways to match them and picks one arbitrarily; treating that pick as
        // a fixed anchor would push genuinely related lines onto different
        // rows. `align_hunk` re-matches them where they fit best.
        let start = i;
        let mut end = i + 1;
        loop {
            while end < ops.len() && ops[end].tag() != DiffTag::Equal {
                end += 1;
            }
            let bridges_to_next_change = end + 1 < ops.len()
                && ops[end + 1].tag() != DiffTag::Equal
                && is_weak_anchor(&old[ops[end].old_range()]);
            if !bridges_to_next_change {
                break;
            }
            end += 2;
        }

        let old_range = ops[start].old_range().start..ops[end - 1].old_range().end;
        let new_range = ops[start].new_range().start..ops[end - 1].new_range().end;
        let cells = old_range.len().saturating_mul(new_range.len());
        if end - start == 1 || cells <= rows.align_budget {
            align_hunk(&mut rows, &old[old_range], &new[new_range]);
        } else {
            // The merged hunk is too big to align as a whole; fall back to the
            // line diff's own anchors and align each change on its own.
            for op in &ops[start..end] {
                if op.tag() == DiffTag::Equal {
                    for line in &old[op.old_range()] {
                        rows.equal(line);
                    }
                } else {
                    align_hunk(&mut rows, &old[op.old_range()], &new[op.new_range()]);
                }
            }
        }
        i = end;
    }

    rows.lines
}

/// Two different lines count as "the same line, edited" when at least this
/// share of their words is common to both. Unrelated lines of prose rarely get
/// past 0.2 (they share little beyond "the", "of" and punctuation).
const SIMILARITY_THRESHOLD: f32 = 0.35;
/// A line that survives almost whole inside a much longer one (a heading that
/// had a sentence appended, say) shares little of the *combined* text, so it
/// is also judged by the share of the shorter line that is found in the longer
/// one, minus this discount. Lines lighter than `CONTAINMENT_MIN_WEIGHT` are
/// too easy to find inside any long line to count.
const CONTAINMENT_DISCOUNT: f32 = 0.5;
const CONTAINMENT_MIN_WEIGHT: u32 = 12;
/// Alignment scores. An identical line beats any merely similar one, and a
/// blank-line match is only ever a tie-breaker between otherwise equal layouts.
const EXACT_MATCH_SCORE: f32 = 1.0;
const BLANK_MATCH_SCORE: f32 = 0.05;
/// An equal run with at most this many non-whitespace characters carries too
/// little information to pin a change hunk's alignment.
const WEAK_ANCHOR_MAX_CHARS: usize = 4;
/// How many `old line x new line` comparisons the similarity alignment may
/// spend on one diff. Hunks that no longer fit are paired top-to-bottom, which
/// keeps huge rewrites responsive (the diff is recomputed while typing).
const ALIGN_BUDGET_CELLS: usize = 2_000_000;

fn is_weak_anchor(lines: &[&str]) -> bool {
    lines
        .iter()
        .flat_map(|l| l.chars())
        .filter(|c| !c.is_whitespace())
        .nth(WEAK_ANCHOR_MAX_CHARS)
        .is_none()
}

/// Emit rows for one change hunk. Lines that are identical or similar enough
/// are put on the same row; whatever is left between two such rows is paired
/// top-to-bottom, with the surplus shown as pure Delete / Insert rows.
fn align_hunk(rows: &mut RowWriter, old: &[&str], new: &[&str]) {
    let (mut old_done, mut new_done) = (0, 0);
    for (o, n) in matching_line_pairs(old, new, &mut rows.align_budget, rows.deadline) {
        rows.unmatched(&old[old_done..o], &new[new_done..n]);
        rows.pair(old[o], new[n]);
        old_done = o + 1;
        new_done = n + 1;
    }
    rows.unmatched(&old[old_done..], &new[new_done..]);
}

/// Order-preserving pairs `(old index, new index)` that maximise the total
/// similarity of the paired lines (a weighted longest-common-subsequence).
/// Ties are resolved towards the earliest possible pairing.
fn matching_line_pairs(
    old: &[&str],
    new: &[&str],
    budget: &mut usize,
    deadline: std::time::Instant,
) -> Vec<(usize, usize)> {
    let (n, m) = (old.len(), new.len());
    let cells = n.saturating_mul(m);
    // Nothing to choose between in a 1:1 hunk; `unmatched` pairs it anyway.
    if cells <= 1 || cells > *budget {
        return Vec::new();
    }
    *budget -= cells;

    let old_words: Vec<LineWords> = old.iter().map(|l| LineWords::new(l)).collect();
    let new_words: Vec<LineWords> = new.iter().map(|l| LineWords::new(l)).collect();

    // best[i * w + j] = best total score aligning old[..i] with new[..j].
    let w = m + 1;
    let mut best = vec![0f32; (n + 1) * w];
    for i in 1..=n {
        if std::time::Instant::now() >= deadline {
            return Vec::new();
        }
        for j in 1..=m {
            if j % 256 == 0 && std::time::Instant::now() >= deadline {
                return Vec::new();
            }
            let mut score = best[(i - 1) * w + j].max(best[i * w + j - 1]);
            if let Some(s) =
                pair_score(old[i - 1], new[j - 1], &old_words[i - 1], &new_words[j - 1])
            {
                score = score.max(best[(i - 1) * w + j - 1] + s);
            }
            best[i * w + j] = score;
        }
    }

    let mut pairs = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 && j > 0 {
        let score = best[i * w + j];
        if score == best[(i - 1) * w + j] {
            i -= 1;
        } else if score == best[i * w + j - 1] {
            j -= 1;
        } else {
            pairs.push((i - 1, j - 1));
            i -= 1;
            j -= 1;
        }
    }
    pairs.reverse();
    pairs
}

/// Score for putting two lines on the same row, or `None` if they are too
/// different to be considered the same line. Similarity is squared so that one
/// close match outweighs a couple of borderline ones.
fn pair_score(old: &str, new: &str, old_words: &LineWords, new_words: &LineWords) -> Option<f32> {
    if old_words.is_blank() && new_words.is_blank() {
        return Some(BLANK_MATCH_SCORE);
    }
    if old == new {
        return Some(EXACT_MATCH_SCORE);
    }
    let similarity = old_words.similarity(new_words);
    (similarity >= SIMILARITY_THRESHOLD).then_some(similarity * similarity)
}

/// The words of a line as a sorted multiset, for cheap line-to-line similarity.
/// A word is a run of alphanumerics weighted by its length; every other
/// non-whitespace character is a word of weight 1.
struct LineWords {
    /// `(word hash, total weight of its occurrences)`, sorted by hash.
    words: Vec<(u64, u32)>,
    total: u32,
}

impl LineWords {
    fn new(line: &str) -> Self {
        let mut words: Vec<(u64, u32)> = Vec::new();
        let mut hash = FNV_OFFSET;
        let mut len = 0u32;
        for c in line.chars() {
            if c.is_alphanumeric() || c == '_' {
                hash = fnv1a(hash, c);
                len += 1;
                continue;
            }
            if len > 0 {
                words.push((hash, len));
                hash = FNV_OFFSET;
                len = 0;
            }
            if !c.is_whitespace() {
                words.push((fnv1a(FNV_OFFSET, c), 1));
            }
        }
        if len > 0 {
            words.push((hash, len));
        }

        words.sort_unstable_by_key(|&(h, _)| h);
        words.dedup_by(|cur, kept| {
            let same = cur.0 == kept.0;
            if same {
                kept.1 += cur.1;
            }
            same
        });
        let total = words.iter().map(|&(_, weight)| weight).sum();
        Self { words, total }
    }

    fn is_blank(&self) -> bool {
        self.total == 0
    }

    /// How much two lines have in common, from 0.0 (nothing) to 1.0 (the same
    /// words): the shared share of their combined weight (Dice coefficient),
    /// or the discounted containment of the shorter line if that is higher.
    fn similarity(&self, other: &Self) -> f32 {
        let total = self.total + other.total;
        if total == 0 {
            return 1.0;
        }

        let mut shared = 0u32;
        let (mut a, mut b) = (0, 0);
        while a < self.words.len() && b < other.words.len() {
            let (ha, wa) = self.words[a];
            let (hb, wb) = other.words[b];
            match ha.cmp(&hb) {
                Ordering::Less => a += 1,
                Ordering::Greater => b += 1,
                Ordering::Equal => {
                    shared += wa.min(wb);
                    a += 1;
                    b += 1;
                }
            }
        }

        let dice = (2 * shared) as f32 / total as f32;
        let shorter = self.total.min(other.total);
        if shorter < CONTAINMENT_MIN_WEIGHT {
            return dice;
        }
        dice.max(shared as f32 / shorter as f32 - CONTAINMENT_DISCOUNT)
    }
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv1a(hash: u64, c: char) -> u64 {
    (hash ^ c as u64).wrapping_mul(FNV_PRIME)
}

/// Accumulates output rows and keeps the running line numbers of both sides.
struct RowWriter {
    lines: Vec<DiffLine>,
    left_num: u32,
    right_num: u32,
    /// What is left of `ALIGN_BUDGET_CELLS` for this diff.
    align_budget: usize,
    deadline: std::time::Instant,
}

impl RowWriter {
    fn new() -> Self {
        Self {
            lines: Vec::new(),
            left_num: 0,
            right_num: 0,
            align_budget: ALIGN_BUDGET_CELLS,
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
        }
    }

    fn equal(&mut self, line: &str) {
        self.left_num += 1;
        self.right_num += 1;
        let segs = vec![DiffSegment {
            text: strip_trailing_newline(line),
            changed: false,
        }];
        self.lines.push(DiffLine {
            kind: DiffLineKind::Equal,
            left_num: Some(self.left_num),
            right_num: Some(self.right_num),
            left: Some(segs.clone()),
            right: Some(segs),
        });
    }

    /// One row holding both lines: Equal if they are identical, otherwise a
    /// Replace row with word-level emphasis.
    fn pair(&mut self, old: &str, new: &str) {
        if old == new {
            return self.equal(old);
        }
        self.left_num += 1;
        self.right_num += 1;
        let (left_segs, right_segs) = word_level_diff_until(old, new, self.deadline);
        self.lines.push(DiffLine {
            kind: DiffLineKind::Replace,
            left_num: Some(self.left_num),
            right_num: Some(self.right_num),
            left: Some(left_segs),
            right: Some(right_segs),
        });
    }

    fn delete(&mut self, old: &str) {
        self.left_num += 1;
        self.lines.push(DiffLine {
            kind: DiffLineKind::Delete,
            left_num: Some(self.left_num),
            right_num: None,
            left: Some(vec![DiffSegment {
                text: strip_trailing_newline(old),
                changed: false,
            }]),
            right: None,
        });
    }

    fn insert(&mut self, new: &str) {
        self.right_num += 1;
        self.lines.push(DiffLine {
            kind: DiffLineKind::Insert,
            left_num: None,
            right_num: Some(self.right_num),
            left: None,
            right: Some(vec![DiffSegment {
                text: strip_trailing_newline(new),
                changed: false,
            }]),
        });
    }

    /// Lines with no counterpart on the other side. To keep the hunk compact
    /// they still share rows, paired from the top as Replace rows; the surplus
    /// of the longer side becomes pure Delete / Insert rows. Blank lines are
    /// the first to be left on their own, so text sits next to text.
    fn unmatched(&mut self, deletes: &[&str], inserts: &[&str]) {
        let old_is_longer = deletes.len() >= inserts.len();
        let (longer, shorter) = if old_is_longer {
            (deletes, inserts)
        } else {
            (inserts, deletes)
        };
        let mut spare = longer.len() - shorter.len();
        let mut partners = shorter.iter();

        for &line in longer {
            let partner = if spare > 0 && line.trim().is_empty() {
                spare -= 1;
                None
            } else {
                partners.next()
            };
            match (partner, old_is_longer) {
                (Some(&new), true) => self.pair(line, new),
                (Some(&old), false) => self.pair(old, line),
                (None, true) => self.delete(line),
                (None, false) => self.insert(line),
            }
        }
    }
}

/// Run a word-level diff over two lines and split into left/right segments with
/// `changed` flags per word token. Tokenization is the same whitespace-aware
/// splitter that `similar`'s own inline path uses.
fn word_level_diff_until(
    left_line: &str,
    right_line: &str,
    deadline: std::time::Instant,
) -> (Vec<DiffSegment>, Vec<DiffSegment>) {
    let l = strip_trailing_newline(left_line);
    let r = strip_trailing_newline(right_line);
    if std::time::Instant::now() >= deadline {
        return (
            vec![DiffSegment {
                text: l,
                changed: true,
            }],
            vec![DiffSegment {
                text: r,
                changed: true,
            }],
        );
    }
    let wd = TextDiff::configure().deadline(deadline).diff_words(&l, &r);

    let mut lv: Vec<DiffSegment> = Vec::new();
    let mut rv: Vec<DiffSegment> = Vec::new();

    for change in wd.iter_all_changes() {
        let text = change.value().to_string();
        match change.tag() {
            ChangeTag::Equal => {
                lv.push(DiffSegment {
                    text: text.clone(),
                    changed: false,
                });
                rv.push(DiffSegment {
                    text,
                    changed: false,
                });
            }
            ChangeTag::Delete => lv.push(DiffSegment {
                text,
                changed: true,
            }),
            ChangeTag::Insert => rv.push(DiffSegment {
                text,
                changed: true,
            }),
        }
    }

    // Ensure each side has at least one segment so the row renders even when the
    // paired line is empty.
    if lv.is_empty() {
        lv.push(DiffSegment {
            text: String::new(),
            changed: false,
        });
    }
    if rv.is_empty() {
        rv.push(DiffSegment {
            text: String::new(),
            changed: false,
        });
    }

    (lv, rv)
}

fn strip_trailing_newline(s: &str) -> String {
    s.trim_end_matches('\n').trim_end_matches('\r').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(left: &str, right: &str) -> FileDiffResult {
        FileDiffResult {
            binary: false,
            too_large: false,
            lines: build_diff_lines(left, right),
        }
    }

    #[test]
    fn diff_identical_inputs() {
        let result = run("one\ntwo\nthree\n", "one\ntwo\nthree\n");
        assert!(!result.binary);
        assert!(!result.too_large);
        assert_eq!(result.lines.len(), 3);
        assert!(result.lines.iter().all(|l| l.kind == DiffLineKind::Equal));
    }

    #[test]
    fn diff_pure_insert() {
        let result = run("one\ntwo\n", "one\ntwo\nthree\n");
        assert_eq!(result.lines.len(), 3);
        assert_eq!(result.lines[2].kind, DiffLineKind::Insert);
        assert!(result.lines[2].left.is_none());
        assert!(result.lines[2].right.is_some());
    }

    #[test]
    fn diff_pure_delete() {
        let result = run("one\ntwo\nthree\n", "one\ntwo\n");
        assert_eq!(result.lines.len(), 3);
        assert_eq!(result.lines[2].kind, DiffLineKind::Delete);
        assert!(result.lines[2].left.is_some());
        assert!(result.lines[2].right.is_none());
    }

    #[test]
    fn diff_replace_has_word_level_segments() {
        let result = run("the quick brown fox\n", "the slow brown fox\n");
        assert_eq!(result.lines.len(), 1);
        let line = &result.lines[0];
        assert_eq!(line.kind, DiffLineKind::Replace);
        assert!(line.left.as_ref().unwrap().iter().any(|s| s.changed));
        assert!(line.right.as_ref().unwrap().iter().any(|s| s.changed));
        assert!(line.left.as_ref().unwrap().iter().any(|s| !s.changed));
        assert!(line.right.as_ref().unwrap().iter().any(|s| !s.changed));
    }

    // Regression: the user's Overview.md case — line 5 is modified and lines 6-8
    // are brand-new on the right. Myers merges them into a single Replace op
    // spanning 1 old line vs 4 new lines; similar's `iter_inline_changes` would
    // then bail out of word emphasis due to its MIN_RATIO=0.5 gate (ratio = 0.4).
    // Our per-pair word diff must still emphasize the differing tokens.
    #[test]
    fn diff_replace_adjacent_to_insert_preserves_word_emphasis() {
        let result = run(
            "a\nb\nc\nd\nonly 1 video. Which.\n",
            "a\nb\nc\nd\nonly 2 videos. Both.\n\n# Target\n## More.\n",
        );

        let replace_row = result
            .lines
            .iter()
            .find(|l| l.kind == DiffLineKind::Replace)
            .expect("expected a Replace row for line 5");
        assert_eq!(replace_row.left_num, Some(5));
        assert_eq!(replace_row.right_num, Some(5));

        assert!(
            replace_row.left.as_ref().unwrap().iter().any(|s| s.changed),
            "left side of Replace row should have at least one emphasized segment",
        );
        assert!(
            replace_row
                .right
                .as_ref()
                .unwrap()
                .iter()
                .any(|s| s.changed),
            "right side of Replace row should have at least one emphasized segment",
        );

        assert!(replace_row
            .left
            .as_ref()
            .unwrap()
            .iter()
            .any(|s| !s.changed));
    }

    // A pure 2-line vs 2-line Replace: each paired line must independently carry
    // word-level emphasis.
    #[test]
    fn diff_multi_line_replace_pairs_each_line() {
        let result = run("alpha one\nbravo two\n", "alpha ONE\nbravo TWO\n");

        let replaces: Vec<&DiffLine> = result
            .lines
            .iter()
            .filter(|l| l.kind == DiffLineKind::Replace)
            .collect();
        assert_eq!(replaces.len(), 2, "expected two paired Replace rows");
        for row in replaces {
            assert!(
                row.left.as_ref().unwrap().iter().any(|s| s.changed),
                "each Replace row's left side should have an emphasized segment",
            );
            assert!(
                row.right.as_ref().unwrap().iter().any(|s| s.changed),
                "each Replace row's right side should have an emphasized segment",
            );
        }
    }

    // Edge case: word_level_diff receives an empty string on one side (e.g. a
    // blank line paired with a non-blank line). Must not panic; the non-empty
    // side should be fully emphasized.
    #[test]
    fn diff_word_diff_handles_empty_line_pair() {
        let result = run("first\n\nlast\n", "first\nhello\nlast\n");

        let replace_row = result
            .lines
            .iter()
            .find(|l| l.kind == DiffLineKind::Replace)
            .expect("expected a Replace row for the blank-vs-hello line");
        let right_segs = replace_row.right.as_ref().unwrap();
        assert!(
            right_segs.iter().any(|s| s.changed),
            "non-empty side of the pair should have emphasized segments",
        );
    }

    /// The row holding the given left line.
    fn row_of_left(result: &FileDiffResult, left_num: u32) -> &DiffLine {
        result
            .lines
            .iter()
            .find(|l| l.left_num == Some(left_num))
            .expect("left line should appear in the diff")
    }

    /// The text of one side rebuilt from its rows, checking that the line
    /// numbers run 1, 2, 3, ... without gaps.
    fn side_text<'a>(
        rows: impl Iterator<Item = (Option<u32>, &'a Option<Vec<DiffSegment>>)>,
    ) -> Vec<String> {
        let mut texts = Vec::new();
        for (num, segs) in rows {
            assert_eq!(num.is_some(), segs.is_some());
            if let (Some(num), Some(segs)) = (num, segs) {
                assert_eq!(num as usize, texts.len() + 1);
                texts.push(segs.iter().map(|s| s.text.as_str()).collect());
            }
        }
        texts
    }

    /// Every input line must come out exactly once, in order, on its own side.
    fn assert_rows_reconstruct(left: &str, right: &str) {
        let result = run(left, right);
        let expected = |text: &str| text.lines().map(str::to_string).collect::<Vec<_>>();
        assert_eq!(
            side_text(result.lines.iter().map(|l| (l.left_num, &l.left))),
            expected(left)
        );
        assert_eq!(
            side_text(result.lines.iter().map(|l| (l.right_num, &l.right))),
            expected(right)
        );
    }

    const SPEC_V1: &str = "\
title one

status draft

this is the single source of truth

build status

---

## how to use

- part a old
- part b old
- agents
- contributors
- words
- labels

| label |
|---|
| stated |

## contents
";
    const SPEC_V2: &str = "\
title two

version

this is the source of truth

## how to use

- part a new
- part b new
- must
- targets
- new here

## contents
";

    // Regression: above the first heading the two versions share nothing but
    // blank lines. The line diff anchored on the *last* three of them, which
    // showed the left "this is the ..." line as deleted and paired the right
    // one with `---`. The reworded line must share a row with its counterpart.
    #[test]
    fn diff_pairs_reworded_line_across_blank_line_anchors() {
        let result = run(SPEC_V1, SPEC_V2);

        let paragraph = row_of_left(&result, 5);
        assert_eq!(paragraph.kind, DiffLineKind::Replace);
        assert_eq!(paragraph.right_num, Some(5));
        assert!(paragraph.left.as_ref().unwrap().iter().any(|s| !s.changed));

        // The lines around it keep their natural partners too.
        assert_eq!(row_of_left(&result, 1).right_num, Some(1));
        assert_eq!(row_of_left(&result, 3).right_num, Some(3));
        // "Build status" and the rule were removed, not rewritten.
        assert_eq!(row_of_left(&result, 7).kind, DiffLineKind::Delete);
        assert_eq!(row_of_left(&result, 9).kind, DiffLineKind::Delete);

        let heading = row_of_left(&result, 11);
        assert_eq!(heading.kind, DiffLineKind::Equal);
        assert_eq!(heading.right_num, Some(7));

        assert_rows_reconstruct(SPEC_V1, SPEC_V2);
    }

    // A line that was kept and had a lot appended shares little of the combined
    // text, but it is still the same line: it must not be shown as deleted
    // while an unrelated line is paired with its longer version.
    #[test]
    fn diff_pairs_line_with_its_much_longer_version() {
        let left = "\
## Contents
1. What Wrybill is
2. Requirements
**Part B: How we'll build it**
## Body
";
        let right = "\
## Contents
**Part B: How we'll build it.** 5 Design constraints, 6 Technology choice, 7 Architecture, 8 Brains, 9 Helpers, 10 Hands
## Body
";
        let result = run(left, right);

        let part_b = row_of_left(&result, 4);
        assert_eq!(part_b.kind, DiffLineKind::Replace);
        assert_eq!(part_b.right_num, Some(2));
        assert_eq!(row_of_left(&result, 2).kind, DiffLineKind::Delete);
        assert_eq!(row_of_left(&result, 3).kind, DiffLineKind::Delete);
        assert_rows_reconstruct(left, right);
    }

    // With nothing similar to go by, lines are paired top-to-bottom, but text
    // should end up next to text rather than next to a blank line.
    #[test]
    fn diff_pairs_unrelated_text_with_text_before_blank_lines() {
        let left = "start\n\nalpha beta gamma\n\nend\n";
        let right = "start\nquick brown fox\nend\n";
        let result = run(left, right);

        assert_eq!(row_of_left(&result, 2).kind, DiffLineKind::Delete);
        let text = row_of_left(&result, 3);
        assert_eq!(text.kind, DiffLineKind::Replace);
        assert_eq!(text.right_num, Some(2));
        assert_eq!(row_of_left(&result, 4).kind, DiffLineKind::Delete);
        assert_rows_reconstruct(left, right);
    }

    // Lines moved past each other cannot both keep their partner; the diff must
    // still account for every line exactly once.
    #[test]
    fn diff_rows_reconstruct_both_inputs() {
        assert_rows_reconstruct("", "");
        assert_rows_reconstruct("", "only right\n");
        assert_rows_reconstruct("only left\n", "");
        assert_rows_reconstruct("a\n\nb\n\nc\n", "c\n\nb\n\na\n");
        assert_rows_reconstruct(
            "fn one() {\n    a();\n}\n\nfn two() {\n    b();\n}\n",
            "fn one() {\n    a(1);\n}\n\nfn three() {\n    c();\n}\n\nfn two() {\n    b(2);\n}\n",
        );
        assert_rows_reconstruct("no trailing newline", "no trailing newline\n");
    }

    // A rewrite too large for the similarity alignment falls back to plain
    // top-to-bottom pairing instead of taking seconds.
    #[test]
    fn diff_huge_rewrite_falls_back_to_positional_pairing() {
        let lines = 1500; // 1500 x 1500 comparisons would exceed the budget
        assert!(lines * lines > ALIGN_BUDGET_CELLS);
        let left: String = (0..lines).map(|i| format!("left only {i}\n")).collect();
        let right: String = (0..lines).map(|i| format!("right only {i}\n")).collect();
        let result = run(&left, &right);

        assert_eq!(result.lines.len(), lines);
        assert!(result.lines.iter().all(|l| l.kind == DiffLineKind::Replace));
        assert!(result.lines.iter().all(|l| l.left_num == l.right_num));
    }

    #[test]
    fn line_similarity_ranks_reworded_above_unrelated() {
        let words = LineWords::new;
        let original = words("This is the single source of truth for Wrybill: what it is.");
        let reworded = words("This is the source of truth for what Wrybill is.");
        let unrelated = words("**Build status:** design only. Nothing has been implemented.");

        assert!(original.similarity(&reworded) >= SIMILARITY_THRESHOLD);
        assert!(original.similarity(&unrelated) < SIMILARITY_THRESHOLD);
        assert_eq!(original.similarity(&original), 1.0);
        assert!(words("   ").is_blank());
    }
}

#[cfg(test)]
mod deadline_tests {
    use super::*;
    #[test]
    fn expired_budget_preserves_both_inputs() {
        let left = "alpha\nbeta\ngamma\n";
        let right = "different\ntext\n";
        let lines = build_diff_with_deadline(left, right, std::time::Instant::now());
        let collect = |left_side: bool| {
            lines
                .iter()
                .filter_map(|line| {
                    if left_side {
                        line.left.as_ref()
                    } else {
                        line.right.as_ref()
                    }
                })
                .map(|segments| segments.iter().map(|s| s.text.as_str()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n")
                + "\n"
        };
        assert_eq!(collect(true), left);
        assert_eq!(collect(false), right);
    }
}
