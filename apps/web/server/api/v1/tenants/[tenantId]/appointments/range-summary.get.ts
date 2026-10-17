import { getQuery, getRouterParam } from "h3";
import { requireTenantAccess } from "~/server/utils/authz";
import { parseDateRange, summarizeAppointmentRange } from "~/server/utils/appointment-data";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const query = getQuery(event);
  return summarizeAppointmentRange(access.tenant.id, parseDateRange(query.from, query.to));
});
