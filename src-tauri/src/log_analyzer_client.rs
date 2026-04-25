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

fn parse_nginx_line(line: &str) -> Option<HashMap<String, String>> {
    let re = Regex::new(r#"^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) (\d+)"#).ok()?;
    let caps = re.captures(line)?;
    let mut m = HashMap::new();
    m.insert("ip".to_string(), caps.get(1)?.as_str().to_string());
    m.insert("time".to_string(), caps.get(2)?.as_str().to_string());
    m.insert("method".to_string(), caps.get(3)?.as_str().to_string());
    m.insert("path".to_string(), caps.get(4)?.as_str().to_string());
    m.insert("status".to_string(), caps.get(5)?.as_str().to_string());
    m.insert("size".to_string(), caps.get(6)?.as_str().to_string());
    Some(m)
}

fn parse_syslog_line(line: &str) -> Option<HashMap<String, String>> {
    let re = Regex::new(r"^(\w+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.+)$").ok()?;
    let caps = re.captures(line)?;
    let mut m = HashMap::new();
    m.insert("month".to_string(), caps.get(1)?.as_str().to_string());
    m.insert("day".to_string(), caps.get(2)?.as_str().to_string());
    m.insert("time".to_string(), caps.get(3)?.as_str().to_string());
    m.insert("host".to_string(), caps.get(4)?.as_str().to_string());
    m.insert("process".to_string(), caps.get(5)?.as_str().to_string());
    if let Some(pid) = caps.get(6) {
        m.insert("pid".to_string(), pid.as_str().to_string());
    }
    m.insert("message".to_string(), caps.get(7)?.as_str().to_string());
    Some(m)
}

fn parse_json_line(line: &str) -> Option<HashMap<String, String>> {
    let v: Value = serde_json::from_str(line).ok()?;
    let mut m = HashMap::new();
    if let Value::Object(map) = v {
        for (k, val) in map {
            m.insert(k.clone(), val.to_string());
        }
    }
    Some(m)
}

fn detect_format(lines: &[&str]) -> String {
    if lines.is_empty() {
        return "unknown".to_string();
    }
    let sample = lines[0];
    if sample.starts_with('{') && sample.contains("\"level\"") {
        return "json".to_string();
    }
    if sample.contains(" - - [") || sample.contains("\"GET") {
        return "nginx".to_string();
    }
    if sample.len() < 50 && !sample.contains('{') && !sample.contains('"') {
        return "syslog".to_string();
    }
    "unknown".to_string()
}

#[tauri::command]
pub fn run_client_log_analyzer(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let op = str_arg(obj, &["operation", "op", "action"]);
    let op = if op.is_empty() { "parse" } else { &op };

    let content = str_arg(obj, &["log_content", "content", "logs", "input"]);
    if content.is_empty() {
        return Err("missing log content".to_string());
    }

    let format = str_arg(obj, &["format", "log_format", "type"]);
    let format = if format.is_empty() { "auto" } else { &format };

    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let fmt = if format == "auto" {
        detect_format(&lines)
    } else {
        format.to_string()
    };

    match op {
        "parse" => {
            let mut results = Vec::new();
            for (i, line) in lines.iter().take(50).enumerate() {
                let fields = match fmt.as_str() {
                    "nginx" => parse_nginx_line(line),
                    "syslog" => parse_syslog_line(line),
                    "json" => parse_json_line(line),
                    _ => None,
                };
                if let Some(f) = fields {
                    results.push(format!("Line {}: {:?}", i + 1, f));
                } else {
                    results.push(format!(
                        "Line {}: (unparsed) {}",
                        i + 1,
                        &line[..line.len().min(60)]
                    ));
                }
            }
            Ok(format!(
                "Format: {}\nParsed {} lines:\n\n{}",
                fmt,
                results.len(),
                results.join("\n")
            ))
        }
        "filter" => {
            let level = str_arg(obj, &["filter_level", "level", "severity"]);
            if level.is_empty() {
                return Err("missing filter level".to_string());
            }
            let level_lower = level.to_lowercase();
            let filtered: Vec<&str> = lines
                .iter()
                .copied()
                .filter(|l| l.to_lowercase().contains(&level_lower))
                .collect();
            Ok(format!(
                "Filter '{}': {} of {} lines\n\n{}",
                level,
                filtered.len(),
                lines.len(),
                filtered.join("\n")
            ))
        }
        "summarize" => {
            let mut errors = 0;
            let mut warnings = 0;
            let mut infos = 0;
            let mut status_codes: HashMap<String, usize> = HashMap::new();

            for line in &lines {
                let lower = line.to_lowercase();
                if lower.contains("error") || lower.contains("err") || lower.contains("fatal") {
                    errors += 1;
                } else if lower.contains("warn") {
                    warnings += 1;
                } else if lower.contains("info") {
                    infos += 1;
                }
                if let Some(caps) = Regex::new(r#"\"(\d{3})\""#)
                    .ok()
                    .and_then(|re| re.captures(line))
                {
                    if let Some(code) = caps.get(1) {
                        *status_codes.entry(code.as_str().to_string()).or_insert(0) += 1;
                    }
                }
            }

            let mut result = format!(
                "Summary ({}):\nErrors: {}\nWarnings: {}\nInfo: {}",
                fmt, errors, warnings, infos
            );
            if !status_codes.is_empty() {
                result.push_str("\nStatus codes: ");
                for (code, count) in status_codes.iter().take(5) {
                    result.push_str(&format!("{}={}, ", code, count));
                }
            }
            Ok(result)
        }
        _ => Err(format!("unknown op: {}", op)),
    }
}
