import { Capacitor } from "@capacitor/core";
import { AlpiplanDevice } from "@alpiplan/capacitor-call-hints";
import {
  APPOINTMENT_LIVE_EVENT,
  type AppointmentLiveEvent,
  type AppointmentLiveEventType,
} from "~/types/live-events";
import { liveEventNotificationCopy } from "~/utils/appointment-live-audience";
import { registerNativePushToken } from "~/utils/push-registration";

let askedPushPermission = false;

const LIVE_TYPES = new Set<AppointmentLiveEventType>([
  "appointment.created",
  "appointment.moved",
  "appointment.deleted",
]);

function isLiveEvent(value: unknown): value is AppointmentLiveEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AppointmentLiveEvent>;
  return (
    typeof event.type === "string" &&
    LIVE_TYPES.has(event.type as AppointmentLiveEventType) &&
    typeof event.appointmentId === "string"
  );
}

function browserCanAskNotifications() {
  return typeof Notification !== "undefined" && Notification.permission === "default";
}

function alertCopy(event: AppointmentLiveEvent): { title: string; body: string } {
  return liveEventNotificationCopy(event);
}

async function notifyOs(event: AppointmentLiveEvent, title: string, body: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await AlpiplanDevice.showLocalNotification({
        title,
        body,
        id: `${event.type}:${event.appointmentId}`,
      });
      return;
    } catch {
      // Fall through to the browser Notification API.
    }
  }

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: `${event.type}:${event.appointmentId}` });
  } catch {
    // Some WebViews reject Notification construction even after permission.
  }
}

export function useAppointmentAlerts() {
  const { user, primaryTenant } = useAuth();
  const { device } = useDeviceCapabilities();
  const alert = ref<AppointmentLiveEvent | null>(null);
  const canAskNotifications = ref(false);

  let source: EventSource | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function dismiss() {
    alert.value = null;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  function disconnect() {
    source?.close();
    source = null;
  }

  async function maybeRequestPush() {
    if (askedPushPermission) return;
    if (!Capacitor.isNativePlatform()) return;
    askedPushPermission = true;
    try {
      await device.value.requestPushPermission();
    } catch {
      askedPushPermission = false;
    }
  }

  async function enableNotifications() {
    try {
      await device.value.requestPushPermission();
    } catch {
      // Keep the in-app popup even if the system prompt is dismissed.
    }
    canAskNotifications.value = browserCanAskNotifications();
  }

  function show(event: AppointmentLiveEvent) {
    window.dispatchEvent(new CustomEvent(APPOINTMENT_LIVE_EVENT, { detail: event }));

    if (event.actorUserId === user.value?.id) return;

    alert.value = event;
    canAskNotifications.value = browserCanAskNotifications();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (alert.value?.appointmentId === event.appointmentId && alert.value?.type === event.type) {
        alert.value = null;
      }
    }, 12_000);

    const copy = alertCopy(event);
    void notifyOs(event, copy.title, copy.body);
  }

  function connect() {
    disconnect();
    const tenantId = primaryTenant.value?.tenantId;
    if (!import.meta.client || !user.value || !tenantId) return;

    const sourceUrl = `/api/v1/tenants/${tenantId}/events`;
    source = new EventSource(sourceUrl, { withCredentials: true });
    source.onmessage = (message) => {
      try {
        const payload: unknown = JSON.parse(message.data);
        if (isLiveEvent(payload)) show(payload);
      } catch {
        // Ignore keep-alives and malformed frames.
      }
    };
    window.setTimeout(() => {
      void maybeRequestPush();
      void registerNativePushToken();
    }, 2500);
  }

  watch(
    [user, () => primaryTenant.value?.tenantId],
    () => {
      connect();
    },
    { immediate: true },
  );

  onUnmounted(() => {
    disconnect();
    dismiss();
  });

  return { alert, dismiss, canAskNotifications, enableNotifications };
}

export function useAppointmentListSync(reload: () => void | Promise<void>) {
  function onLive() {
    void reload();
  }

  onMounted(() => {
    window.addEventListener(APPOINTMENT_LIVE_EVENT, onLive);
  });

  onUnmounted(() => {
    window.removeEventListener(APPOINTMENT_LIVE_EVENT, onLive);
  });
}
