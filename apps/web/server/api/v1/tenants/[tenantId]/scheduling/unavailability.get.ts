import { getQuery, getRouterParam } from "h3";
import { assertUuid, requireTenantAccess, staffAppointmentScope } from "~/server/utils/authz";
import { listTeacherUnavailability } from "~/server/utils/scheduling";

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"));
  const query = getQuery(event);
  const scope = await staffAppointmentScope(access);
  if (scope.empty) return { data: [], range: null };
  const requestedTeacherId = queryString(query.teacherId);
  return listTeacherUnavailability(access.tenant.id, {
    from: queryString(query.from),
    to: queryString(query.to),
    teacherId: scope.forceTeacherId ?? (requestedTeacherId ? assertUuid(requestedTeacherId, "teacherId") : null),
  });
});
