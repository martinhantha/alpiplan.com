<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

type TenantRole = "ADMIN" | "STAFF" | "END_CUSTOMER";

interface MembershipInfo {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
}

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: boolean;
  disabledAt: string | null;
  memberships: MembershipInfo[];
  membershipIdInActive: string | null;
  roleInActive: TenantRole | null;
}

interface MemberApiItem {
  membershipId: string;
  role: TenantRole;
  user: { id: string; email: string; name: string | null; isSuperadmin: boolean; disabledAt: string | null };
}

interface SuperadminUser {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: boolean;
  disabledAt: string | null;
  memberships: MembershipInfo[];
}
interface SuperadminTenant {
  id: string;
  name: string;
  slug: string;
}
interface SuperadminOverview {
  tenants: SuperadminTenant[];
  users: SuperadminUser[];
}

const { user, primaryTenant } = useAuth();

const isSuperadmin = computed(() => Boolean(user.value?.isSuperadmin));
const isTenantAdmin = computed(() => primaryTenant.value?.role === "ADMIN");
const canEdit = computed(() => isSuperadmin.value || isTenantAdmin.value);

const users = ref<UserItem[]>([]);
const tenants = ref<SuperadminTenant[]>([]);
const loading = ref(false);
const savingId = ref("");
const error = ref("");
const info = ref("");

const filterOpen = ref(false);
const filters = reactive({
  q: "",
  role: "",
  scope: "active" as "active" | "all",
});

const addOpen = ref(false);
const addForm = reactive({
  email: "",
  name: "",
  password: "",
  role: "STAFF" as TenantRole,
  isSuperadmin: false,
  tenantId: "",
});

const editOpen = ref(false);
const editingUser = ref<UserItem | null>(null);
const editForm = reactive({
  email: "",
  name: "",
  password: "",
  role: "STAFF" as TenantRole,
  isSuperadmin: false,
});
interface EditableMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
  originalRole: TenantRole | null;
  removed: boolean;
  isNew: boolean;
}
const editMemberships = ref<EditableMembership[]>([]);
const newMembershipForm = reactive({
  tenantId: "",
  role: "STAFF" as TenantRole,
});
const dialogError = ref("");
const dialogInfo = ref("");

function setDialogError(message: string) {
  dialogError.value = message;
  dialogInfo.value = "";
}
function setDialogInfo(message: string) {
  dialogInfo.value = message;
  dialogError.value = "";
}
function clearDialogMessages() {
  dialogError.value = "";
  dialogInfo.value = "";
}

const existingUserEmails = computed(() => new Set(users.value.map((u) => u.email.toLowerCase())));
const addEmailNormalized = computed(() => addForm.email.trim().toLowerCase());
const addIsExistingUser = computed(
  () => addEmailNormalized.value.length > 0 && existingUserEmails.value.has(addEmailNormalized.value),
);
const addPasswordRequired = computed(() => !addIsExistingUser.value);
const editEmailNormalized = computed(() => editForm.email.trim().toLowerCase());
const editEmailTaken = computed(() => {
  if (!editingUser.value || !editEmailNormalized.value) return false;
  return users.value.some(
    (item) => item.id !== editingUser.value!.id && item.email.toLowerCase() === editEmailNormalized.value,
  );
});

const roleOptions: TenantRole[] = ["ADMIN", "STAFF", "END_CUSTOMER"];
const roleLabels: Record<TenantRole, string> = {
  ADMIN: "Admin",
  STAFF: "Benutzer",
  END_CUSTOMER: "Kunde",
};

const filteredUsers = computed(() => {
  const q = filters.q.trim().toLowerCase();
  return users.value.filter((u) => {
    if (filters.role) {
      const hasRole = u.memberships.some((m) => m.role === filters.role);
      if (!hasRole) return false;
    }
    if (isSuperadmin.value && filters.scope === "active") {
      if (
        primaryTenant.value &&
        !u.memberships.some((m) => m.tenantId === primaryTenant.value!.tenantId)
      ) {
        return false;
      }
    }
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.name?.toLowerCase().includes(q) ?? false)
    );
  });
});

const activeFilterCount = computed(() => {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.role) n += 1;
  if (isSuperadmin.value && filters.scope !== "active") n += 1;
  return n;
});

function setInfo(message: string) {
  info.value = message;
  error.value = "";
}
function setError(message: string) {
  error.value = message;
  info.value = "";
}
function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

function activeMembershipFor(memberships: MembershipInfo[]): MembershipInfo | null {
  if (!primaryTenant.value) return null;
  return memberships.find((m) => m.tenantId === primaryTenant.value!.tenantId) ?? null;
}

async function loadUsers() {
  loading.value = true;
  error.value = "";
  try {
    if (isSuperadmin.value) {
      const overview = await $fetch<SuperadminOverview>("/api/admin/overview", {
        credentials: "include",
      });
      tenants.value = overview.tenants;
      users.value = overview.users.map((u) => {
        const active = activeMembershipFor(u.memberships);
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          isSuperadmin: u.isSuperadmin,
          disabledAt: u.disabledAt,
          memberships: u.memberships,
          membershipIdInActive: active ? active.tenantId : null,
          roleInActive: active ? active.role : null,
        };
      });
    } else {
      if (!primaryTenant.value?.tenantId) {
        users.value = [];
        return;
      }
      const response = await $fetch<{ data: MemberApiItem[] }>(
        `/api/v1/tenants/${primaryTenant.value.tenantId}/members`,
        { credentials: "include" },
      );
      users.value = response.data.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        isSuperadmin: m.user.isSuperadmin,
        disabledAt: m.user.disabledAt,
        memberships: [
          {
            tenantId: primaryTenant.value!.tenantId,
            tenantName: primaryTenant.value!.tenantName,
            tenantSlug: primaryTenant.value!.tenantSlug,
            role: m.role,
          },
        ],
        membershipIdInActive: primaryTenant.value!.tenantId,
        roleInActive: m.role,
      }));
    }
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzer konnten nicht geladen werden"));
  } finally {
    loading.value = false;
  }
}

function openAdd() {
  addForm.email = "";
  addForm.name = "";
  addForm.password = "";
  addForm.role = "STAFF";
  addForm.isSuperadmin = false;
  addForm.tenantId = primaryTenant.value?.tenantId ?? "";
  clearDialogMessages();
  addOpen.value = true;
}

async function submitAdd() {
  clearDialogMessages();
  const email = addForm.email.trim();
  if (!email) {
    setDialogError("E-Mail ist erforderlich");
    return;
  }
  if (!email.includes("@")) {
    setDialogError("Gültige E-Mail ist erforderlich");
    return;
  }
  const password = addForm.password ?? "";
  const isExisting = addIsExistingUser.value;
  const willCreateNewUser = !isExisting;
  const willUseAdminEndpoint =
    isSuperadmin.value && (!addForm.tenantId || addForm.isSuperadmin);

  if (willCreateNewUser && (willUseAdminEndpoint || password.length > 0) && password.length < 6) {
    setDialogError("Passwort muss mindestens 6 Zeichen haben");
    return;
  }
  if (willCreateNewUser && !willUseAdminEndpoint && password.length < 6) {
    setDialogError("Für einen neuen Benutzer ist ein Passwort mit mind. 6 Zeichen erforderlich");
    return;
  }
  if (!isSuperadmin.value && !primaryTenant.value?.tenantId) {
    setDialogError("Kein aktiver Mandant – Benutzer kann nicht angelegt werden");
    return;
  }

  loading.value = true;
  try {
    if (willUseAdminEndpoint) {
      await $fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        body: {
          email,
          name: addForm.name || undefined,
          password,
          isSuperadmin: addForm.isSuperadmin,
          tenantId: addForm.tenantId || undefined,
          role: addForm.tenantId ? addForm.role : undefined,
        },
      });
    } else {
      const tenantId = addForm.tenantId || primaryTenant.value?.tenantId;
      if (!tenantId) {
        throw new Error("Kein Mandant ausgewählt");
      }
      await $fetch(`/api/v1/tenants/${tenantId}/members`, {
        method: "POST",
        credentials: "include",
        body: {
          email,
          name: addForm.name || undefined,
          password: password || undefined,
          role: addForm.role,
        },
      });
    }
    setInfo("Benutzer hinzugefügt");
    addOpen.value = false;
    await loadUsers();
  } catch (e: unknown) {
    setDialogError(apiMessage(e, "Benutzer konnte nicht hinzugefügt werden"));
  } finally {
    loading.value = false;
  }
}

function openEdit(userItem: UserItem) {
  editingUser.value = userItem;
  editForm.email = userItem.email;
  editForm.name = userItem.name ?? "";
  editForm.password = "";
  editForm.role = userItem.roleInActive ?? "STAFF";
  editForm.isSuperadmin = userItem.isSuperadmin;
  editMemberships.value = userItem.memberships.map((m) => ({
    tenantId: m.tenantId,
    tenantName: m.tenantName,
    tenantSlug: m.tenantSlug,
    role: m.role,
    originalRole: m.role,
    removed: false,
    isNew: false,
  }));
  newMembershipForm.tenantId = "";
  newMembershipForm.role = "STAFF";
  clearDialogMessages();
  editOpen.value = true;
}

const availableTenantsForNew = computed(() => {
  const used = new Set(
    editMemberships.value.filter((m) => !m.removed).map((m) => m.tenantId),
  );
  return tenants.value.filter((t) => !used.has(t.id));
});

function addMembershipDraft() {
  if (!newMembershipForm.tenantId) return;
  const tenant = tenants.value.find((t) => t.id === newMembershipForm.tenantId);
  if (!tenant) return;
  editMemberships.value.push({
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    role: newMembershipForm.role,
    originalRole: null,
    removed: false,
    isNew: true,
  });
  newMembershipForm.tenantId = "";
  newMembershipForm.role = "STAFF";
}

function toggleMembershipRemove(item: EditableMembership) {
  if (item.isNew) {
    editMemberships.value = editMemberships.value.filter((m) => m !== item);
  } else {
    item.removed = !item.removed;
  }
}

async function submitEdit() {
  if (!editingUser.value) return;
  clearDialogMessages();
  const email = editForm.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    setDialogError("Gültige E-Mail ist erforderlich");
    return;
  }
  if (editEmailTaken.value) {
    setDialogError("Diese E-Mail ist bereits vergeben");
    return;
  }
  if (editForm.password.trim().length > 0 && editForm.password.trim().length < 6) {
    setDialogError("Passwort muss mindestens 6 Zeichen haben");
    return;
  }
  const remainingMemberships = editMemberships.value.filter((m) => !m.removed);
  if (!editForm.isSuperadmin && remainingMemberships.length === 0) {
    setDialogError(
      "Benutzer muss mindestens einem Mandanten zugewiesen sein (oder Superadmin-Rechte erhalten).",
    );
    return;
  }

  loading.value = true;
  const target = editingUser.value;
  try {
    const activeTenantId = primaryTenant.value?.tenantId;
    const tenantBody: Record<string, unknown> = {};
    if (activeTenantId && target.roleInActive) {
      if (email !== target.email.toLowerCase()) {
        tenantBody.email = email;
      }
      if (editForm.name.trim() !== (target.name ?? "")) {
        tenantBody.name = editForm.name.trim() || null;
      }
      if (editForm.password.trim().length > 0) {
        tenantBody.password = editForm.password;
      }
      const activeEdit = editMemberships.value.find(
        (m) => m.tenantId === activeTenantId && !m.removed && !m.isNew,
      );
      if (activeEdit && activeEdit.role !== target.roleInActive) {
        tenantBody.role = activeEdit.role;
      }
    }

    if (Object.keys(tenantBody).length && activeTenantId) {
      await $fetch(`/api/v1/tenants/${activeTenantId}/members/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        body: tenantBody,
      });
    }

    if (isSuperadmin.value) {
      const adminBody: Record<string, unknown> = {};
      if (
        !tenantBody.email &&
        email !== target.email.toLowerCase()
      ) {
        adminBody.email = email;
      }
      if (
        !tenantBody.name &&
        editForm.name.trim() !== (target.name ?? "")
      ) {
        adminBody.name = editForm.name.trim() || null;
      }
      if (!tenantBody.password && editForm.password.trim().length > 0) {
        adminBody.password = editForm.password;
      }
      if (editForm.isSuperadmin !== target.isSuperadmin) {
        adminBody.isSuperadmin = editForm.isSuperadmin;
      }
      if (Object.keys(adminBody).length) {
        await $fetch(`/api/admin/users/${target.id}`, {
          method: "PATCH",
          credentials: "include",
          body: adminBody,
        });
      }

      for (const m of editMemberships.value) {
        if (m.tenantId === activeTenantId && !m.removed && !m.isNew) {
          continue;
        }
        if (m.isNew && !m.removed) {
          await $fetch("/api/admin/memberships", {
            method: "POST",
            credentials: "include",
            body: { userId: target.id, tenantId: m.tenantId, role: m.role },
          });
        } else if (!m.isNew && m.removed) {
          await $fetch(`/api/v1/tenants/${m.tenantId}/members/${target.id}`, {
            method: "DELETE",
            credentials: "include",
          });
        } else if (!m.isNew && !m.removed && m.role !== m.originalRole) {
          await $fetch("/api/admin/memberships", {
            method: "POST",
            credentials: "include",
            body: { userId: target.id, tenantId: m.tenantId, role: m.role },
          });
        }
      }
    }

    setInfo(`Benutzer ${target.email} aktualisiert`);
    editOpen.value = false;
    editingUser.value = null;
    await loadUsers();
  } catch (e: unknown) {
    setDialogError(apiMessage(e, "Benutzer konnte nicht aktualisiert werden"));
  } finally {
    loading.value = false;
  }
}

async function changeRole(userItem: UserItem, role: TenantRole) {
  if (!primaryTenant.value?.tenantId) return;
  if (userItem.roleInActive === role) return;
  savingId.value = userItem.id;
  try {
    if (userItem.roleInActive) {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/members/${userItem.id}`, {
        method: "PATCH",
        credentials: "include",
        body: { role },
      });
    } else {
      await $fetch("/api/admin/memberships", {
        method: "POST",
        credentials: "include",
        body: { userId: userItem.id, tenantId: primaryTenant.value.tenantId, role },
      });
    }
    setInfo(`Rolle für ${userItem.email} aktualisiert`);
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, "Rolle konnte nicht geändert werden"));
  } finally {
    savingId.value = "";
  }
}

async function removeFromTenant(userItem: UserItem) {
  if (!primaryTenant.value?.tenantId) return;
  if (!userItem.roleInActive) return;
  if (
    !confirm(
      `Benutzer ${userItem.email} aus Mandant „${primaryTenant.value.tenantName}“ entfernen? Die Mitgliedschaft kann im Papierkorb wiederhergestellt werden.`,
    )
  ) {
    return;
  }
  savingId.value = userItem.id;
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/members/${userItem.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    setInfo(`${userItem.email} entfernt`);
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzer konnte nicht entfernt werden"));
  } finally {
    savingId.value = "";
  }
}

function isSelf(userItem: UserItem) {
  return user.value?.id === userItem.id;
}

function canLockUser(userItem: UserItem) {
  if (!canEdit.value || isSelf(userItem)) return false;
  if (userItem.isSuperadmin && !isSuperadmin.value) return false;
  return true;
}

function canDeleteUser(userItem: UserItem) {
  if (!canLockUser(userItem)) return false;
  if (isSuperadmin.value) return true;
  return userItem.memberships.every((m) => m.tenantId === primaryTenant.value?.tenantId);
}

async function toggleDisabled(userItem: UserItem) {
  if (!canLockUser(userItem)) return;
  const lock = !userItem.disabledAt;
  if (
    !confirm(
      lock
        ? `Benutzer ${userItem.email} sperren? Die Person kann sich dann nicht mehr anmelden.`
        : `Sperre für ${userItem.email} aufheben?`,
    )
  ) {
    return;
  }
  savingId.value = userItem.id;
  try {
    if (isSuperadmin.value) {
      await $fetch(`/api/admin/users/${userItem.id}`, {
        method: "PATCH",
        credentials: "include",
        body: { disabled: lock },
      });
    } else if (primaryTenant.value?.tenantId) {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/members/${userItem.id}`, {
        method: "PATCH",
        credentials: "include",
        body: { disabled: lock },
      });
    }
    setInfo(lock ? `${userItem.email} gesperrt` : `${userItem.email} entsperrt`);
    if (editingUser.value?.id === userItem.id) {
      editingUser.value = { ...editingUser.value, disabledAt: lock ? new Date().toISOString() : null };
    }
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzerstatus konnte nicht geändert werden"));
  } finally {
    savingId.value = "";
  }
}

async function deleteUserAccount(userItem: UserItem) {
  if (!canDeleteUser(userItem)) return;
  if (
    !confirm(
      `Benutzerkonto ${userItem.email} wirklich löschen? Die Person wird abgemeldet und erscheint nicht mehr in der Benutzerliste. Wiederherstellen ist im Papierkorb möglich.`,
    )
  ) {
    return;
  }
  savingId.value = userItem.id;
  try {
    if (isSuperadmin.value) {
      await $fetch(`/api/admin/users/${userItem.id}`, {
        method: "DELETE",
        credentials: "include",
      });
    } else if (primaryTenant.value?.tenantId) {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/users/${userItem.id}`, {
        method: "DELETE",
        credentials: "include",
      });
    }
    setInfo(`${userItem.email} gelöscht`);
    editOpen.value = false;
    editingUser.value = null;
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzer konnte nicht gelöscht werden"));
    setDialogError(apiMessage(e, "Benutzer konnte nicht gelöscht werden"));
  } finally {
    savingId.value = "";
  }
}

onMounted(loadUsers);

watch(
  () => primaryTenant.value?.tenantId,
  () => {
    loadUsers();
  },
);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p class="text-sm text-muted font-medium">Alpiplan · Benutzer</p>
        <h1 class="font-display text-3xl sm:text-4xl">
          Benutzer
          <span class="ml-2 text-sm font-normal text-neutral-500">({{ filteredUsers.length }})</span>
        </h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          <template v-if="isSuperadmin">
            Alle Benutzer im System
            <UBadge color="secondary" variant="soft" class="ml-1">SUPERADMIN</UBadge>
          </template>
          <template v-else>
            Mitglieder von <strong>{{ primaryTenant?.tenantName || "—" }}</strong>
            <template v-if="canEdit">
              · <UBadge color="primary" variant="subtle" class="ml-1">ADMIN</UBadge>
            </template>
          </template>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-filter"
          @click="filterOpen = !filterOpen"
        >
          Filter
          <UBadge v-if="activeFilterCount" color="primary" variant="subtle" class="ml-1">
            {{ activeFilterCount }}
          </UBadge>
          <UIcon
            :name="filterOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="ml-1 size-4"
          />
        </UButton>
        <UButton
          v-if="canEdit"
          icon="i-lucide-user-plus"
          color="primary"
          @click="openAdd"
        >
          Benutzer hinzufügen
        </UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <UCard v-if="filterOpen">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium">Filter</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="filterOpen = false" />
        </div>
      </template>
      <div class="grid gap-3 md:grid-cols-3">
        <UInput v-model="filters.q" placeholder="Suche E-Mail oder Name" />
        <select
          v-model="filters.role"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="">Alle Rollen</option>
          <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
        </select>
        <select
          v-if="isSuperadmin"
          v-model="filters.scope"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="active">Nur aktiver Mandant</option>
          <option value="all">Alle Mandanten</option>
        </select>
      </div>
    </UCard>

    <div
      v-if="!filteredUsers.length && !loading"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Keine Benutzer passend zu den Filtern.
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="u in filteredUsers" :key="u.id">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">{{ u.name || u.email }}</p>
            <p class="text-xs text-neutral-500 truncate">{{ u.email }}</p>
            <div class="mt-2 flex flex-wrap gap-1 items-center">
              <UBadge v-if="u.isSuperadmin" color="secondary" variant="soft">SUPERADMIN</UBadge>
              <UBadge v-if="u.disabledAt" color="warning" variant="soft">Gesperrt</UBadge>
            </div>
            <div class="mt-2">
              <p class="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
                Mandanten ({{ u.memberships.length }})
              </p>
              <div v-if="u.memberships.length" class="flex flex-wrap gap-1">
                <UBadge
                  v-for="m in u.memberships"
                  :key="`${u.id}:${m.tenantId}`"
                  :color="m.tenantId === primaryTenant?.tenantId ? 'primary' : 'neutral'"
                  variant="subtle"
                >
                  {{ m.tenantName }} · {{ roleLabels[m.role] }}
                </UBadge>
              </div>
              <UAlert
                v-else-if="!u.isSuperadmin"
                color="warning"
                variant="subtle"
                icon="i-lucide-alert-triangle"
                title="Keine Mandanten-Zuweisung"
                description="Dieser Benutzer hat aktuell keine Mitgliedschaft."
              />
              <span v-else class="text-xs text-neutral-500 italic">Superadmin ohne Mandanten-Mitgliedschaft</span>
            </div>
          </div>
          <div v-if="canEdit" class="flex items-center gap-2 shrink-0">
            <select
              :value="u.roleInActive ?? ''"
              class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
              :disabled="savingId === u.id || !primaryTenant"
              @change="changeRole(u, ($event.target as HTMLSelectElement).value as TenantRole)"
            >
              <option value="" disabled>—</option>
              <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
            </select>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-pencil"
              aria-label="Bearbeiten"
              title="Bearbeiten"
              :disabled="!isSuperadmin && !u.roleInActive"
              @click="openEdit(u)"
            >
              <span class="hidden sm:inline">Bearbeiten</span>
            </UButton>
            <UButton
              v-if="canLockUser(u)"
              size="sm"
              :color="u.disabledAt ? 'success' : 'warning'"
              variant="ghost"
              :icon="u.disabledAt ? 'i-lucide-unlock' : 'i-lucide-lock'"
              :aria-label="u.disabledAt ? 'Entsperren' : 'Sperren'"
              :title="u.disabledAt ? 'Entsperren' : 'Sperren'"
              :disabled="savingId === u.id"
              :loading="savingId === u.id"
              @click="toggleDisabled(u)"
            >
              <span class="hidden sm:inline">{{ u.disabledAt ? "Entsperren" : "Sperren" }}</span>
            </UButton>
            <UButton
              v-if="u.roleInActive"
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-user-minus"
              aria-label="Aus Mandant entfernen"
              title="Aus Mandant entfernen"
              :loading="savingId === u.id"
              @click="removeFromTenant(u)"
            >
              <span class="hidden sm:inline">Entfernen</span>
            </UButton>
            <UButton
              v-if="canDeleteUser(u)"
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              aria-label="Konto löschen"
              title="Konto löschen"
              :disabled="savingId === u.id"
              :loading="savingId === u.id"
              @click="deleteUserAccount(u)"
            >
              <span class="hidden sm:inline">Löschen</span>
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <UModal v-model:open="editOpen" :ui="{ content: 'max-w-lg' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <div class="min-w-0">
            <h2 class="font-medium truncate">Benutzer bearbeiten</h2>
            <p class="text-xs text-neutral-500 truncate">{{ editingUser?.email }}</p>
            <UBadge v-if="editingUser?.disabledAt" color="warning" variant="soft" class="mt-1">Gesperrt</UBadge>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="editOpen = false" />
        </div>
      </template>
      <template #body>
        <form class="space-y-4" @submit.prevent="submitEdit">
          <UAlert v-if="dialogError" color="error" variant="soft" icon="i-lucide-circle-alert" :title="dialogError" />
          <UFormField label="E-Mail" required hint="muss eindeutig sein">
            <UInput v-model="editForm.email" type="email" autocomplete="off" />
          </UFormField>
          <UAlert
            v-if="editEmailTaken"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Diese E-Mail ist bereits vergeben"
          />
          <UFormField label="Name">
            <UInput v-model="editForm.name" />
          </UFormField>
          <UFormField label="Neues Passwort" hint="leer lassen, um nicht zu ändern">
            <UInput v-model="editForm.password" type="password" autocomplete="new-password" />
          </UFormField>

          <div class="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium">Mandanten-Zuweisungen</h3>
              <UBadge color="neutral" variant="subtle">
                {{ editMemberships.filter((m) => !m.removed).length }}
              </UBadge>
            </div>

            <div v-if="!editMemberships.length" class="text-xs text-neutral-500 italic mb-2">
              Noch keine Mitgliedschaft.
            </div>
            <ul v-else class="space-y-2 mb-3">
              <li
                v-for="(m, idx) in editMemberships"
                :key="`${m.tenantId}:${idx}`"
                class="flex items-center gap-2 flex-wrap rounded-md border border-neutral-200 dark:border-neutral-800 p-2"
                :class="{ 'opacity-50 line-through': m.removed }"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium truncate">{{ m.tenantName }}</p>
                  <p class="text-xs text-neutral-500 truncate">{{ m.tenantSlug }}</p>
                </div>
                <select
                  v-model="m.role"
                  :disabled="m.removed || (!isSuperadmin && m.tenantId !== primaryTenant?.tenantId)"
                  class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
                </select>
                <UBadge v-if="m.isNew" color="success" variant="subtle">neu</UBadge>
                <UButton
                  v-if="isSuperadmin || m.tenantId === primaryTenant?.tenantId"
                  size="xs"
                  :color="m.removed ? 'neutral' : 'error'"
                  variant="ghost"
                  :icon="m.removed ? 'i-lucide-rotate-ccw' : 'i-lucide-trash-2'"
                  @click="toggleMembershipRemove(m)"
                >
                  {{ m.removed ? "Wiederherstellen" : "Entfernen" }}
                </UButton>
              </li>
            </ul>

            <div
              v-if="isSuperadmin && availableTenantsForNew.length"
              class="flex items-end gap-2 flex-wrap rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-2"
            >
              <UFormField label="Mandant" class="flex-1 min-w-[160px]">
                <select
                  v-model="newMembershipForm.tenantId"
                  class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option value="">Mandant wählen…</option>
                  <option v-for="t in availableTenantsForNew" :key="t.id" :value="t.id">
                    {{ t.name }} ({{ t.slug }})
                  </option>
                </select>
              </UFormField>
              <UFormField label="Rolle">
                <select
                  v-model="newMembershipForm.role"
                  class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
                </select>
              </UFormField>
              <UButton
                size="sm"
                icon="i-lucide-plus"
                variant="outline"
                :disabled="!newMembershipForm.tenantId"
                @click="addMembershipDraft"
              >
                Zuweisen
              </UButton>
            </div>
            <p v-else-if="isSuperadmin" class="text-xs text-neutral-500 italic">
              Benutzer ist bereits allen Mandanten zugewiesen.
            </p>
          </div>

          <label
            v-if="isSuperadmin"
            class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
          >
            <input v-model="editForm.isSuperadmin" type="checkbox" />
            Superadmin-Rechte
          </label>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-between gap-2 w-full flex-wrap">
          <div class="flex gap-2">
            <UButton
              v-if="editingUser && canLockUser(editingUser)"
              variant="outline"
              :color="editingUser.disabledAt ? 'success' : 'warning'"
              :icon="editingUser.disabledAt ? 'i-lucide-unlock' : 'i-lucide-lock'"
              :loading="savingId === editingUser.id"
              @click="toggleDisabled(editingUser)"
            >
              {{ editingUser.disabledAt ? "Entsperren" : "Sperren" }}
            </UButton>
            <UButton
              v-if="editingUser && canDeleteUser(editingUser)"
              variant="outline"
              color="error"
              icon="i-lucide-trash-2"
              :loading="savingId === editingUser.id"
              @click="deleteUserAccount(editingUser)"
            >
              Konto löschen
            </UButton>
          </div>
          <div class="flex gap-2 ml-auto">
            <UButton variant="ghost" color="neutral" @click="editOpen = false">Abbrechen</UButton>
            <UButton color="primary" :loading="loading" icon="i-lucide-save" :disabled="editEmailTaken" @click="submitEdit">
              Speichern
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="addOpen" :ui="{ content: 'max-w-lg' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <h2 class="font-medium">Benutzer hinzufügen</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="addOpen = false" />
        </div>
      </template>
      <template #body>
        <form class="space-y-3" @submit.prevent="submitAdd">
          <UAlert v-if="dialogError" color="error" variant="soft" icon="i-lucide-circle-alert" :title="dialogError" />
          <UAlert v-if="dialogInfo" color="success" variant="soft" icon="i-lucide-circle-check" :title="dialogInfo" />
          <UFormField label="E-Mail" required>
            <UInput v-model="addForm.email" type="email" placeholder="email@domain.tld" autocomplete="off" />
          </UFormField>
          <UAlert
            v-if="addIsExistingUser"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Benutzer existiert bereits"
            description="Dieser Benutzer wird dem Mandanten zugeordnet. Passwort ist nicht erforderlich."
          />
          <UFormField label="Name (optional)">
            <UInput v-model="addForm.name" />
          </UFormField>
          <UFormField
            :label="addPasswordRequired ? 'Passwort' : 'Passwort (optional)'"
            :hint="addPasswordRequired ? 'Pflicht bei neuem Benutzer · mind. 6 Zeichen' : 'wird ignoriert, Benutzer existiert bereits'"
            :required="addPasswordRequired"
          >
            <UInput
              v-model="addForm.password"
              type="password"
              autocomplete="new-password"
              :disabled="addIsExistingUser"
            />
          </UFormField>
          <UFormField v-if="isSuperadmin" label="Mandant">
            <select
              v-model="addForm.tenantId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">Ohne Mandant</option>
              <option v-for="t in tenants" :key="t.id" :value="t.id">
                {{ t.name }} ({{ t.slug }})
              </option>
            </select>
          </UFormField>
          <UFormField label="Rolle">
            <select
              v-model="addForm.role"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
            </select>
          </UFormField>
          <label v-if="isSuperadmin" class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input v-model="addForm.isSuperadmin" type="checkbox" />
            Superadmin-Rechte
          </label>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="addOpen = false">Abbrechen</UButton>
          <UButton color="primary" :loading="loading" icon="i-lucide-user-plus" @click="submitAdd">
            Hinzufügen
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
