use serde_json::Value;
use std::collections::HashSet;
use std::env;
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

fn allowed_git_ops() -> HashSet<&'static str> {
    ["status", "log", "diff", "branch", "show", "blame", "tag"]
        .into_iter()
        .collect()
}

#[tauri::command]
pub fn run_client_git_operator(params: Value) -> Result<String, String> {
    // 若看到这行 stderr，说明 git 是在本机 AI TaskMeta（Tauri）进程里执行的，而不是 aiops-server。
    eprintln!(
        "[git_client] CLIENT_SIDE layer=tauri pid={} current_exe={}",
        std::process::id(),
        env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "(unknown)".to_string())
    );

    let obj = params.as_object().ok_or("params must be a JSON object")?;

    let mut op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        op = "status".to_string();
    }

    if !allowed_git_ops().contains(op.as_str()) {
        return Err(format!("operation not allowed: {}", op));
    }

    let repo_path = str_arg(obj, &["repo_path", "path", "directory", "dir"]);
    let dir = if repo_path.is_empty() {
        "."
    } else {
        &repo_path
    };

    let resolved_display = if repo_path.is_empty() {
        env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| ".".to_string())
    } else {
        repo_path.clone()
    };
    let extra_args = str_arg(obj, &["args", "arguments", "extra"]);
    // Mirrors `internal/skills/git_operator.go` `buildGitArgs`.
    let mut git_args: Vec<String> = vec![op.clone()];
    if !extra_args.trim().is_empty() {
        git_args.extend(
            extra_args
                .split_whitespace()
                .map(std::string::ToString::to_string),
        );
    }
    match op.as_str() {
        "log" if extra_args.trim().is_empty() => {
            git_args.extend(["--oneline".to_string(), "-n".to_string(), "20".to_string()]);
        }
        "diff" if extra_args.trim().is_empty() => {
            git_args.push("--stat".to_string());
        }
        "branch" if extra_args.trim().is_empty() => {
            git_args.push("-a".to_string());
        }
        _ => {}
    }

    eprintln!(
        "[git_client] run_client_git_operator op={} repo_path_param={:?} cwd_for_git={:?} resolved={} extra_args={:?} git_argv={:?}",
        op,
        if repo_path.is_empty() {
            None::<&str>
        } else {
            Some(repo_path.as_str())
        },
        dir,
        resolved_display,
        extra_args,
        std::iter::once("git".to_string())
            .chain(git_args.iter().cloned())
            .collect::<Vec<_>>()
    );

    let output = Command::new("git")
        .args(&git_args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("failed to spawn git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        eprintln!(
            "[git_client] CLIENT_SIDE git failed op={} status={:?}",
            op,
            output.status.code()
        );
        return Err(format!(
            "git {:?} in {} failed (status {:?})\nstdout:\n{}\nstderr:\n{}",
            git_args,
            resolved_display,
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }

    let out = String::from_utf8_lossy(&output.stdout);
    eprintln!(
        "[git_client] CLIENT_SIDE git finished ok op={} stdout_len={}",
        op,
        out.len()
    );
    Ok(format!("git {}:\n{}", op, out))
}
