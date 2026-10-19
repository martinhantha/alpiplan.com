const RESUME_CHECK_THROTTLE_MS = 60 * 1000;

export default defineNuxtPlugin((nuxtApp) => {
  const { webUpdateAvailable, checkNativeUpdate } = useAppUpdate();
  const { app } = useRuntimeConfig();
  const latestManifestUrl = `${app.baseURL.replace(/\/+$/, "")}/${app.buildAssetsDir.replace(/^\/+|\/+$/g, "")}/builds/latest.json`;

  // Nuxt lädt nach diesem Hook beim nächsten Seitenwechsel ohnehin neu (chunk-reload).
  nuxtApp.hook("app:manifest:update", () => {
    webUpdateAvailable.value = true;
  });

  /** Nuxt prüft nur im Intervall; nach Rückkehr aus dem Hintergrund sofort prüfen. */
  async function checkWebBuild() {
    if (webUpdateAvailable.value) return;
    try {
      const current = await getAppManifest();
      const latest = await $fetch<{ id: string }>(`${latestManifestUrl}?${Date.now()}`);
      if (latest.id && latest.id !== current.id) {
        await nuxtApp.hooks.callHook("app:manifest:update", latest);
      }
    } catch {
      // Dev-Server ohne Manifest oder offline
    }
  }

  let lastResumeCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastResumeCheck < RESUME_CHECK_THROTTLE_MS) return;
    lastResumeCheck = Date.now();
    void checkWebBuild();
    void checkNativeUpdate();
  });

  onNuxtReady(() => {
    void checkNativeUpdate();
  });
});
