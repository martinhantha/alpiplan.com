import { restoreCookieSession } from "~/server/utils/auth-cookies";
import { withSuperadminTenants } from "~/server/utils/session";

export default defineEventHandler(async (event) => {
  const session = await restoreCookieSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: "Nicht angemeldet" });
  }
  return withSuperadminTenants(session);
});
