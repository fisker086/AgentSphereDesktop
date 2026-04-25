use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

mod builtin_browser;
mod chrome_session;
mod cron_manager_client;
mod docker_client;
mod stubs_client;

mod api_security_checker_client;
mod cisco_ios_client;
mod crypto_tool_client;
mod csv_analyzer_client;
mod datetime_client;
mod db_query_client;
mod file_parser_client;
mod git_client;
mod h3c_switch_client;
mod huawei_switch_client;
mod json_parser_client;
mod jwt_tool_client;
mod log_analyzer_client;
mod log_security_analyzer_client;
mod password_strength_checker_client;
mod redis_tool_client;
mod regex_client;
mod secrets_scanner_client;
mod security_headers_checker_client;
mod system_monitor_client;
mod test_runner_client;

mod ethereum_query;
mod nft_query;
mod smart_contract;
mod transaction_analyzer;

use api_security_checker_client::run_client_api_security_checker;
use builtin_browser::{check_agent_browser, run_client_browser};
use cisco_ios_client::run_client_cisco_ios;
use crypto_tool_client::run_client_crypto_tool;
use csv_analyzer_client::run_client_csv_analyzer;
use datetime_client::run_client_datetime;
use db_query_client::run_client_db_query;
use docker_client::run_client_docker_operator;
use ethereum_query::run_client_ethereum_query;
use file_parser_client::run_client_file_parser;
use git_client::run_client_git_operator;
use h3c_switch_client::run_client_h3c_switch;
use huawei_switch_client::run_client_huawei_switch;
use json_parser_client::run_client_json_parser;
use jwt_tool_client::run_client_jwt_tool;
use log_analyzer_client::run_client_log_analyzer;
use log_security_analyzer_client::run_client_log_security_analyzer;
use nft_query::run_client_nft_query;
use password_strength_checker_client::run_client_password_strength_checker;
use redis_tool_client::run_client_redis_tool;
use regex_client::run_client_regex;
use secrets_scanner_client::run_client_secrets_scanner;
use security_headers_checker_client::run_client_security_headers_checker;
use smart_contract::run_client_smart_contract;
use system_monitor_client::run_client_system_monitor;
use test_runner_client::run_client_test_runner;
use transaction_analyzer::run_client_transaction_analyzer;

use cron_manager_client::run_client_cron_manager;
use stubs_client::{
    run_client_cert_checker, run_client_dns_lookup, run_client_network_tools,
    run_client_nginx_diagnose,
};

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
        .join("taskmate");
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
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
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
    _code: Vec<u8>,
    function: String,
    args: Vec<String>,
    _memory_limit: Option<usize>,
    _time_limit_ms: Option<u64>,
) -> Result<String, String> {
    Ok(format!("wasm: {}/{:?}", function, args))
}

#[tauri::command]
fn execute_js_command(
    code: String,
    args: Vec<String>,
    _timeout_ms: Option<u64>,
    _memory_limit: Option<usize>,
) -> Result<String, String> {
    Ok(format!("js: {}/{:?}", code.len(), args))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            check_agent_browser,
            run_client_browser,
            run_client_git_operator,
            run_client_regex,
            run_client_json_parser,
            run_client_datetime,
            run_client_log_analyzer,
            run_client_file_parser,
            run_client_system_monitor,
            run_client_cron_manager,
            run_client_network_tools,
            run_client_cert_checker,
            run_client_nginx_diagnose,
            run_client_csv_analyzer,
            run_client_db_query,
            run_client_redis_tool,
            run_client_dns_lookup,
            run_client_ethereum_query,
            run_client_smart_contract,
            run_client_transaction_analyzer,
            run_client_nft_query,
            run_client_test_runner,
            run_client_password_strength_checker,
            run_client_secrets_scanner,
            run_client_api_security_checker,
            run_client_jwt_tool,
            run_client_security_headers_checker,
            run_client_log_security_analyzer,
            run_client_crypto_tool,
            run_client_huawei_switch,
            run_client_h3c_switch,
            run_client_cisco_ios,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
