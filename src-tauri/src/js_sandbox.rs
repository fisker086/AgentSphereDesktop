use rquickjs::{Context, Error, Runtime};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

pub struct JsSandbox {
    runtime: Runtime,
}

impl JsSandbox {
    pub fn new() -> Self {
        let runtime = Runtime::new().expect("Failed to create JS runtime");
        Self { runtime }
    }

    pub fn execute(&self, code: &str, timeout_ms: u64) -> JsOutput {
        let ctx = match Context::base(&self.runtime) {
            Ok(c) => c,
            Err(e) => {
                return JsOutput {
                    success: false,
                    result: String::new(),
                    error: Some(format!("Failed to create context: {}", e)),
                };
            }
        };

        let timeout = Duration::from_millis(timeout_ms);
        let start = Instant::now();

        let result: Result<String, Error> = ctx.with(|ctx| ctx.eval(code.as_bytes()));

        if start.elapsed() > timeout {
            return JsOutput {
                success: false,
                result: String::new(),
                error: Some("Execution timeout".to_string()),
            };
        }

        match result {
            Ok(value) => JsOutput {
                success: true,
                result: value,
                error: None,
            },
            Err(e) => JsOutput {
                success: false,
                result: String::new(),
                error: Some(e.to_string()),
            },
        }
    }

    pub fn execute_with_args(&self, code: &str, args: Vec<String>, timeout_ms: u64) -> JsOutput {
        let ctx = match Context::base(&self.runtime) {
            Ok(c) => c,
            Err(e) => {
                return JsOutput {
                    success: false,
                    result: String::new(),
                    error: Some(format!("Failed to create context: {}", e)),
                };
            }
        };

        let timeout = Duration::from_millis(timeout_ms);
        let start = Instant::now();

        let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "[]".to_string());
        let wrapped_code = format!(
            r#"(function() {{
                const args = {};
                {}
            }})()"#,
            args_json, code
        );

        let result: Result<String, Error> = ctx.with(|ctx| ctx.eval(wrapped_code.as_bytes()));

        if start.elapsed() > timeout {
            return JsOutput {
                success: false,
                result: String::new(),
                error: Some("Execution timeout".to_string()),
            };
        }

        match result {
            Ok(value) => JsOutput {
                success: true,
                result: value,
                error: None,
            },
            Err(e) => JsOutput {
                success: false,
                result: String::new(),
                error: Some(e.to_string()),
            },
        }
    }
}

impl Default for JsSandbox {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JsInput {
    pub code: String,
    pub args: Vec<String>,
    pub timeout_ms: Option<u64>,
    pub memory_limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsOutput {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

pub fn execute_js(input: JsInput) -> JsOutput {
    let timeout = input.timeout_ms.unwrap_or(5000);
    let sandbox = JsSandbox::new();
    if input.args.is_empty() {
        sandbox.execute(&input.code, timeout)
    } else {
        sandbox.execute_with_args(&input.code, input.args, timeout)
    }
}
