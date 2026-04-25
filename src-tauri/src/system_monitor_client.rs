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
pub fn run_client_system_monitor(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let op = str_arg(obj, &["operation", "op", "action"]);
    let op = if op.is_empty() { "all" } else { &op };

    let mut results = Vec::new();

    match op {
        "cpu" | "all" => {
            if cfg!(target_os = "macos") {
                let out = Command::new("top").args(["-l", "1", "-n", "0"]).output();
                if let Ok(o) = out {
                    results.push(format!("CPU:\n{}", String::from_utf8_lossy(&o.stdout)));
                }
            } else {
                let out = Command::new("top").args(["-b", "-n", "1"]).output();
                if let Ok(o) = out {
                    results.push(format!(
                        "CPU:\n{}",
                        String::from_utf8_lossy(&o.stdout)
                            .lines()
                            .take(10)
                            .collect::<Vec<_>>()
                            .join("\n")
                    ));
                }
            }
        }
        _ => {}
    }

    if op == "all" || op == "memory" {
        if cfg!(target_os = "macos") {
            let out = Command::new("vm_stat").output();
            if let Ok(o) = out {
                results.push(format!("Memory:\n{}", String::from_utf8_lossy(&o.stdout)));
            }
        } else {
            let out = Command::new("free").args(["-h"]).output();
            if let Ok(o) = out {
                results.push(format!("Memory:\n{}", String::from_utf8_lossy(&o.stdout)));
            }
        }
    }

    if op == "all" || op == "disk" {
        let out = Command::new("df").args(["-h"]).output();
        if let Ok(o) = out {
            results.push(format!("Disk:\n{}", String::from_utf8_lossy(&o.stdout)));
        }
    }

    if op == "all" || op == "uptime" {
        let out = Command::new("uptime").output();
        if let Ok(o) = out {
            results.push(format!("Uptime:\n{}", String::from_utf8_lossy(&o.stdout)));
        }
    }

    if op == "all" || op == "processes" {
        let limit = str_arg(obj, &["limit", "count", "n"]);
        let n: usize = limit.parse().unwrap_or(10);
        let out = Command::new("ps").args(["aux", "-r"]).output();
        if let Ok(o) = out {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let lines: Vec<_> = stdout.lines().take(n + 1).collect();
            results.push(format!("Top {} processes:\n{}", n, lines.join("\n")));
        }
    }

    Ok(results.join("\n\n"))
}
