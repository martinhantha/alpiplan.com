import { Capacitor } from "@capacitor/core";
import { APPOINTMENT_LIVE_EVENT } from "~/types/live-events";
import { resolveAppointmentDisplayName, formatAppointmentTeachers, isAssignedTeacher } from "~/utils/appointment-contact";
import { REMINDER_LEAD_MS } from "~/utils/rome-time";

const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 60_000;
const SHOWN_KEY = "alpiplan.reminders.shown";

export interface AppointmentReminder {
  id: string;
  startsAt: string;
  title: string;
  teacherName: string | null;
}

interface AppointmentListItem {
  id: string;
  startsAt: string;
  status: string;
  appointmentContactText: string | null;
  teacher: { id: string; displayName: string } | null;
  teachers?: { id: string; displayName: string }[] | null;
  customer: { displayName: string | null } | null;
}

function loadShownIds(): Set<string> {
  if (!import.meta.client) return new Set();
  try {
    const raw = sessionStorage.getItem(SHOWN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function persistShownIds(ids: Set<string>) {
  if (!import.meta.client) return;
  sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...ids]));
}

function toReminder(item: AppointmentListItem): AppointmentReminder {
  return {
    id: item.id,
    startsAt: item.startsAt,
    title: resolveAppointmentDisplayName(item),
    teacherName: formatAppointmentTeachers(item) || null,
  };
}

async function notifyOs(reminder: AppointmentReminder, body: string) {
  // Native OS banners for due reminders come from FCM so a killed app still gets them.
  if (Capacitor.isNativePlatform()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification("Terminerinnerung", { body, tag: `reminder-${reminder.id}` });
  } catch {
    // Some WebViews reject Notification construction even after permission.
  }
}

export function useAppointmentReminders() {
  const { user, primaryTenant, teacherLabel } = useAuth();
  const reminder = useState<AppointmentReminder | null>("appointment-reminder", () => null);
  const shownIds = useState<Set<string>>("appointment-reminder-shown", () => loadShownIds());

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queue: AppointmentReminder[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const minutesLeft = computed(() => {
    if (!reminder.value) return 15;
    const start = new Date(reminder.value.startsAt).getTime();
    return Math.max(1, Math.round((start - Date.now()) / 60_000));
  });

  function markShown(id: string) {
    shownIds.value.add(id);
    persistShownIds(shownIds.value);
  }

  function clearTimers() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  function present(next: AppointmentReminder) {
    if (shownIds.value.has(next.id)) return;
    if (reminder.value) {
      if (reminder.value.id !== next.id && !queue.some((item) => item.id === next.id)) {
        queue.push(next);
      }
      return;
    }
    markShown(next.id);
    reminder.value = next;
    const when = new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(next.startsAt));
    const body = [next.title, `in ${Math.max(1, Math.round((new Date(next.startsAt).getTime() - Date.now()) / 60_000))} Min · ${when}`]
      .filter(Boolean)
      .join(" · ");
    void notifyOs(next, body);
  }

  function dismiss() {
    reminder.value = null;
    const next = queue.shift();
    if (next) present(next);
  }

  function schedule(items: AppointmentListItem[]) {
    const now = Date.now();
    const due: AppointmentReminder[] = [];
    const upcomingIds = new Set<string>();

    for (const item of items) {
      if (item.status === "cancelled" || item.status === "completed") continue;
      const myTeacherId = primaryTenant.value?.teacherProfileId;
      if (!isAssignedTeacher(item, myTeacherId)) continue;
      const start = new Date(item.startsAt).getTime();
      if (!Number.isFinite(start) || start <= now) continue;
      if (shownIds.value.has(item.id)) continue;
      upcomingIds.add(item.id);
      const fireAt = start - REMINDER_LEAD_MS;
      if (fireAt <= now) {
        due.push(toReminder(item));
        continue;
      }
      const delay = fireAt - now;
      if (delay > LOOKAHEAD_MS || timers.has(item.id)) continue;
      timers.set(
        item.id,
        setTimeout(() => {
          timers.delete(item.id);
          present(toReminder(item));
        }, delay),
      );
    }

    for (const [id, timer] of timers) {
      if (upcomingIds.has(id)) continue;
      clearTimeout(timer);
      timers.delete(id);
    }

    for (const item of due) present(item);
  }

  async function refresh() {
    const tenantId = primaryTenant.value?.tenantId;
    if (!import.meta.client || !user.value || !tenantId || user.value.appointmentReminderEnabled === false) {
      clearTimers();
      reminder.value = null;
      queue.length = 0;
      return;
    }
    const now = Date.now();
    try {
      const response = await $fetch<{ data: AppointmentListItem[] }>(
        `/api/v1/tenants/${tenantId}/appointments`,
        {
          credentials: "include",
          query: {
            from: new Date(now).toISOString(),
            to: new Date(now + LOOKAHEAD_MS).toISOString(),
            status: "draft,confirmed",
            pageSize: 100,
            sort: "asc",
          },
        },
      );
      schedule(response.data);
    } catch {
      // Keep existing timers if the list cannot be refreshed.
    }
  }

  function onCreated() {
    void refresh();
  }

  function onVisible() {
    if (document.visibilityState === "visible") void refresh();
  }

  onMounted(() => {
    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    window.addEventListener(APPOINTMENT_LIVE_EVENT, onCreated);
    document.addEventListener("visibilitychange", onVisible);
  });

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
    clearTimers();
    window.removeEventListener(APPOINTMENT_LIVE_EVENT, onCreated);
    document.removeEventListener("visibilitychange", onVisible);
  });

  watch(
    () => [primaryTenant.value?.tenantId, user.value?.appointmentReminderEnabled],
    () => {
      clearTimers();
      void refresh();
    },
  );

  return { reminder, minutesLeft, teacherLabel, dismiss };
}
