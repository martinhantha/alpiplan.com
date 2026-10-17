import type { AuthSession } from "~/types/auth";

export default defineNuxtRouteMiddleware(async (to) => {
  const session = useState<AuthSession | null>("auth:session", () => null);

  const fetchMe = async () => {
    const headers: Record<string, string> = {};
    if (import.meta.server) {
      const cookie = useRequestHeaders(["cookie"]).cookie;
      if (cookie) headers.cookie = cookie;
    }
    return await $fetch<AuthSession>("/api/auth/me", {
      headers: Object.keys(headers).length ? headers : undefined,
      credentials: "include",
    });
  };

  if (to.meta.public) {
    if (to.path === "/login") {
      try {
        const s = session.value ?? (await fetchMe());
        session.value = s;
        return navigateTo("/");
      } catch {
        session.value = null;
      }
    }
    return;
  }

  try {
    if (!session.value) {
      session.value = await fetchMe();
    }
  } catch {
    session.value = null;
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }

  const tenantAdminOnly = new Set(["/users", "/lesson-types", "/conflicts", "/trash", "/appointment-data"]);
  if (tenantAdminOnly.has(to.path)) {
    const { canManageTenant } = useAuth();
    if (!canManageTenant.value) {
      return navigateTo("/");
    }
  }
});
