import { Capacitor } from "@capacitor/core";
import { Contacts, PhoneType } from "@capacitor-community/contacts";
import {
  WebDeviceCapabilities,
  isCallHintsPluginAvailable,
  withAlpiplanContactMeta,
  type ContactWritePayload,
  type DeviceCapabilities,
  type DeviceContactLookupResult,
  type DeviceFeatureFlags,
  type DevicePlatform,
  type PickedContact,
} from "@alpiplan/device-capabilities";
import { AlpiplanDevice, CallHints } from "@alpiplan/capacitor-call-hints";

function nativePlatform(): DevicePlatform {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

function permissionGranted(state: string | undefined) {
  const value = String(state ?? "").toLowerCase();
  return value === "granted" || value === "limited";
}

export class CapacitorDeviceCapabilities extends WebDeviceCapabilities implements DeviceCapabilities {
  override readonly id = "capacitor";
  override readonly platform: DevicePlatform = nativePlatform();

  override get features(): DeviceFeatureFlags {
    return {
      pickContact: true,
      saveContact: true,
      lookupContact: true,
      deleteContact: true,
      callHints: this.platform === "android" && isCallHintsPluginAvailable(),
    };
  }

  override async pickContact(): Promise<PickedContact | null> {
    try {
      const result = await Contacts.pickContact({
        projection: { name: true, phones: true, emails: true },
      });
      const name =
        result.contact.name?.display ||
        [result.contact.name?.given, result.contact.name?.family].filter(Boolean).join(" ") ||
        undefined;
      const phone =
        result.contact.phones?.find((item) => item.isPrimary)?.number ||
        result.contact.phones?.[0]?.number ||
        undefined;
      const email = result.contact.emails?.[0]?.address || undefined;
      if (!name && !phone && !email) return null;
      return { name, phone: phone ?? undefined, email };
    } catch {
      return super.pickContact();
    }
  }

  override async getRecentCallHints() {
    return [];
  }

  override async requestPushPermission(): Promise<NotificationPermission | "unsupported"> {
    try {
      const status = await AlpiplanDevice.requestPermissions({ alias: "notifications" });
      // WKWebView has no Web Notification API, so the native answer is final on iOS.
      if (this.platform === "ios") {
        if (status.notifications === "granted") return "granted";
        return status.notifications === "denied" ? "denied" : "default";
      }
    } catch {
      // Continue with the Web Notification prompt if native request fails.
    }
    return super.requestPushPermission();
  }

  override async requestMicrophonePermission(): Promise<boolean> {
    try {
      const status = await AlpiplanDevice.requestMicrophone();
      if (!permissionGranted(status.microphone)) return false;
    } catch {
      return false;
    }
    await super.requestMicrophonePermission();
    return true;
  }

  override async saveOrUpdateDeviceContact(payload: ContactWritePayload): Promise<void> {
    const labeled = withAlpiplanContactMeta(payload);
    try {
      await AlpiplanDevice.saveLocalContact({
        displayName: labeled.displayName.trim() || "Alpiplan Kontakt",
        phone: labeled.phoneE164?.trim() || undefined,
        note: labeled.note,
        organization: labeled.organization,
      });
      return;
    } catch {
      // Fall through to the community plugin / vCard.
    }
    try {
      const permission = await Contacts.requestPermissions();
      if (permission.contacts !== "granted" && permission.contacts !== "limited") {
        await super.saveOrUpdateDeviceContact(labeled);
        return;
      }
      const given = labeled.displayName.trim() || "Alpiplan Kontakt";
      await Contacts.createContact({
        contact: {
          name: { given },
          organization: {
            company: labeled.organization ?? "Alpiplan",
            jobTitle: "Alpiplan-App",
          },
          phones: labeled.phoneE164
            ? [{ type: PhoneType.Mobile, number: labeled.phoneE164, isPrimary: true }]
            : [],
          note: labeled.note?.trim() || null,
        },
      });
    } catch {
      await super.saveOrUpdateDeviceContact(labeled);
    }
  }

  override async lookupDeviceContact(phone: string): Promise<DeviceContactLookupResult> {
    const trimmed = phone.trim();
    if (trimmed.replace(/\D/g, "").length < 6) return { status: "unknown" };
    try {
      const permission = await AlpiplanDevice.checkPermissions();
      if (!permissionGranted(permission.contacts)) {
        return { status: "unknown" };
      }
      const result = await AlpiplanDevice.findContactByPhone({ phone: trimmed });
      if (!result.found || !result.contactId) return { status: "missing" };
      return {
        status: "saved",
        match: {
          contactId: result.contactId,
          displayName: result.displayName,
          googleSynced: result.googleSynced,
        },
      };
    } catch {
      return { status: "unknown" };
    }
  }

  override async deleteDeviceContact(phone: string): Promise<void> {
    const trimmed = phone.trim();
    if (!trimmed) return;
    await AlpiplanDevice.deleteContactByPhone({ phone: trimmed });
  }
}

export async function requestCallHintsPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return false;
  const status = await CallHints.requestPermissions();
  return status.callLog === "granted";
}
