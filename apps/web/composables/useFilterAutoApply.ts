import { onBeforeUnmount, watch } from "vue";

export const FILTER_AUTO_APPLY_MS = 800;

/**
 * Applies a filter form automatically shortly after the user stops changing it.
 * Call `markApplied()` whenever the page loads with the current filters (reset, presets, paging),
 * so the debounced watcher does not trigger a second identical load.
 */
export function useFilterAutoApply(source: () => unknown, apply: () => void, canApply: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready = false;
  let lastApplied = "";

  const snapshot = () => JSON.stringify(source());

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function markApplied() {
    cancel();
    lastApplied = snapshot();
  }

  watch(source, () => {
    if (!ready || !canApply()) return;
    cancel();
    if (snapshot() === lastApplied) return;
    timer = setTimeout(() => {
      timer = undefined;
      apply();
    }, FILTER_AUTO_APPLY_MS);
  });

  onBeforeUnmount(cancel);

  return {
    markApplied,
    /** Enable auto-apply once the initial load has run. */
    start() {
      ready = true;
      markApplied();
    },
  };
}
