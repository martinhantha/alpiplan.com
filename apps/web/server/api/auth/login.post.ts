import { setAuthCookies } from "~/server/utils/auth-cookies";
import { authSessionFromAccessToken, loginWithEmailPassword } from "~/server/utils/auth-service";
import { withSuperadminTenants } from "~/server/utils/session";

function loginErrorMessage(code: "VALIDATION_ERROR" | "UNAUTHORIZED" | "DISABLED") {
  if (code === "VALIDATION_ERROR") return "E-Mail und Passwort sind erforderlich";
  if (code === "DISABLED") return "Dieses Konto ist gesperrt";
  return "Ungültige Anmeldedaten";
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event);
  const result = await loginWithEmailPassword(body.email ?? "", body.password ?? "");

  if (!result.ok) {
    const message = loginErrorMessage(result.code);
    throw createError({
      statusCode: result.code === "VALIDATION_ERROR" ? 400 : 401,
      statusMessage: message,
      data: { code: result.code, message },
    });
  }

  const { tokens } = result;
  setAuthCookies(event, tokens);

  const session = await authSessionFromAccessToken(tokens.accessToken);
  if (!session) {
    throw createError({ statusCode: 500, statusMessage: "Sitzung konnte nicht erstellt werden" });
  }

  return withSuperadminTenants(session);
});
