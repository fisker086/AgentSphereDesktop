use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use wasmtime::{Config, Engine, Linker, Memory, Module, Store};

static ENGINE: std::sync::OnceLock<Engine> = std::sync::OnceLock::new();
static BLOCKED_FUNCTIONS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static MEMORY_LIMIT_BYTES: Mutex<usize> = Mutex::new(64 * 1024 * 1024);

fn get_engine() -> &'static Engine {
    ENGINE.get_or_init(|| {
        let mut config = Config::default();
        config.epoch_interruption(true);
        Engine::new(&config).expect("Failed to create wasmtime engine")
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WasmInput {
    pub code: Vec<u8>,
    pub function: String,
    pub args: Vec<String>,
    pub memory_limit: Option<usize>,
    pub time_limit_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WasmOutput {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WasmStats {
    pub memory_used: usize,
    pub memory_limit: usize,
    pub execution_time_ms: u64,
}

pub fn init_wasm_sandbox() {}

/// Reserved for Tauri / future config hooks (mutates `BLOCKED_FUNCTIONS`).
#[allow(dead_code)]
pub fn set_blocked_functions(functions: Vec<String>) {
    let mut blocked = BLOCKED_FUNCTIONS.lock().unwrap();
    *blocked = Some(functions.into_iter().collect());
}

/// Reserved for Tauri / future config hooks (mutates default WASM memory cap).
#[allow(dead_code)]
pub fn set_memory_limit(bytes: usize) {
    let mut limit = MEMORY_LIMIT_BYTES.lock().unwrap();
    *limit = bytes;
}

pub fn get_memory_limit() -> usize {
    *MEMORY_LIMIT_BYTES.lock().unwrap()
}

fn is_function_blocked(name: &str) -> bool {
    let blocked = BLOCKED_FUNCTIONS.lock().unwrap();
    if let Some(set) = blocked.as_ref() {
        set.contains(name)
    } else {
        false
    }
}

pub fn execute_wasm(input: WasmInput) -> WasmOutput {
    let engine = get_engine();
    let start = std::time::Instant::now();

    let mut store = Store::new(engine, ());

    if let Some(limit_ms) = input.time_limit_ms {
        let deadline = (limit_ms / 10).max(1);
        store.set_epoch_deadline(deadline);
    }

    let module = match Module::from_binary(engine, &input.code) {
        Ok(m) => m,
        Err(e) => {
            return WasmOutput {
                success: false,
                result: String::new(),
                error: Some(format!("Failed to load WASM module: {}", e)),
            };
        }
    };

    let mut linker = Linker::new(engine);

    let mem_limit_pages = input.memory_limit.unwrap_or_else(get_memory_limit) as u32 / 65536;
    let memory = match Memory::new(
        &mut store,
        wasmtime::MemoryType::new(1, Some(mem_limit_pages.max(1))),
    ) {
        Ok(m) => m,
        Err(e) => {
            return WasmOutput {
                success: false,
                result: String::new(),
                error: Some(format!("Failed to create memory: {}", e)),
            };
        }
    };

    if is_function_blocked(&input.function) {
        return WasmOutput {
            success: false,
            result: String::new(),
            error: Some(format!("Function '{}' is blocked", input.function)),
        };
    }

    let _ = linker.define(&mut store, "env", "memory", memory);

    let instance = match linker.instantiate(&mut store, &module) {
        Ok(i) => i,
        Err(e) => {
            return WasmOutput {
                success: false,
                result: String::new(),
                error: Some(format!("Failed to instantiate: {}", e)),
            };
        }
    };

    let func = match instance.get_typed_func::<(i32, i32), i32>(&mut store, &input.function) {
        Ok(f) => f,
        Err(_) => {
            return WasmOutput {
                success: false,
                result: String::new(),
                error: Some(format!(
                    "Function '{}' not found or has invalid signature",
                    input.function
                )),
            };
        }
    };

    let args_data = input.args.join("\x00");
    let args_len = args_data.len() as i32;

    let alloc_func: Option<wasmtime::TypedFunc<i32, i32>> =
        instance.get_typed_func(&mut store, "alloc").ok();

    let (result_ptr, result_len) = if let Some(alloc) = alloc_func {
        let ptr = match alloc.call(&mut store, args_len) {
            Ok(p) => p,
            Err(e) => {
                return WasmOutput {
                    success: false,
                    result: String::new(),
                    error: Some(format!("alloc failed: {}", e)),
                };
            }
        };
        if let Err(e) = memory.write(&mut store, ptr as usize, args_data.as_bytes()) {
            return WasmOutput {
                success: false,
                result: String::new(),
                error: Some(format!("write memory failed: {}", e)),
            };
        }
        (ptr, args_len)
    } else {
        (0, 0)
    };

    let ret = func.call(&mut store, (result_ptr, result_len));
    let elapsed = start.elapsed().as_millis() as u64;

    match ret {
        Ok(_) => {
            if result_ptr != 0 && result_len > 0 {
                let mut buf = vec![0u8; result_len as usize];
                match memory.read(&mut store, result_ptr as usize, &mut buf) {
                    Ok(_) => {
                        let result_str = String::from_utf8_lossy(&buf).to_string();
                        WasmOutput {
                            success: true,
                            result: result_str,
                            error: None,
                        }
                    }
                    Err(e) => WasmOutput {
                        success: false,
                        result: String::new(),
                        error: Some(format!("read memory failed: {}", e)),
                    },
                }
            } else {
                WasmOutput {
                    success: true,
                    result: elapsed.to_string(),
                    error: None,
                }
            }
        }
        Err(e) => {
            let error_msg = if e.to_string().contains("deadline") {
                "Execution timeout".to_string()
            } else {
                format!("Execution error: {}", e)
            };
            WasmOutput {
                success: false,
                result: String::new(),
                error: Some(error_msg),
            }
        }
    }
}
