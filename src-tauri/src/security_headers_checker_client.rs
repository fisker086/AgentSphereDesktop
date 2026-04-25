//! Server-side security headers checker (aligned with skills/security_headers_checker/SKILL.md).

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

fn check_security_headers(headers: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut findings = Vec::new();

    let expected = [
        ("Strict-Transport-Security", "HSTS"),
        ("X-Content-Type-Options", "X-Content-Type-Options"),
        ("X-Frame-Options", "X-Frame-Options"),
        ("X-XSS-Protection", "X-XSS-Protection"),
        ("Content-Security-Policy", "CSP"),
        ("Referrer-Policy", "Referrer-Policy"),
        ("Permissions-Policy", "Permissions-Policy"),
    ];

    for (header, name) in expected {
        if let Some(value) = headers.get(header) {
            if value.to_lowercase().contains("max-age=0") || value.is_empty() {
                findings.push((name.to_string(), format!("{}: present but weak", value)));
            } else {
                findings.push((
                    name.to_string(),
                    format!("OK: {}", value.chars().take(50).collect::<String>()),
                ));
            }
        } else {
            findings.push((name.to_string(), "Missing".to_string()));
        }
    }

    findings
}

#[tauri::command]
pub fn run_client_security_headers_checker(params: Value) -> Result<String, String> {
    eprintln!("[security_headers_checker] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let url = str_arg(obj, &["url", "address", "host"]);
    if url.is_empty() {
        return Err("missing URL".to_string());
    }

    let url_obj = if url.starts_with("http") {
        url.clone()
    } else {
        format!("https://{}", url)
    };

    eprintln!("[security_headers_checker] fetching {}", url_obj);

    let output = Command::new("curl")
        .arg("-s")
        .arg("-I")
        .arg(&url_obj)
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    let mut headers: HashMap<String, String> = HashMap::new();
    for line in stdout.lines() {
        if let Some((key, val)) = line.split_once(':') {
            headers.insert(key.trim().to_string(), val.trim().to_string());
        }
    }

    let findings = check_security_headers(&headers);

    let result = findings
        .iter()
        .map(|(name, status)| format!("{}: {}", name, status))
        .collect::<Vec<_>>()
        .join("\n");

    eprintln!(
        "[security_headers_checker] checked {} headers",
        findings.len()
    );
    Ok(format!("Security Headers:\n{}\n", result))
}
