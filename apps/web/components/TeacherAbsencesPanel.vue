<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

type AbsenceType = "vacation" | "sick" | "block";

interface Absence {
  id: string;
  teacherId: string;
  type: AbsenceType | "extra_open";
  startsOn: string;
  endsOn: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

const props = defineProps<{
  tenantId: string;
  teacherId: string;
  /** Shown in the heading and hint; omit when the panel is about the signed-in user. */
  teacherName?: string;
}>();

const emit = defineEmits<{
  info: [message: string];
  error: [message: string];
}>();

const { intlLocale } = useAppLocale();

const absenceTypeOptions: { value: AbsenceType; label: string }[] = [
  { value: "vacation", label: "Urlaub" },
  { value: "block", label: "Frei" },
  { value: "sick", label: "Krank" },
];

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

const absences = ref<Absence[]>([]);
const loading = ref(false);
const showPast = ref(false);
const form = reactive({
  id: "",
  type: "vacation" as AbsenceType,
  startsOn: todayDateKey(),
  endsOn: todayDateKey(),
  allDay: true,
  startTime: "12:00",
  endTime: "14:00",
  reason: "",
});

const visibleAbsences = computed(() => {
  if (showPast.value) return absences.value;
  const today = todayDateKey();
  return absences.value.filter((item) => item.endsOn >= today);
});

const pastCount = computed(() => absences.value.length - visibleAbsences.value.length);

const basePath = computed(
  () => `/api/v1/tenants/${props.tenantId}/teachers/${props.teacherId}/availability/exceptions`,
);

function typeLabel(type: Absence["type"]) {
  if (type === "extra_open") return "Zusätzlich verfügbar";
  return absenceTypeOptions.find((option) => option.value === type)?.label ?? type;
}

function typeColor(type: Absence["type"]) {
  if (type === "vacation") return "primary" as const;
  if (type === "sick") return "error" as const;
  if (type === "extra_open") return "success" as const;
  return "warning" as const;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function rangeLabel(item: Absence) {
  const dates =
    item.startsOn === item.endsOn ? formatDate(item.startsOn) : `${formatDate(item.startsOn)} – ${formatDate(item.endsOn)}`;
  const time = item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : "ganzer Tag";
  return `${dates} · ${time}`;
}

async function load() {
  if (!props.tenantId || !props.teacherId) {
    absences.value = [];
    return;
  }
  loading.value = true;
  try {
    const response = await $fetch<{ data: Absence[] }>(basePath.value, { credentials: "include" });
    absences.value = response.data;
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Abwesenheiten konnten nicht geladen werden"));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.id = "";
  form.type = "vacation";
  form.startsOn = todayDateKey();
  form.endsOn = todayDateKey();
  form.allDay = true;
  form.startTime = "12:00";
  form.endTime = "14:00";
  form.reason = "";
}

function select(item: Absence) {
  form.id = item.id;
  form.type = item.type === "extra_open" ? "block" : item.type;
  form.startsOn = item.startsOn;
  form.endsOn = item.endsOn;
  form.allDay = !(item.startTime && item.endTime);
  form.startTime = item.startTime ?? "12:00";
  form.endTime = item.endTime ?? "14:00";
  form.reason = item.reason ?? "";
}

watch(
  () => form.startsOn,
  (startsOn) => {
    if (startsOn && (!form.endsOn || form.endsOn < startsOn)) form.endsOn = startsOn;
  },
);

async function save() {
  if (!props.tenantId || !props.teacherId) return;
  if (!form.startsOn || !form.endsOn) {
    emit("error", "Von- und Bis-Datum sind erforderlich");
    return;
  }
  if (!form.allDay && form.startTime >= form.endTime) {
    emit("error", "Bis-Uhrzeit muss nach der Von-Uhrzeit liegen");
    return;
  }
  loading.value = true;
  try {
    const body = {
      type: form.type,
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      startTime: form.allDay ? null : form.startTime,
      endTime: form.allDay ? null : form.endTime,
      reason: form.reason,
    };
    if (form.id) {
      await $fetch(`${basePath.value}/${form.id}`, { method: "PATCH", credentials: "include", body });
      emit("info", "Abwesenheit aktualisiert");
    } else {
      await $fetch(basePath.value, { method: "POST", credentials: "include", body });
      emit("info", "Abwesenheit eingetragen");
    }
    resetForm();
    await load();
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Abwesenheit konnte nicht gespeichert werden"));
  } finally {
    loading.value = false;
  }
}

async function remove(item: Absence) {
  if (!props.tenantId || !props.teacherId) return;
  if (!confirm(`${typeLabel(item.type)} ${rangeLabel(item)} löschen?`)) return;
  try {
    await $fetch(`${basePath.value}/${item.id}`, { method: "DELETE", credentials: "include" });
    emit("info", "Abwesenheit gelöscht");
    if (form.id === item.id) resetForm();
    await load();
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Abwesenheit konnte nicht gelöscht werden"));
  }
}

watch(
  () => [props.tenantId, props.teacherId],
  () => {
    resetForm();
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-3">
    <UCard class="lg:col-span-2">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium">
            Abwesenheiten
            <span v-if="teacherName" class="text-neutral-500 font-normal">· {{ teacherName }}</span>
          </h2>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
              <input v-model="showPast" type="checkbox" />
              Vergangene{{ pastCount && !showPast ? ` (${pastCount})` : "" }}
            </label>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="loading" @click="load" />
          </div>
        </div>
      </template>
      <div v-if="!visibleAbsences.length" class="text-sm text-neutral-500">
        Keine {{ showPast ? "" : "anstehenden " }}Abwesenheiten eingetragen.
      </div>
      <div v-else class="divide-y divide-neutral-200 dark:divide-neutral-800">
        <div v-for="item in visibleAbsences" :key="item.id" class="flex items-center justify-between py-2 gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <UBadge :color="typeColor(item.type)" variant="subtle" size="sm">
                {{ typeLabel(item.type) }}
              </UBadge>
              <p class="font-medium text-sm">{{ rangeLabel(item) }}</p>
            </div>
            <p v-if="item.reason" class="text-xs text-neutral-500 mt-0.5 truncate">{{ item.reason }}</p>
          </div>
          <div class="flex gap-1 shrink-0">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" @click="select(item)" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="remove(item)" />
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">{{ form.id ? "Abwesenheit bearbeiten" : "Abwesenheit eintragen" }}</h2>
      </template>
      <form class="space-y-3" @submit.prevent="save">
        <UFormField label="Art">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="option in absenceTypeOptions"
              :key="option.value"
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
              :class="
                form.type === option.value
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
              "
              @click="form.type = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </UFormField>
        <div class="grid grid-cols-2 gap-2">
          <UFormField label="Von Datum">
            <UInput v-model="form.startsOn" type="date" />
          </UFormField>
          <UFormField label="Bis Datum">
            <UInput v-model="form.endsOn" type="date" :min="form.startsOn" />
          </UFormField>
        </div>
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="form.allDay" type="checkbox" />
          Ganzer Tag
        </label>
        <div v-if="!form.allDay" class="space-y-1">
          <div class="grid grid-cols-2 gap-2">
            <UFormField label="Von">
              <UInput v-model="form.startTime" type="time" />
            </UFormField>
            <UFormField label="Bis">
              <UInput v-model="form.endTime" type="time" />
            </UFormField>
          </div>
          <p v-if="form.startsOn !== form.endsOn" class="text-xs text-neutral-500">
            Gilt an jedem Tag im gewählten Zeitraum.
          </p>
        </div>
        <UFormField label="Notiz" hint="optional">
          <UInput v-model="form.reason" maxlength="200" placeholder="z. B. Arzttermin" />
        </UFormField>
        <p class="text-xs text-neutral-500">
          In diesem Zeitraum können keine Termine für {{ teacherName || "dich" }} eingetragen werden; Vorschläge für
          freie Termine überspringen ihn.
        </p>
        <div class="flex gap-2">
          <UButton type="submit" color="primary" :loading="loading" :disabled="!teacherId">
            {{ form.id ? "Speichern" : "Eintragen" }}
          </UButton>
          <UButton v-if="form.id" variant="ghost" color="neutral" @click="resetForm">Abbrechen</UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>
