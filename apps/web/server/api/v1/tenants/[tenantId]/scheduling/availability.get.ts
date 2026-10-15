import { getQuery, getRouterParam } from "h3";
import { requireTenantAccess, staffAppointmentScope } from "~/server/utils/authz";
import { getTeacherAvailability } from "~/server/utils/scheduling";

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"));
  const query = getQuery(event);
  const scope = await staffAppointmentScope(access);
  const result = await getTeacherAvailability(access.tenant.id, {
    startsAt: queryString(query.startsAt),
    endsAt: queryString(query.endsAt),
    excludeAppointmentId: queryString(query.excludeAppointmentId),
    teacherId: scope.forceTeacherId ?? queryString(query.teacherId),
    resourceId: queryString(query.resourceId),
    lessonTypeId: queryString(query.lessonTypeId),
  });
  if (scope.forceTeacherId) {
    result.data = result.data.filter((item) => item.teacherId === scope.forceTeacherId);
    result.freeSlots = result.freeSlots.filter((slot) => slot.teacherId === scope.forceTeacherId);
    result.firstFreeSlot = result.freeSlots[0] ?? null;
  }
  return result;
});
