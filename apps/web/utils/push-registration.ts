import { Capacitor } from "@capacitor/core";
import { AlpiplanDevice } from "@alpiplan/capacitor-call-hints";

let lastToken: string | null = null;
let registering = false;

export async function registerNativePushToken(): Promise<void> {
  if (!import.meta.client) return;
  if (!Capacitor.isNativePlatform()) return;
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return;
  if (registering) return;
  registering = true;
  try {
    await AlpiplanDevice.requestPermissions({ alias: "notifications" });
    const result = await AlpiplanDevice.getPushToken();
    const token = result.token?.trim();
    if (!token) return;
    lastToken = token;
    await $fetch("/api/auth/push-token", {
      method: "POST",
      credentials: "include",
      body: { token, platform },
    });
  } catch {
    // Permission denied or Firebase not configured on this build.
  } finally {
    registering = false;
  }
}

export async function unregisterNativePushToken(): Promise<void> {
  const token = lastToken;
  lastToken = null;
  if (!token) return;
  try {
    await $fetch("/api/auth/push-token", {
      method: "DELETE",
      credentials: "include",
      body: { token },
    });
  } catch {
    // Session may already be gone.
  }
}
