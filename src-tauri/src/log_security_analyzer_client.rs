//! Local log security analyzer client (aligned with skills/log_security_analyzer/SKILL.md).

use regex::Regex;
use serde_json::Value;

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

fn analyze_log_security(log_text: &str) -> Vec<(String, String, String)> {
    let mut events = Vec::new();

    let patterns = [
        (
            "Failed Login",
            r"(?i)(failed|invalid|incorrect).*(login|password|auth|password)",
            "Failed authentication attempt detected",
        ),
        (
            "Brute Force",
            r"(?i)(multiple|failure|attempt).{0,20}(login|auth)",
            "Possible brute force attack",
        ),
        (
            "Suspicious IP",
            r"(?i)(denied|blocked|refused).{0,30}(ip|from|address)",
            "Access denied from suspicious source",
        ),
        (
            "Privilege Escalation",
            r"(?i)(sudo|su|admin|root|privilege).{0,30}(denied|failed|error)",
            "Privilege escalation attempt",
        ),
        (
            "Data Exfiltration",
            r"(?i)( bulk | massive | large ).{0,20}(download|export|upload)",
            "Possible data exfiltration",
        ),
        (
            "SQL Injection Attempt",
            r"(?i)(union|select|insert|drop|delete).{0,30}('|1=1|--)",
            "Possible SQL injection attempt",
        ),
        (
            "Path Traversal",
            r"(?i)(\.\./|\.\.\\)",
            "Possible path traversal attempt",
        ),
        (
            "XSS Attempt",
            r"(?i)(script|<|>|javascript:)",
            "Possible XSS attempt",
        ),
    ];

    let lines: Vec<&str> = log_text.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (name, pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    events.push((
                        name.to_string(),
                        format!("Line {}", line_num + 1),
                        msg.to_string(),
                    ));
                }
            }
        }
    }

    events.sort_by(|a, b| a.0.cmp(&b.0));
    events
}

#[tauri::command]
pub fn run_client_log_security_analyzer(params: Value) -> Result<String, String> {
    eprintln!("[log_security_analyzer] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let log_text = str_arg(obj, &["log_text", "log", "content", "text"]);
    if log_text.is_empty() {
        return Err("missing log text to analyze".to_string());
    }

    let events = analyze_log_security(&log_text);

    if events.is_empty() {
        eprintln!("[log_security_analyzer] no security events found");
        Ok("No security events detected.\n".to_string())
    } else {
        let mut output = Vec::new();
        let mut current_type = String::new();

        for (event_type, location, msg) in &events {
            if current_type != *event_type {
                if !current_type.is_empty() {
                    output.push(String::new());
                }
                output.push(format!("=== {} ===", event_type));
                current_type = event_type.clone();
            }
            output.push(format!("{} - {}", location, msg));
        }

        let result = output.join("\n");
        eprintln!(
            "[log_security_analyzer] found {} security events",
            events.len()
        );
        Ok(format!("Security Events:\n{}\n", result))
    }
}
