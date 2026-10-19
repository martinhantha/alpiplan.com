import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  AppUpdate,
  AppUpdateAvailability,
  AppUpdateResultCode,
} from "@capawesome/capacitor-app-update";

type NativePlatform = "android" | "ios";

interface AppVersionResponse {
  android: { minVersionCode: number };
  ios: { minVersionCode: number; appStoreId: string; country: string };
}

export interface NativeUpdateState {
  required: boolean;
  /** Identifiziert die angebotene Version, damit „Später“ nur für diese gilt. */
  versionKey: string;
}

const ANDROID_PACKAGE = "at.alpiplan.app";
const DISMISS_STORAGE_KEY = "alpiplan.appUpdate.dismissed";
const DISMISS_MS = 24 * 60 * 60 * 1000;

function nativePlatform(): NativePlatform | null {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios" ? platform : null;
}

/** Shells vor Einführung von @capacitor/app liefern 0 → gelten als veraltet. */
async function currentVersionCode() {
  if (!Capacitor.isPluginAvailable("App")) return 0;
  try {
    const { build } = await App.getInfo();
    return Number.parseInt(build, 10) || 0;
  } catch {
    return 0;
  }
}

async function storeHasNewerVersion(country: string) {
  if (!Capacitor.isPluginAvailable("AppUpdate")) return null;
  try {
    const info = await AppUpdate.getAppUpdateInfo(country ? { country } : undefined);
    if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return null;
    return info.availableVersionCode || info.availableVersionName || "store";
  } catch {
    return null;
  }
}

function isDismissed(versionKey: string) {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const { key, at } = JSON.parse(raw) as { key: string; at: number };
    return key === versionKey && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function storeFallbackUrl(platform: NativePlatform, appStoreId: string) {
  if (platform === "android") return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  return appStoreId
    ? `https://apps.apple.com/app/id${appStoreId}`
    : "itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=Alpiplan";
}

export function useAppUpdate() {
  const webUpdateAvailable = useState("app-update:web", () => false);
  const nativeUpdate = useState<NativeUpdateState | null>("app-update:native", () => null);
  const iosStore = useState("app-update:ios-store", () => ({ appStoreId: "", country: "" }));
  const installing = useState("app-update:installing", () => false);

  async function checkNativeUpdate() {
    const platform = nativePlatform();
    if (!platform) return;

    let config: AppVersionResponse;
    try {
      config = await $fetch<AppVersionResponse>("/api/app-version");
    } catch {
      return;
    }
    if (platform === "ios") {
      iosStore.value = { appStoreId: config.ios.appStoreId, country: config.ios.country };
    }

    const { minVersionCode } = config[platform];
    if (minVersionCode > 0 && (await currentVersionCode()) < minVersionCode) {
      nativeUpdate.value = { required: true, versionKey: `min-${minVersionCode}` };
      return;
    }

    const versionKey = await storeHasNewerVersion(iosStore.value.country);
    nativeUpdate.value =
      versionKey && !isDismissed(versionKey) ? { required: false, versionKey } : null;
  }

  async function openStore(platform: NativePlatform) {
    const { appStoreId } = iosStore.value;
    if (Capacitor.isPluginAvailable("AppUpdate")) {
      try {
        await AppUpdate.openAppStore(
          platform === "ios" && appStoreId ? { appId: appStoreId } : undefined,
        );
        return;
      } catch {
        // Fallback unten: externe URL öffnet Capacitor im Store bzw. System-Browser.
      }
    }
    window.location.href = storeFallbackUrl(platform, appStoreId);
  }

  async function installNativeUpdate() {
    const platform = nativePlatform();
    if (!platform || installing.value) return;
    installing.value = true;
    try {
      if (platform === "android" && Capacitor.isPluginAvailable("AppUpdate")) {
        try {
          const info = await AppUpdate.getAppUpdateInfo();
          if (
            info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE &&
            info.immediateUpdateAllowed
          ) {
            const { code } = await AppUpdate.performImmediateUpdate();
            if (code === AppUpdateResultCode.OK || code === AppUpdateResultCode.CANCELED) return;
          }
        } catch {
          // z. B. nicht über Google Play installiert → Store-Seite öffnen.
        }
      }
      await openStore(platform);
    } finally {
      installing.value = false;
    }
  }

  function dismissNativeUpdate() {
    const update = nativeUpdate.value;
    if (!update || update.required) return;
    try {
      localStorage.setItem(
        DISMISS_STORAGE_KEY,
        JSON.stringify({ key: update.versionKey, at: Date.now() }),
      );
    } catch {
      // ignore
    }
    nativeUpdate.value = null;
  }

  function reloadWeb() {
    reloadNuxtApp({ force: true });
  }

  return {
    webUpdateAvailable,
    nativeUpdate,
    installing,
    checkNativeUpdate,
    installNativeUpdate,
    dismissNativeUpdate,
    reloadWeb,
  };
}
