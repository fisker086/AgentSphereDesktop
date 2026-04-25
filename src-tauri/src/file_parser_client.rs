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

fn extract_path(data: &serde_json::Value, path: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
    let mut current = data;
    for part in parts {
        current = match current {
            Value::Object(map) => map.get(part)?,
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                arr.get(idx)?
            }
            _ => return None,
        };
    }
    Some(current.clone())
}

#[tauri::command]
pub fn run_client_file_parser(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;

    let format = str_arg(obj, &["format", "type", "file_type"]);
    if format.is_empty() {
        return Err("missing format (csv, yaml, ini, toml, xml)".to_string());
    }

    let content = str_arg(obj, &["content", "data", "input", "file_content"]);
    if content.is_empty() {
        return Err("missing content".to_string());
    }

    let op = str_arg(obj, &["operation", "op", "action"]);
    let op = if op.is_empty() { "parse" } else { &op };

    match format.to_lowercase().as_str() {
        "csv" => parse_csv(&content, op),
        "yaml" | "yml" => parse_yaml(&content, op, obj),
        "ini" => parse_ini(&content, op, obj),
        "toml" => parse_toml(&content, op, obj),
        "xml" => parse_xml(&content, op, obj),
        _ => Err(format!("unsupported format: {}", format)),
    }
}

fn parse_csv(content: &str, op: &str) -> Result<String, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(content.as_bytes());

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|s| s.to_string())
        .collect();

    let rows: Vec<Vec<String>> = reader
        .records()
        .filter_map(|r| r.ok())
        .map(|r| r.iter().map(|s| s.to_string()).collect())
        .collect();

    match op {
        "parse" | "to_json" => {
            let json_rows: Vec<serde_json::Map<String, Value>> = rows
                .iter()
                .map(|row| {
                    let mut map = serde_json::Map::new();
                    for (i, h) in headers.iter().enumerate() {
                        let val = row.get(i).map(|s| s.to_string()).unwrap_or_default();
                        map.insert(h.clone(), Value::String(val));
                    }
                    map
                })
                .collect();
            serde_json::to_string_pretty(&json_rows).map_err(|e| e.to_string())
        }
        _ => Ok(format!("CSV: {} cols, {} rows", headers.len(), rows.len())),
    }
}

fn parse_yaml(
    content: &str,
    op: &str,
    obj: &serde_json::Map<String, Value>,
) -> Result<String, String> {
    let data: serde_yaml::Value =
        serde_yaml::from_str(content).map_err(|e| format!("YAML error: {}", e))?;

    match op {
        "parse" | "to_json" => {
            let json = yaml_to_json(&data);
            serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
        }
        "get" => {
            let key = str_arg(obj, &["key", "path"]);
            if key.is_empty() {
                return Err("missing key".to_string());
            }
            let json = yaml_to_json(&data);
            if let Some(v) = extract_path(&json, &key) {
                serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
            } else {
                Err(format!("key not found: {}", key))
            }
        }
        _ => Ok("YAML parsed".to_string()),
    }
}

fn yaml_to_json(val: &serde_yaml::Value) -> Value {
    match val {
        serde_yaml::Value::Null => Value::Null,
        serde_yaml::Value::Bool(b) => Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                Value::Number(serde_json::Number::from_f64(f).unwrap_or_else(|| 0.into()))
            } else {
                Value::Null
            }
        }
        serde_yaml::Value::String(s) => Value::String(s.clone()),
        serde_yaml::Value::Sequence(seq) => Value::Array(seq.iter().map(yaml_to_json).collect()),
        serde_yaml::Value::Mapping(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let Some(key) = k.as_str() {
                    obj.insert(key.to_string(), yaml_to_json(v));
                }
            }
            Value::Object(obj)
        }
        serde_yaml::Value::Tagged(t) => yaml_to_json(&t.value),
    }
}

fn parse_ini(
    content: &str,
    op: &str,
    obj: &serde_json::Map<String, Value>,
) -> Result<String, String> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current = "default".to_string();
    sections.insert(current.clone(), HashMap::new());

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line[1..line.len() - 1].to_string();
            sections.entry(current.clone()).or_insert_with(HashMap::new);
            continue;
        }
        if let Some(idx) = line.find('=') {
            let key = line[..idx].trim().to_string();
            let val = line[idx + 1..].trim().to_string();
            if let Some(section) = sections.get_mut(&current) {
                section.insert(key, val);
            }
        }
    }

    match op {
        "parse" | "to_json" => {
            let json: serde_json::Map<String, Value> = sections
                .iter()
                .map(|(k, v)| {
                    let inner: serde_json::Map<String, Value> = v
                        .iter()
                        .map(|(ka, va)| (ka.clone(), Value::String(va.clone())))
                        .collect();
                    (k.clone(), Value::Object(inner))
                })
                .collect();
            serde_json::to_string_pretty(&Value::Object(json)).map_err(|e| e.to_string())
        }
        "get" => {
            let key = str_arg(obj, &["key", "path"]);
            let parts: Vec<&str> = key.splitn(2, '.').collect();
            let section = if parts.len() == 2 {
                parts[0]
            } else {
                "default"
            };
            let key = if parts.len() == 2 { parts[1] } else { parts[0] };
            if let Some(s) = sections.get(section) {
                if let Some(v) = s.get(key) {
                    Ok(v.clone())
                } else {
                    Err(format!("key not found: {}", key))
                }
            } else {
                Err(format!("section not found: {}", section))
            }
        }
        _ => Ok(format!("INI: {} sections", sections.len())),
    }
}

fn parse_toml(
    content: &str,
    op: &str,
    obj: &serde_json::Map<String, Value>,
) -> Result<String, String> {
    let data: toml::Value = toml::from_str(content).map_err(|e| format!("TOML error: {}", e))?;

    match op {
        "parse" | "to_json" => {
            let json = toml_to_json(&data);
            serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
        }
        "get" => {
            let key = str_arg(obj, &["key", "path"]);
            if key.is_empty() {
                return Err("missing key".to_string());
            }
            let json = toml_to_json(&data);
            if let Some(v) = extract_path(&json, &key) {
                serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
            } else {
                Err(format!("key not found: {}", key))
            }
        }
        _ => Ok("TOML parsed".to_string()),
    }
}

fn toml_to_json(val: &toml::Value) -> Value {
    match val {
        toml::Value::String(s) => Value::String(s.clone()),
        toml::Value::Integer(i) => Value::Number((*i).into()),
        toml::Value::Float(f) => {
            Value::Number(serde_json::Number::from_f64(*f).unwrap_or_else(|| 0.into()))
        }
        toml::Value::Boolean(b) => Value::Bool(*b),
        toml::Value::Array(arr) => Value::Array(arr.iter().map(toml_to_json).collect()),
        toml::Value::Table(table) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in table {
                obj.insert(k.clone(), toml_to_json(v));
            }
            Value::Object(obj)
        }
        toml::Value::Datetime(dt) => Value::String(dt.to_string()),
    }
}

fn parse_xml(
    content: &str,
    op: &str,
    _obj: &serde_json::Map<String, Value>,
) -> Result<String, String> {
    let content = content.trim();
    if !content.starts_with('<') {
        return Err("not valid XML".to_string());
    }

    fn parse_xml_element(xml: &str) -> Result<serde_json::Value, String> {
        let mut stack: Vec<(&str, serde_json::Map<String, Value>)> = Vec::new();
        let mut i = 0;
        let mut text = String::new();

        while i < xml.len() {
            if xml[i..].starts_with("</") {
                let end = xml[i + 2..]
                    .find('>')
                    .map(|j| i + 2 + j)
                    .unwrap_or(xml.len());
                if let Some((name, mut props)) = stack.pop() {
                    if !text.trim().is_empty() {
                        props.insert("_text".to_string(), Value::String(text.trim().to_string()));
                    }
                    if let Some((_, parent)) = stack.last_mut() {
                        parent.insert(name.to_string(), Value::Object(props));
                    } else {
                        return Ok(Value::Object(props));
                    }
                }
                text.clear();
                i = end + 1;
                continue;
            }
            if xml[i..].starts_with('<') {
                let end = xml[i + 1..]
                    .find('>')
                    .map(|j| i + 1 + j)
                    .unwrap_or(xml.len());
                let tag = &xml[i + 1..end];
                if tag.ends_with('/') {
                    i = end + 1;
                    continue;
                }
                let name = tag.split_whitespace().next().unwrap_or(tag);
                stack.push((name, serde_json::Map::new()));
                text.clear();
                i = end + 1;
                continue;
            }
            text.push_str(&xml[i..i + 1]);
            i += 1;
        }
        Err("incomplete".to_string())
    }

    match op {
        "parse" | "to_json" => {
            let json = parse_xml_element(content)?;
            serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
        }
        _ => Ok("XML parsed".to_string()),
    }
}
