import { getRouterParam, readBody } from "h3";
import { requireTenantAccess } from "~/server/utils/authz";
import { importAppointmentsCsv } from "~/server/utils/appointment-data";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const body = await readBody<{ csv?: string; dryRun?: boolean }>(event);
  return importAppointmentsCsv(access.tenant.id, body?.csv, {
    dryRun: body?.dryRun !== false,
    actorUserId: access.actorUserId,
  });
});
