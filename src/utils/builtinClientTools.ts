/**
 * Desktop client tools use names `builtin_*` and Tauri commands `run_client_*` with the same suffix.
 * Add new Rust handlers in `src-tauri/src/lib.rs` only; no frontend list to maintain.
 */
export function builtinToTauriCommand(toolName: string): string {
  if (!toolName.startsWith('builtin_')) {
    throw new Error(`expected builtin_* tool name, got: ${toolName}`);
  }
  return toolName.replace(/^builtin_/, 'run_client_');
}

export function isBuiltinClientToolName(toolName: string): boolean {
  return toolName.startsWith('builtin_');
}

/**
 * Invokes the matching `run_client_*` Tauri command.
 * Implementation for `builtin_browser` lives in `src-tauri/src/builtin_browser.rs` (client HTTP fetch).
 */
export async function invokeBuiltinClientTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const cmd = builtinToTauriCommand(toolName);
  const raw = await invoke<string>(cmd, { params });
  const s = String(raw ?? '');
  // Empty POST body makes the server persist an empty tool message → generic stream failure.
  if (s.trim() !== '') return s;
  return '(local tool produced no output; check permissions or stderr in devtools / Tauri logs)';
}
