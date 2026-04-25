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
pub fn run_client_json_parser(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "parse".to_string();
    }

    let json_str = str_arg(obj, &["json", "content", "input", "data"]);
    if json_str.is_empty() {
        return Err("missing json".to_string());
    }

    let parsed: Value =
        serde_json::from_str(&json_str).map_err(|e| format!("invalid JSON: {}", e))?;

    match op.as_str() {
        "parse" | "validate" => {
            let t = match &parsed {
                Value::Null => "null",
                Value::Bool(_) => "boolean",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Object(_) => "object",
            };
            Ok(format!("Valid JSON. Type: {}", t))
        }
        "format" | "beautify" | "pretty" => {
            serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())
        }
        "extract" | "get" | "query" => {
            let path = str_arg(obj, &["path", "key", "key_path"]);
            if path.is_empty() {
                return Err("missing path".to_string());
            }
            // Simple path extraction - just find the key in the JSON
            if let Value::Object(map) = &parsed {
                if let Some(v) = map.get(&path) {
                    return serde_json::to_string_pretty(v).map_err(|e| e.to_string());
                }
            }
            Err(format!("key not found: {}", path))
        }
        _ => Err(format!("unknown op: {}", op)),
    }
}
