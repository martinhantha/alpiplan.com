import { readBody } from "h3";
import { setAuthCookies } from "~/server/utils/auth-cookies";
import { authSessionFromAccessToken, issueTokensForUser } from "~/server/utils/auth-service";
import { consumePasswordToken } from "~/server/utils/password-tokens";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string; password?: string }>(event);
  const userId = await consumePasswordToken(body?.token, body?.password);

  const tokens = await issueTokensForUser(userId);
  setAuthCookies(event, tokens);
  const session = await authSessionFromAccessToken(tokens.accessToken);
  if (!session) {
    throw createError({ statusCode: 500, statusMessage: "Sitzung konnte nicht erstellt werden" });
  }
  return session;
});
