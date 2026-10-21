<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { $fetch } from "ofetch";
import { isCallHintsOptIn } from "@alpiplan/device-capabilities";
import { useWhatsAppPreference } from "../composables/useWhatsAppPreference";
import { DEFAULT_BRIEFING_MINUTES, formatBriefingTime, parseBriefingTime } from "../utils/rome-time";
import { normalizeUiScale, type UiScale } from "../utils/ui-scale";
import {
  disableWebPush,
  enableWebPush,
  webPushErrorDetail,
  webPushState,
  type WebPushState,
} from "../utils/web-push-registration";

interface LessonType {
  id: string;
  name: string;
  defaultDurationMin: number | null;
  teacherIds: string[];
}

interface TeacherOption {
  id: string;
  displayName: string;
  color?: string | null;
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
const nextDayBriefingTimeLocal = ref(formatBriefingTime(DEFAULT_BRIEFING_MINUTES));
const briefingSaving = ref(false);
const movedAlertsEnabledLocal = ref(true);
const movedAlertsSaving = ref(false);
const reminderEnabledLocal = ref(true);
const reminderSaving = ref(false);
const uiScaleLocal = ref<UiScale>("small");
const uiScaleSaving = ref(false);
watch(
  () => user.value?.uiScale,
  (value) => {
    uiScaleLocal.value = normalizeUiScale(value);
  },
  { immediate: true },
);
watch(
  () => user.value?.appointmentReminderEnabled,
  (value) => {
    reminderEnabledLocal.value = value !== false;
  },
  { immediate: true },
);
watch(
  () => user.value?.appointmentMovedAlertsEnabled,
  (value) => {
    movedAlertsEnabledLocal.value = value !== false;
  },
  { immediate: true },
);
const { whatsappApp, setWhatsAppApp } = useWhatsAppPreference();

watch(
  () => user.value?.nextDayBriefingEnabled,
  (value) => {
    nextDayBriefingEnabledLocal.value = value !== false;
  },
  { immediate: true },
);
watch(
  () => user.value?.nextDayBriefingMinutes,
  (value) => {
    nextDayBriefingTimeLocal.value = formatBriefingTime(value ?? DEFAULT_BRIEFING_MINUTES);
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

const ownTeacherId = computed(() => primaryTenant.value?.teacherProfileId ?? "");

const tabs = computed(() => {
  const items = [{ id: "account", label: t("settings.tabs.account"), icon: "i-lucide-user" }];
  if (ownTeacherId.value) {
    items.push({ id: "absences", label: t("settings.tabs.absences"), icon: "i-lucide-calendar-off" });
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
        ? `Vortags-Info aktiv – um ${nextDayBriefingTimeLocal.value} Uhr, wenn morgen Termine anstehen.`
        : "Vortags-Info deaktiviert.",
    );
  } catch (e: unknown) {
    nextDayBriefingEnabledLocal.value = user.value?.nextDayBriefingEnabled !== false;
    setError(apiMessage(e, "Einstellung konnte nicht gespeichert werden"));
  } finally {
    briefingSaving.value = false;
  }
}

async function saveUiScale(scale: UiScale) {
  uiScaleLocal.value = scale;
  uiScaleSaving.value = true;
  try {
    session.value = await $fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      body: { uiScale: scale },
    });
    setInfo(t("uiScale.saved"));
  } catch (e: unknown) {
    uiScaleLocal.value = normalizeUiScale(user.value?.uiScale);
    setError(apiMessage(e, "Einstellung konnte nicht gespeichert werden"));
  } finally {
    uiScaleSaving.value = false;
  }
}

async function saveReminder(enabled: boolean) {
  reminderEnabledLocal.value = enabled;
  reminderSaving.value = true;
  try {
    session.value = await $fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      body: { appointmentReminderEnabled: enabled },
    });
    setInfo(enabled ? "Erinnerung 15 Minuten vor deinen Terminen aktiv." : "Terminerinnerung deaktiviert.");
  } catch (e: unknown) {
    reminderEnabledLocal.value = user.value?.appointmentReminderEnabled !== false;
    setError(apiMessage(e, "Einstellung konnte nicht gespeichert werden"));
  } finally {
    reminderSaving.value = false;
  }
}

async function saveMovedAlerts(enabled: boolean) {
  movedAlertsEnabledLocal.value = enabled;
  movedAlertsSaving.value = true;
  try {
    session.value = await $fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      body: { appointmentMovedAlertsEnabled: enabled },
    });
    setInfo(
      enabled
        ? "Du wirst benachrichtigt, wenn jemand einen Termin verschiebt."
        : "Keine Benachrichtigung mehr bei verschobenen Terminen anderer.",
    );
  } catch (e: unknown) {
    movedAlertsEnabledLocal.value = user.value?.appointmentMovedAlertsEnabled !== false;
    setError(apiMessage(e, "Einstellung konnte nicht gespeichert werden"));
  } finally {
    movedAlertsSaving.value = false;
  }
}

async function saveNextDayBriefingTime() {
  const savedMinutes = user.value?.nextDayBriefingMinutes ?? DEFAULT_BRIEFING_MINUTES;
  const minutes = parseBriefingTime(nextDayBriefingTimeLocal.value);
  if (minutes === null) {
    nextDayBriefingTimeLocal.value = formatBriefingTime(savedMinutes);
    return;
  }
  if (minutes === savedMinutes) return;
  briefingSaving.value = true;
  try {
    session.value = await $fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      body: { nextDayBriefingMinutes: minutes },
    });
    setInfo(`Vortags-Info kommt ab jetzt um ${formatBriefingTime(minutes)} Uhr.`);
  } catch (e: unknown) {
    nextDayBriefingTimeLocal.value = formatBriefingTime(savedMinutes);
    setError(apiMessage(e, "Uhrzeit konnte nicht gespeichert werden"));
  } finally {
    briefingSaving.value = false;
  }
}

const webPush = ref<WebPushState | null>(null);
const webPushSaving = ref(false);

async function refreshWebPushState() {
  webPush.value = await webPushState();
}

async function toggleWebPush(enabled: boolean) {
  webPushSaving.value = true;
  try {
    if (enabled) {
      webPush.value = await enableWebPush();
      if (webPush.value === "subscribed") setInfo("Push auf diesem Gerät aktiv – auch wenn Alpiplan geschlossen ist.");
      else if (webPush.value === "denied") setError("Mitteilungen sind für Alpiplan blockiert – siehe Hinweis unter „Push auf diesem Gerät“.");
    } else {
      await disableWebPush();
      await refreshWebPushState();
      setInfo("Push auf diesem Gerät deaktiviert.");
    }
  } catch (e: unknown) {
    setError(apiMessage(e, `Push konnte nicht eingerichtet werden (${webPushErrorDetail(e)})`));
    await refreshWebPushState();
  } finally {
    webPushSaving.value = false;
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
        : "Anruf-Vorschläge sind deaktiviert.",
    );
  } catch (e: unknown) {
    callHintsEnabled.value = false;
    setError(e instanceof Error ? e.message : "Anruf-Vorschläge konnten nicht aktiviert werden");
  } finally {
    callHintsSaving.value = false;
  }
}
function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

const lessonTypes = ref<LessonType[]>([]);

async function loadLessonTypes() {
  if (!primaryTenant.value?.tenantId) return;
  try {
    const response = await $fetch<{ data: LessonType[] }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types`,
      { credentials: "include" },
    );
    lessonTypes.value = response.data;
  } catch (e: unknown) {
    setError(apiMessage(e, "Terminarten konnten nicht geladen werden"));
  }
}

const teachers = ref<TeacherOption[]>([]);

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
  } catch (e: unknown) {
    setError(apiMessage(e, `${teacherLabelLocal.value} konnten nicht geladen werden`));
  }
}

watch(activeTab, () => {
  info.value = "";
  error.value = "";
});

watch(ownTeacherId, (id) => {
  if (!id && activeTab.value === "absences") activeTab.value = "account";
});

onMounted(() => {
  if (canEdit.value) {
    loadLessonTypes();
    loadTeachers();
  }
  callHintsEnabled.value = isCallHintsOptIn();
  void refreshStatus();
  void refreshWebPushState();
  document.addEventListener("visibilitychange", onVisibilityChange);
});

function onVisibilityChange() {
  if (document.visibilityState === "visible" && !webPushSaving.value) void refreshWebPushState();
}

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
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
        <template #header><h2 class="font-medium">{{ $t("uiScale.title") }}</h2></template>
        <div class="space-y-2 text-sm">
          <p class="text-xs text-neutral-500">{{ $t("uiScale.description") }}</p>
          <UiScaleSwitcher
            :model-value="uiScaleLocal"
            :disabled="uiScaleSaving"
            @update:model-value="saveUiScale"
          />
        </div>
      </UCard>
      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium">Benachrichtigungen</h2></template>
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-medium">Termine am nächsten Tag</p>
            <p class="text-xs text-neutral-500 mt-1">
              Am Vorabend eine Übersicht für den nächsten Tag, wenn du eigene Termine hast — wie viele und wann.
              Standardmäßig aktiv, um 20:00 Uhr.
            </p>
            <UFormField v-if="nextDayBriefingEnabledLocal" label="Uhrzeit" class="mt-3 w-32">
              <UInput
                v-model="nextDayBriefingTimeLocal"
                type="time"
                :disabled="briefingSaving"
                @change="saveNextDayBriefingTime"
              />
            </UFormField>
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
        <div class="mt-4 flex items-start justify-between gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <div>
            <p class="font-medium">Erinnerung vor dem Termin</p>
            <p class="text-xs text-neutral-500 mt-1">
              15 Minuten vor deinen eigenen Terminen eine Benachrichtigung. Standardmäßig aktiv.
            </p>
          </div>
          <label class="relative inline-flex items-center shrink-0 mt-1 cursor-pointer">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="reminderEnabledLocal"
              :disabled="reminderSaving"
              @change="saveReminder(!reminderEnabledLocal)"
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>
        <div
          v-if="canManageTenant"
          class="mt-4 flex items-start justify-between gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800"
        >
          <div>
            <p class="font-medium">Verschobene Termine</p>
            <p class="text-xs text-neutral-500 mt-1">
              Als Admin eine Push-Nachricht, wenn jemand anderes einen Termin zeitlich oder auf eine andere Person
              verschiebt. Standardmäßig aktiv.
            </p>
          </div>
          <label class="relative inline-flex items-center shrink-0 mt-1 cursor-pointer">
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="movedAlertsEnabledLocal"
              :disabled="movedAlertsSaving"
              @change="saveMovedAlerts(!movedAlertsEnabledLocal)"
            />
            <div class="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500 dark:bg-neutral-700 dark:after:bg-neutral-200" />
          </label>
        </div>
        <div
          v-if="webPush && webPush !== 'unsupported'"
          class="mt-4 flex items-start justify-between gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800"
        >
          <div>
            <p class="font-medium">Push auf diesem Gerät</p>
            <p v-if="webPush === 'needs-install'" class="text-xs text-neutral-500 mt-1">
              Auf iPhone/iPad: in Safari <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong> antippen,
              Alpiplan dann über das neue Symbol öffnen und hier Push einschalten.
            </p>
            <p v-else-if="webPush === 'not-configured'" class="text-xs text-neutral-500 mt-1">
              Web-Push ist auf dem Server noch nicht eingerichtet.
            </p>
            <p v-else-if="webPush === 'denied'" class="text-xs text-neutral-500 mt-1">
              Mitteilungen sind blockiert. Auf iPhone/iPad: <strong>Einstellungen → Mitteilungen → Alpiplan</strong>
              → „Mitteilungen erlauben“. Fehlt Alpiplan dort, das Symbol vom Home-Bildschirm löschen, über Safari neu
              hinzufügen und Push erneut einschalten. Am Computer: Website-Einstellungen des Browsers.
            </p>
            <p v-else class="text-xs text-neutral-500 mt-1">
              Neue und verschobene Termine, Erinnerungen und die Vortags-Info — auch wenn Alpiplan geschlossen ist.
            </p>
          </div>
          <label
            v-if="webPush === 'default' || webPush === 'subscribed' || webPush === 'denied'"
            class="relative inline-flex items-center shrink-0 mt-1 cursor-pointer"
          >
            <input
              type="checkbox"
              class="sr-only peer"
              :checked="webPush === 'subscribed'"
              :disabled="webPushSaving"
              @change="toggleWebPush(webPush !== 'subscribed')"
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
                Nur in der Android-App (ab Android 10), nur nach Opt-in. Dafür wird Alpiplan als
                „Anrufer-ID- &amp; Spam-App“ eingestellt; Anrufe werden nicht blockiert. Vorgeschlagen werden
                Anrufe ab dann, auch der Anruf, der gerade läuft. Nummern bleiben auf dem Gerät und werden nicht
                an den Server geschickt. Unter iOS und im Browser nicht verfügbar.
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

    <section v-else-if="activeTab === 'absences' && ownTeacherId && primaryTenant" class="space-y-4">
      <p v-if="canEdit" class="text-sm text-neutral-600 dark:text-neutral-400">
        Hier trägst du deine eigenen Abwesenheiten ein. Für andere Personen und die Standard-Uhrzeiten:
        <NuxtLink to="/users?tab=absences" class="font-medium text-primary-700 hover:underline dark:text-primary-300">
          Benutzer → Urlaub & Freizeiten
        </NuxtLink>
      </p>
      <TeacherAbsencesPanel
        :tenant-id="primaryTenant.tenantId"
        :teacher-id="ownTeacherId"
        @info="setInfo"
        @error="setError"
      />
    </section>

    <AppVersionInfo />
  </UContainer>
</template>
