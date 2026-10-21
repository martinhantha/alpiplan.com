/** Shared UModal `ui` for Schnellerfassung — centered; max height respects system bars only. */
export const quickCaptureModalUi = {
  overlay: "bg-elevated/75",
  content:
    "max-w-2xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] flex flex-col overflow-hidden " +
    "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 " +
    "max-h-[min(96dvh,calc(100dvh-var(--app-safe-top)-var(--app-safe-bottom)-0.5rem))] " +
    "rounded-xl shadow-lg ring ring-default",
  header: "px-3 py-2 sm:px-4 sm:py-2.5 shrink-0 border-b border-neutral-200/80 dark:border-neutral-800/80",
  body:
    "flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 sm:px-4 sm:py-3 " +
    "pb-[max(0.5rem,var(--app-safe-bottom))] lg:pb-3",
};
