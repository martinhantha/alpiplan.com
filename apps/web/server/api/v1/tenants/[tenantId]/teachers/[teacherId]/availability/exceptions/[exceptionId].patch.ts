import { getRouterParam, readBody } from "h3";
import { requireTeacherSelfOrAdmin } from "~/server/utils/authz";
import { patchAvailabilityException } from "~/server/utils/scheduling";

export default defineEventHandler(async (event) => {
  const access = await requireTeacherSelfOrAdmin(event, getRouterParam(event, "tenantId"), getRouterParam(event, "teacherId"));
  const body = await readBody(event);

  return patchAvailabilityException(
    access.tenant.id,
    getRouterParam(event, "teacherId"),
    getRouterParam(event, "exceptionId"),
    body,
  );
});
