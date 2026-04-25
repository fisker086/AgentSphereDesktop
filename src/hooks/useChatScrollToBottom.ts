import { useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';

/**
 * Scrolls the chat column to the bottom synchronously after DOM updates (before paint).
 * Uses the scroll container's `scrollTop` instead of `scrollIntoView` so only this pane moves.
 *
 * Dev-only `[chat-scroll]` logs: filter Console. `scrollHeightShrink` flags layout that got shorter
 * since last effect (often correlates with tall→short jitter before batching fixes).
 */
export function useChatScrollToBottom(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  deps: DependencyList,
  debugLabel: string,
  getDebugSnapshot?: () => Record<string, unknown>,
): void {
  const lastScrollHeightRef = useRef(0);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const scrollHeight = el.scrollHeight;
    const prev = lastScrollHeightRef.current;
    const scrollHeightShrink = prev > 0 && scrollHeight < prev - 8;

    const beforeTop = el.scrollTop;
    const beforeMax = Math.max(0, scrollHeight - el.clientHeight);
    el.scrollTop = el.scrollHeight;
    const afterTop = el.scrollTop;

    if (import.meta.env.DEV) {
      const snap = getDebugSnapshot?.() ?? {};
      console.debug(`[chat-scroll] ${debugLabel}`, {
        beforeTop: Math.round(beforeTop),
        afterTop: Math.round(afterTop),
        delta: Math.round(afterTop - beforeTop),
        beforeMax: Math.round(beforeMax),
        scrollHeight,
        scrollHeightPrev: prev > 0 ? prev : undefined,
        scrollHeightShrink: scrollHeightShrink || undefined,
        clientHeight: el.clientHeight,
        ...snap,
      });
    }

    lastScrollHeightRef.current = scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: deps passed by caller
  }, deps);
}
