//! Local password strength checker (aligned with skills/password_strength_checker/SKILL.md).

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

fn check_password_strength(password: &str) -> (u8, Vec<String>) {
    let mut score: u8 = 0;
    let mut suggestions = Vec::new();

    if password.len() >= 8 {
        score += 10;
    } else {
        suggestions.push("Use at least 8 characters".to_string());
    }

    if password.len() >= 12 {
        score += 10;
    }

    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    if has_lower && has_upper {
        score += 20;
    } else {
        if !has_lower {
            suggestions.push("Add lowercase letters".to_string());
        }
        if !has_upper {
            suggestions.push("Add uppercase letters".to_string());
        }
    }

    if has_digit {
        score += 20;
    } else {
        suggestions.push("Add numbers".to_string());
    }

    if has_special {
        score += 20;
    } else {
        suggestions.push("Add special characters (!@#$%^&*)".to_string());
    }

    let common_passwords = [
        "password", "123456", "qwerty", "admin", "letmein", "welcome", "monkey", "dragon",
    ];
    let lower = password.to_lowercase();
    if common_passwords.iter().any(|p| lower.contains(p)) {
        score = score.saturating_sub(30);
        suggestions.push("Avoid common passwords".to_string());
    }

    if password.len() > 0 {
        let entropy = (password.len() as f64) * 3.32;
        if entropy < 28.0 {
            score = score.saturating_sub(10);
            suggestions.push("Increase password complexity for higher entropy".to_string());
        }
    }

    (score, suggestions)
}

#[tauri::command]
pub fn run_client_password_strength_checker(params: Value) -> Result<String, String> {
    eprintln!("[password_strength_checker] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let password = str_arg(obj, &["password", "pass", "pwd"]);
    if password.is_empty() {
        return Err("missing password".to_string());
    }

    let (score, suggestions) = check_password_strength(&password);

    let strength = if score >= 80 {
        "Strong"
    } else if score >= 50 {
        "Medium"
    } else {
        "Weak"
    };

    let result = format!(
        "Password Strength: {}/100 ({})\n\nSuggestions:\n{}",
        score,
        strength,
        if suggestions.is_empty() {
            "- None (good password!)".to_string()
        } else {
            suggestions
                .iter()
                .map(|s| format!("- {}", s))
                .collect::<Vec<_>>()
                .join("\n")
        }
    );

    eprintln!(
        "[password_strength_checker] score={}, strength={}",
        score, strength
    );
    Ok(result)
}
