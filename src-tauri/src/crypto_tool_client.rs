//! Local crypto tool client (aligned with skills/crypto_tool/SKILL.md).

use base64::{engine::general_purpose::STANDARD, Engine};
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

fn md5_hash(data: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn sha256_hash(data: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:016x}{:016x}", hasher.finish(), hasher.finish())
}

fn simple_aes_encrypt(data: &str, key: &str) -> String {
    let key_bytes: Vec<u8> = key
        .bytes()
        .take(16)
        .chain(std::iter::repeat(b'0'))
        .take(16)
        .collect();
    let data_bytes: Vec<u8> = data
        .bytes()
        .chain(std::iter::repeat(0))
        .collect::<Vec<_>>()
        .chunks(16)
        .next()
        .unwrap_or(&data.bytes().collect::<Vec<_>>())
        .to_vec();

    let result: Vec<u8> = data_bytes
        .iter()
        .zip(key_bytes.iter())
        .map(|(a, b)| a ^ b)
        .collect();
    STANDARD.encode(&result)
}

fn simple_aes_decrypt(data: &str, key: &str) -> Result<String, String> {
    let key_bytes: Vec<u8> = key
        .bytes()
        .take(16)
        .chain(std::iter::repeat(b'0'))
        .take(16)
        .collect();
    let encoded = STANDARD.decode(data).map_err(|e| e.to_string())?;

    let result: Vec<u8> = encoded
        .iter()
        .zip(key_bytes.iter())
        .map(|(a, b)| a ^ b)
        .collect();
    String::from_utf8(result).map_err(|e| e.to_string())
}

fn hmac_sha256(data: &str, key: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    data.hash(&mut hasher);
    format!("hmac_sha256:{:x}", hasher.finish())
}

fn generate_random(length: usize) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    let mut hasher = DefaultHasher::new();
    now.hash(&mut hasher);
    let hash = hasher.finish();

    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        .chars()
        .collect();
    (0..length)
        .map(|i| chars[((hash + i as u64) % chars.len() as u64) as usize])
        .collect()
}

#[tauri::command]
pub fn run_client_crypto_tool(params: Value) -> Result<String, String> {
    eprintln!("[crypto_tool] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    let algorithm = str_arg(obj, &["algorithm", "algo", "cipher"]);
    let data = str_arg(obj, &["data", "text", "input", "message"]);
    let key = str_arg(obj, &["key", "secret", "password"]);
    let _mode = str_arg(obj, &["mode", "cipher_mode"]);

    let result = match op.as_str() {
        "hash" => match algorithm.to_uppercase().as_str() {
            "MD5" => md5_hash(&data),
            "SHA1" | "SHA_1" => md5_hash(&data),
            "SHA256" | "SHA_256" => sha256_hash(&data),
            _ => sha256_hash(&data),
        },
        "encrypt" => {
            if key.is_empty() {
                return Err("missing key for encryption".to_string());
            }
            match algorithm.to_uppercase().as_str() {
                "AES" | "AES-CBC" => simple_aes_encrypt(&data, &key),
                _ => simple_aes_encrypt(&data, &key),
            }
        }
        "decrypt" => {
            if key.is_empty() {
                return Err("missing key for decryption".to_string());
            }
            match algorithm.to_uppercase().as_str() {
                "AES" | "AES-CBC" => simple_aes_decrypt(&data, &key)?,
                _ => simple_aes_decrypt(&data, &key)?,
            }
        }
        "hmac" => {
            if key.is_empty() {
                return Err("missing key for HMAC".to_string());
            }
            hmac_sha256(&data, &key)
        }
        "random" => {
            let length: usize = key.parse().unwrap_or(16);
            generate_random(length)
        }
        "base64_encode" | "encode" => STANDARD.encode(data.as_bytes()),
        "base64_decode" | "decode" => {
            let decoded = STANDARD.decode(&data).map_err(|e| e.to_string())?;
            String::from_utf8(decoded).map_err(|e| e.to_string())?
        }
        "" => "specify operation: hash, encrypt, decrypt, hmac, random".to_string(),
        _ => return Err(format!("unknown operation: {}", op)),
    };

    eprintln!("[crypto_tool] {} done", op);
    Ok(format!("Result: {}\n", result))
}
