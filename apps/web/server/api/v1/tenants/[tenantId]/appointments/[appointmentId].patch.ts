import { getRequestHeader, getRouterParam, readBody } from "h3";
import { throwNotFound } from "~/server/utils/api-errors";
import { requireTenantAccess, staffAppointmentScope, staffOwnsAppointment } from "~/server/utils/authz";
import {
  assignedTeachersFromAppointment,
  publishAppointmentLive,
  toAppointmentLiveEvent,
} from "~/server/utils/appointment-events";
import { getAppointment, patchAppointment } from "~/server/utils/scheduling";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"));
  const scope = await staffAppointmentScope(access);
  if (scope.empty) {
    throwNotFound("Termin nicht gefunden");
  }

  const appointmentId = getRouterParam(event, "appointmentId");
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  const existing = await getAppointment(access.tenant.id, appointmentId);

  if (!staffOwnsAppointment(scope.forceTeacherId, existing)) {
    throwNotFound("Termin nicht gefunden", { appointmentId: existing.id });
  }
  if (scope.forceTeacherId) {
    delete body.teacherId;
    delete body.teacherIds;
  }

  const updated = await patchAppointment(
    access.tenant.id,
    appointmentId,
    body,
    getRequestHeader(event, "if-match"),
  );

  const previousTeachers = assignedTeachersFromAppointment(existing);
  const teacherKey = (teachers: { id: string }[]) => teachers.map((teacher) => teacher.id).sort().join(",");
  const moved =
    existing.startsAt !== updated.startsAt ||
    existing.endsAt !== updated.endsAt ||
    teacherKey(previousTeachers) !== teacherKey(assignedTeachersFromAppointment(updated));
  publishAppointmentLive(
    await toAppointmentLiveEvent(
      moved ? "appointment.moved" : "appointment.updated",
      access.tenant.id,
      access.actorUserId,
      updated,
      { previousStartsAt: existing.startsAt, previousTeachers },
    ),
  );

  return updated;
});
