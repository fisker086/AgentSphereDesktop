//! Local read-only docker invocation (aligned with internal/skills/docker_operator.go).

use serde_json::Value;
use std::collections::HashSet;
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

fn allowed_ops() -> HashSet<&'static str> {
    [
        "ps", "images", "logs", "inspect", "stats", "network", "volume", "info", "version", "events",
    ]
    .into_iter()
    .collect()
}

/// Runs a whitelisted `docker` subcommand with structured args from the LLM tool JSON.
#[tauri::command]
pub fn run_client_docker_operator(params: Value) -> Result<String, String> {
    eprintln!("[docker_client] run_client_docker_operator invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let mut op = str_arg(obj, &["operation", "op", "action", "command"]);
    if op.is_empty() {
        op = "ps".to_string();
    }

    if !allowed_ops().contains(op.as_str()) {
        eprintln!("[docker_client] rejected operation={:?}", op);
        return Err(format!(
            "operation {:?} not allowed (read-only; allowed: ps, images, logs, inspect, stats, network, volume, info, version, events)",
            op
        ));
    }

    let name = str_arg(obj, &["name", "container", "target"]);
    let all_flag = str_arg(obj, &["all", "include_stopped", "show_all"]);

    let mut cmd_args: Vec<String> = vec![op.clone()];

    match op.as_str() {
        "ps" => {
            if all_flag == "true" || all_flag == "1" || all_flag == "yes" {
                cmd_args.push("-a".to_string());
            }
        }
        "logs" => {
            if name.is_empty() {
                return Err("missing container name for logs".to_string());
            }
            cmd_args.extend(["--tail".to_string(), "100".to_string(), name]);
        }
        "inspect" => {
            if name.is_empty() {
                return Err("missing container/image name for inspect".to_string());
            }
            cmd_args.push(name);
        }
        "stats" => {
            cmd_args.push("--no-stream".to_string());
            if !name.is_empty() {
                cmd_args.push(name);
            }
        }
        "network" | "volume" => {
            let mut sub = str_arg(obj, &["sub_operation", "sub_op", "action2"]);
            if sub.is_empty() {
                sub = "ls".to_string();
            }
            cmd_args.push(sub.clone());
            if !name.is_empty() && sub == "inspect" {
                cmd_args.push(name);
            }
        }
        "images" => {
            cmd_args.push("-a".to_string());
        }
        _ => {}
    }

    let docker_argv: Vec<String> = std::iter::once("docker".to_string())
        .chain(cmd_args.iter().cloned())
        .collect();
    eprintln!(
        "[docker_client] spawning: {}",
        docker_argv
            .iter()
            .map(|s| shell_escape(s))
            .collect::<Vec<_>>()
            .join(" ")
    );

    let output = Command::new("docker")
        .args(&cmd_args)
        .output()
        .map_err(|e| {
            eprintln!("[docker_client] spawn failed: {}", e);
            format!("failed to spawn docker: {}", e)
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !output.status.success() {
        eprintln!(
            "[docker_client] docker exited with status {} (stderr+stdout len={})",
            output.status,
            combined.trim().len()
        );
        return Err(format!(
            "docker {} failed: {}\n{}",
            op,
            output.status,
            combined.trim()
        ));
    }

    let result = combined.trim();
    if result.is_empty() {
        eprintln!("[docker_client] docker {} succeeded (no output)", op);
        return Ok(format!("docker {}: (no output)", op));
    }
    eprintln!(
        "[docker_client] docker {} succeeded, output_len={} bytes",
        op,
        result.len()
    );
    Ok(format!("docker {} result:\n\n{}", op, result))
}

/// Best-effort quoting for log lines (avoid leaking secrets in argv: we only log docker + args).
fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._:-@".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\"'\"'"))
    }
}
