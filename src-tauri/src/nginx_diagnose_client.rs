//! Local nginx diagnose operations (aligned with internal/skills/nginx_diagnose.go).

use serde_json::Value;
use std::collections::HashMap;
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

fn allowed_nginx_ops() -> HashMap<&'static str, bool> {
    [
        ("test_config", true),
        ("show_config", true),
        ("list_sites", true),
        ("status", true),
    ]
    .into_iter()
    .collect()
}

/// Local nginx diagnose: test config, show config, list sites, check status.
#[tauri::command]
pub fn run_client_nginx_diagnose(params: Value) -> Result<String, String> {
    eprintln!("[nginx_diagnose_client] run_client_nginx_diagnose invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "test_config".to_string();
    }

    let allowed = allowed_nginx_ops();
    if !allowed.contains_key(op.as_str()) {
        return Err(format!(
            "operation {:?} not allowed (read-only; allowed: test_config, show_config, list_sites, status)",
            op
        ));
    }

    let output = match op.as_str() {
        "test_config" => Command::new("nginx").arg("-t").output(),
        "show_config" => Command::new("nginx").arg("-T").output(),
        "list_sites" => Command::new("ls").arg("/etc/nginx/sites-enabled").output(),
        "status" => Command::new("ps").arg("aux").output(),
        _ => return Err(format!("unknown nginx operation: {}", op)),
    };

    let output = output.map_err(|e| format!("failed to run nginx {}: {}", op, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr).trim().to_string();

    // Filter for status operation
    if op == "status" && output.status.success() {
        let lines: Vec<&str> = combined.lines().filter(|l| l.contains("nginx")).collect();
        if lines.is_empty() {
            return Ok("nginx: not running".to_string());
        }
        return Ok(format!("nginx {} result:\n\n{}", op, lines.join("\n")));
    }

    if !output.status.success() && op != "list_sites" {
        return Err(format!(
            "nginx {} failed: {}\n{}",
            op, output.status, combined
        ));
    }

    if combined.is_empty() {
        return Ok(format!("nginx {}: (no output)", op));
    }

    Ok(format!("nginx {} result:\n\n{}", op, combined))
}
