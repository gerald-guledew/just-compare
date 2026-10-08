use std::collections::{BTreeMap, BTreeSet};
pub type ChildIndex = BTreeMap<String, Vec<String>>;
pub fn index<'a>(keys: impl Iterator<Item = &'a String>) -> ChildIndex {
    let keys: BTreeSet<_> = keys.cloned().collect();
    let mut out: ChildIndex = BTreeMap::new();
    for key in keys {
        let parent = key.rsplit_once('/').map_or("", |(p, _)| p).to_owned();
        out.entry(parent).or_default().push(key);
    }
    out
}
