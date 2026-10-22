import { WebDeviceCapabilities, persistCallHintsOptIn, type DeviceCapabilities } from "@alpiplan/device-capabilities";

const fallback = new WebDeviceCapabilities();
const sharedDevice = shallowRef<DeviceCapabilities>(fallback);
const deviceReady = ref(false);

const ssrSafe: DeviceCapabilities = {
  id: "web",
  platform: "web",
  features: { pickContact: false, saveContact: false, lookupContact: false, deleteContact: false, callHints: false },
  startSpeechToText: () => fallback.startSpeechToText(),
  requestMicrophonePermission: () => fallback.requestMicrophonePermission(),
  takePhoto: () => fallback.takePhoto(),
  requestPushPermission: () => fallback.requestPushPermission(),
  pickContact: () => fallback.pickContact(),
  getRecentCallHints: () => fallback.getRecentCallHints(),
  saveOrUpdateDeviceContact: (payload) => fallback.saveOrUpdateDeviceContact(payload),
  lookupDeviceContact: (phone) => fallback.lookupDeviceContact(phone),
  deleteDeviceContact: (phone) => fallback.deleteDeviceContact(phone),
};

export function installRuntimeDevice(device: DeviceCapabilities) {
  sharedDevice.value = device;
  deviceReady.value = true;
}

export function useDeviceCapabilities() {
  const nuxtApp = useNuxtApp();
  const { t } = useI18n();

  onMounted(() => {
    if (deviceReady.value) return;
    sharedDevice.value = (nuxtApp.$device as DeviceCapabilities | undefined) ?? fallback;
    deviceReady.value = true;
  });

  const device = computed(() => (deviceReady.value ? sharedDevice.value : ssrSafe));

  async function refresh() {
    if (!import.meta.client) return;
    const { createRuntimeDeviceCapabilities } = await import("../utils/create-device-capabilities");
    installRuntimeDevice(createRuntimeDeviceCapabilities());
  }

  async function setCallHintsOptIn(enabled: boolean) {
    persistCallHintsOptIn(enabled);
    if (enabled && import.meta.client) {
      const { requestCallHintsPermission } = await import("../utils/capacitor-device-capabilities");
      const granted = await requestCallHintsPermission();
      if (!granted) {
        persistCallHintsOptIn(false);
        await refresh();
        throw new Error(t("permissions.callerIdSetup"));
      }
    }
    await refresh();
  }

  return { device, refresh, setCallHintsOptIn };
}
