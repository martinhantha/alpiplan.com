import { webPushPublicKey } from "~/server/utils/web-push";

export default defineEventHandler(() => {
  return { publicKey: webPushPublicKey() };
});
