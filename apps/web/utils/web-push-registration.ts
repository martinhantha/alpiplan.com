import { Capacitor } from "@capacitor/core";

export type WebPushState =
  /** Browser cannot do Web Push at all. */
  | "unsupported"
  /** iPhone/iPad in a Safari tab — push only works after "Add to Home Screen". */
  | "needs-install"
  /** Server has no VAPID keys configured. */
  | "not-configured"
  | "denied"
  | "default"
  | "subscribed";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let publicKeyPromise: Promise<string | null> | null = null;

function isIosDevice() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function browserSupportsWebPush() {
  return (
    import.meta.client &&
    !Capacitor.isNativePlatform() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

function serverPublicKey() {
  publicKeyPromise ??= $fetch<{ publicKey: string | null }>("/api/auth/web-push-key")
    .then((response) => response.publicKey)
    .catch(() => {
      publicKeyPromise = null;
      return null;
    });
  return publicKeyPromise;
}

function serviceWorkerRegistration() {
  if (!browserSupportsWebPush()) return Promise.resolve(null);
  registrationPromise ??= navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => {
      registrationPromise = null;
      return null;
    });
  return registrationPromise;
}

async function saveSubscription(subscription: PushSubscription) {
  await $fetch("/api/auth/push-token", {
    method: "POST",
    credentials: "include",
    body: { token: JSON.stringify(subscription.toJSON()), platform: "web" },
  });
}

export async function webPushState(): Promise<WebPushState> {
  if (!import.meta.client || Capacitor.isNativePlatform()) return "unsupported";
  if (isIosDevice() && !isStandalone()) return "needs-install";
  if (!browserSupportsWebPush()) return "unsupported";
  if (!(await serverPublicKey())) return "not-configured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  const registration = await serviceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "subscribed" : "default";
}

/**
 * Asks for permission and subscribes. Must be called from a tap/click —
 * Safari on iOS ignores permission requests without a user gesture.
 */
export async function enableWebPush(): Promise<WebPushState> {
  if (!browserSupportsWebPush()) return webPushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";
  const [registration, publicKey] = await Promise.all([serviceWorkerRegistration(), serverPublicKey()]);
  if (!registration) return "unsupported";
  if (!publicKey) return "not-configured";
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await saveSubscription(subscription);
  return "subscribed";
}

/** Re-sends an existing subscription after login, without prompting. */
export async function syncWebPushSubscription(): Promise<void> {
  if (!browserSupportsWebPush() || Notification.permission !== "granted") return;
  try {
    if (!(await serverPublicKey())) return;
    const registration = await serviceWorkerRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await saveSubscription(subscription);
  } catch {
    // Offline or session gone — the next login retries.
  }
}

/**
 * Removes this browser's subscription from the server. On logout the browser keeps it
 * (`unsubscribe: false`) so the next login re-registers it without a new prompt.
 */
export async function disableWebPush({ unsubscribe = true }: { unsubscribe?: boolean } = {}): Promise<void> {
  if (!browserSupportsWebPush()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await $fetch("/api/auth/push-token", {
      method: "DELETE",
      credentials: "include",
      body: { token: JSON.stringify(subscription.toJSON()) },
    }).catch(() => undefined);
    if (unsubscribe) await subscription.unsubscribe();
  } catch {
    // Nothing to clean up.
  }
}
