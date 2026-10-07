<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";
import { isCallHintsOptIn } from "@alpiplan/device-capabilities";
import { useWhatsAppPreference } from "../composables/useWhatsAppPreference";
import type { SuperadminOverview, TenantRole } from "../types/superadmin";

interface LessonType {
  id: string;
  name: string;
  defaultDurationMin: number | null;
}

interface TeacherOption {
  id: string;
  displayName: string;
}

interface AvailabilityRule {
  id: string;
  teacherId: string;
  weekday: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  kind: "available" | "unavailable";
  allDay: boolean;
  priority: number;
}

const { user, session, primaryTenant, refreshSession, canManageTenant, speechRecognitionEnabled } = useAuth();
const { locale, locales, setAppLocale, t } = useAppLocale();
const { device, setCallHintsOptIn } = useDeviceCapabilities();
const {
  isNative,
  requesting: permissionsRequesting,
  lastError: permissionsError,
  microphoneGranted,
  contactsGranted,
  allGranted,
  anyDenied,
  refreshStatus,
  requestNow,
  openAppSettings,
} = useNativePermissions({ needMicrophone: speechRecognitionEnabled });
const callHintsEnabled = ref(false);
const callHintsSaving = ref(false);
const nextDayBriefingEnabledLocal = ref(true);
const briefingSaving = ref(false);
const { whatsappApp, setWhatsAppApp } = useWhatsAppPreference();

watch(
  () => user.value?.nextDayBriefingEnabled,
  (value) => {
    nextDayBriefingEnabledLocal.value = value !== false;
  },
  { immediate: true },
);

function onWhatsAppAppChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  setWhatsAppApp(value === "business" ? "business" : "whatsapp");
}

async function onLocaleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!isAppLocaleCode(value) || value === locale.value) return;
  await setAppLocale(value);
  const label = t(`languages.${value}`);
  setInfo(t("settings.language.saved", { language: label }));
}

const isSuperadmin = computed(() => Boolean(user.value?.isSuperadmin));
const canEdit = canManageTenant;

const tenantSettingsSaving = ref(false);
const useDefaultDurationLocal = ref(true);
const resourcesEnabledLocal = ref(true);
const speechRecognitionEnabledLocal = ref(false);
const autoCompleteAppointmentsLocal = ref(false);
const autoCompleteAfterMinutesLocal = ref(0);
const teacherLabelLocal = ref("Lehrer");
const defaultTeacherIdLocal = ref("");
const lastSavedDefaultTeacherId = ref("");
const defaultLessonTypeIdLocal = ref("");
const lastSavedDefaultLessonTypeId = ref("");
watch(
  () => primaryTenant.value?.useDefaultDuration,
  (v) => {
    useDefaultDurationLocal.value = v ?? true;
  },
  { immediate: true },
);
watch(
  () => primaryTenant.value?.resourcesEnabled,
  (v) => {
    resourcesEnabledLocal.value = v ?? true;
  },
  { immediate: true },
);
watch(
  () => primaryTenant.value?.speechRecognitionEnabled,
  (v) => {
    speechRecognitionEnabledLocal.value = v ?? false;
  },
  { immediate: true },
);
watch(
  () => primaryTenant.value?.autoCompleteAppointments,
  (v) => {
    autoCompleteAppointmentsLocal.value = v ?? false;
  },
  { immediate: true },
);
watch(
  () => primaryTenant.value?.autoCompleteAfterMinutes,
  (v) => {
    autoCompleteAfterMinutesLocal.value = typeof v === "number" ? v : 0;
  },
  { immediate: true },
);
watch(
  () => primaryTenant.value?.teacherLabel,
  (v) => {
    teacherLabelLocal.value = v?.trim() || "Lehrer";
  },
  { immediate: true },
);

async function saveTenantSettings(patch: {
  useDefaultDuration?: boolean;
  defaultTeacherId?: string | null;
  defaultLessonTypeId?: string | null;
  teacherLabel?: string;
  resourcesEnabled?: boolean;
  speechRecognitionEnabled?: boolean;
  autoCompleteAppointments?: boolean;
  autoCompleteAfterMinutes?: number;
}) {
  if (!primaryTenant.value?.tenantId) return;
  tenantSettingsSaving.value = true;
  try {
    const saved = await $fetch<{
      useDefaultDuration: boolean;
      defaultTeacherId: string | null;
      defaultLessonTypeId: string | null;
      teacherLabel: string;
      resourcesEnabled: boolean;
      speechRecognitionEnabled: boolean;
      autoCompleteAppointments: boolean;
      autoCompleteAfterMinutes: number;
    }>(`/api/v1/tenants/${primaryTenant.value.tenantId}/settings`, {
      method: "PATCH",
      credentials: "include",
      body: patch,
    });
    if (typeof saved.useDefaultDuration === "boolean") {
      useDefaultDurationLocal.value = saved.useDefaultDuration;
    }
    if (typeof saved.resourcesEnabled === "boolean") {
      resourcesEnabledLocal.value = saved.resourcesEnabled;
    }
    if (typeof saved.speechRecognitionEnabled === "boolean") {
      speechRecognitionEnabledLocal.value = saved.speechRecognitionEnabled;
    }
    if (typeof saved.autoCompleteAppointments === "boolean") {
      autoCompleteAppointmentsLocal.value = saved.autoCompleteAppointments;
    }
    if (typeof saved.autoCompleteAfterMinutes === "number") {
      autoCompleteAfterMinutesLocal.value = saved.autoCompleteAfterMinutes;
    }
    if (typeof saved.teacherLabel === "string") {
      teacherLabelLocal.value = saved.teacherLabel;
    }
    if (Object.prototype.hasOwnProperty.call(saved, "defaultTeacherId")) {
      defaultTeacherIdLocal.value = saved.defaultTeacherId ?? "";
      lastSavedDefaultTeacherId.value = defaultTeacherIdLocal.value;
    }
    if (Object.prototype.hasOwnProperty.call(saved, "defaultLessonTypeId")) {
      defaultLessonTypeIdLocal.value = saved.defaultLessonTypeId ?? "";
      lastSavedDefaultLessonTypeId.value = defaultLessonTypeIdLocal.value;
    }
    await refreshSession();
    setInfo("Mandanten-Einstellungen gespeichert");
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    setError(err.data?.data?.message || err.data?.message || err.statusMessage || "Speichern fehlgeschlagen");
    useDefaultDurationLocal.value = primaryTenant.value?.useDefaultDuration ?? true;
    resourcesEnabledLocal.value = primaryTenant.value?.resourcesEnabled ?? true;
    speechRecognitionEnabledLocal.value = primaryTenant.value?.speechRecognitionEnabled ?? false;
    autoCompleteAppointmentsLocal.value = primaryTenant.value?.autoCompleteAppointments ?? false;
    autoCompleteAfterMinutesLocal.value = primaryTenant.value?.autoCompleteAfterMinutes ?? 0;
    teacherLabelLocal.value = primaryTenant.value?.teacherLabel?.trim() || "Lehrer";
    defaultTeacherIdLocal.value = lastSavedDefaultTeacherId.value;
    defaultLessonTypeIdLocal.value = lastSavedDefaultLessonTypeId.value;
  } finally {
    tenantSettingsSaving.value = false;
  }
}

function saveTeacherLabel() {
  const next = teacherLabelLocal.value.trim() || "Lehrer";
  teacherLabelLocal.value = next;
  if (next === (primaryTenant.value?.teacherLabel?.trim() || "Lehrer")) return;
  saveTenantSettings({ teacherLabel: next });
}

const tabs = computed(() => {
  const items = [{ id: "account", label: t("settings.tabs.account"), icon: "i-lucide-user" }];
  if (canEdit.value) {
    items.push(
      { id: "lesson-types", label: t("settings.tabs.lessonTypes"), icon: "i-lucide-tag" },
      { id: "availability", label: t("settings.tabs.availability"), icon: "i-lucide-clock" },
    );
  }
  if (isSuperadmin.value) {
    items.push({ id: "users", label: t("settings.tabs.users"), icon: "i-lucide-users" });
  }
  return items;
});
const activeTab = ref("account");

const info = ref("");
const error = ref("");

function setInfo(msg: string) {
  info.value = msg;
  error.value = "";
}
function setError(msg: string) {
  error.value = msg;
  info.value = "";
}
async function saveNextDayBriefing(enabled: boolean) {
  nextDayBriefingEnabledLocal.value = enabled;
  briefingSaving.value = true;
  try {
    session.value = await $fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      body: { nextDayBriefingEnabled: enabled },
    });
    setInfo(
      enabled
        ? "Vortags-Info aktiv – um 8 Uhr, wenn morgen Termine anstehen."
        : "Vortags-Info deaktiviert.",
    );
  } catch (e: unknown) {
    nextDayBriefingEnabledLocal.value = user.value?.nextDayBriefingEnabled !== false;
    setError(apiMessage(e, "Einstellung konnte nicht gespeichert werden"));
  } finally {
    briefingSaving.value = false;
  }
}
async function toggleCallHints(enabled: boolean) {
  callHintsSaving.value = true;
  try {
    await setCallHintsOptIn(enabled);
    callHintsEnabled.value = enabled && isCallHintsOptIn();
    setInfo(
      callHintsEnabled.value
        ? "Letzte Anrufe werden nur lokal als Vorschlag genutzt — nicht an den Server gesendet."
        : "Vorschläge aus der Anrufliste sind deaktiviert.",
    );
  } catch (e: unknown) {
    callHintsEnabled.value = false;
    setError(e instanceof Error ? e.message : "Anrufliste konnte nicht aktiviert werden");
  } finally {
    callHintsSaving.value = false;
  }
}
function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

const lessonTypes = ref<LessonType[]>([]);
const lessonTypeForm = reactive({ id: "", name: "", defaultDurationMin: 60 as number | "" });
const lessonTypeLoading = ref(false);

async function loadLessonTypes() {
  if (!primaryTenant.value?.tenantId) return;
  lessonTypeLoading.value = true;
  try {
    const response = await $fetch<{ data: LessonType[] }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types`,
      { credentials: "include" },
    );
    lessonTypes.value = response.data;
  } catch (e: unknown) {
    setError(apiMessage(e, "Termintypen konnten nicht geladen werden"));
  } finally {
    lessonTypeLoading.value = false;
  }
}

function selectLessonType(item: LessonType) {
  lessonTypeForm.id = item.id;
  lessonTypeForm.name = item.name;
  lessonTypeForm.defaultDurationMin = item.defaultDurationMin ?? "";
}
function resetLessonTypeForm() {
  lessonTypeForm.id = "";
  lessonTypeForm.name = "";
  lessonTypeForm.defaultDurationMin = 60;
}

async function saveLessonType() {
  if (!primaryTenant.value?.tenantId) return;
  if (!lessonTypeForm.name.trim()) {
    setError("Name ist erforderlich");
    return;
  }
  lessonTypeLoading.value = true;
  try {
    const body = {
      name: lessonTypeForm.name,
      defaultDurationMin:
        lessonTypeForm.defaultDurationMin === "" ? null : Number(lessonTypeForm.defaultDurationMin),
    };
    if (lessonTypeForm.id) {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types/${lessonTypeForm.id}`, {
        method: "PATCH",
        credentials: "include",
        body,
      });
      setInfo("Termintyp aktualisiert");
    } else {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types`, {
        method: "POST",
        credentials: "include",
        body,
      });
      setInfo("Termintyp angelegt");
    }
    resetLessonTypeForm();
    await loadLessonTypes();
  } catch (e: unknown) {
    setError(apiMessage(e, "Termintyp konnte nicht gespeichert werden"));
  } finally {
    lessonTypeLoading.value = false;
  }
}

async function deleteLessonType(item: LessonType) {
  if (!primaryTenant.value?.tenantId) return;
  if (!confirm(`Termintyp „${item.name}“ löschen? Er kann im Papierkorb wiederhergestellt werden.`)) return;
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types/${item.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    setInfo("Termintyp gelöscht");
    if (lessonTypeForm.id === item.id) resetLessonTypeForm();
    await loadLessonTypes();
  } catch (e: unknown) {
    setError(apiMessage(e, "Termintyp konnte nicht gelöscht werden"));
  }
}

const teachers = ref<TeacherOption[]>([]);
const selectedTeacherId = ref("");
const rules = ref<AvailabilityRule[]>([]);
const ruleForm = reactive({
  id: "",
  weekdays: [1, 2, 3, 4, 5] as number[],
  startTime: "09:00",
  endTime: "17:00",
  kind: "available" as "available" | "unavailable",
  allDay: false,
  priority: 0,
});
const rulesLoading = ref(false);
const weekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdayPresets = [
  { label: "Mo–Fr", days: [1, 2, 3, 4, 5] },
  { label: "Wochenende", days: [6, 0] },
  { label: "Alle", days: [1, 2, 3, 4, 5, 6, 0] },
];

function orderedWeekdays(days: number[]): number[] {
  const unique = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return weekdayOrder.filter((day) => unique.includes(day));
}

function formatWeekdays(days: number[]): string {
  const ordered = orderedWeekdays(days);
  if (!ordered.length) return "";
  const ranges: string[] = [];
  let from = ordered[0];
  let prev = ordered[0];
  const flush = (start: number, end: number) => {
    ranges.push(start === end ? weekdayLabels[start] : `${weekdayLabels[start]}–${weekdayLabels[end]}`);
  };
  for (let i = 1; i < ordered.length; i += 1) {
    const day = ordered[i];
    if (weekdayOrder.indexOf(day) === weekdayOrder.indexOf(prev) + 1) {
      prev = day;
      continue;
    }
    flush(from, prev);
    from = day;
    prev = day;
  }
  flush(from, prev);
  return ranges.join(", ");
}

function ruleDays(item: AvailabilityRule): number[] {
  return item.weekdays?.length ? item.weekdays : [item.weekday];
}

function ruleTimeLabel(item: AvailabilityRule): string {
  if (item.allDay || (item.kind === "unavailable" && item.startTime === "00:00" && item.endTime === "23:59")) {
    return "ganzer Tag";
  }
  return `${item.startTime}–${item.endTime}`;
}

function toggleWeekday(day: number) {
  const index = ruleForm.weekdays.indexOf(day);
  if (index >= 0) {
    ruleForm.weekdays.splice(index, 1);
  } else {
    ruleForm.weekdays.push(day);
  }
}

function setWeekdays(days: number[]) {
  ruleForm.weekdays = [...days];
}

function selectedWeekdays(): number[] {
  return orderedWeekdays(ruleForm.weekdays);
}

async function loadTeachers() {
  if (!primaryTenant.value?.tenantId) return;
  try {
    const response = await $fetch<{
      teachers: TeacherOption[];
      defaultTeacherId?: string | null;
      defaultLessonTypeId?: string | null;
    }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/scheduling/options`,
      { credentials: "include" },
    );
    teachers.value = response.teachers;
    defaultTeacherIdLocal.value = response.defaultTeacherId ?? "";
    lastSavedDefaultTeacherId.value = defaultTeacherIdLocal.value;
    defaultLessonTypeIdLocal.value = response.defaultLessonTypeId ?? "";
    lastSavedDefaultLessonTypeId.value = defaultLessonTypeIdLocal.value;
    if (!selectedTeacherId.value && teachers.value[0]) {
      selectedTeacherId.value = teachers.value[0].id;
    }
  } catch (e: unknown) {
    setError(apiMessage(e, `${teacherLabelLocal.value} konnten nicht geladen werden`));
  }
}

async function loadRules() {
  if (!primaryTenant.value?.tenantId || !selectedTeacherId.value) {
    rules.value = [];
    return;
  }
  rulesLoading.value = true;
  try {
    const response = await $fetch<{ data: AvailabilityRule[] }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/teachers/${selectedTeacherId.value}/availability/rules`,
      { credentials: "include" },
    );
    rules.value = response.data;
  } catch (e: unknown) {
    setError(apiMessage(e, "Verfügbarkeit konnte nicht geladen werden"));
  } finally {
    rulesLoading.value = false;
  }
}

function selectRule(item: AvailabilityRule) {
  ruleForm.id = item.id;
  ruleForm.weekdays = ruleDays(item);
  ruleForm.startTime = item.startTime;
  ruleForm.endTime = item.endTime;
  ruleForm.kind = item.kind === "unavailable" ? "unavailable" : "available";
  ruleForm.allDay = Boolean(item.allDay);
  ruleForm.priority = item.priority;
}
function resetRuleForm() {
  ruleForm.id = "";
  ruleForm.weekdays = [1, 2, 3, 4, 5];
  ruleForm.startTime = "09:00";
  ruleForm.endTime = "17:00";
  ruleForm.kind = "available";
  ruleForm.allDay = false;
  ruleForm.priority = 0;
}

function setRuleKind(kind: "available" | "unavailable") {
  ruleForm.kind = kind;
  if (kind === "available") {
    ruleForm.allDay = false;
    if (ruleForm.startTime === "00:00" && ruleForm.endTime === "23:59") {
      ruleForm.startTime = "09:00";
      ruleForm.endTime = "17:00";
    }
  }
}

async function saveRule() {
  if (!primaryTenant.value?.tenantId || !selectedTeacherId.value) return;
  const days = selectedWeekdays();
  if (!days.length) {
    setError("Mindestens einen Wochentag wählen");
    return;
  }
  rulesLoading.value = true;
  try {
    const base = `/api/v1/tenants/${primaryTenant.value.tenantId}/teachers/${selectedTeacherId.value}/availability/rules`;
    const allDay = ruleForm.kind === "unavailable" && ruleForm.allDay;
    const body = {
      weekdays: days,
      startTime: allDay ? "00:00" : ruleForm.startTime,
      endTime: allDay ? "23:59" : ruleForm.endTime,
      kind: ruleForm.kind,
      allDay,
      priority: Number(ruleForm.priority) || 0,
    };
    if (ruleForm.id) {
      await $fetch(`${base}/${ruleForm.id}`, {
        method: "PATCH",
        credentials: "include",
        body,
      });
      setInfo("Regel aktualisiert");
    } else {
      await $fetch(base, {
        method: "POST",
        credentials: "include",
        body,
      });
      setInfo(days.length > 1 ? `Regel für ${days.length} Tage angelegt` : "Regel angelegt");
    }
    resetRuleForm();
    await loadRules();
  } catch (e: unknown) {
    setError(apiMessage(e, "Regel konnte nicht gespeichert werden"));
  } finally {
    rulesLoading.value = false;
  }
}

async function deleteRule(item: AvailabilityRule) {
  if (!primaryTenant.value?.tenantId || !selectedTeacherId.value) return;
  const label = `${formatWeekdays(ruleDays(item))} · ${ruleTimeLabel(item)}`;
  if (!confirm(`Regel ${label} löschen?`)) return;
  try {
    await $fetch(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/teachers/${selectedTeacherId.value}/availability/rules/${item.id}`,
      { method: "DELETE", credentials: "include" },
    );
    setInfo("Regel gelöscht");
    if (ruleForm.id === item.id) resetRuleForm();
    await loadRules();
  } catch (e: unknown) {
    setError(apiMessage(e, "Regel konnte nicht gelöscht werden"));
  }
}

const overview = ref<SuperadminOverview | null>(null);
const overviewLoading = ref(false);
const tenantForm = reactive({ name: "", slug: "" });
const userForm = reactive({
  email: "",
  name: "",
  password: "",
  isSuperadmin: false,
  tenantId: "",
  role: "ADMIN" as TenantRole,
});
const membershipForm = reactive({ userId: "", tenantId: "", role: "STAFF" as TenantRole });
const userEditForm = reactive({ userId: "", name: "", password: "", isSuperadmin: false });
const roleOptions: TenantRole[] = ["ADMIN", "STAFF", "END_CUSTOMER"];

async function loadOverview() {
  if (!isSuperadmin.value) return;
  overviewLoading.value = true;
  try {
    overview.value = await $fetch<SuperadminOverview>("/api/admin/overview", { credentials: "include" });
  } catch (e: unknown) {
    setError(apiMessage(e, "Daten konnten nicht geladen werden"));
  } finally {
    overviewLoading.value = false;
  }
}

async function createTenant() {
  try {
    await $fetch("/api/admin/tenants", {
      method: "POST",
      credentials: "include",
      body: { name: tenantForm.name, slug: tenantForm.slug },
    });
    tenantForm.name = "";
    tenantForm.slug = "";
    setInfo("Mandant angelegt");
    await loadOverview();
  } catch (e: unknown) {
    setError(apiMessage(e, "Mandant konnte nicht angelegt werden"));
  }
}

async function createUser() {
  try {
    await $fetch("/api/admin/users", {
      method: "POST",
      credentials: "include",
      body: {
        email: userForm.email,
        name: userForm.name,
        password: userForm.password,
        isSuperadmin: userForm.isSuperadmin,
        tenantId: userForm.tenantId || undefined,
        role: userForm.tenantId ? userForm.role : undefined,
      },
    });
    userForm.email = "";
    userForm.name = "";
    userForm.password = "";
    userForm.isSuperadmin = false;
    userForm.tenantId = "";
    userForm.role = "ADMIN";
    setInfo("Benutzer angelegt");
    await loadOverview();
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzer konnte nicht angelegt werden"));
  }
}

async function grantMembership() {
  try {
    await $fetch("/api/admin/memberships", {
      method: "POST",
      credentials: "include",
      body: membershipForm,
    });
    membershipForm.userId = "";
    membershipForm.tenantId = "";
    membershipForm.role = "STAFF";
    setInfo("Mitgliedschaft gesetzt");
    await loadOverview();
  } catch (e: unknown) {
    setError(apiMessage(e, "Mitgliedschaft konnte nicht gesetzt werden"));
  }
}

function selectUserForEdit(id: string, name: string | null, superadmin: boolean) {
  userEditForm.userId = id;
  userEditForm.name = name ?? "";
  userEditForm.password = "";
  userEditForm.isSuperadmin = superadmin;
}

async function updateUser() {
  if (!userEditForm.userId) {
    setError("Bitte zuerst Benutzer aus der Liste auswählen");
    return;
  }
  try {
    await $fetch(`/api/admin/users/${userEditForm.userId}`, {
      method: "PATCH",
      credentials: "include",
      body: {
        name: userEditForm.name,
        password: userEditForm.password || undefined,
        isSuperadmin: userEditForm.isSuperadmin,
      },
    });
    userEditForm.password = "";
    setInfo("Benutzer aktualisiert");
    await loadOverview();
  } catch (e: unknown) {
    setError(apiMessage(e, "Benutzer konnte nicht aktualisiert werden"));
  }
}

watch(activeTab, async (tab) => {
  info.value = "";
  error.value = "";
  if (tab === "lesson-types") await loadLessonTypes();
  if (tab === "availability") {
    await loadTeachers();
    await loadRules();
  }
  if (tab === "users") await loadOverview();
});

watch(selectedTeacherId, () => {
  resetRuleForm();
  loadRules();
});

watch(canEdit, (ok) => {
  if (!ok && (activeTab.value === "lesson-types" || activeTab.value === "availability")) {
    activeTab.value = "account";
  }
});

onMounted(() => {
  if (canEdit.value) {
    loadLessonTypes();
    loadTeachers();
  }
  callHintsEnabled.value = isCallHintsOptIn();
  void refreshStatus();
});
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="space-y-2">
      <p class="text-sm text-muted font-medium">{{ $t("settings.breadcrumb") }}</p>
      <h1 class="font-display text-3xl sm:text-4xl">{{ $t("settings.title") }}</h1>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ $t("settings.subtitleAccount") }}
        <template v-if="canEdit">
          {{ $t("settings.subtitleTenantOptions") }}
          <UBadge color="primary" variant="subtle" class="ml-1">
            {{ isSuperadmin ? $t("settings.roles.superadmin") : $t("settings.roles.admin") }}
          </UBadge>
        </template>
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <div class="flex flex-wrap gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-2">
      <UButton
        v-for="tab in tabs"
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

    <section v-if="activeTab === 'account'" class="grid gap-4 lg:grid-cols-2">
      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium">{{ $t("settings.language.title") }}</h2></template>
        <div class="space-y-2 text-sm">
          <p class="text-xs text-neutral-500">{{ $t("settings.language.description") }}</p>
          <select
            class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            :value="locale"
            @change="onLocaleChange"
          >
            <option v-for="loc in locales" :key="loc.code" :value="loc.code">
              {{ $t(`languages.${loc.code}`) }}
            </option>
          </select>
        </div>
      </UCard>
      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium">{{ $t("theme.title") }}</h2></template>
        <div class="space-y-2 text-sm">
          <p class="text-xs text-neutral-500">{{ $t("theme.description") }}</p>
          <ThemeSwitcher class="max-w-md" />
        </div>
      </UCard>
      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium">Benachrichtigungen</h2></template>
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-medium">Termine am nächsten Tag</p>
            <p class="text-xs text-neutral-500 mt-1">
              Um 20 Uhr eine Übersicht für den nächsten Tag, wenn du eigene Termine hast — wie viele und wann.
              Standardmäßig aktiv.
            </p>
          </div>
          <label class="relative inline-flex items-center shrink-0 mt-1 cursor-pointer">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="nextDayBriefingEnabledLocal"
              :disabled="briefingSaving"
              @change="saveNextDayBriefing(!nextDayBriefingEnabledLocal)"
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>
      </UCard>
      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium">Dieses Gerät</h2></template>
        <div class="space-y-4 text-sm">
          <p>
            <span class="text-neutral-500">Umgebung:</span>
            {{
              device.platform === "android"
                ? "Android-App"
                : device.platform === "ios"
                  ? "iOS-App"
                  : "Browser"
            }}
          </p>
          <div class="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <p class="font-medium">WhatsApp-App</p>
            <p class="text-xs text-neutral-500">
              Welche App beim Tippen auf WhatsApp geöffnet wird. WhatsApp Business wird in der Android-App direkt
              gestartet und muss installiert sein.
            </p>
            <select
              class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              :value="whatsappApp"
              @change="onWhatsAppAppChange"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="business">WhatsApp Business</option>
            </select>
          </div>
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-medium">Letzte Anrufe als Telefon-Vorschlag</p>
              <p class="text-xs text-neutral-500 mt-1">
                Nur in der Android-App, nur nach Opt-in. Nummern bleiben auf dem Gerät und werden nicht an den Server
                geschickt. Unter iOS und im Browser nicht verfügbar.
              </p>
            </div>
            <label class="relative inline-flex items-center shrink-0 mt-1" :class="device.features.callHints ? 'cursor-pointer' : 'opacity-50'">
              <input
                type="checkbox"
                class="sr-only peer"
                :checked="callHintsEnabled"
                :disabled="!device.features.callHints || callHintsSaving"
                @change="toggleCallHints(!callHintsEnabled)"
              />
              <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
            </label>
          </div>
          <div v-if="isNative" class="space-y-3 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <p class="font-medium">{{ speechRecognitionEnabled ? "Mikrofon & Kontakte" : "Kontakte" }}</p>
            <p class="text-xs text-neutral-500">
              <template v-if="speechRecognitionEnabled">Spracheingabe und Adressbuch. </template>
              <template v-else>Adressbuch. </template>
              Kontakte werden lokal gespeichert (Organisation: {{ primaryTenant?.tenantName || "Mandant" }}), nicht im Google-Konto.
            </p>
            <ul class="text-sm space-y-1">
              <li v-if="speechRecognitionEnabled" class="flex items-center justify-between gap-3">
                <span>Mikrofon</span>
                <UBadge :color="microphoneGranted ? 'success' : 'neutral'" variant="subtle">
                  {{ microphoneGranted ? "Erlaubt" : "Nicht erlaubt" }}
                </UBadge>
              </li>
              <li class="flex items-center justify-between gap-3">
                <span>Kontakte</span>
                <UBadge :color="contactsGranted ? 'success' : 'neutral'" variant="subtle">
                  {{ contactsGranted ? "Erlaubt" : "Nicht erlaubt" }}
                </UBadge>
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <UButton
                type="button"
                size="sm"
                color="primary"
                icon="i-lucide-shield-check"
                :loading="permissionsRequesting"
                :disabled="allGranted || permissionsRequesting"
                @click="requestNow"
              >
                Jetzt erlauben
              </UButton>
              <UButton
                v-if="anyDenied || !allGranted"
                type="button"
                size="sm"
                variant="soft"
                color="neutral"
                icon="i-lucide-settings-2"
                @click="openAppSettings"
              >
                App-Einstellungen
              </UButton>
            </div>
            <p v-if="permissionsError" class="text-xs text-red-600 dark:text-red-400">{{ permissionsError }}</p>
          </div>
          <p v-else class="text-xs text-neutral-500">
            Kontakte speichern: in der App direkt ins Adressbuch, im Browser als vCard-Download.
          </p>
        </div>
      </UCard>
      <UCard>
        <template #header><h2 class="font-medium">Account</h2></template>
        <div class="space-y-2 text-sm">
          <p><span class="text-neutral-500">Name:</span> {{ user?.name || "—" }}</p>
          <p><span class="text-neutral-500">E-Mail:</span> {{ user?.email || "—" }}</p>
          <p>
            <span class="text-neutral-500">Rolle:</span>
            {{ user?.isSuperadmin ? "Superadmin" : "Standard" }}
          </p>
        </div>
      </UCard>
      <UCard>
        <template #header><h2 class="font-medium">Mandant</h2></template>
        <div class="space-y-2 text-sm">
          <p><span class="text-neutral-500">Aktiver Mandant:</span> {{ primaryTenant?.tenantName || "—" }}</p>
          <p><span class="text-neutral-500">Slug:</span> {{ primaryTenant?.tenantSlug || "—" }}</p>
          <p><span class="text-neutral-500">Rolle:</span> {{ primaryTenant?.role || "—" }}</p>
        </div>
      </UCard>

      <UCard v-if="canEdit" class="lg:col-span-2">
        <template #header><h2 class="font-medium">Mandanten-Optionen</h2></template>
        <div class="flex items-start justify-between gap-4">
          <div class="text-sm">
            <p class="font-medium">Standard-Dauer für Termintypen verwenden</p>
            <p class="text-xs text-neutral-500 mt-1">
              Wenn deaktiviert, hat ein Termintyp keine Standard-Dauer. Die Termin-Dauer wird pro Termin manuell gesetzt.
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="useDefaultDurationLocal"
              :disabled="!canEdit || tenantSettingsSaving"
              @change="
                () => {
                  useDefaultDurationLocal = !useDefaultDurationLocal;
                  saveTenantSettings({ useDefaultDuration: useDefaultDurationLocal });
                }
              "
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>

        <div class="flex items-start justify-between gap-4 mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div class="text-sm">
            <p class="font-medium">Ressource bei Terminen verwenden</p>
            <p class="text-xs text-neutral-500 mt-1">
              Wenn deaktiviert, wird bei Terminen keine Ressource zugeordnet (z. B. Raum oder Flugzeug).
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="resourcesEnabledLocal"
              :disabled="!canEdit || tenantSettingsSaving"
              @change="
                () => {
                  resourcesEnabledLocal = !resourcesEnabledLocal;
                  saveTenantSettings({ resourcesEnabled: resourcesEnabledLocal });
                }
              "
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>

        <div class="flex items-start justify-between gap-4 mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div class="text-sm">
            <p class="font-medium">Spracherkennung</p>
            <p class="text-xs text-neutral-500 mt-1">
              Standardmäßig aus. Wenn aktiviert, startet die Spracheingabe in der Schnellerfassung automatisch.
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="speechRecognitionEnabledLocal"
              :disabled="!canEdit || tenantSettingsSaving"
              @change="
                () => {
                  speechRecognitionEnabledLocal = !speechRecognitionEnabledLocal;
                  saveTenantSettings({ speechRecognitionEnabled: speechRecognitionEnabledLocal });
                }
              "
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>

        <div class="flex items-start justify-between gap-4 mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div class="text-sm min-w-0">
            <p class="font-medium">Termine automatisch als erledigt markieren</p>
            <p class="text-xs text-neutral-500 mt-1">
              Gilt für alle Benutzer. Offene Termine werden erledigt, sobald das Ende plus die angegebene Zeit vorbei ist.
            </p>
            <UFormField
              v-if="autoCompleteAppointmentsLocal"
              label="Minuten nach Terminende"
              class="mt-3 max-w-xs"
            >
              <UInput
                v-model.number="autoCompleteAfterMinutesLocal"
                type="number"
                min="0"
                max="1440"
                :disabled="!canEdit || tenantSettingsSaving"
                @blur="
                  saveTenantSettings({
                    autoCompleteAppointments: true,
                    autoCompleteAfterMinutes: Math.max(0, Math.min(1440, Number(autoCompleteAfterMinutesLocal) || 0)),
                  })
                "
              />
            </UFormField>
          </div>
          <label class="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="autoCompleteAppointmentsLocal"
              :disabled="!canEdit || tenantSettingsSaving"
              @change="
                () => {
                  autoCompleteAppointmentsLocal = !autoCompleteAppointmentsLocal;
                  saveTenantSettings({ autoCompleteAppointments: autoCompleteAppointmentsLocal });
                }
              "
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>

        <div class="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          <p class="font-medium text-sm">Bezeichnung der Rolle</p>
          <p class="text-xs text-neutral-500">
            Wird in der Schnellerfassung und bei Terminen angezeigt. z. B. Lehrer, Pilot, Trainer.
          </p>
          <UInput
            v-model="teacherLabelLocal"
            class="max-w-md"
            maxlength="40"
            placeholder="Lehrer"
            :disabled="!canEdit || tenantSettingsSaving"
            @blur="saveTeacherLabel"
            @keydown.enter.prevent="saveTeacherLabel"
          />
        </div>

        <div class="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          <p class="font-medium text-sm">Standard-{{ teacherLabelLocal }} für Schnellerfassung</p>
          <p class="text-xs text-neutral-500">
            Wird beim Anlegen eines Termins über die Schnellerfassung vorausgewählt. Ohne Auswahl bleibt der erste
            {{ teacherLabelLocal }} vorausgewählt.
          </p>
          <select
            v-model="defaultTeacherIdLocal"
            class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            :disabled="!canEdit || tenantSettingsSaving"
            @change="saveTenantSettings({ defaultTeacherId: defaultTeacherIdLocal || null })"
          >
            <option value="">Kein Standard (erster {{ teacherLabelLocal }})</option>
            <option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.displayName }}</option>
          </select>
        </div>

        <div class="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          <p class="font-medium text-sm">Standard-Terminart für Schnellerfassung</p>
          <p class="text-xs text-neutral-500">
            Wird beim Anlegen eines Termins über die Schnellerfassung vorausgewählt. Ohne Auswahl bleibt die erste
            Terminart vorausgewählt.
          </p>
          <select
            v-model="defaultLessonTypeIdLocal"
            class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            :disabled="!canEdit || tenantSettingsSaving"
            @change="saveTenantSettings({ defaultLessonTypeId: defaultLessonTypeIdLocal || null })"
          >
            <option value="">Kein Standard (erste Terminart)</option>
            <option v-for="item in lessonTypes" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </div>
      </UCard>
    </section>

    <section v-else-if="activeTab === 'lesson-types' && canEdit" class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-medium">Termintypen ({{ lessonTypes.length }})</h2>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="lessonTypeLoading" @click="loadLessonTypes" />
          </div>
        </template>
        <div v-if="!lessonTypes.length" class="text-sm text-neutral-500">Noch keine Termintypen angelegt.</div>
        <div v-else class="divide-y divide-neutral-200 dark:divide-neutral-800">
          <div v-for="item in lessonTypes" :key="item.id" class="flex items-center justify-between py-2 gap-3">
            <div>
              <p class="font-medium">{{ item.name }}</p>
              <p v-if="useDefaultDurationLocal" class="text-xs text-neutral-500">
                Standard-Dauer: {{ item.defaultDurationMin ? `${item.defaultDurationMin} Min` : "—" }}
              </p>
            </div>
            <div class="flex gap-1">
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" :disabled="!canEdit" @click="selectLessonType(item)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="!canEdit" @click="deleteLessonType(item)" />
            </div>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">{{ lessonTypeForm.id ? "Termintyp bearbeiten" : "Neuer Termintyp" }}</h2>
        </template>
        <form class="space-y-3" @submit.prevent="saveLessonType">
          <UFormField label="Name">
            <UInput v-model="lessonTypeForm.name" placeholder="z. B. Einzelstunde" :disabled="!canEdit" />
          </UFormField>
          <UFormField v-if="useDefaultDurationLocal" label="Standard-Dauer (Minuten)" hint="leer = keine Vorgabe">
            <UInput v-model.number="lessonTypeForm.defaultDurationMin" type="number" min="5" max="1440" :disabled="!canEdit" />
          </UFormField>
          <p v-else class="text-xs text-neutral-500">
            Dauer ist für diesen Mandanten deaktiviert (Tab „Account" → Mandanten-Optionen).
          </p>
          <div class="flex gap-2">
            <UButton type="submit" color="primary" :loading="lessonTypeLoading" :disabled="!canEdit">
              {{ lessonTypeForm.id ? "Speichern" : "Anlegen" }}
            </UButton>
            <UButton v-if="lessonTypeForm.id" variant="ghost" color="neutral" @click="resetLessonTypeForm">
              Abbrechen
            </UButton>
          </div>
        </form>
      </UCard>
    </section>

    <section v-else-if="activeTab === 'availability' && canEdit" class="space-y-4">
      <UCard>
        <template #header><h2 class="font-medium">{{ teacherLabelLocal }} wählen</h2></template>
        <div v-if="!teachers.length" class="text-sm text-neutral-500">Noch keine {{ teacherLabelLocal }} hinterlegt.</div>
        <select
          v-else
          v-model="selectedTeacherId"
          class="w-full max-w-md rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.displayName }}</option>
        </select>
      </UCard>

      <div class="grid gap-4 lg:grid-cols-3">
        <UCard class="lg:col-span-2">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="font-medium">Standard-Uhrzeiten ({{ rules.length }})</h2>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="rulesLoading" @click="loadRules" />
            </div>
          </template>
          <div v-if="!rules.length" class="text-sm text-neutral-500">
            Noch keine Standard-Uhrzeiten für diesen {{ teacherLabelLocal }}.
          </div>
          <div v-else class="divide-y divide-neutral-200 dark:divide-neutral-800">
            <div v-for="item in rules" :key="item.id" class="flex items-center justify-between py-2 gap-3">
              <div>
                <p class="font-medium" :class="item.kind === 'unavailable' ? 'text-red-600 dark:text-red-400' : ''">
                  {{ formatWeekdays(ruleDays(item)) }} · {{ ruleTimeLabel(item) }}
                </p>
                <p class="text-xs text-neutral-500">
                  {{ item.kind === "unavailable" ? "Nicht verfügbar" : "Verfügbar" }}
                  <span v-if="item.kind !== 'unavailable'"> · Priorität {{ item.priority }}</span>
                </p>
              </div>
              <div class="flex gap-1">
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" :disabled="!canEdit" @click="selectRule(item)" />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="!canEdit" @click="deleteRule(item)" />
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">{{ ruleForm.id ? "Regel bearbeiten" : "Neue Regel" }}</h2>
          </template>
          <form class="space-y-3" @submit.prevent="saveRule">
            <UFormField label="Art">
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
                  :class="
                    ruleForm.kind === 'available'
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
                  "
                  :disabled="!canEdit"
                  @click="setRuleKind('available')"
                >
                  Verfügbar
                </button>
                <button
                  type="button"
                  class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
                  :class="
                    ruleForm.kind === 'unavailable'
                      ? 'border-red-500 bg-red-500 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
                  "
                  :disabled="!canEdit"
                  @click="setRuleKind('unavailable')"
                >
                  Nicht verfügbar
                </button>
              </div>
              <p class="mt-1 text-xs text-neutral-500">
                Mehrere Tage bleiben eine Regel. „Nicht verfügbar“ blockiert ganze Tage oder einzelne Stunden.
              </p>
            </UFormField>
            <UFormField label="Wochentage">
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="day in weekdayOrder"
                  :key="day"
                  type="button"
                  class="min-w-10 rounded-md border px-2 py-1.5 text-sm font-medium transition"
                  :class="
                    ruleForm.weekdays.includes(day)
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
                  "
                  :disabled="!canEdit"
                  @click="toggleWeekday(day)"
                >
                  {{ weekdayLabels[day] }}
                </button>
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                <UButton
                  v-for="preset in weekdayPresets"
                  :key="preset.label"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :disabled="!canEdit"
                  @click="setWeekdays(preset.days)"
                >
                  {{ preset.label }}
                </UButton>
              </div>
            </UFormField>
            <label
              v-if="ruleForm.kind === 'unavailable'"
              class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
            >
              <input v-model="ruleForm.allDay" type="checkbox" :disabled="!canEdit" />
              Ganzer Tag
            </label>
            <div v-if="!(ruleForm.kind === 'unavailable' && ruleForm.allDay)" class="grid grid-cols-2 gap-2">
              <UFormField label="Von">
                <UInput v-model="ruleForm.startTime" type="time" :disabled="!canEdit" />
              </UFormField>
              <UFormField label="Bis">
                <UInput v-model="ruleForm.endTime" type="time" :disabled="!canEdit" />
              </UFormField>
            </div>
            <UFormField
              v-if="ruleForm.kind === 'available'"
              label="Priorität"
              hint="Höhere Zahl = wird zuerst als nächster freier Termin vorgeschlagen"
            >
              <UInput v-model.number="ruleForm.priority" type="number" :disabled="!canEdit" />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" color="primary" :loading="rulesLoading" :disabled="!canEdit || !selectedTeacherId">
                {{ ruleForm.id ? "Speichern" : "Anlegen" }}
              </UButton>
              <UButton v-if="ruleForm.id" variant="ghost" color="neutral" @click="resetRuleForm">
                Abbrechen
              </UButton>
            </div>
          </form>
        </UCard>
      </div>
    </section>

    <section v-else-if="activeTab === 'users' && isSuperadmin" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">Benutzer & Mandanten</h2>
        <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-refresh-cw" :loading="overviewLoading" @click="loadOverview">
          Neu laden
        </UButton>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <template #header><h3 class="font-medium">Mandant anlegen</h3></template>
          <form class="space-y-3" @submit.prevent="createTenant">
            <UInput v-model="tenantForm.name" placeholder="Tenant Name" />
            <UInput v-model="tenantForm.slug" placeholder="tenant-slug" />
            <UButton type="submit" color="primary" :loading="overviewLoading">Mandant erstellen</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><h3 class="font-medium">Benutzer anlegen</h3></template>
          <form class="space-y-3" @submit.prevent="createUser">
            <UInput v-model="userForm.email" type="email" placeholder="email@domain.tld" />
            <UInput v-model="userForm.name" placeholder="Name (optional)" />
            <UInput v-model="userForm.password" type="password" placeholder="Passwort" />
            <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input v-model="userForm.isSuperadmin" type="checkbox" />
              Superadmin-Rechte
            </label>
            <div class="grid gap-2 sm:grid-cols-2">
              <select
                v-model="userForm.tenantId"
                class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              >
                <option value="">Ohne Mandant</option>
                <option v-for="t in overview?.tenants || []" :key="t.id" :value="t.id">
                  {{ t.name }} ({{ t.slug }})
                </option>
              </select>
              <select
                v-model="userForm.role"
                class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              >
                <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
              </select>
            </div>
            <UButton type="submit" color="primary" :loading="overviewLoading">Benutzer erstellen</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><h3 class="font-medium">Mitgliedschaft zuweisen</h3></template>
          <form class="space-y-3" @submit.prevent="grantMembership">
            <select
              v-model="membershipForm.userId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">Benutzer wählen</option>
              <option v-for="u in overview?.users || []" :key="u.id" :value="u.id">{{ u.email }}</option>
            </select>
            <select
              v-model="membershipForm.tenantId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">Mandant wählen</option>
              <option v-for="t in overview?.tenants || []" :key="t.id" :value="t.id">
                {{ t.name }} ({{ t.slug }})
              </option>
            </select>
            <select
              v-model="membershipForm.role"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
            </select>
            <UButton type="submit" color="primary" :loading="overviewLoading">Zuweisen</UButton>
          </form>
        </UCard>

        <UCard>
          <template #header><h3 class="font-medium">Benutzer bearbeiten</h3></template>
          <form class="space-y-3" @submit.prevent="updateUser">
            <select
              v-model="userEditForm.userId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">Benutzer wählen</option>
              <option v-for="u in overview?.users || []" :key="u.id" :value="u.id">{{ u.email }}</option>
            </select>
            <UInput v-model="userEditForm.name" placeholder="Anzeigename (leer = null)" />
            <UInput v-model="userEditForm.password" type="password" placeholder="Neues Passwort (optional)" />
            <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input v-model="userEditForm.isSuperadmin" type="checkbox" />
              Superadmin-Rechte
            </label>
            <UButton type="submit" color="secondary" :loading="overviewLoading">Speichern</UButton>
          </form>
        </UCard>
      </div>

      <UCard>
        <template #header><h3 class="font-medium">Benutzer & Rechte</h3></template>
        <div v-if="!overview?.users?.length" class="text-sm text-neutral-500">Noch keine Benutzerdaten geladen.</div>
        <div v-else class="space-y-3">
          <div
            v-for="u in overview.users"
            :key="u.id"
            class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-medium">{{ u.name || u.email }}</p>
                <p class="text-xs text-neutral-500">{{ u.email }}</p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge v-if="u.isSuperadmin" color="secondary" variant="soft">SUPERADMIN</UBadge>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-pencil"
                  @click="selectUserForEdit(u.id, u.name, u.isSuperadmin)"
                >
                  Bearbeiten
                </UButton>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="m in u.memberships"
                :key="`${u.id}:${m.tenantId}:${m.role}`"
                color="primary"
                variant="subtle"
              >
                {{ m.tenantSlug }} · {{ m.role }}
              </UBadge>
              <span v-if="u.memberships.length === 0" class="text-xs text-neutral-500">keine Membership</span>
            </div>
          </div>
        </div>
      </UCard>
    </section>
  </UContainer>
</template>
