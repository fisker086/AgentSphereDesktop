use chrono::Local;
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
pub fn run_client_datetime(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let op = str_arg(obj, &["operation", "op", "action"]);
    let op = if op.is_empty() { "now" } else { &op };

    let now = Local::now();

    match op {
        "now" | "current" | "time" => Ok(format!(
            "Current time: {}\nISO 8601: {}\nUnix: {}",
            now.format("%Y-%m-%d %H:%M:%S %Z"),
            now.to_rfc3339(),
            now.timestamp()
        )),
        "convert" => Ok("Timezone conversion: use 'now' or provide full timestamp".to_string()),
        "parse" => {
            let time_str = str_arg(obj, &["time", "datetime", "timestamp", "input"]);
            if time_str.is_empty() {
                return Err("missing time string".to_string());
            }

            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&time_str, "%Y-%m-%d %H:%M:%S") {
                return Ok(format!(
                    "Parsed: {}\nUnix: {}",
                    dt.format("%Y-%m-%d %H:%M:%S"),
                    dt.and_utc().timestamp()
                ));
            }
            if let Ok(dt) = chrono::NaiveDate::parse_from_str(&time_str, "%Y-%m-%d") {
                return Ok(format!("Parsed: {}", dt.format("%Y-%m-%d")));
            }
            Err(format!("cannot parse: {}", time_str))
        }
        "relative" => {
            let expr = str_arg(obj, &["expression", "expr", "relative", "offset"]);
            if expr.is_empty() {
                return Err("missing expression".to_string());
            }

            let mut days = 0i64;
            let mut hours = 0i64;

            let re = regex::Regex::new(r"(\d+)\s*(days?|hours?)").unwrap();
            for cap in re.captures_iter(&expr) {
                let num: i64 = cap[1].parse().unwrap_or(0);
                if cap[2].starts_with("day") {
                    days = num;
                } else if cap[2].starts_with("hour") {
                    hours = num;
                }
            }

            let result = now + chrono::Duration::days(days) + chrono::Duration::hours(hours);

            Ok(format!(
                "Base: {}\nExpression: {}\nResult: {}",
                now.format("%Y-%m-%d %H:%M:%S"),
                expr,
                result.format("%Y-%m-%d %H:%M:%S")
            ))
        }
        _ => Err(format!("unknown op: {}", op)),
    }
}
