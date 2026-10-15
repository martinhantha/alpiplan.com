import type { AppointmentLiveEvent } from "../types/live-events";

export type LiveAppointmentTeacher = {
  id?: string | null;
  teacherId?: string | null;
  displayName?: string | null;
  teacher?: { id?: string | null; displayName?: string | null } | null;
};

export function assignedTeachersFromAppointment(appointment: {
  teacherId?: string | null;
  teacher?: { id?: string | null; displayName?: string | null } | null;
  teachers?: LiveAppointmentTeacher[] | null;
}): Array<{ id: string; displayName: string }> {
  const collected: Array<{ id: string; displayName: string }> = [];

  const push = (id?: string | null, displayName?: string | null) => {
    if (!id || collected.some((item) => item.id === id)) return;
    collected.push({ id, displayName: displayName?.trim() || "" });
  };

  for (const item of appointment.teachers ?? []) {
    if (!item) continue;
    push(item.teacher?.id ?? item.teacherId ?? item.id, item.teacher?.displayName ?? item.displayName);
  }
  push(appointment.teacher?.id, appointment.teacher?.displayName);
  push(appointment.teacherId);

  return collected;
}

type AudienceEvent = Pick<
  AppointmentLiveEvent,
  "type" | "actorUserId" | "createdByUserId" | "teacherUserId" | "teacherUserIds" | "previousTeacherUserIds"
>;

export interface LiveViewer {
  userId: string;
  isAdmin: boolean;
  /** Admin preference: alert when someone else moves an appointment. */
  movedAlertsEnabled: boolean;
}

function isAssignedTeacher(viewerUserId: string, event: AudienceEvent) {
  return Boolean(
    (event.teacherUserIds ?? []).includes(viewerUserId) ||
      (event.teacherUserId && event.teacherUserId === viewerUserId),
  );
}

/** Whether the viewer's open views must refresh for this event (no alert implied). */
export function shouldReceiveAppointmentLive(viewer: LiveViewer, event: AudienceEvent): boolean {
  if (viewer.isAdmin || event.actorUserId === viewer.userId) return true;
  if (isAssignedTeacher(viewer.userId, event)) return true;
  if ((event.previousTeacherUserIds ?? []).includes(viewer.userId)) return true;
  return Boolean(event.createdByUserId && event.createdByUserId === viewer.userId);
}

/** Whether the viewer gets an in-app / OS alert for this event. */
export function shouldNotifyAppointmentLive(viewer: LiveViewer, event: AudienceEvent): boolean {
  if (event.actorUserId === viewer.userId) return false;
  if (event.type === "appointment.updated") return false;

  const assigned = isAssignedTeacher(viewer.userId, event);
  const isCreator = Boolean(event.createdByUserId && event.createdByUserId === viewer.userId);

  if (event.type === "appointment.created") {
    return assigned;
  }
  if (event.type === "appointment.moved" && viewer.isAdmin && viewer.movedAlertsEnabled) {
    return true;
  }
  return assigned || isCreator;
}

export function pushRecipientUserIds(event: AudienceEvent): string[] {
  if (event.type === "appointment.updated") return [];
  const ids = new Set<string>();
  for (const id of event.teacherUserIds ?? []) ids.add(id);
  if (event.teacherUserId) ids.add(event.teacherUserId);
  if (event.type !== "appointment.created" && event.createdByUserId) {
    ids.add(event.createdByUserId);
  }
  ids.delete(event.actorUserId);
  return [...ids];
}

export function liveEventNotificationCopy(
  event: Pick<
    AppointmentLiveEvent,
    "type" | "title" | "startsAt" | "previousStartsAt" | "actorName" | "teacherName" | "previousTeacherName"
  >,
): {
  title: string;
  body: string;
} {
  const format = (value: string) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  const when = format(event.startsAt);

  if (event.type === "appointment.moved") {
    const previous =
      event.previousStartsAt && event.previousStartsAt !== event.startsAt ? format(event.previousStartsAt) : "";
    const teacherChanged = (event.previousTeacherName ?? null) !== (event.teacherName ?? null);
    const teacherChange = teacherChanged
      ? `${event.previousTeacherName || "niemand"} → ${event.teacherName || "niemand"}`
      : "";
    return {
      title: "Termin verschoben",
      body: [
        event.title,
        previous ? `${previous} → ${when}` : when,
        teacherChange,
        event.actorName ? `von ${event.actorName}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (event.type === "appointment.updated") {
    return {
      title: "Termin geändert",
      body: [event.title, when].filter(Boolean).join(" · "),
    };
  }
  if (event.type === "appointment.deleted") {
    return {
      title: "Termin gelöscht",
      body: [event.title, when].filter(Boolean).join(" · "),
    };
  }
  return {
    title: "Neuer Termin",
    body: [event.title, when].filter(Boolean).join(" · "),
  };
}
