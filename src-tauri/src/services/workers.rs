use std::sync::{Arc, OnceLock};
use tokio::sync::Semaphore;

pub async fn read<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static READS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    run(
        READS.get_or_init(|| Arc::new(Semaphore::new(2))).clone(),
        job,
    )
    .await
}

pub async fn mutate<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static WRITES: OnceLock<Arc<Semaphore>> = OnceLock::new();
    run(
        WRITES.get_or_init(|| Arc::new(Semaphore::new(1))).clone(),
        job,
    )
    .await
}

async fn run<T: Send + 'static>(
    gate: Arc<Semaphore>,
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = gate.acquire_owned().await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        job()
    })
    .await
    .map_err(|e| e.to_string())?
}
