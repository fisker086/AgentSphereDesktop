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

#[tauri::command]
pub fn run_client_regex(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "match".to_string();
    }

    let pattern = str_arg(obj, &["pattern", "regex", "expr"]);
    if pattern.is_empty() {
        return Err("missing pattern".to_string());
    }

    let text = str_arg(obj, &["text", "input", "string"]);
    if text.is_empty() {
        return Err("missing text".to_string());
    }

    let re = Regex::new(&pattern).map_err(|e| format!("invalid regex: {}", e))?;

    match op.as_str() {
        "match" | "test" | "validate" => Ok(format!(
            "Pattern: {}\nMatch: {}",
            pattern,
            re.is_match(&text)
        )),
        "extract" | "find" | "findall" => {
            let matches: Vec<_> = re.captures_iter(&text).collect();
            if matches.is_empty() {
                return Ok(format!("No matches: {}", pattern));
            }
            let result = format!("Found {} match(es)", matches.len());
            Ok(result)
        }
        "replace" | "sub" => {
            let replacement = str_arg(obj, &["replacement", "replace_with", "new"]);
            let replaced = re.replace_all(&text, &replacement);
            Ok(format!("Result: {}", replaced))
        }
        _ => Err(format!("unknown op: {}", op)),
    }
}
