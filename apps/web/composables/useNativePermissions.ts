import { Capacitor } from "@capacitor/core";
import type { PermissionState } from "@capacitor/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toValue, type MaybeRefOrGetter } from "vue";
import { AlpiplanDevice, type AlpiplanDevicePermissionStatus } from "@alpiplan/capacitor-call-hints";
import { queueNativePermissionRequest } from "~/utils/native-permission-queue";

const PROMPT_SESSION_KEY = "alpiplan.device.permissionsPrompted";

const emptyStatus: AlpiplanDevicePermissionStatus = {
  microphone: "prompt",
  contacts: "prompt",
};

function normalizeState(state: string | undefined): PermissionState {
  const value = String(state ?? "prompt")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (value === "granted" || value === "limited") return "granted";
  if (value === "denied") return "denied";
  if (value === "prompt-with-rationale") return "prompt-with-rationale";
  return "prompt";
}

function normalizeStatus(
  raw: Partial<AlpiplanDevicePermissionStatus> | null | undefined,
): AlpiplanDevicePermissionStatus {
  return {
    microphone: normalizeState(raw?.microphone),
    contacts: normalizeState(raw?.contacts),
    notifications: raw?.notifications ? normalizeState(raw.notifications) : undefined,
  };
}

function isGranted(state: string | undefined) {
  const value = normalizeState(state);
  return value === "granted";
}

export function permissionLabel(granted: boolean) {
  return granted ? "Erlaubt" : "Nicht erlaubt";
}

export function useNativePermissions(options?: {
  autoPrompt?: boolean;
  needMicrophone?: MaybeRefOrGetter<boolean>;
}) {
  const open = ref(false);
  const requesting = useState("alpiplan.nativePermissions.requesting", () => false);
  const lastError = useState("alpiplan.nativePermissions.error", () => "");
  const status = useState<AlpiplanDevicePermissionStatus>("alpiplan.nativePermissions.status", () => ({
    ...emptyStatus,
  }));
  const isNative = computed(() => Capacitor.isNativePlatform());
  const needMicrophone = computed(() => toValue(options?.needMicrophone) ?? true);

  const microphoneGranted = computed(() => isGranted(status.value.microphone));
  const contactsGranted = computed(() => isGranted(status.value.contacts));
  const allGranted = computed(
    () => contactsGranted.value && (!needMicrophone.value || microphoneGranted.value),
  );
  const anyDenied = computed(
    () =>
      status.value.contacts === "denied" ||
      (needMicrophone.value && status.value.microphone === "denied"),
  );

  async function refreshStatus() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      status.value = normalizeStatus(await AlpiplanDevice.checkPermissions());
    } catch {
      status.value = { ...emptyStatus };
    }
  }

  async function requestNow() {
    if (!Capacitor.isNativePlatform()) return;
    requesting.value = true;
    lastError.value = "";
    try {
      const result = await queueNativePermissionRequest(() =>
        needMicrophone.value
          ? AlpiplanDevice.requestAllPermissions()
          : AlpiplanDevice.requestPermissions({ alias: "contacts" }),
      );
      status.value = normalizeStatus(result);
      await refreshStatus();
      if (allGranted.value) open.value = false;
    } catch (error) {
      lastError.value =
        error instanceof Error ? error.message : "Berechtigung konnte nicht angefragt werden.";
      await refreshStatus();
    } finally {
      requesting.value = false;
    }
  }

  async function openAppSettings() {
    if (!Capacitor.isNativePlatform()) return;
    lastError.value = "";
    try {
      await AlpiplanDevice.openAppSettings();
    } catch (error) {
      lastError.value =
        error instanceof Error ? error.message : "App-Einstellungen konnten nicht geöffnet werden.";
    }
  }

  function onAppVisible() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void refreshStatus();
  }

  onMounted(async () => {
    if (!Capacitor.isNativePlatform()) return;
    await refreshStatus();
    document.addEventListener("visibilitychange", onAppVisible);
    window.addEventListener("focus", onAppVisible);
    if (!options?.autoPrompt) return;
    if (allGranted.value) return;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(PROMPT_SESSION_KEY) === "1") {
      return;
    }
    sessionStorage.setItem(PROMPT_SESSION_KEY, "1");
    open.value = true;
    await nextTick();
    await requestNow();
  });

  onBeforeUnmount(() => {
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onAppVisible);
    window.removeEventListener("focus", onAppVisible);
  });

  return {
    open,
    requesting,
    lastError,
    status,
    isNative,
    microphoneGranted,
    contactsGranted,
    allGranted,
    anyDenied,
    refreshStatus,
    requestNow,
    openAppSettings,
  };
}
