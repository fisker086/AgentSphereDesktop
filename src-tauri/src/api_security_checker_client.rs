//! Local API security checker client (aligned with skills/api_security_checker/SKILL.md).

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

fn check_sql_injection(code: &str) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let patterns = [
        (
            r#""SELECT.*\+.*request"#,
            "Potential SQL injection: string concatenation",
        ),
        (
            r#""SELECT.*%s"#,
            "Potential SQL injection: sprintf placeholder",
        ),
        (
            r#""SELECT.*\".*format"#,
            "Potential SQL injection: format string",
        ),
        (
            r#"execute\s*\(\s*".*SELECT.*\+.*"#,
            "Potential SQL injection: execute with concatenation",
        ),
        (
            r#"query\s*\(\s*".*SELECT.*\+.*"#,
            "Potential SQL injection: query with concatenation",
        ),
        (r#"f"SELECT.*{"#, "Potential SQL injection: f-string"),
    ];

    let lines: Vec<&str> = code.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    issues.push((
                        format!("Line {}: SQL Injection", line_num + 1),
                        format!("{} - {}", msg, line.chars().take(60).collect::<String>()),
                    ));
                }
            }
        }
    }
    issues
}

fn check_xss(code: &str) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let patterns = [
        (
            r#"innerHTML\s*=", "Potential XSS: innerHTML assignment"),
        (r#"dangerouslySetInnerHTML"#,
            "Potential XSS: React dangerouslySetInnerHTML",
        ),
        (
            r#"eval\s*\(\s*", "Potential XSS: eval with user input"),
        (r#"document\.write\s*\(", "Potential XSS: document.write"),
        (r#"<%\s*=\s*", "Potential XSS: EJS unescaped output"),
        (r#"{{.*\|safe}}"#,
            "Potential XSS: Jinja2 safe filter",
        ),
    ];

    let lines: Vec<&str> = code.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    issues.push((
                        format!("Line {}: XSS", line_num + 1),
                        format!("{} - {}", msg, line.chars().take(60).collect::<String>()),
                    ));
                }
            }
        }
    }
    issues
}

fn check_command_injection(code: &str) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let patterns = [
        (
            r#"exec\s*\(\s*".*\$"#,
            "Potential command injection: exec with variable",
        ),
        (
            r#"system\s*\(\s*".*\$"#,
            "Potential command injection: system with variable",
        ),
        (
            r#"popen\s*\(\s*".*\$"#,
            "Potential command injection: popen with variable",
        ),
        (
            r#"shell_exec\s*\(\s*".*\$"#,
            "Potential command injection: shell_exec",
        ),
        (
            r#"ProcessBuilder.*runtime"#,
            "Potential command injection: ProcessBuilder",
        ),
    ];

    let lines: Vec<&str> = code.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    issues.push((
                        format!("Line {}: Command Injection", line_num + 1),
                        format!("{} - {}", msg, line.chars().take(60).collect::<String>()),
                    ));
                }
            }
        }
    }
    issues
}

fn check_path_traversal(code: &str) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let patterns = [
        (
            r#"open\s*\(\s*".*\.\./"#,
            "Potential path traversal: open with ..",
        ),
        (
            r#"readFile\s*\(\s*".*\.\./"#,
            "Potential path traversal: readFile with ..",
        ),
        (
            r#"readFileSync\s*\(\s*".*\.\./"#,
            "Potential path traversal: readFileSync with ..",
        ),
        (
            r#"join\s*\(\s*req\.params"#,
            "Potential path traversal: join with user input",
        ),
    ];

    let lines: Vec<&str> = code.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    issues.push((
                        format!("Line {}: Path Traversal", line_num + 1),
                        format!("{} - {}", msg, line.chars().take(60).collect::<String>()),
                    ));
                }
            }
        }
    }
    issues
}

fn check_unsafe_deserialization(code: &str) -> Vec<(String, String)> {
    let mut issues = Vec::new();
    let patterns = [
        (
            r#"pickle\.load\s*\("#,
            "Unsafe deserialization: pickle.load",
        ),
        (
            r#"yaml\.load\s*\([^)]*Loader=yaml\.FullLoader"#,
            "Unsafe deserialization: yaml.load without SafeLoader",
        ),
        (
            r#"ObjectInputStream"#,
            "Unsafe deserialization: ObjectInputStream",
        ),
        (r#"XMLDecoder"#, "Unsafe deserialization: XMLDecoder"),
    ];

    let lines: Vec<&str> = code.lines().collect();
    for (line_num, line) in lines.iter().enumerate() {
        for (pattern, msg) in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    issues.push((
                        format!("Line {}: Unsafe Deserialization", line_num + 1),
                        format!("{} - {}", msg, line.chars().take(60).collect::<String>()),
                    ));
                }
            }
        }
    }
    issues
}

#[tauri::command]
pub fn run_client_api_security_checker(params: Value) -> Result<String, String> {
    eprintln!("[api_security_checker] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let code = str_arg(obj, &["code", "source", "content", "input"]);
    if code.is_empty() {
        return Err("missing code to check".to_string());
    }

    let mut all_issues = Vec::new();
    all_issues.extend(check_sql_injection(&code));
    all_issues.extend(check_xss(&code));
    all_issues.extend(check_command_injection(&code));
    all_issues.extend(check_path_traversal(&code));
    all_issues.extend(check_unsafe_deserialization(&code));

    if all_issues.is_empty() {
        eprintln!("[api_security_checker] no issues found");
        Ok("No security issues detected.\n".to_string())
    } else {
        eprintln!("[api_security_checker] found {} issues", all_issues.len());
        let result = all_issues
            .iter()
            .map(|(t, l)| format!("{}: {}", t, l))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!("Security issues found:\n{}\n", result))
    }
}
