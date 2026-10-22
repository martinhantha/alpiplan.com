import { Capacitor } from "@capacitor/core";
import type { PermissionState } from "@capacitor/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toValue, type MaybeRefOrGetter } from "vue";
import {
  AlpiplanDevice,
  CallHints,
  type AlpiplanDevicePermissionStatus,
  type CallHintsPermissionStatus,
} from "@alpiplan/capacitor-call-hints";
import { isCallHintsPluginAvailable, persistCallHintsOptIn } from "@alpiplan/device-capabilities";
import { queueNativePermissionRequest } from "~/utils/native-permission-queue";

let autoPrompted = false;

type NativePermissionStatus = AlpiplanDevicePermissionStatus & {
  callerId?: PermissionState;
};

const emptyStatus: NativePermissionStatus = {
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
  callHints?: Partial<CallHintsPermissionStatus> | null,
): NativePermissionStatus {
  return {
    microphone: normalizeState(raw?.microphone),
    contacts: normalizeState(raw?.contacts),
    notifications: raw?.notifications ? normalizeState(raw.notifications) : undefined,
    callerId: callHints?.callerId ? normalizeState(callHints.callerId) : undefined,
  };
}

function isGranted(state: string | undefined) {
  const value = normalizeState(state);
  return value === "granted";
}

/** Not yet answered; "denied" means the OS no longer shows a dialog. */
function isAskable(state: PermissionState | undefined) {
  return state === "prompt" || state === "prompt-with-rationale";
}

function supportsCallHints() {
  return Capacitor.getPlatform() === "android" && isCallHintsPluginAvailable();
}

async function readCallHintsStatus(): Promise<CallHintsPermissionStatus | null> {
  if (!supportsCallHints()) return null;
  try {
    return await CallHints.checkPermissions();
  } catch {
    return null;
  }
}

export function permissionLabel(granted: boolean, translate: (key: string) => string) {
  return granted ? translate("common.allowed") : translate("common.denied");
}

export function useNativePermissions(options?: {
  autoPrompt?: boolean;
  needMicrophone?: MaybeRefOrGetter<boolean>;
}) {
  const { t } = useI18n();
  const open = ref(false);
  const requesting = useState("alpiplan.nativePermissions.requesting", () => false);
  const lastError = useState("alpiplan.nativePermissions.error", () => "");
  const status = useState<NativePermissionStatus>("alpiplan.nativePermissions.status", () => ({
    ...emptyStatus,
  }));
  const { refresh: refreshDevice } = useDeviceCapabilities();
  const isNative = computed(() => Capacitor.isNativePlatform());
  const callHintsSupported = computed(() => isNative.value && supportsCallHints());
  const needMicrophone = computed(() => toValue(options?.needMicrophone) ?? true);

  const microphoneGranted = computed(() => isGranted(status.value.microphone));
  const contactsGranted = computed(() => isGranted(status.value.contacts));
  const callerIdGranted = computed(() => isGranted(status.value.callerId));
  const notificationsSupported = computed(() => isNative.value && status.value.notifications !== undefined);
  const notificationsGranted = computed(() => isGranted(status.value.notifications));
  const deviceAskable = computed(
    () =>
      isAskable(status.value.contacts) || (needMicrophone.value && isAskable(status.value.microphone)),
  );
  const callerIdAskable = computed(() => callHintsSupported.value && isAskable(status.value.callerId));
  const notificationsAskable = computed(() => isAskable(status.value.notifications));
  const anyAskable = computed(
    () => deviceAskable.value || callerIdAskable.value || notificationsAskable.value,
  );
  const allGranted = computed(
    () => contactsGranted.value && (!needMicrophone.value || microphoneGranted.value),
  );
  const anyDenied = computed(
    () =>
      status.value.contacts === "denied" ||
      (needMicrophone.value && status.value.microphone === "denied") ||
      status.value.notifications === "denied",
  );

  async function refreshStatus() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const [device, callHints] = await Promise.all([
        AlpiplanDevice.checkPermissions(),
        readCallHintsStatus(),
      ]);
      status.value = normalizeStatus(device, callHints);
    } catch {
      status.value = { ...emptyStatus };
    }
  }

  async function requestCallHints() {
    if (!callerIdAskable.value) return;
    const result = await queueNativePermissionRequest(() => CallHints.requestPermissions());
    if (isGranted(result.callerId)) {
      persistCallHintsOptIn(true);
      await refreshDevice();
    }
  }

  async function requestNow() {
    if (!Capacitor.isNativePlatform()) return;
    requesting.value = true;
    lastError.value = "";
    try {
      if (deviceAskable.value) {
        await queueNativePermissionRequest(() =>
          needMicrophone.value
            ? AlpiplanDevice.requestAllPermissions()
            : AlpiplanDevice.requestPermissions({ alias: "contacts" }),
        );
      }
      await requestCallHints();
      if (notificationsAskable.value) {
        await queueNativePermissionRequest(() =>
          AlpiplanDevice.requestPermissions({ alias: "notifications" }),
        );
      }
      await refreshStatus();
      if (!anyAskable.value && !anyDenied.value) open.value = false;
    } catch (error) {
      lastError.value =
        error instanceof Error ? error.message : t("permissions.requestFailed");
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
        error instanceof Error ? error.message : t("permissions.settingsOpenFailed");
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
    if (!options?.autoPrompt || autoPrompted || !anyAskable.value) return;
    autoPrompted = true;
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
    callHintsSupported,
    callerIdGranted,
    notificationsSupported,
    notificationsGranted,
    anyAskable,
    allGranted,
    anyDenied,
    refreshStatus,
    requestNow,
    openAppSettings,
  };
}
