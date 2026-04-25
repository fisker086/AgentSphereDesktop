//! Local secrets scanner client (aligned with skills/secrets_scanner/SKILL.md).

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

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

fn build_secret_patterns() -> HashMap<String, Regex> {
    let mut patterns = HashMap::new();

    patterns.insert(
        "AWS Access Key ID".to_string(),
        Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
    );
    patterns.insert(
        "AWS Secret Access Key".to_string(),
        Regex::new(r#"(?i)aws_secret_access_key['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?"#)
            .unwrap(),
    );
    patterns.insert(
        "GitHub Token".to_string(),
        Regex::new(r"ghp_[A-Za-z0-9]{36}").unwrap(),
    );
    patterns.insert(
        "GitHub OAuth".to_string(),
        Regex::new(r"gho_[A-Za-z0-9]{36}").unwrap(),
    );
    patterns.insert(
        "Bearer Token".to_string(),
        Regex::new(r"(?i)bearer\s+[A-Za-z0-9\-_.~+/]+=*").unwrap(),
    );
    patterns.insert(
        "JWT Token".to_string(),
        Regex::new(r"eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+").unwrap(),
    );
    patterns.insert(
        "API Key (generic)".to_string(),
        Regex::new(r#"(?i)(api[_-]?key|apikey|api[_-]?token)['"]?\s*[:=]\s*['"]?[A-Za-z0-9\-_=]{16,}['"]?"#).unwrap(),
    );
    patterns.insert(
        "Password".to_string(),
        Regex::new(r#"(?i)(password|passwd|pwd)['"]?\s*[:=]\s*['"]?[^\s'"]{4,}['"]?"#).unwrap(),
    );
    patterns.insert(
        "Private Key (RSA)".to_string(),
        Regex::new(r"-----BEGIN (RSA )?PRIVATE KEY-----").unwrap(),
    );
    patterns.insert(
        "Private Key (EC)".to_string(),
        Regex::new(r"-----BEGIN EC PRIVATE KEY-----").unwrap(),
    );
    patterns.insert(
        "Private Key (OpenSSH)".to_string(),
        Regex::new(r"-----BEGIN OPENSSH PRIVATE KEY-----").unwrap(),
    );
    patterns.insert(
        "Database Connection String".to_string(),
        Regex::new(r"(?i)(mysql|postgres|mongodb|redis)://[^:\s]+:[^@]+@").unwrap(),
    );
    patterns.insert(
        "Slack Token".to_string(),
        Regex::new(r"xox[baprs]-([0-9a-zA-Z]{10,48})").unwrap(),
    );
    patterns.insert(
        "Google API Key".to_string(),
        Regex::new(r"AIza[0-9A-Za-z-_]{35}").unwrap(),
    );
    patterns.insert(
        "Stripe API Key".to_string(),
        Regex::new(r"sk_live_[0-9a-zA-Z]{24}").unwrap(),
    );
    patterns.insert(
        "Slack Webhook".to_string(),
        Regex::new(
            r"https://hooks\.slack\.com/services/T[a-zA-Z0-9_]+/B[a-zA-Z0-9_]+/[a-zA-Z0-9_]+",
        )
        .unwrap(),
    );

    patterns
}

fn scan_for_secrets(text: &str) -> Vec<(String, String)> {
    let patterns = build_secret_patterns();
    let mut findings = Vec::new();

    let lines: Vec<&str> = text.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (secret_type, pattern) in &patterns {
            if pattern.is_match(line) {
                findings.push((
                    format!("Line {}: {}", line_num + 1, secret_type),
                    line.chars().take(80).collect(),
                ));
            }
        }
    }

    findings
}

#[tauri::command]
pub fn run_client_secrets_scanner(params: Value) -> Result<String, String> {
    eprintln!("[secrets_scanner] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let text = str_arg(obj, &["text", "code", "content", "input"]);
    if text.is_empty() {
        return Err("missing text to scan".to_string());
    }

    let findings = scan_for_secrets(&text);

    if findings.is_empty() {
        eprintln!("[secrets_scanner] no secrets found");
        Ok("No secrets detected.\n".to_string())
    } else {
        eprintln!("[secrets_scanner] found {} secrets", findings.len());
        let result = findings
            .iter()
            .map(|(t, l)| format!("{}: {}", t, l))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!("Detected secrets:\n{}\n", result))
    }
}
