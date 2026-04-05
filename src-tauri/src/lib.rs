use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

mod browser_client;
mod docker_client;
mod js_sandbox;
mod wasm_sandbox;
use browser_client::run_client_browser;
use docker_client::run_client_docker_operator;
use js_sandbox::{execute_js, JsInput, JsOutput};
use wasm_sandbox::{execute_wasm, init_wasm_sandbox, WasmInput, WasmOutput};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub server_url: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { server_url: None }
    }
}

fn get_config_file_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("agentsphere");
    config_dir.join("config.json")
}

fn load_config() -> AppConfig {
    let path = get_config_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

#[tauri::command]
fn get_server_url() -> String {
    let config = load_config();
    config
        .server_url
        .unwrap_or_else(|| "http://localhost:8080".to_string())
}

#[tauri::command]
fn save_server_url(url: String) -> Result<(), String> {
    let path = get_config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let config = AppConfig {
        server_url: Some(url),
    };
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_config_path() -> String {
    get_config_file_path().to_string_lossy().to_string()
}

/// Read a user-picked path as base64 (for building `File` in the webview). Extension must match chat uploads.
#[tauri::command]
fn read_picked_file_base64(path: String) -> Result<String, String> {
    const MAX_BYTES: u64 = 11 * 1024 * 1024;
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err("not a file".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("file too large".into());
    }
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let allowed = matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf" | "txt" | "md" | "json"
    );
    if !allowed {
        return Err("unsupported file type".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn execute_wasm_command(
    code: Vec<u8>,
    function: String,
    args: Vec<String>,
    memory_limit: Option<usize>,
    time_limit_ms: Option<u64>,
) -> WasmOutput {
    let input = WasmInput {
        code,
        function,
        args,
        memory_limit,
        time_limit_ms,
    };
    execute_wasm(input)
}

#[tauri::command]
fn execute_js_command(
    code: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    memory_limit: Option<usize>,
) -> JsOutput {
    let input = JsInput {
        code,
        args,
        timeout_ms,
        memory_limit,
    };
    execute_js(input)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_wasm_sandbox();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            save_server_url,
            get_config_path,
            read_picked_file_base64,
            execute_wasm_command,
            execute_js_command,
            run_client_docker_operator,
            run_client_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
