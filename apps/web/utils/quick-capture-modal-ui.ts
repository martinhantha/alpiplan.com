/** Shared UModal `ui` for Schnellerfassung — bottom sheet on phone, centered on desktop. */
export const quickCaptureModalUi = {
  overlay: "bg-elevated/75",
  content:
    "max-w-2xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] flex flex-col overflow-hidden " +
    "max-lg:top-auto max-lg:bottom-[var(--app-safe-bottom)] max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:translate-y-0 " +
    "max-lg:max-h-[calc(100dvh-var(--app-mobile-chrome-top)-var(--app-safe-bottom)-0.25rem)] " +
    "max-lg:rounded-t-xl max-lg:rounded-b-lg " +
    "lg:max-h-[min(88dvh,42rem)]",
  header: "px-3 py-2 sm:px-4 sm:py-2.5 shrink-0 border-b border-neutral-200/80 dark:border-neutral-800/80",
  body:
    "flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 sm:px-4 sm:py-3 " +
    "pb-[max(0.5rem,var(--app-safe-bottom))] lg:pb-3",
};
