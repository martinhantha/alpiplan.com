import { getRouterParam, readBody } from "h3";
import { throwValidation } from "~/server/utils/api-errors";
import { requireTenantAccess } from "~/server/utils/authz";
import { deleteAppointmentRange, parseDateRange } from "~/server/utils/appointment-data";

export default defineEventHandler(async (event) => {
  const access = await requireTenantAccess(event, getRouterParam(event, "tenantId"), ["ADMIN"]);
  const body = await readBody<{ from?: string; to?: string; mode?: string; expectedCount?: number }>(event);
  const mode = body?.mode;
  if (mode !== "soft" && mode !== "permanent") {
    throwValidation("mode muss „soft“ oder „permanent“ sein", { field: "mode" });
  }
  return deleteAppointmentRange(access.tenant.id, parseDateRange(body?.from, body?.to), {
    mode,
    expectedCount: body?.expectedCount,
    actorUserId: access.actorUserId,
  });
});
