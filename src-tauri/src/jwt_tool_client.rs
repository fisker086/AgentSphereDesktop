//! Local JWT tool client (aligned with skills/jwt_tool/SKILL.md).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn decode_jwt(token: &str) -> Result<(serde_json::Value, serde_json::Value), String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(format!(
            "Invalid JWT format: expected 3 parts, got {}",
            parts.len()
        ));
    }

    let header = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|e| format!("Failed to decode header: {}", e))?;
    let header_json: serde_json::Value = serde_json::from_slice(&header)
        .map_err(|e| format!("Failed to parse header JSON: {}", e))?;

    let payload = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|e| format!("Failed to decode payload: {}", e))?;
    let payload_json: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|e| format!("Failed to parse payload JSON: {}", e))?;

    Ok((header_json, payload_json))
}

fn check_expiration(payload: &serde_json::Value) -> (bool, String) {
    if let Some(exp) = payload.get("exp") {
        if let Some(exp_num) = exp.as_i64() {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            if exp_num < now {
                return (true, format!("Token expired at: {}", exp_num));
            } else {
                let remaining = exp_num - now;
                return (false, format!("Token expires in {} seconds", remaining));
            }
        }
    }
    (false, "No expiration set".to_string())
}

#[tauri::command]
pub fn run_client_jwt_tool(params: Value) -> Result<String, String> {
    eprintln!("[jwt_tool] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    let token = str_arg(obj, &["token", "jwt", "jwt_token"]);

    if token.is_empty() {
        return Err("missing token".to_string());
    }

    match op.as_str() {
        "decode" | "" => {
            let (header, payload) = decode_jwt(&token)?;
            let (expired, exp_info) = check_expiration(&payload);

            let result = format!(
                "Header:\n{}\n\nPayload:\n{}\n\nExpiration: {}",
                serde_json::to_string_pretty(&header).unwrap_or_default(),
                serde_json::to_string_pretty(&payload).unwrap_or_default(),
                exp_info
            );
            eprintln!("[jwt_tool] decode done, expired={}", expired);
            Ok(result)
        }
        "verify" => {
            let (_header, payload) = decode_jwt(&token)?;
            let (expired, exp_info) = check_expiration(&payload);

            if expired {
                eprintln!("[jwt_tool] token expired");
                Err(format!("Token is expired: {}", exp_info))
            } else {
                eprintln!("[jwt_tool] token valid");
                Ok(format!("Token is valid. {}", exp_info))
            }
        }
        "encode" => return Err("encode not implemented yet - decode only".to_string()),
        _ => Err(format!("unknown operation: {}", op)),
    }
}
