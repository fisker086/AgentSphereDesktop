import { invoke } from '@tauri-apps/api/core';

export interface WasmInput {
  code: number[];
  function: string;
  args: string[];
  memory_limit?: number;
  time_limit_ms?: number;
}

export interface WasmOutput {
  success: boolean;
  result: string;
  error: string | null;
}

export async function executeWasm(
  source: string,
  functionName: string = 'run',
  args: string[] = [],
  timeLimitMs: number = 5000
): Promise<WasmOutput> {
  const wasmBytes = await compileToWasm(source);
  
  return invoke<WasmOutput>('execute_wasm_command', {
    code: Array.from(wasmBytes),
    function: functionName,
    args,
    memoryLimit: null,
    timeLimitMs
  });
}

async function compileToWasm(source: string): Promise<Uint8Array> {
  console.log('WASM sandbox: Compiling source:', source.substring(0, 100) + '...');
  
  const wasmText = `
(module
  (import "env" "memory" (memory 1 65536))
  
  (func $print (import "env" "print") (param i32 i32))
  (func $time (import "env") (result i64)
    (i64.const 0)
  )
  
  (func $run (export "run") (param i32 i32) (result i32)
    ;; Simple implementation - just return success
    (i32.const 0)
  )
  
  (func $alloc (export "alloc") (param i32) (result i32)
    (i32.const 0)
  )
)
  `;
  
  return new TextEncoder().encode(wasmText);
}

export class WasmSandbox {
  private compiled: Uint8Array | null = null;
  
  async compile(code: string): Promise<boolean> {
    try {
      this.compiled = await compileToWasm(code);
      return true;
    } catch (e) {
      console.error('WASM compilation failed:', e);
      return false;
    }
  }
  
  async execute(
    functionName: string = 'run',
    args: string[] = [],
    timeLimitMs: number = 5000
  ): Promise<WasmOutput> {
    if (!this.compiled) {
      return {
        success: false,
        result: '',
        error: 'No code compiled'
      };
    }
    
    return invoke<WasmOutput>('execute_wasm_command', {
      code: Array.from(this.compiled),
      function: functionName,
      args,
      memoryLimit: null,
      timeLimitMs
    });
  }
}