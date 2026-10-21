export const UI_SCALES = ["small", "medium", "large"] as const;
export type UiScale = (typeof UI_SCALES)[number];

export const DEFAULT_UI_SCALE: UiScale = "small";

export function normalizeUiScale(value: unknown): UiScale {
  if (value === "medium" || value === "large") return value;
  return "small";
}

export function applyUiScaleDocument(scale: UiScale) {
  if (!import.meta.client) return;
  document.documentElement.dataset.uiScale = scale;
}
