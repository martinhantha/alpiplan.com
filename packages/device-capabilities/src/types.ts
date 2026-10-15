/** Normalized phone suggestion (no raw call logs on server). */
export interface CallHint {
  e164?: string;
  raw?: string;
  lastSeenAt: string;
  confidence: number;
  /** Android: the call is ringing or still running right now. */
  active?: boolean;
}

export interface ContactWritePayload {
  displayName: string;
  phoneE164?: string;
  note?: string;
  /** Shown as company / organisation on the device contact. */
  organization?: string;
}

export interface PickedContact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface SpeechRecognitionResult {
  transcript: string;
  locale?: string;
}

export type DevicePlatform = "web" | "android" | "ios";

export interface DeviceFeatureFlags {
  pickContact: boolean;
  saveContact: boolean;
  /** Native only: look up whether a number already exists in the device address book. */
  lookupContact: boolean;
  /** Native only: delete a device contact matched by phone number. */
  deleteContact: boolean;
  /** True when the Android CallHints plugin is present (opt-in still required). */
  callHints: boolean;
}

export interface DeviceContactMatch {
  contactId: string;
  displayName?: string;
  googleSynced?: boolean;
}

export type DeviceContactLookupStatus = "unknown" | "missing" | "saved";

export interface DeviceContactLookupResult {
  status: DeviceContactLookupStatus;
  match?: DeviceContactMatch;
}

/**
 * Platform-neutral capability surface; Capacitor/native implementations live in app layer.
 */
export interface DeviceCapabilities {
  readonly id: string;
  readonly platform: DevicePlatform;
  readonly features: DeviceFeatureFlags;

  startSpeechToText(): Promise<SpeechRecognitionResult>;
  requestMicrophonePermission(): Promise<boolean>;
  takePhoto(): Promise<Blob | null>;
  requestPushPermission(): Promise<NotificationPermission | "unsupported">;
  pickContact(): Promise<PickedContact | null>;
  /** Optional Android: recent call hints; iOS/web typically empty. */
  getRecentCallHints(limit?: number): Promise<CallHint[]>;
  /** Save or update device contact — must be user-triggered. Browser: vCard download. */
  saveOrUpdateDeviceContact(payload: ContactWritePayload): Promise<void>;
  /** Address-book lookup by phone (includes Google-synced contacts on the device). */
  lookupDeviceContact(phone: string): Promise<DeviceContactLookupResult>;
  /** Delete matching device contacts by phone — must be user-triggered. */
  deleteDeviceContact(phone: string): Promise<void>;
}
