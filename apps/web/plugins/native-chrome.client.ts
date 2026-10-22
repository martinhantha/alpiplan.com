import { Capacitor } from "@capacitor/core";

/** iOS ignores user-scalable. Cancel the WebKit gesture and two-finger moves instead. */
function blockIosViewportZoom() {
  const blockGesture = (event: Event) => {
    event.preventDefault();
  };
  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, blockGesture, { passive: false, capture: true });
  }
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false, capture: true },
  );
}

export default defineNuxtPlugin(() => {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add("capacitor-native", `capacitor-${Capacitor.getPlatform()}`);
  if (Capacitor.getPlatform() === "ios") blockIosViewportZoom();
});
