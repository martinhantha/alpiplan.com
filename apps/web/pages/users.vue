<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";
import { avatarColor } from "../utils/avatar";

type TenantRole = "ADMIN" | "STAFF" | "END_CUSTOMER";

interface TeacherProfileInfo {
  id: string;
  color: string | null;
  priority: number;
}

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
  performsAppointmentsInActive: boolean;
  teacherProfile: TeacherProfileInfo | null;
}

interface MemberApiItem {
  membershipId: string;
  role: TenantRole;
  performsAppointments: boolean;
  teacherProfile: TeacherProfileInfo | null;
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
const { t } = useAppLocale();
const route = useRoute();
const router = useRouter();

const isSuperadmin = computed(() => Boolean(user.value?.isSuperadmin));
const isTenantAdmin = computed(() => primaryTenant.value?.role === "ADMIN");
const canEdit = computed(() => isSuperadmin.value || isTenantAdmin.value);
const teacherLabel = computed(() => primaryTenant.value?.teacherLabel || t("quickCapture.teacherFallback"));

type UsersTab = "users" | "absences" | "availability";
const USERS_TABS = computed<{ id: UsersTab; label: string; icon: string }[]>(() => [
  { id: "users", label: t("usersPage.tabUsers"), icon: "i-lucide-users" },
  { id: "absences", label: t("usersPage.tabAbsences"), icon: "i-lucide-calendar-off" },
  { id: "availability", label: t("usersPage.tabHours"), icon: "i-lucide-clock" },
]);

const activeTab = computed<UsersTab>({
  get: () => {
    const tab = route.query.tab;
    return USERS_TABS.value.some((item) => item.id === tab) ? (tab as UsersTab) : "users";
  },
  set: (tab) => {
    void router.replace({ query: { ...route.query, tab: tab === "users" ? undefined : tab } });
  },
});

const scheduleTeachers = ref<{ id: string; displayName: string }[]>([]);
const scheduleTeacherId = ref("");
const scheduleTeacherName = computed(
  () => scheduleTeachers.value.find((teacher) => teacher.id === scheduleTeacherId.value)?.displayName ?? "",
);

async function loadScheduleTeachers() {
  const tenantId = primaryTenant.value?.tenantId;
  if (!tenantId) {
    scheduleTeachers.value = [];
    scheduleTeacherId.value = "";
    return;
  }
  try {
    const response = await $fetch<{ teachers: { id: string; displayName: string }[] }>(
      `/api/v1/tenants/${tenantId}/scheduling/options`,
      { credentials: "include" },
    );
    scheduleTeachers.value = response.teachers;
    if (!scheduleTeachers.value.some((teacher) => teacher.id === scheduleTeacherId.value)) {
      const own = primaryTenant.value?.teacherProfileId;
      scheduleTeacherId.value =
        (own && scheduleTeachers.value.some((teacher) => teacher.id === own) ? own : scheduleTeachers.value[0]?.id) ?? "";
    }
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.teachersLoadFailed", { teacher: teacherLabel.value })));
  }
}

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
  sendInvite: true,
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
  teacherColor: null as string | null,
  teacherPriority: 0,
  performsAppointments: true,
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
const addPasswordRequired = computed(() => !addIsExistingUser.value && !addForm.sendInvite);
const editEmailNormalized = computed(() => editForm.email.trim().toLowerCase());
const editEmailTaken = computed(() => {
  if (!editingUser.value || !editEmailNormalized.value) return false;
  return users.value.some(
    (item) => item.id !== editingUser.value!.id && item.email.toLowerCase() === editEmailNormalized.value,
  );
});

const roleOptions: TenantRole[] = ["ADMIN", "STAFF", "END_CUSTOMER"];
const roleLabels = computed<Record<TenantRole, string>>(() => ({
  ADMIN: t("usersPage.roleAdmin"),
  STAFF: t("usersPage.roleStaff"),
  END_CUSTOMER: t("usersPage.roleCustomer"),
}));

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

interface PasswordLinkResult {
  purpose: "reset" | "setup";
  delivered: boolean;
  actionUrl?: string;
}

function passwordLinkMessage(email: string, result: PasswordLinkResult) {
  const kind = result.purpose === "setup" ? t("usersPage.invite") : t("usersPage.resetLink");
  if (result.delivered) return t("usersPage.linkSent", { kind, email });
  return result.actionUrl
    ? t("usersPage.smtpWithLink", { url: result.actionUrl })
    : t("usersPage.smtpNone");
}

const sendingLinkId = ref("");

async function sendPasswordLink(userItem: UserItem) {
  const tenantId = primaryTenant.value?.tenantId;
  const url =
    userItem.roleInActive && tenantId
      ? `/api/v1/tenants/${tenantId}/members/${userItem.id}/password-link`
      : `/api/admin/users/${userItem.id}/password-link`;
  sendingLinkId.value = userItem.id;
  clearDialogMessages();
  try {
    const result = await $fetch<PasswordLinkResult>(url, { method: "POST", credentials: "include" });
    setDialogInfo(passwordLinkMessage(userItem.email, result));
  } catch (e: unknown) {
    setDialogError(apiMessage(e, t("usersPage.linkFailed")));
  } finally {
    sendingLinkId.value = "";
  }
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
      const activeTenantId = primaryTenant.value?.tenantId;
      const [overview, activeMembers] = await Promise.all([
        $fetch<SuperadminOverview>("/api/admin/overview", {
          credentials: "include",
        }),
        activeTenantId
          ? $fetch<{ data: MemberApiItem[] }>(`/api/v1/tenants/${activeTenantId}/members`, {
              credentials: "include",
            }).catch(() => ({ data: [] as MemberApiItem[] }))
          : Promise.resolve({ data: [] as MemberApiItem[] }),
      ]);
      const activeMemberByUser = new Map(activeMembers.data.map((m) => [m.user.id, m]));
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
          performsAppointmentsInActive: activeMemberByUser.get(u.id)?.performsAppointments ?? true,
          teacherProfile: active ? (activeMemberByUser.get(u.id)?.teacherProfile ?? null) : null,
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
        performsAppointmentsInActive: m.performsAppointments,
        teacherProfile: m.teacherProfile,
      }));
    }
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.loadFailed")));
  } finally {
    loading.value = false;
  }
}

function openAdd() {
  addForm.email = "";
  addForm.name = "";
  addForm.password = "";
  addForm.sendInvite = true;
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
    setDialogError(t("usersPage.emailRequired"));
    return;
  }
  if (!email.includes("@")) {
    setDialogError(t("usersPage.emailInvalid"));
    return;
  }
  const password = addForm.password ?? "";
  const isExisting = addIsExistingUser.value;
  const willCreateNewUser = !isExisting;
  const willUseAdminEndpoint =
    isSuperadmin.value && (!addForm.tenantId || addForm.isSuperadmin);
  const sendInvite = willCreateNewUser && addForm.sendInvite && !password;

  if (willCreateNewUser && password.length > 0 && password.length < 6) {
    setDialogError(t("usersPage.passwordMin"));
    return;
  }
  if (willCreateNewUser && !sendInvite && password.length < 6) {
    setDialogError(t("usersPage.passwordOrInvite"));
    return;
  }
  if (!isSuperadmin.value && !primaryTenant.value?.tenantId) {
    setDialogError(t("usersPage.noActiveTenant"));
    return;
  }

  loading.value = true;
  try {
    let created: { passwordLink?: PasswordLinkResult };
    if (willUseAdminEndpoint) {
      created = await $fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        body: {
          email,
          name: addForm.name || undefined,
          password: password || undefined,
          sendInvite,
          isSuperadmin: addForm.isSuperadmin,
          tenantId: addForm.tenantId || undefined,
          role: addForm.tenantId ? addForm.role : undefined,
        },
      });
    } else {
      const tenantId = addForm.tenantId || primaryTenant.value?.tenantId;
      if (!tenantId) {
        throw new Error(t("usersPage.noTenantSelected"));
      }
      created = await $fetch(`/api/v1/tenants/${tenantId}/members`, {
        method: "POST",
        credentials: "include",
        body: {
          email,
          name: addForm.name || undefined,
          password: password || undefined,
          sendInvite,
          role: addForm.role,
        },
      });
    }
    setInfo(
      created.passwordLink
        ? t("usersPage.addedWithLink", { message: passwordLinkMessage(email, created.passwordLink) })
        : t("usersPage.added"),
    );
    addOpen.value = false;
    await loadUsers();
  } catch (e: unknown) {
    setDialogError(apiMessage(e, t("usersPage.addFailed")));
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
  editForm.teacherColor = userItem.teacherProfile?.color ?? null;
  editForm.teacherPriority = userItem.teacherProfile?.priority ?? 0;
  editForm.performsAppointments = userItem.performsAppointmentsInActive;
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
    setDialogError(t("usersPage.emailInvalid"));
    return;
  }
  if (editEmailTaken.value) {
    setDialogError(t("usersPage.emailTaken"));
    return;
  }
  if (editForm.password.trim().length > 0 && editForm.password.trim().length < 6) {
    setDialogError(t("usersPage.passwordMin"));
    return;
  }
  const remainingMemberships = editMemberships.value.filter((m) => !m.removed);
  if (!editForm.isSuperadmin && remainingMemberships.length === 0) {
    setDialogError(t("usersPage.mustHaveTenant"));
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
      if (editForm.performsAppointments !== target.performsAppointmentsInActive) {
        tenantBody.performsAppointments = editForm.performsAppointments;
      }
    }

    if (Object.keys(tenantBody).length && activeTenantId) {
      await $fetch(`/api/v1/tenants/${activeTenantId}/members/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        body: tenantBody,
      });
    }

    const profile = target.teacherProfile;
    if (profile && activeTenantId && editForm.performsAppointments) {
      const teacherBody: Record<string, unknown> = {};
      if ((editForm.teacherColor ?? null) !== (profile.color ?? null)) {
        teacherBody.color = editForm.teacherColor;
      }
      const priority = Math.round(Number(editForm.teacherPriority) || 0);
      if (priority !== profile.priority) {
        teacherBody.priority = priority;
      }
      if (Object.keys(teacherBody).length) {
        await $fetch(`/api/v1/tenants/${activeTenantId}/teachers/${profile.id}`, {
          method: "PATCH",
          credentials: "include",
          body: teacherBody,
        });
      }
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

    setInfo(t("usersPage.updated", { email: target.email }));
    editOpen.value = false;
    editingUser.value = null;
    await loadUsers();
  } catch (e: unknown) {
    setDialogError(apiMessage(e, t("usersPage.updateFailed")));
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
    setInfo(t("usersPage.roleUpdated", { email: userItem.email }));
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.roleFailed")));
  } finally {
    savingId.value = "";
  }
}

async function removeFromTenant(userItem: UserItem) {
  if (!primaryTenant.value?.tenantId) return;
  if (!userItem.roleInActive) return;
  if (
    !confirm(
      t("usersPage.removeConfirm", { email: userItem.email, tenant: primaryTenant.value.tenantName }),
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
    setInfo(t("usersPage.removed", { email: userItem.email }));
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.removeFailed")));
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
        ? t("usersPage.lockConfirm", { email: userItem.email })
        : t("usersPage.unlockConfirm", { email: userItem.email }),
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
    setInfo(lock ? t("usersPage.lockedInfo", { email: userItem.email }) : t("usersPage.unlockedInfo", { email: userItem.email }));
    if (editingUser.value?.id === userItem.id) {
      editingUser.value = { ...editingUser.value, disabledAt: lock ? new Date().toISOString() : null };
    }
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.statusFailed")));
  } finally {
    savingId.value = "";
  }
}

async function deleteUserAccount(userItem: UserItem) {
  if (!canDeleteUser(userItem)) return;
  if (
    !confirm(
      t("usersPage.deleteConfirm", { email: userItem.email }),
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
    setInfo(t("usersPage.deleted", { email: userItem.email }));
    editOpen.value = false;
    editingUser.value = null;
    await loadUsers();
  } catch (e: unknown) {
    setError(apiMessage(e, t("usersPage.deleteFailed")));
    setDialogError(apiMessage(e, t("usersPage.deleteFailed")));
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

watch(
  () => [activeTab.value, primaryTenant.value?.tenantId] as const,
  ([tab]) => {
    info.value = "";
    error.value = "";
    if (tab !== "users") void loadScheduleTeachers();
  },
  { immediate: true },
);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p class="text-sm text-muted font-medium">{{ t("usersPage.breadcrumb") }}</p>
        <h1 class="font-display text-3xl sm:text-4xl">
          {{ t("usersPage.title") }}
          <span class="ml-2 text-sm font-normal text-neutral-500">({{ filteredUsers.length }})</span>
        </h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          <template v-if="isSuperadmin">
            {{ t("usersPage.allInSystem") }}
            <UBadge color="secondary" variant="soft" class="ml-1">SUPERADMIN</UBadge>
          </template>
          <template v-else>
            {{ t("usersPage.membersOf") }} <strong>{{ primaryTenant?.tenantName || "—" }}</strong>
            <template v-if="canEdit">
              · <UBadge color="primary" variant="subtle" class="ml-1">ADMIN</UBadge>
            </template>
          </template>
        </p>
      </div>
      <div v-if="activeTab === 'users'" class="flex items-center gap-2">
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-filter"
          @click="filterOpen = !filterOpen"
        >
          {{ t("common.filter") }}
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
          {{ t("usersPage.add") }}
        </UButton>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-2">
      <UButton
        v-for="tab in USERS_TABS"
        :key="tab.id"
        size="sm"
        :variant="activeTab === tab.id ? 'soft' : 'ghost'"
        :color="activeTab === tab.id ? 'primary' : 'neutral'"
        :icon="tab.icon"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <section v-if="activeTab !== 'users'" class="space-y-4">
      <div
        v-if="!primaryTenant"
        class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
      >
        {{ t("usersPage.pickTenant") }}
      </div>
      <div
        v-else-if="!scheduleTeachers.length"
        class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
      >
        {{ t("usersPage.noTeachers", { teacher: teacherLabel }) }}
      </div>
      <template v-else>
        <UCard>
          <template #header><h2 class="font-medium">{{ t("usersPage.chooseTeacher", { teacher: teacherLabel }) }}</h2></template>
          <select
            v-model="scheduleTeacherId"
            class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
          >
            <option v-for="t in scheduleTeachers" :key="t.id" :value="t.id">
              {{ t.displayName }}{{ t.id === primaryTenant.teacherProfileId ? ` ${$t("common.me")}` : "" }}
            </option>
          </select>
        </UCard>
        <TeacherAbsencesPanel
          v-if="activeTab === 'absences'"
          :tenant-id="primaryTenant.tenantId"
          :teacher-id="scheduleTeacherId"
          :teacher-name="scheduleTeacherName"
          @info="setInfo"
          @error="setError"
        />
        <TeacherAvailabilityRulesPanel
          v-else
          :tenant-id="primaryTenant.tenantId"
          :teacher-id="scheduleTeacherId"
          :teacher-label="teacherLabel"
          @info="setInfo"
          @error="setError"
        />
      </template>
    </section>

    <template v-else>
    <UCard v-if="filterOpen">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium">{{ t("common.filter") }}</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="filterOpen = false" />
        </div>
      </template>
      <div class="grid gap-3 md:grid-cols-3">
        <UInput v-model="filters.q" :placeholder="t('usersPage.searchPlaceholder')" />
        <select
          v-model="filters.role"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="">{{ t("usersPage.allRoles") }}</option>
          <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
        </select>
        <select
          v-if="isSuperadmin"
          v-model="filters.scope"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="active">{{ t("usersPage.scopeActive") }}</option>
          <option value="all">{{ t("usersPage.scopeAll") }}</option>
        </select>
      </div>
    </UCard>

    <div
      v-if="!filteredUsers.length && !loading"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      {{ t("usersPage.empty") }}
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="u in filteredUsers" :key="u.id">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 font-medium">
              <span
                v-if="u.teacherProfile"
                class="size-3 shrink-0 rounded-full"
                :style="{ backgroundColor: avatarColor(u.teacherProfile.id, u.teacherProfile.color) }"
                :title="t('colorPicker.calendar')"
              />
              <span class="truncate">{{ u.name || u.email }}</span>
            </p>
            <p class="text-xs text-neutral-500 truncate">{{ u.email }}</p>
            <div class="mt-2 flex flex-wrap gap-1 items-center">
              <UBadge v-if="u.isSuperadmin" color="secondary" variant="soft">SUPERADMIN</UBadge>
              <UBadge v-if="u.disabledAt" color="warning" variant="soft">{{ t("usersPage.locked") }}</UBadge>
              <UBadge v-if="u.teacherProfile" color="neutral" variant="subtle">
                {{ teacherLabel }} · {{ t("availability.priority", { priority: u.teacherProfile.priority }) }}
              </UBadge>
              <UBadge v-else-if="u.roleInActive && !u.performsAppointmentsInActive" color="info" variant="subtle">
                {{ t("usersPage.organizeBadge") }}
              </UBadge>
            </div>
            <div class="mt-2">
              <p class="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
                {{ t("usersPage.tenantsCount", { count: u.memberships.length }) }}
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
                :title="t('usersPage.noAssignment')"
                :description="t('usersPage.noMembershipBody')"
              />
              <span v-else class="text-xs text-neutral-500 italic">{{ t("usersPage.noMembership") }}</span>
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
              :aria-label="t('common.edit')"
              :title="t('common.edit')"
              :disabled="!isSuperadmin && !u.roleInActive"
              @click="openEdit(u)"
            >
              <span class="hidden sm:inline">{{ t("common.edit") }}</span>
            </UButton>
            <UButton
              v-if="canLockUser(u)"
              size="sm"
              :color="u.disabledAt ? 'success' : 'warning'"
              variant="ghost"
              :icon="u.disabledAt ? 'i-lucide-unlock' : 'i-lucide-lock'"
              :aria-label="u.disabledAt ? t('usersPage.unlock') : t('usersPage.lock')"
              :title="u.disabledAt ? t('usersPage.unlock') : t('usersPage.lock')"
              :disabled="savingId === u.id"
              :loading="savingId === u.id"
              @click="toggleDisabled(u)"
            >
              <span class="hidden sm:inline">{{ u.disabledAt ? t("usersPage.unlock") : t("usersPage.lock") }}</span>
            </UButton>
            <UButton
              v-if="u.roleInActive"
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-user-minus"
              :aria-label="t('usersPage.removeFromTenant')"
              :title="t('usersPage.removeFromTenant')"
              :loading="savingId === u.id"
              @click="removeFromTenant(u)"
            >
              <span class="hidden sm:inline">{{ t("common.remove") }}</span>
            </UButton>
            <UButton
              v-if="canDeleteUser(u)"
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              :aria-label="t('usersPage.deleteAccount')"
              :title="t('usersPage.deleteAccount')"
              :disabled="savingId === u.id"
              :loading="savingId === u.id"
              @click="deleteUserAccount(u)"
            >
              <span class="hidden sm:inline">{{ t("common.delete") }}</span>
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
    </template>

    <UModal v-model:open="editOpen" :ui="{ content: 'max-w-lg' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <div class="min-w-0">
            <h2 class="font-medium truncate">{{ t("usersPage.editTitle") }}</h2>
            <p class="text-xs text-neutral-500 truncate">{{ editingUser?.email }}</p>
            <UBadge v-if="editingUser?.disabledAt" color="warning" variant="soft" class="mt-1">{{ t("usersPage.locked") }}</UBadge>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="editOpen = false" />
        </div>
      </template>
      <template #body>
        <form class="space-y-4" @submit.prevent="submitEdit">
          <UAlert v-if="dialogError" color="error" variant="soft" icon="i-lucide-circle-alert" :title="dialogError" />
          <UAlert
            v-if="dialogInfo"
            color="success"
            variant="soft"
            icon="i-lucide-circle-check"
            :title="dialogInfo"
            :ui="{ title: 'break-all' }"
          />
          <UFormField :label="t('common.email')" required :hint="t('usersPage.emailUnique')">
            <UInput v-model="editForm.email" type="email" autocomplete="off" />
          </UFormField>
          <UAlert
            v-if="editEmailTaken"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="t('usersPage.emailTaken')"
          />
          <UFormField :label="t('common.name')">
            <UInput v-model="editForm.name" />
          </UFormField>
          <UFormField :label="t('usersPage.newPassword')" :hint="t('usersPage.passwordKeep')">
            <UInput v-model="editForm.password" type="password" autocomplete="new-password" />
          </UFormField>
          <div v-if="editingUser" class="flex items-center justify-between gap-3 flex-wrap -mt-1">
            <p class="text-xs text-neutral-500">
              {{ t("usersPage.orEmailLink") }}
            </p>
            <UButton
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-mail"
              :loading="sendingLinkId === editingUser.id"
              :disabled="Boolean(editingUser.disabledAt) || (editingUser.isSuperadmin && !isSuperadmin)"
              @click="sendPasswordLink(editingUser)"
            >
              {{ t("usersPage.sendPasswordLink") }}
            </UButton>
          </div>

          <div
            v-if="editingUser?.roleInActive === 'ADMIN' || editingUser?.roleInActive === 'STAFF'"
            class="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800"
          >
            <h3 class="text-sm font-medium">{{ t("usersPage.planning", { teacher: teacherLabel }) }}</h3>
            <UCheckbox
              v-model="editForm.performsAppointments"
              :label="t('usersPage.performs', { teacher: teacherLabel })"
              :description="editForm.performsAppointments ? undefined : t('usersPage.organizeOnly')"
            />
            <template v-if="editingUser.teacherProfile && editForm.performsAppointments">
              <UFormField :label="t('colorPicker.calendar')">
                <TeacherColorPicker
                  :teacher-id="editingUser.teacherProfile.id"
                  :color="editForm.teacherColor"
                  @change="editForm.teacherColor = $event"
                />
              </UFormField>
              <UFormField :label="t('common.priority')" :hint="t('usersPage.priorityHint')">
                <UInput v-model.number="editForm.teacherPriority" type="number" min="-100" max="100" step="1" />
              </UFormField>
            </template>
          </div>

          <div class="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium">{{ t("usersPage.memberships") }}</h3>
              <UBadge color="neutral" variant="subtle">
                {{ editMemberships.filter((m) => !m.removed).length }}
              </UBadge>
            </div>

            <div v-if="!editMemberships.length" class="text-xs text-neutral-500 italic mb-2">
              {{ t("usersPage.noMembershipYet") }}
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
                <UBadge v-if="m.isNew" color="success" variant="subtle">{{ t("common.newBadge") }}</UBadge>
                <UButton
                  v-if="isSuperadmin || m.tenantId === primaryTenant?.tenantId"
                  size="xs"
                  :color="m.removed ? 'neutral' : 'error'"
                  variant="ghost"
                  :icon="m.removed ? 'i-lucide-rotate-ccw' : 'i-lucide-trash-2'"
                  @click="toggleMembershipRemove(m)"
                >
                  {{ m.removed ? t("common.restore") : t("common.remove") }}
                </UButton>
              </li>
            </ul>

            <div
              v-if="isSuperadmin && availableTenantsForNew.length"
              class="flex items-end gap-2 flex-wrap rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-2"
            >
              <UFormField :label="t('common.tenant')" class="flex-1 min-w-[160px]">
                <select
                  v-model="newMembershipForm.tenantId"
                  class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                >
                  <option value="">{{ t("usersPage.pickTenantOption") }}</option>
                  <option v-for="t in availableTenantsForNew" :key="t.id" :value="t.id">
                    {{ t.name }} ({{ t.slug }})
                  </option>
                </select>
              </UFormField>
              <UFormField :label="t('common.role')">
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
                {{ t("common.assign") }}
              </UButton>
            </div>
            <p v-else-if="isSuperadmin" class="text-xs text-neutral-500 italic">
              {{ t("usersPage.assignedAll") }}
            </p>
          </div>

          <label
            v-if="isSuperadmin"
            class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
          >
            <input v-model="editForm.isSuperadmin" type="checkbox" />
            {{ t("usersPage.superadminRights") }}
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
              {{ editingUser.disabledAt ? t("usersPage.unlock") : t("usersPage.lock") }}
            </UButton>
            <UButton
              v-if="editingUser && canDeleteUser(editingUser)"
              variant="outline"
              color="error"
              icon="i-lucide-trash-2"
              :loading="savingId === editingUser.id"
              @click="deleteUserAccount(editingUser)"
            >
              {{ t("usersPage.deleteAccountButton") }}
            </UButton>
          </div>
          <div class="flex gap-2 ml-auto">
            <UButton variant="ghost" color="neutral" @click="editOpen = false">{{ t("common.cancel") }}</UButton>
            <UButton color="primary" :loading="loading" icon="i-lucide-save" :disabled="editEmailTaken" @click="submitEdit">
              {{ t("common.save") }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="addOpen" :ui="{ content: 'max-w-lg' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <h2 class="font-medium">{{ t("usersPage.add") }}</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="addOpen = false" />
        </div>
      </template>
      <template #body>
        <form class="space-y-3" @submit.prevent="submitAdd">
          <UAlert v-if="dialogError" color="error" variant="soft" icon="i-lucide-circle-alert" :title="dialogError" />
          <UAlert v-if="dialogInfo" color="success" variant="soft" icon="i-lucide-circle-check" :title="dialogInfo" />
          <UFormField :label="t('common.email')" required>
            <UInput v-model="addForm.email" type="email" placeholder="email@domain.tld" autocomplete="off" />
          </UFormField>
          <UAlert
            v-if="addIsExistingUser"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="t('usersPage.existingUser')"
            :description="t('usersPage.existingUserHint')"
          />
          <UFormField :label="t('usersPage.nameOptional')">
            <UInput v-model="addForm.name" />
          </UFormField>
          <UCheckbox
            v-if="!addIsExistingUser"
            v-model="addForm.sendInvite"
            :label="t('usersPage.sendInvite')"
            :description="t('usersPage.sendInviteHint')"
          />
          <UFormField
            :label="addPasswordRequired ? t('usersPage.password') : t('usersPage.passwordOptional')"
            :hint="
              addIsExistingUser
                ? t('usersPage.passwordIgnored')
                : addPasswordRequired
                  ? t('usersPage.passwordRequiredHint')
                  : t('usersPage.passwordSelfHint')
            "
            :required="addPasswordRequired"
          >
            <UInput
              v-model="addForm.password"
              type="password"
              autocomplete="new-password"
              :disabled="addIsExistingUser"
            />
          </UFormField>
          <UFormField v-if="isSuperadmin" :label="t('common.tenant')">
            <select
              v-model="addForm.tenantId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">{{ t("usersPage.withoutTenant") }}</option>
              <option v-for="t in tenants" :key="t.id" :value="t.id">
                {{ t.name }} ({{ t.slug }})
              </option>
            </select>
          </UFormField>
          <UFormField :label="t('common.role')">
            <select
              v-model="addForm.role"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabels[role] }}</option>
            </select>
          </UFormField>
          <label v-if="isSuperadmin" class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input v-model="addForm.isSuperadmin" type="checkbox" />
            {{ t("usersPage.superadminRights") }}
          </label>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="addOpen = false">{{ t("common.cancel") }}</UButton>
          <UButton color="primary" :loading="loading" icon="i-lucide-user-plus" @click="submitAdd">
            {{ t("common.add") }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
