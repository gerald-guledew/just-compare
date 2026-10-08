//! Synthetic tree-index benchmark, imports the exact production index.
//! rustc -O tools/tree-benchmark.rs -o /tmp/justcompare-tree-benchmark
//! /usr/bin/time -l /tmp/justcompare-tree-benchmark
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;
#[path = "../src-tauri/src/services/tree_index.rs"]
mod tree_index;
fn baseline(keys: &[String]) -> tree_index::ChildIndex {
    let parents: BTreeSet<_> = keys
        .iter()
        .map(|k| k.rsplit_once('/').map_or("", |(p, _)| p))
        .collect();
    let mut result = BTreeMap::new();
    for parent in parents {
        let prefix = format!("{parent}/");
        let mut children = Vec::new();
        for key in keys.iter().chain(keys.iter()) {
            let direct = if parent.is_empty() {
                !key.contains('/')
            } else {
                key.strip_prefix(&prefix).is_some_and(|s| !s.contains('/'))
            };
            if direct && !children.contains(key) {
                children.push(key.clone());
            }
        }
        result.insert(parent.to_owned(), children);
    }
    result
}
fn main() {
    let algorithm = std::env::args().nth(1);
    for n in [10_000, 100_000] {
        for nested in [false, true] {
            let mut keys = BTreeSet::new();
            for i in 0..n {
                let path = if nested {
                    format!("group{:04}/sub/file{i:06}", i / 100)
                } else {
                    format!("file{i:06}")
                };
                if nested {
                    keys.insert(format!("group{:04}", i / 100));
                    keys.insert(format!("group{:04}/sub", i / 100));
                }
                keys.insert(path);
            }
            let keys: Vec<_> = keys.into_iter().collect();
            if let Some(algorithm) = &algorithm {
                let start = Instant::now();
                let result = if algorithm == "baseline" {
                    baseline(&keys)
                } else {
                    tree_index::index(keys.iter().chain(keys.iter()))
                };
                std::hint::black_box(result);
                println!(
                    "{} files, {}: {} {:.3}s",
                    n,
                    if nested { "nested" } else { "wide" },
                    algorithm,
                    start.elapsed().as_secs_f64()
                );
                continue;
            }
            let start = Instant::now();
            let old = baseline(&keys);
            let before = start.elapsed();
            let start = Instant::now();
            let new = tree_index::index(keys.iter().chain(keys.iter()));
            let after = start.elapsed();
            assert_eq!(old, new);
            println!(
                "{} files, {}: baseline {:.3}s, indexed {:.3}s, {:.1}x faster, equal topology",
                n,
                if nested { "nested" } else { "wide" },
                before.as_secs_f64(),
                after.as_secs_f64(),
                before.as_secs_f64() / after.as_secs_f64()
            );
        }
    }
}
