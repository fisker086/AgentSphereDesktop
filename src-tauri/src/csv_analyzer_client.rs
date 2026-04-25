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

#[tauri::command]
pub fn run_client_csv_analyzer(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let op = str_arg(obj, &["operation", "op", "action"]);
    let op = if op.is_empty() { "info" } else { &op };

    let content = str_arg(obj, &["content", "data", "csv", "text"]);
    if content.is_empty() {
        return Err("missing csv content".to_string());
    }

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
        "info" => Ok(format!(
            "Columns: {}, Rows: {}\n\n{:?}",
            headers.len(),
            rows.len(),
            headers
        )),
        "stats" => {
            let col = str_arg(obj, &["column", "col", "field"]);
            if col.is_empty() {
                return Err("missing column name".to_string());
            }
            let idx = headers
                .iter()
                .position(|h| h.to_lowercase() == col.to_lowercase())
                .ok_or_else(|| format!("column not found: {}", col))?;

            let mut nums: Vec<f64> = Vec::new();
            let mut uniq: HashMap<String, usize> = HashMap::new();

            for row in &rows {
                if let Some(v) = row.get(idx) {
                    let v = v.trim();
                    if !v.is_empty() {
                        *uniq.entry(v.to_string()).or_insert(0) += 1;
                        if let Ok(n) = v.parse::<f64>() {
                            nums.push(n);
                        }
                    }
                }
            }

            let mut result = format!("Column: {}\nUnique: {}", headers[idx], uniq.len());
            if !nums.is_empty() {
                let sum: f64 = nums.iter().sum();
                let avg = sum / nums.len() as f64;
                let min = nums.iter().cloned().fold(f64::INFINITY, f64::min);
                let max = nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                result.push_str(&format!(
                    "\nNumeric: min={:.2}, max={:.2}, avg={:.2}",
                    min, max, avg
                ));
            }
            Ok(result)
        }
        "head" => {
            let n: usize = str_arg(obj, &["limit", "n", "count"]).parse().unwrap_or(10);
            let n = n.min(rows.len());
            let mut out = format!("First {} rows:\n", n);
            out.push_str(&headers.join(" | "));
            out.push('\n');
            for row in rows.iter().take(n) {
                out.push_str(&row.join(" | "));
                out.push('\n');
            }
            Ok(out)
        }
        "tail" => {
            let n: usize = str_arg(obj, &["limit", "n", "count"]).parse().unwrap_or(10);
            let n = n.min(rows.len());
            let start = rows.len() - n;
            let mut out = format!("Last {} rows:\n", n);
            out.push_str(&headers.join(" | "));
            out.push('\n');
            for row in rows.iter().skip(start) {
                out.push_str(&row.join(" | "));
                out.push('\n');
            }
            Ok(out)
        }
        "filter" => {
            let col = str_arg(obj, &["column", "col", "field"]);
            let val = str_arg(obj, &["value", "val", "match"]);
            if col.is_empty() || val.is_empty() {
                return Err("missing column or value".to_string());
            }
            let idx = headers
                .iter()
                .position(|h| h.to_lowercase() == col.to_lowercase())
                .ok_or_else(|| format!("column not found: {}", col))?;

            let filtered: Vec<_> = rows
                .iter()
                .filter(|r| {
                    r.get(idx)
                        .map(|v| v.to_lowercase().contains(&val.to_lowercase()))
                        .unwrap_or(false)
                })
                .collect();

            let mut out = format!(
                "Filtered {}={}: {} of {}\n",
                col,
                val,
                filtered.len(),
                rows.len()
            );
            out.push_str(&headers.join(" | "));
            out.push('\n');
            for row in filtered.iter().take(20) {
                out.push_str(&row.join(" | "));
                out.push('\n');
            }
            Ok(out)
        }
        "count" => Ok(format!("Total rows: {}", rows.len())),
        _ => Err(format!("unknown op: {}", op)),
    }
}
