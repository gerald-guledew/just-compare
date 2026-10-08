use crate::services::{
    filesystem::{self, PlannedItem},
    workers,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct FsOpState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    next_id: AtomicU64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsOpProgress {
    pub op_id: String,
    pub item_path: String,
    pub completed_items: u64,
    pub total_items: u64,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub current_path: String,
}

#[tauri::command(async)]
pub fn is_directory(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}
#[tauri::command]
pub fn start_fs_op(state: State<'_, FsOpState>) -> Result<String, String> {
    let mut cancels = state.cancels.lock().map_err(|e| e.to_string())?;
    if !cancels.is_empty() {
        return Err("Another filesystem operation is running".into());
    }
    let id = format!("fsop-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    cancels.insert(id.clone(), Arc::new(AtomicBool::new(false)));
    Ok(id)
}
#[tauri::command]
pub fn cancel_fs_op(op_id: String, state: State<'_, FsOpState>) -> Result<(), String> {
    if let Some(flag) = state.cancels.lock().map_err(|e| e.to_string())?.get(&op_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
pub fn end_fs_op(op_id: String, state: State<'_, FsOpState>) -> Result<(), String> {
    state
        .cancels
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&op_id);
    Ok(())
}
fn flag(state: &FsOpState, id: &str) -> Result<Arc<AtomicBool>, String> {
    state
        .cancels
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or("Filesystem operation expired".into())
}
#[tauri::command]
pub async fn plan_fs_batch(
    pairs: Vec<(String, String)>,
    op_id: String,
    state: State<'_, FsOpState>,
) -> Result<Vec<PlannedItem>, String> {
    let cancel = flag(&state, &op_id)?;
    workers::read(move || filesystem::plan_batch(pairs, &cancel)).await
}
#[tauri::command]
pub async fn execute_fs_item(
    item: PlannedItem,
    moving: bool,
    overwrite: bool,
    op_id: String,
    state: State<'_, FsOpState>,
    app: AppHandle,
) -> Result<(), String> {
    let cancel = flag(&state, &op_id)?;
    workers::mutate(move || {
        let mut bytes = 0;
        let mut last = std::time::Instant::now();
        filesystem::execute(
            &item,
            moving,
            overwrite,
            &cancel,
            &mut |n, path| {
                bytes += n;
                if last.elapsed().as_millis() >= 50 {
                    last = std::time::Instant::now();
                    let _ = app.emit(
                        "fs_op_progress",
                        FsOpProgress {
                            op_id: op_id.clone(),
                            item_path: item.src.clone(),
                            completed_items: 0,
                            total_items: 1,
                            completed_bytes: bytes,
                            total_bytes: item.total_bytes,
                            current_path: path.display().to_string(),
                        },
                    );
                }
            },
            &filesystem::Faults::default(),
        )?;
        let _ = app.emit(
            "fs_op_progress",
            FsOpProgress {
                op_id,
                item_path: item.src,
                completed_items: 1,
                total_items: 1,
                completed_bytes: item.total_bytes,
                total_bytes: item.total_bytes,
                current_path: item.dst,
            },
        );
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn delete_paths(
    paths: Vec<String>,
    op_id: String,
    state: State<'_, FsOpState>,
    app: AppHandle,
) -> Result<(), String> {
    let cancel = flag(&state, &op_id)?;
    workers::mutate(move || {
        let mut count = 0;
        let mut bytes = 0;
        filesystem::delete(&paths, &cancel, &mut |n, path| {
            count += 1;
            bytes += n;
            let _ = app.emit(
                "fs_op_progress",
                FsOpProgress {
                    op_id: op_id.clone(),
                    item_path: "delete".into(),
                    completed_items: count,
                    total_items: 0,
                    completed_bytes: bytes,
                    total_bytes: 0,
                    current_path: path.display().to_string(),
                },
            );
        })
    })
    .await
}

#[tauri::command]
pub async fn resolve_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    workers::read(move || {
        paths
            .into_iter()
            .map(|p| {
                Ok(filesystem::resolve(std::path::Path::new(&p))?
                    .to_string_lossy()
                    .into_owned())
            })
            .collect()
    })
    .await
}
