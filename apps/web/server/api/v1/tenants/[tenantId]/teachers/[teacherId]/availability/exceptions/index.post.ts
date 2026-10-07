import { getRouterParam, readBody, setResponseStatus } from "h3";
import { requireTeacherSelfOrAdmin } from "~/server/utils/authz";
import { createAvailabilityException } from "~/server/utils/scheduling";

export default defineEventHandler(async (event) => {
  const access = await requireTeacherSelfOrAdmin(event, getRouterParam(event, "tenantId"), getRouterParam(event, "teacherId"));
  const body = await readBody(event);
  const exception = await createAvailabilityException(
    access.tenant.id,
    getRouterParam(event, "teacherId"),
    body,
  );

  setResponseStatus(event, 201);
  return exception;
});
