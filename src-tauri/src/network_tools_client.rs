//! Local network tools operations (aligned with internal/skills/network_tools.go).

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

fn allowed_network_ops() -> HashMap<&'static str, bool> {
    [
        ("ping", true),
        ("traceroute", true),
        ("connections", true),
        ("listening", true),
    ]
    .into_iter()
    .collect()
}

/// Local network tools: ping, traceroute, connections, listening ports.
#[tauri::command]
pub fn run_client_network_tools(params: Value) -> Result<String, String> {
    eprintln!("[network_tools_client] run_client_network_tools invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "connections".to_string();
    }

    let allowed = allowed_network_ops();
    if !allowed.contains_key(op.as_str()) {
        return Err(format!(
            "operation {:?} not allowed (read-only; allowed: ping, traceroute, connections, listening)",
            op
        ));
    }

    let (cmd_name, args) = match op.as_str() {
        "ping" => {
            let host = str_arg(obj, &["host", "target", "address"]);
            if host.is_empty() {
                return Err("missing host for ping".to_string());
            }
            let count = str_arg(obj, &["count", "n", "times"]);
            let count = if count.is_empty() { "4" } else { &count };
            ("ping", vec!["-c", count, &host])
        }
        "traceroute" => {
            let host = str_arg(obj, &["host", "target", "address"]);
            if host.is_empty() {
                return Err("missing host for traceroute".to_string());
            }
            ("traceroute", vec![&host])
        }
        "connections" => ("netstat", vec!["-an"]),
        "listening" => ("lsof", vec!["-i", "-P", "-n"]),
        _ => return Err(format!("unknown network operation: {}", op)),
    };

    let output = Command::new(cmd_name)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run {}: {}", op, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr).trim().to_string();

    if combined.is_empty() {
        Ok(format!("network {}: (no output)", op))
    } else {
        Ok(format!("network {} result:\n\n{}", op, combined))
    }
}
