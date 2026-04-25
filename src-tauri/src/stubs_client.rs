use serde_json::Value;
use std::process::Command;

fn str_arg(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            if let Some(s) = v.as_str() {
                return s.trim().to_string();
            }
        }
    }
    String::new()
}

#[tauri::command]
pub fn run_client_network_tools(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let op = str_arg(obj, &["operation", "op", "action"]);
    let output = match op.as_str() {
        "connections" => Command::new("netstat").arg("-an").output(),
        "listening" => Command::new("lsof").args(["-i", "-P", "-n"]).output(),
        "ping" => {
            let host = str_arg(obj, &["host", "target", "address"]);
            if host.is_empty() {
                return Err("missing host".to_string());
            }
            Command::new("ping").args(["-c", "4", &host]).output()
        }
        _ => Command::new("netstat").arg("-an").output(),
    }
    .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn run_client_cert_checker(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let domain = str_arg(obj, &["domain", "host", "url", "address"]);
    if domain.is_empty() {
        return Err("missing domain".to_string());
    }
    let output = Command::new("openssl")
        .args([
            "s_client",
            "-connect",
            &format!("{}:443", domain),
            "-showcerts",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "Certificate for {}:\n{}",
        domain,
        String::from_utf8_lossy(&output.stdout)
    ))
}

#[tauri::command]
pub fn run_client_nginx_diagnose(_params: Value) -> Result<String, String> {
    let output = Command::new("nginx")
        .arg("-t")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stderr).to_string())
}

#[tauri::command]
pub fn run_client_dns_lookup(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let domain = str_arg(obj, &["domain", "host", "name", "address"]);
    if domain.is_empty() {
        return Err("missing domain".to_string());
    }
    let rt = str_arg(obj, &["record_type", "type", "query_type"]);
    let rt = if rt.is_empty() { "a" } else { &rt };
    let output = Command::new("host")
        .args(["-t", rt, &domain])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
