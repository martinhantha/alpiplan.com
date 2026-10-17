import type { AuthSession } from "~/types/auth";
import { unregisterNativePushToken } from "~/utils/push-registration";
import { disableWebPush } from "~/utils/web-push-registration";

export function useAuth() {
  const session = useState<AuthSession | null>("auth:session", () => null);

  const user = computed(() => session.value?.user ?? null);
  const memberships = computed(() => session.value?.memberships ?? []);
  const selectedTenantId = useCookie<string | null>("alpiplan_tenant", {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const primaryTenant = computed(
    () =>
      memberships.value.find((m) => m.tenantId === selectedTenantId.value) ??
      memberships.value[0] ??
      null,
  );
  const teacherLabel = computed(() => primaryTenant.value?.teacherLabel?.trim() || "Lehrer");
  const resourcesEnabled = computed(() => primaryTenant.value?.resourcesEnabled ?? true);
  const speechRecognitionEnabled = computed(
    () => primaryTenant.value?.speechRecognitionEnabled ?? false,
  );
  const nextDayBriefingEnabled = computed(() => user.value?.nextDayBriefingEnabled !== false);
  const canManageTenant = computed(
    () => Boolean(user.value?.isSuperadmin || primaryTenant.value?.role === "ADMIN"),
  );
  const canPlanAllAppointments = computed(
    () => canManageTenant.value || (primaryTenant.value?.role === "STAFF" && primaryTenant.value.performsAppointments === false),
  );
  const canAccessWorkspace = computed(() => {
    if (user.value?.isSuperadmin) return true;
    const role = primaryTenant.value?.role;
    return role === "ADMIN" || role === "STAFF";
  });

  async function refreshSession() {
    try {
      const headers: Record<string, string> = {};
      if (import.meta.server) {
        const cookie = useRequestHeaders(["cookie"]).cookie;
        if (cookie) headers.cookie = cookie;
      }
      session.value = await $fetch<AuthSession>("/api/auth/me", {
        headers: Object.keys(headers).length ? headers : undefined,
        credentials: "include",
      });
    } catch {
      session.value = null;
    }
    return session.value;
  }

  async function login(email: string, password: string) {
    session.value = await $fetch<AuthSession>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      credentials: "include",
    });
    return session.value;
  }

  async function selectTenant(tenantId: string) {
    if (tenantId === primaryTenant.value?.tenantId) return;
    if (!memberships.value.some((m) => m.tenantId === tenantId)) return;
    selectedTenantId.value = tenantId;
    await nextTick();
    reloadNuxtApp({ force: true });
  }

  async function logout() {
    await unregisterNativePushToken();
    await disableWebPush({ unsubscribe: false });
    await $fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    session.value = null;
    await navigateTo("/login");
  }

  return {
    session,
    user,
    memberships,
    primaryTenant,
    selectTenant,
    teacherLabel,
    resourcesEnabled,
    speechRecognitionEnabled,
    nextDayBriefingEnabled,
    canManageTenant,
    canPlanAllAppointments,
    canAccessWorkspace,
    login,
    logout,
    refreshSession,
  };
}
