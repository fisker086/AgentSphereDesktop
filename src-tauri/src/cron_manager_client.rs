//! Local cron manager operations (aligned with internal/skills/cron_manager.go).

use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

const MAX_CRON_WRITE_BYTES: usize = 256 * 1024;
const MAX_CRON_LINE_BYTES: usize = 4096;

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

fn allowed_cron_ops() -> HashMap<&'static str, bool> {
    [
        ("list", true),
        ("system", true),
        ("status", true),
        ("write", true),
        ("append_line", true),
        ("clear", true),
    ]
    .into_iter()
    .collect()
}

/// Local cron manager: read/write current user crontab; read-only system/status.
#[tauri::command]
pub fn run_client_cron_manager(params: Value) -> Result<String, String> {
    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "list".to_string();
    }

    let allowed = allowed_cron_ops();
    if !allowed.contains_key(op.as_str()) {
        return Err(format!(
            "operation {:?} not allowed (allowed: list, system, status, write, append_line, clear)",
            op
        ));
    }

    match op.as_str() {
        "write" => cron_write(obj),
        "append_line" => cron_append_line(obj),
        "clear" => cron_clear(),
        "list" => cron_read_list(),
        "system" => cron_read_system(),
        "status" => cron_read_status(),
        _ => Err(format!("unknown cron operation: {}", op)),
    }
}

fn cron_write(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
    let content = str_arg(obj, &["content", "crontab", "body"]);
    if content.contains('\0') {
        return Err("invalid content".to_string());
    }
    if content.len() > MAX_CRON_WRITE_BYTES {
        return Err(format!("content exceeds max size ({} bytes)", MAX_CRON_WRITE_BYTES));
    }
    let mut child = Command::new("crontab")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or_else(|| "crontab stdin".to_string())?;
    stdin.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    drop(stdin);
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("crontab write failed: {}", err.trim()));
    }
    Ok(format!(
        "cron write: OK (installed user crontab, {} bytes)",
        content.len()
    ))
}

fn cron_append_line(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
    let line = str_arg(obj, &["line", "entry"]);
    if line.is_empty() {
        return Err("append_line requires non-empty line".to_string());
    }
    if line.len() > MAX_CRON_LINE_BYTES {
        return Err(format!("line exceeds max length ({})", MAX_CRON_LINE_BYTES));
    }
    if line.contains('\n') || line.contains('\r') {
        return Err("append_line must be a single line".to_string());
    }
    let mut existing = String::new();
    if let Ok(out) = Command::new("crontab").args(["-l"]).output() {
        if out.status.success() {
            existing = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    let mut body = String::new();
    if !existing.is_empty() {
        body.push_str(&existing);
        body.push('\n');
    }
    body.push_str(&line);
    body.push('\n');

    let mut child = Command::new("crontab")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or_else(|| "crontab stdin".to_string())?;
    stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    drop(stdin);
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("append_line failed: {}", err.trim()));
    }
    Ok(format!("cron append_line: OK\nappended: {}", line))
}

fn cron_clear() -> Result<String, String> {
    let output = Command::new("crontab").arg("-r").output();
    match output {
        Ok(o) => {
            if o.status.success() {
                Ok("cron clear: OK (user crontab removed)".to_string())
            } else {
                let s = String::from_utf8_lossy(&o.stderr);
                let sl = s.to_lowercase();
                if sl.contains("no crontab") {
                    Ok("cron clear: no user crontab to remove".to_string())
                } else {
                    Ok(format!("cron clear: {}\n{}", o.status, s.trim()))
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn cron_read_list() -> Result<String, String> {
    let output = Command::new("crontab").args(["-l"]).output();
    let output = match output {
        Ok(o) => o,
        Err(e) => return Err(e.to_string()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr).trim().to_string();
    if !output.status.success() {
        return Ok(format!(
            "cron list: (no entries or permission denied)\n{}",
            combined
        ));
    }
    if combined.is_empty() {
        Ok("cron list: (no entries)".to_string())
    } else {
        Ok(format!("cron list result:\n\n{}", combined))
    }
}

fn cron_read_system() -> Result<String, String> {
    let output = Command::new("cat").arg("/etc/crontab").output();
    let output = match output {
        Ok(o) => o,
        Err(_) => {
            let output2 = Command::new("sh")
                .arg("-c")
                .arg("cat /etc/cron.d/* 2>/dev/null || true")
                .output();
            match output2 {
                Ok(o2) => o2,
                Err(_) => {
                    return Ok("cron system: (no entries or permission denied)".to_string());
                }
            }
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr).trim().to_string();
    if combined.is_empty() {
        Ok("cron system: (no entries)".to_string())
    } else {
        Ok(format!("cron system result:\n\n{}", combined))
    }
}

fn cron_read_status() -> Result<String, String> {
    let output = Command::new("launchctl").args(["list"]).output();
    let output = match output {
        Ok(o) => o,
        Err(e) => return Err(e.to_string()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr).trim().to_string();
    if combined.is_empty() {
        Ok("cron status: (no entries)".to_string())
    } else {
        Ok(format!("cron status result:\n\n{}", combined))
    }
}
