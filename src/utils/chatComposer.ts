import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Multiline chat input: **Enter** sends, **Shift+Enter** inserts a newline.
 * During IME composition (e.g. Chinese Pinyin), **Enter** confirms the word — does not send.
 */
export function onChatInputEnterToSend(
  e: ReactKeyboardEvent<HTMLElement>,
  send: () => void | Promise<void>,
): void {
  if (e.key !== 'Enter') return;
  if (e.shiftKey) return;
  if (e.nativeEvent.isComposing) return;
  // Some engines still report keyCode 229 while IME is active
  const kn = (e.nativeEvent as unknown as { keyCode?: number }).keyCode;
  if (kn === 229) return;
  e.preventDefault();
  void send();
}
