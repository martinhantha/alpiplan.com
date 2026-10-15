import { Capacitor } from "@capacitor/core";
import {
  AndroidCallHintCapabilities,
  WebDeviceCapabilities,
  isCallHintsOptIn,
  type CallHint,
  type DeviceCapabilities,
} from "@alpiplan/device-capabilities";
import { CallHints } from "@alpiplan/capacitor-call-hints";
import { CALL_STATE_EVENT } from "./call-state";
import { CapacitorDeviceCapabilities } from "./capacitor-device-capabilities";

let callStateListening = false;

function listenForCallState() {
  if (callStateListening) return;
  callStateListening = true;
  void CallHints.addListener("callStateChanged", () => {
    window.dispatchEvent(new Event(CALL_STATE_EVENT));
  }).catch(() => {
    callStateListening = false;
  });
}

export function createRuntimeDeviceCapabilities(): DeviceCapabilities {
  if (!Capacitor.isNativePlatform()) {
    return new WebDeviceCapabilities();
  }

  const inner = new CapacitorDeviceCapabilities();
  if (Capacitor.getPlatform() === "android" && isCallHintsOptIn()) {
    listenForCallState();
    return new AndroidCallHintCapabilities(inner, async (limit): Promise<CallHint[]> => {
      const result = await CallHints.getRecentCallHints({ limit });
      return result.hints ?? [];
    });
  }
  return inner;
}
