import { getRouterParam, setResponseStatus } from "h3";
import { requireTeacherSelfOrAdmin } from "~/server/utils/authz";
import { softDeleteAvailabilityException } from "~/server/utils/scheduling";

export default defineEventHandler(async (event) => {
  const access = await requireTeacherSelfOrAdmin(event, getRouterParam(event, "tenantId"), getRouterParam(event, "teacherId"));
  await softDeleteAvailabilityException(
    access.tenant.id,
    getRouterParam(event, "teacherId"),
    getRouterParam(event, "exceptionId"),
    access.actorUserId,
  );

  setResponseStatus(event, 204);
  return null;
});
