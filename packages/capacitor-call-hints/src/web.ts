import { WebPlugin } from "@capacitor/core";
import type { CallHint } from "@alpiplan/device-capabilities";
import type {
  AlpiplanDevicePermissionStatus,
  AlpiplanDevicePlugin,
  CallHintsPlugin,
  CallHintsPermissionStatus,
} from "./definitions";

export class CallHintsWeb extends WebPlugin implements CallHintsPlugin {
  async getRecentCallHints(_options?: { limit?: number }): Promise<{ hints: CallHint[] }> {
    return { hints: [] };
  }

  async checkPermissions(): Promise<CallHintsPermissionStatus> {
    return { callerId: "denied" };
  }

  async requestPermissions(): Promise<CallHintsPermissionStatus> {
    return { callerId: "denied" };
  }

  async openCallerIdSettings(): Promise<void> {
    // Browser: nothing to open.
  }
}

export class AlpiplanDeviceWeb extends WebPlugin implements AlpiplanDevicePlugin {
  async checkPermissions(): Promise<AlpiplanDevicePermissionStatus> {
    return {
      microphone: await this.microphoneState(),
      contacts: "prompt",
    };
  }

  async requestPermissions(): Promise<AlpiplanDevicePermissionStatus> {
    return this.requestAllPermissions();
  }

  async requestMicrophone(): Promise<AlpiplanDevicePermissionStatus> {
    await this.promptMicrophone();
    return this.checkPermissions();
  }

  async requestAllPermissions(): Promise<AlpiplanDevicePermissionStatus> {
    await this.promptMicrophone();
    return this.checkPermissions();
  }

  private async microphoneState(): Promise<AlpiplanDevicePermissionStatus["microphone"]> {
    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (result.state === "granted") return "granted";
      if (result.state === "denied") return "denied";
    } catch {
      // Permissions API not available in this WebView.
    }
    return "prompt";
  }

  private async promptMicrophone(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // Denied or unsupported — checkPermissions reports the outcome.
    }
  }

  async openAppSettings(): Promise<void> {
    // Browser: nothing to open.
  }

  async openWhatsApp(): Promise<void> {
    throw this.unimplemented("openWhatsApp is native-only.");
  }

  async saveLocalContact(): Promise<{ contactId: string }> {
    throw this.unimplemented("saveLocalContact is native-only.");
  }

  async findContactByPhone(): Promise<{ found: boolean }> {
    return { found: false };
  }

  async deleteContactByPhone(): Promise<{ deleted: number }> {
    throw this.unimplemented("deleteContactByPhone is native-only.");
  }

  async showLocalNotification(): Promise<void> {
    // Browser notifications are handled by the Notification API.
  }

  async getPushToken(): Promise<{ token?: string | null }> {
    return { token: null };
  }

  async startSpeechRecognition(): Promise<void> {
    throw this.unimplemented("startSpeechRecognition is native-only.");
  }

  async stopSpeechRecognition(): Promise<void> {
    // Browser speech uses the Web Speech API.
  }
}
