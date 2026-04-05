interface ExecuteMessage {
  type: 'execute';
  module: number[];
  function: string;
  args: string[];
  timeLimitMs: number;
}

interface WasmOutput {
  success: boolean;
  result: string;
  error: string | null;
}

self.onmessage = async (event: MessageEvent<ExecuteMessage>) => {
  const { module, function: funcName, timeLimitMs } = event.data;

  try {
    const bytes = new Uint8Array(module);
    const moduleObj = await WebAssembly.compile(bytes);
    
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 64
    });

    const imports = {
      env: {
        memory,
        print: (ptr: number, len: number) => {
          const view = new Uint8Array(memory.buffer);
          const str = new TextDecoder().decode(view.slice(ptr, ptr + len));
          console.log('[WASM]', str);
        },
        time: () => Date.now()
      }
    };

    const instance = await WebAssembly.instantiate(moduleObj, imports);
    
    const deadline = Date.now() + timeLimitMs;
    
    const func = (instance.exports[funcName] as Function) || (instance.exports['run'] as Function);
    
    if (typeof func !== 'function') {
      self.postMessage({
        success: false,
        result: '',
        error: `Function '${funcName}' not found`
      } as WasmOutput);
      return;
    }

    if (Date.now() > deadline) {
      self.postMessage({
        success: false,
        result: '',
        error: 'Execution timeout'
      } as WasmOutput);
      return;
    }

    const result = func();
    
    self.postMessage({
      success: true,
      result: String(result || ''),
      error: null
    } as WasmOutput);

  } catch (e) {
    self.postMessage({
      success: false,
      result: '',
      error: e instanceof Error ? e.message : String(e)
    } as WasmOutput);
  }
};