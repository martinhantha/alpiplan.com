import type { AppointmentLiveEvent, AppointmentLiveEventType } from "~/types/live-events";
import { prisma } from "~/server/utils/prisma";
import { sendAppointmentPush } from "~/server/utils/push";
import {
  assignedTeachersFromAppointment,
  shouldNotifyAppointmentLive,
  shouldReceiveAppointmentLive,
} from "~/utils/appointment-live-audience";

export { shouldNotifyAppointmentLive, shouldReceiveAppointmentLive, assignedTeachersFromAppointment };

type Listener = (event: AppointmentLiveEvent) => void;

const globalForLive = globalThis as typeof globalThis & {
  alpiplanAppointmentListeners?: Map<string, Set<Listener>>;
};

const listeners =
  globalForLive.alpiplanAppointmentListeners ?? new Map<string, Set<Listener>>();
globalForLive.alpiplanAppointmentListeners = listeners;

export function appointmentEventTitle(appointment: {
  customer?: { displayName?: string | null } | null;
  appointmentContactText?: string | null;
  lessonType?: { name?: string | null } | null;
}): string {
  return (
    appointment.customer?.displayName ||
    appointment.appointmentContactText ||
    appointment.lessonType?.name ||
    "Termin"
  );
}

export async function toAppointmentLiveEvent(
  type: AppointmentLiveEventType,
  tenantId: string,
  actorUserId: string,
  appointment: {
    id: string;
    startsAt: string;
    createdByUserId?: string | null;
    appointmentContactText?: string | null;
    teacherId?: string | null;
    teacher?: { id: string; displayName: string } | null;
    teachers?: Array<{
      id?: string;
      teacherId?: string;
      displayName?: string;
      teacher?: { id: string; displayName: string } | null;
    }> | null;
    customer?: { displayName?: string | null } | null;
    lessonType?: { name?: string | null } | null;
  },
  extra?: {
    previousStartsAt?: string | null;
    previousTeachers?: Array<{ id: string; displayName: string }>;
  },
): Promise<AppointmentLiveEvent> {
  const assigned = assignedTeachersFromAppointment(appointment);
  const previousTeachers = extra?.previousTeachers ?? null;
  const teacherIds = [...new Set([...assigned, ...(previousTeachers ?? [])].map((item) => item.id))];
  const [profiles, actor] = await Promise.all([
    teacherIds.length
      ? prisma.teacherProfile.findMany({
          where: { id: { in: teacherIds }, deletedAt: null },
          select: { id: true, membership: { select: { userId: true } } },
        })
      : [],
    prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true, email: true } }),
  ]);
  const userIdsOf = (teachers: Array<{ id: string }>) => [
    ...new Set(
      teachers
        .map((teacher) => profiles.find((profile) => profile.id === teacher.id)?.membership?.userId)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const teacherUserIds = userIdsOf(assigned);
  const namesOf = (teachers: Array<{ displayName: string }>) =>
    teachers.map((item) => item.displayName).filter(Boolean).join(", ") || null;

  return {
    type,
    tenantId,
    appointmentId: appointment.id,
    actorUserId,
    actorName: actor?.name?.trim() || actor?.email || null,
    createdByUserId: appointment.createdByUserId ?? null,
    teacherUserId: teacherUserIds[0] ?? null,
    teacherUserIds,
    previousTeacherUserIds: previousTeachers ? userIdsOf(previousTeachers) : [],
    title: appointmentEventTitle(appointment),
    startsAt: appointment.startsAt,
    previousStartsAt: extra?.previousStartsAt ?? null,
    teacherName: namesOf(assigned),
    previousTeacherName: previousTeachers ? namesOf(previousTeachers) : namesOf(assigned),
    teacherId: assigned[0]?.id ?? null,
  };
}

export function publishAppointmentLive(event: AppointmentLiveEvent) {
  const tenantListeners = listeners.get(event.tenantId);
  if (tenantListeners?.size) {
    for (const listener of tenantListeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not block the others.
      }
    }
  }
  void sendAppointmentPush(event);
}

export function publishAppointmentCreated(event: AppointmentLiveEvent) {
  publishAppointmentLive(event);
}

export function subscribeAppointmentEvents(tenantId: string, listener: Listener): () => void {
  let tenantListeners = listeners.get(tenantId);
  if (!tenantListeners) {
    tenantListeners = new Set();
    listeners.set(tenantId, tenantListeners);
  }
  tenantListeners.add(listener);
  return () => {
    tenantListeners.delete(listener);
    if (!tenantListeners.size) {
      listeners.delete(tenantId);
    }
  };
}
