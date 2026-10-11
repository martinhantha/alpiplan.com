import { getQuery, getRouterParam } from "h3";
import { requireTenantAccess, staffAppointmentScope } from "~/server/utils/authz";
import { listAppointments, MAX_APPOINTMENT_PAGE_SIZE } from "~/server/utils/scheduling";

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function emptyList(query: ReturnType<typeof getQuery>) {
  const pageRaw = Number(queryString(query.page) ?? 1);
  const pageSizeRaw = Number(queryString(query.pageSize) ?? 25);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 && pageSizeRaw <= MAX_APPOINTMENT_PAGE_SIZE
      ? Math.floor(pageSizeRaw)
      : 25;
  return {
    data: [],
    pagination: { page, pageSize, total: 0, totalPages: 1 },
  };
}

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"));
  const query = getQuery(event);
  const scope = await staffAppointmentScope(access);

  if (scope.empty) {
    return emptyList(query);
  }

  return listAppointments(access.tenant.id, {
    from: queryString(query.from),
    to: queryString(query.to),
    teacherId: scope.forceTeacherId ?? queryString(query.teacherId),
    lessonTypeId: queryString(query.lessonTypeId),
    status: queryString(query.status),
    q: queryString(query.q),
    page: queryString(query.page),
    pageSize: queryString(query.pageSize),
    sort: queryString(query.sort),
  });
});
