use serde_json::Value;
use std::process::Command;

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
pub fn run_client_test_runner(params: Value) -> Result<String, String> {
    let obj = params.as_object().ok_or("params must be a JSON object")?;
    let framework = str_arg(obj, &["framework", "lang", "language"]);
    let framework = if framework.is_empty() {
        "go"
    } else {
        &framework
    };

    let work_dir = str_arg(obj, &["work_dir", "cwd", "directory"]);
    let test_path = str_arg(obj, &["path", "test_path", "file"]);
    let pattern = str_arg(obj, &["pattern", "match", "run"]);

    let (cmd, args) = match framework.to_lowercase().as_str() {
        "go" => {
            let mut args = vec!["test".to_string(), "-v".to_string()];
            if !test_path.is_empty() {
                args.push(test_path);
            }
            if !pattern.is_empty() {
                args.push("-run".to_string());
                args.push(pattern);
            }
            args.push("-count=1".to_string());
            ("go".to_string(), args)
        }
        "jest" | "npm" => {
            if std::path::Path::new("package.json").exists() {
                (
                    "npm".to_string(),
                    vec![
                        "test".to_string(),
                        "--".to_string(),
                        "--verbose".to_string(),
                    ],
                )
            } else {
                (
                    "npx".to_string(),
                    vec!["jest".to_string(), "--verbose".to_string()],
                )
            }
        }
        "playwright" => {
            let mut args = vec!["test".to_string()];
            if !test_path.is_empty() {
                args.push(test_path);
            }
            if !pattern.is_empty() {
                args.push("-g".to_string());
                args.push(pattern);
            }
            ("npx".to_string(), args)
        }
        "pytest" => {
            let mut args = vec!["-v".to_string()];
            if !pattern.is_empty() {
                args.push("-k".to_string());
                args.push(pattern);
            }
            if !test_path.is_empty() {
                args.push(test_path);
            } else {
                args.push(".".to_string());
            }
            ("pytest".to_string(), args)
        }
        "cargo" => {
            let mut args = vec![
                "test".to_string(),
                "--".to_string(),
                "--verbose".to_string(),
            ];
            if !pattern.is_empty() {
                args.push("--test".to_string());
                args.push(pattern);
            }
            ("cargo".to_string(), args)
        }
        _ => return Err(format!("unsupported framework: {}", framework)),
    };

    let mut c = Command::new(&cmd);
    c.args(&args);

    if !work_dir.is_empty() {
        c.current_dir(&work_dir);
    }

    let output = c.output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(format!(
            "Test execution failed:\n{}\n\nOutput:\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(format!(
        "Test executed successfully:\n{}",
        String::from_utf8_lossy(&output.stdout)
    ))
}
