import { getRouterParam } from "h3";
import { requireTeacherSelfOrAdmin } from "~/server/utils/authz";
import { listAvailabilityExceptions } from "~/server/utils/scheduling";

export default defineEventHandler(async (event) => {
  const access = await requireTeacherSelfOrAdmin(event, getRouterParam(event, "tenantId"), getRouterParam(event, "teacherId"));
  return listAvailabilityExceptions(access.tenant.id, getRouterParam(event, "teacherId"));
});
