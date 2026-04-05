import { invoke } from '@tauri-apps/api/core';
import { logSecurityEvent } from '../api/audit';

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

export interface JsOutput {
  success: boolean;
  result: string;
  error: string | null;
}

export async function executeJsCode(
  code: string,
  args: string[] = [],
  timeoutMs: number = 5000,
  memoryLimit?: number
): Promise<JsOutput> {
  const result = await invoke<JsOutput>('execute_js_command', {
    code,
    args,
    timeoutMs,
    memoryLimit
  });

  await logSecurityEvent(
    'EXECUTE_JS',
    code.substring(0, 50),
    result.success ? 'SUCCESS' : 'FAILED',
    result.error || undefined
  );

  return result;
}

export async function executeWasm(
  source: Uint8Array,
  functionName: string = 'run',
  args: string[] = [],
  timeLimitMs: number = 5000,
  memoryLimit?: number
): Promise<WasmOutput> {
  const result = await invoke<WasmOutput>('execute_wasm_command', {
    code: Array.from(source),
    function: functionName,
    args,
    memoryLimit,
    timeLimitMs
  });

  await logSecurityEvent(
    'EXECUTE_WASM',
    functionName,
    result.success ? 'SUCCESS' : 'FAILED',
    result.error || undefined
  );

  return result;
}

export class BrowserWasmSandbox {
  private worker: Worker | null = null;
  private pendingResolve: ((value: WasmOutput) => void) | null = null;
  private timeoutId: number | null = null;

  async init(): Promise<boolean> {
    try {
      this.worker = new Worker(
        new URL('./wasmWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      this.worker.onmessage = (event) => {
        if (this.pendingResolve) {
          this.pendingResolve(event.data as WasmOutput);
          this.pendingResolve = null;
        }
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = null;
        }
      };

      return true;
    } catch (e) {
      console.error('Failed to init WASM worker:', e);
      return false;
    }
  }

  async execute(
    moduleBytes: Uint8Array,
    functionName: string = 'run',
    args: string[] = [],
    timeLimitMs: number = 5000
  ): Promise<WasmOutput> {
    if (!this.worker) {
      await this.init();
    }

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      
      this.timeoutId = window.setTimeout(() => {
        resolve({
          success: false,
          result: '',
          error: 'Execution timeout'
        });
        this.pendingResolve = null;
      }, timeLimitMs);

      this.worker!.postMessage({
        type: 'execute',
        module: Array.from(moduleBytes),
        function: functionName,
        args,
        timeLimitMs
      });
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

const wasmModuleCache = new Map<string, WebAssembly.Module>();

export async function compileWasmModule(source: Uint8Array | string, key?: string): Promise<WebAssembly.Module> {
  const cacheKey = key || source.toString();
  
  if (wasmModuleCache.has(cacheKey)) {
    return wasmModuleCache.get(cacheKey)!;
  }

  let bytes: Uint8Array;
  if (typeof source === 'string') {
    bytes = new TextEncoder().encode(source);
  } else {
    bytes = source;
  }

  const module = await WebAssembly.compile(bytes);
  wasmModuleCache.set(cacheKey, module);
  return module;
}

export async function instantiateWasm(
  module: WebAssembly.Module,
  imports: WebAssembly.Imports = {}
): Promise<WebAssembly.Instance> {
  return WebAssembly.instantiate(module, imports);
}

export function createLimitedMemory(maxPages: number = 16): WebAssembly.Memory {
  return new WebAssembly.Memory({
    initial: 1,
    maximum: maxPages,
    shared: false
  });
}

export interface MemoryStats {
  used: number;
  maximum: number;
}

export function getMemoryStats(instance: WebAssembly.Instance): MemoryStats | null {
  const memory = instance.exports['memory'] as WebAssembly.Memory | undefined;
  if (!memory) return null;

  return {
    used: memory.buffer.byteLength,
    maximum: memory.buffer.byteLength
  };
}