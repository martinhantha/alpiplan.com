<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

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

const props = defineProps<{
  tenantId: string;
  teacherId: string;
  teacherLabel: string;
}>();

const emit = defineEmits<{
  info: [message: string];
  error: [message: string];
}>();

const rules = ref<AvailabilityRule[]>([]);
const loading = ref(false);
const form = reactive({
  id: "",
  weekdays: [1, 2, 3, 4, 5] as number[],
  startTime: "09:00",
  endTime: "17:00",
  kind: "available" as "available" | "unavailable",
  allDay: false,
  priority: 0,
});

const weekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdayPresets = [
  { label: "Mo–Fr", days: [1, 2, 3, 4, 5] },
  { label: "Wochenende", days: [6, 0] },
  { label: "Alle", days: [1, 2, 3, 4, 5, 6, 0] },
];

function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

function basePath() {
  return `/api/v1/tenants/${props.tenantId}/teachers/${props.teacherId}/availability/rules`;
}

function orderedWeekdays(days: number[]): number[] {
  const unique = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return weekdayOrder.filter((day) => unique.includes(day));
}

function formatWeekdays(days: number[]): string {
  const ordered = orderedWeekdays(days);
  if (!ordered.length) return "";
  const ranges: string[] = [];
  let from = ordered[0]!;
  let prev = ordered[0]!;
  const flush = (start: number, end: number) => {
    ranges.push(start === end ? weekdayLabels[start]! : `${weekdayLabels[start]}–${weekdayLabels[end]}`);
  };
  for (let i = 1; i < ordered.length; i += 1) {
    const day = ordered[i]!;
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
  const index = form.weekdays.indexOf(day);
  if (index >= 0) form.weekdays.splice(index, 1);
  else form.weekdays.push(day);
}

function setWeekdays(days: number[]) {
  form.weekdays = [...days];
}

async function load() {
  if (!props.tenantId || !props.teacherId) {
    rules.value = [];
    return;
  }
  loading.value = true;
  try {
    const response = await $fetch<{ data: AvailabilityRule[] }>(basePath(), { credentials: "include" });
    rules.value = response.data;
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Verfügbarkeit konnte nicht geladen werden"));
  } finally {
    loading.value = false;
  }
}

function select(item: AvailabilityRule) {
  form.id = item.id;
  form.weekdays = ruleDays(item);
  form.startTime = item.startTime;
  form.endTime = item.endTime;
  form.kind = item.kind === "unavailable" ? "unavailable" : "available";
  form.allDay = Boolean(item.allDay);
  form.priority = item.priority;
}

function resetForm() {
  form.id = "";
  form.weekdays = [1, 2, 3, 4, 5];
  form.startTime = "09:00";
  form.endTime = "17:00";
  form.kind = "available";
  form.allDay = false;
  form.priority = 0;
}

function setKind(kind: "available" | "unavailable") {
  form.kind = kind;
  if (kind === "available") {
    form.allDay = false;
    if (form.startTime === "00:00" && form.endTime === "23:59") {
      form.startTime = "09:00";
      form.endTime = "17:00";
    }
  }
}

async function save() {
  if (!props.tenantId || !props.teacherId) return;
  const days = orderedWeekdays(form.weekdays);
  if (!days.length) {
    emit("error", "Mindestens einen Wochentag wählen");
    return;
  }
  loading.value = true;
  try {
    const allDay = form.kind === "unavailable" && form.allDay;
    const body = {
      weekdays: days,
      startTime: allDay ? "00:00" : form.startTime,
      endTime: allDay ? "23:59" : form.endTime,
      kind: form.kind,
      allDay,
      priority: Number(form.priority) || 0,
    };
    if (form.id) {
      await $fetch(`${basePath()}/${form.id}`, { method: "PATCH", credentials: "include", body });
      emit("info", "Regel aktualisiert");
    } else {
      await $fetch(basePath(), { method: "POST", credentials: "include", body });
      emit("info", days.length > 1 ? `Regel für ${days.length} Tage angelegt` : "Regel angelegt");
    }
    resetForm();
    await load();
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Regel konnte nicht gespeichert werden"));
  } finally {
    loading.value = false;
  }
}

async function remove(item: AvailabilityRule) {
  if (!props.tenantId || !props.teacherId) return;
  if (!confirm(`Regel ${formatWeekdays(ruleDays(item))} · ${ruleTimeLabel(item)} löschen?`)) return;
  try {
    await $fetch(`${basePath()}/${item.id}`, { method: "DELETE", credentials: "include" });
    emit("info", "Regel gelöscht");
    if (form.id === item.id) resetForm();
    await load();
  } catch (e: unknown) {
    emit("error", apiMessage(e, "Regel konnte nicht gelöscht werden"));
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
          <h2 class="font-medium">Standard-Uhrzeiten ({{ rules.length }})</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :loading="loading" @click="load" />
        </div>
      </template>
      <div v-if="!rules.length" class="text-sm text-neutral-500">
        Noch keine Standard-Uhrzeiten für diesen {{ teacherLabel }}.
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
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" @click="select(item)" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="remove(item)" />
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">{{ form.id ? "Regel bearbeiten" : "Neue Regel" }}</h2>
      </template>
      <form class="space-y-3" @submit.prevent="save">
        <UFormField label="Art">
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
              :class="
                form.kind === 'available'
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
              "
              @click="setKind('available')"
            >
              Verfügbar
            </button>
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
              :class="
                form.kind === 'unavailable'
                  ? 'border-red-500 bg-red-500 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
              "
              @click="setKind('unavailable')"
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
                form.weekdays.includes(day)
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
              "
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
              @click="setWeekdays(preset.days)"
            >
              {{ preset.label }}
            </UButton>
          </div>
        </UFormField>
        <label v-if="form.kind === 'unavailable'" class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input v-model="form.allDay" type="checkbox" />
          Ganzer Tag
        </label>
        <div v-if="!(form.kind === 'unavailable' && form.allDay)" class="grid grid-cols-2 gap-2">
          <UFormField label="Von">
            <UInput v-model="form.startTime" type="time" />
          </UFormField>
          <UFormField label="Bis">
            <UInput v-model="form.endTime" type="time" />
          </UFormField>
        </div>
        <UFormField
          v-if="form.kind === 'available'"
          label="Priorität"
          hint="Höhere Zahl = wird zuerst als nächster freier Termin vorgeschlagen"
        >
          <UInput v-model.number="form.priority" type="number" />
        </UFormField>
        <div class="flex gap-2">
          <UButton type="submit" color="primary" :loading="loading" :disabled="!teacherId">
            {{ form.id ? "Speichern" : "Anlegen" }}
          </UButton>
          <UButton v-if="form.id" variant="ghost" color="neutral" @click="resetForm">Abbrechen</UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>
