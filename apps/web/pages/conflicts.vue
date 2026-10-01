<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { $fetch } from "ofetch";
import { useAuth } from "../composables/useAuth";
import { formatAppointmentTeachers } from "../utils/appointment-contact";

const { appointmentStatusLabel, appointmentStatusColor } = useAppointmentStatus();
const { intlLocale } = useAppLocale();

interface ConflictAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  version: number;
  appointmentContactText: string | null;
  teacher: { id: string; displayName: string } | null;
  teachers?: { id: string; displayName: string }[] | null;
  resource: { id: string; name: string } | null;
  lessonType: { id: string; name: string } | null;
  customer: { id: string; displayName: string } | null;
}

interface SchedulingConflict {
  id: string;
  type: "TIME_OVERLAP" | "RESOURCE_DOUBLE_BOOK";
  title: string;
  detail: string;
  appointments: ConflictAppointment[];
}

interface ConflictAlternative {
  id: string;
  kind: "time" | "teacher" | "time_and_teacher" | "resource";
  title: string;
  detail: string;
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  teacherId: string | null;
  resourceId: string | null;
}

const { memberships, primaryTenant, teacherLabel, canManageTenant } = useAuth();

const selectedTenantId = ref("");
const fromDate = ref("");
const toDate = ref("");
const conflicts = ref<SchedulingConflict[]>([]);
const loading = ref(false);
const applying = ref(false);
const error = ref("");
const info = ref("");

const selectedConflictId = ref("");
const moveAppointmentId = ref("");
const alternatives = ref<ConflictAlternative[]>([]);
const alternativesLoading = ref(false);
const selectedAlternativeId = ref<string | null>(null);

const tenantOptions = computed(() =>
  memberships.value.map((membership) => ({
    id: membership.tenantId,
    name: membership.tenantName,
  })),
);

const activeTenantId = computed(() => selectedTenantId.value || primaryTenant.value?.tenantId || "");

const selectedConflict = computed(
  () => conflicts.value.find((conflict) => conflict.id === selectedConflictId.value) ?? null,
);

const moveAppointment = computed(
  () => selectedConflict.value?.appointments.find((item) => item.id === moveAppointmentId.value) ?? null,
);

const selectedAlternative = computed(
  () => alternatives.value.find((item) => item.id === selectedAlternativeId.value) ?? null,
);

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function appointmentTitle(appointment: ConflictAppointment) {
  return appointment.customer?.displayName || appointment.appointmentContactText || "Termin ohne Kontakt";
}

function conflictTypeLabel(type: SchedulingConflict["type"]) {
  return type === "RESOURCE_DOUBLE_BOOK" ? "Ressource" : teacherLabel.value;
}

function pickMoveTarget(appointments: ConflictAppointment[]) {
  const movable = appointments.filter((item) => item.status !== "completed");
  const pool = movable.length ? movable : appointments;
  return [...pool].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())[0] ?? null;
}

function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

function resetSelection() {
  selectedConflictId.value = "";
  moveAppointmentId.value = "";
  alternatives.value = [];
  selectedAlternativeId.value = null;
}

async function loadConflicts() {
  if (!canManageTenant.value || !activeTenantId.value || !fromDate.value || !toDate.value) {
    conflicts.value = [];
    resetSelection();
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const response = await $fetch<{ data: SchedulingConflict[] }>(
      `/api/v1/tenants/${activeTenantId.value}/conflicts`,
      {
        credentials: "include",
        query: {
          from: new Date(`${fromDate.value}T00:00:00`).toISOString(),
          to: new Date(`${toDate.value}T23:59:59`).toISOString(),
        },
      },
    );
    conflicts.value = response.data;
    if (selectedConflictId.value && !conflicts.value.some((item) => item.id === selectedConflictId.value)) {
      resetSelection();
    }
  } catch (e: unknown) {
    error.value = apiMessage(e, "Konflikte konnten nicht geladen werden");
    conflicts.value = [];
    resetSelection();
  } finally {
    loading.value = false;
  }
}

async function loadAlternatives() {
  selectedAlternativeId.value = null;
  alternatives.value = [];
  if (!activeTenantId.value || !moveAppointmentId.value) return;
  alternativesLoading.value = true;
  try {
    const response = await $fetch<{ data: ConflictAlternative[] }>(
      `/api/v1/tenants/${activeTenantId.value}/appointments/${moveAppointmentId.value}/alternatives`,
      { credentials: "include" },
    );
    alternatives.value = response.data;
  } catch (e: unknown) {
    error.value = apiMessage(e, "Alternativen konnten nicht geladen werden");
  } finally {
    alternativesLoading.value = false;
  }
}

function selectConflict(conflict: SchedulingConflict) {
  selectedConflictId.value = conflict.id;
  info.value = "";
  error.value = "";
  const target = pickMoveTarget(conflict.appointments);
  moveAppointmentId.value = target?.id ?? "";
}

async function applyAlternative() {
  if (!activeTenantId.value || !moveAppointment.value || !selectedAlternative.value) return;
  applying.value = true;
  error.value = "";
  info.value = "";
  try {
    const alternative = selectedAlternative.value;
    const body: Record<string, string | null> = {
      startsAt: alternative.startsAt,
      endsAt: alternative.endsAt,
    };
    if (alternative.teacherId) body.teacherId = alternative.teacherId;
    if (alternative.resourceId) body.resourceId = alternative.resourceId;
    await $fetch(`/api/v1/tenants/${activeTenantId.value}/appointments/${moveAppointment.value.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "If-Match": String(moveAppointment.value.version) },
      body,
    });
    info.value = "Alternative übernommen — Termin wurde verschoben.";
    resetSelection();
    await loadConflicts();
  } catch (e: unknown) {
    error.value = apiMessage(e, "Alternative konnte nicht übernommen werden");
  } finally {
    applying.value = false;
  }
}

watch(activeTenantId, () => {
  resetSelection();
  loadConflicts();
});

watch(moveAppointmentId, () => {
  if (moveAppointmentId.value) loadAlternatives();
});

onMounted(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  fromDate.value = toDateKey(addDays(today, -1));
  toDate.value = toDateKey(addDays(today, 14));
  selectedTenantId.value = primaryTenant.value?.tenantId ?? memberships.value[0]?.tenantId ?? "";
  loadConflicts();
});
</script>

<template>
  <UContainer class="py-6 space-y-6 max-w-3xl">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="space-y-1">
        <p class="text-sm text-muted font-medium">Alpiplan · Konflikte</p>
        <h1 class="text-2xl font-semibold tracking-tight">Konflikte</h1>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          Überschneidungen bei {{ teacherLabel }} oder Ressourcen. Wähle eine Alternative, um den Termin zu verschieben.
        </p>
      </div>
      <UButton
        size="sm"
        variant="outline"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        :disabled="!canManageTenant || !activeTenantId"
        @click="loadConflicts"
      >
        Neu laden
      </UButton>
    </div>

    <div
      v-if="!canManageTenant"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Konflikte können nur Admins ansehen und auflösen.
    </div>

    <div
      v-else-if="!activeTenantId"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Kein Mandant zugewiesen — Konflikte können nicht geladen werden.
    </div>

    <template v-else>
      <UCard>
        <div class="grid gap-3 sm:grid-cols-3">
          <UFormField v-if="tenantOptions.length > 1" label="Mandant">
            <select
              v-model="selectedTenantId"
              class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
            >
              <option v-for="tenant in tenantOptions" :key="tenant.id" :value="tenant.id">
                {{ tenant.name }}
              </option>
            </select>
          </UFormField>
          <UFormField label="Von">
            <UInput v-model="fromDate" type="date" @change="loadConflicts" />
          </UFormField>
          <UFormField label="Bis">
            <UInput v-model="toDate" type="date" @change="loadConflicts" />
          </UFormField>
        </div>
      </UCard>

      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
      <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

      <div v-if="loading && !conflicts.length" class="text-sm text-neutral-500">Konflikte werden geladen …</div>
      <div
        v-else-if="!conflicts.length"
        class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
      >
        Keine Konflikte im gewählten Zeitraum.
      </div>

      <div v-else class="space-y-3">
        <button
          v-for="conflict in conflicts"
          :key="conflict.id"
          type="button"
          class="w-full text-left rounded-xl border p-4 transition hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          :class="
            selectedConflictId === conflict.id
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/40'
              : 'border-neutral-200 dark:border-neutral-800'
          "
          @click="selectConflict(conflict)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium">{{ conflict.title }}</p>
              <p class="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{{ conflict.detail }}</p>
            </div>
            <UBadge color="warning" variant="subtle" class="shrink-0">
              {{ conflictTypeLabel(conflict.type) }}
            </UBadge>
          </div>
          <ul class="mt-3 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            <li v-for="appointment in conflict.appointments" :key="appointment.id">
              {{ formatDateTime(appointment.startsAt) }}–{{ formatTime(appointment.endsAt) }}
              · {{ appointmentTitle(appointment) }}
            </li>
          </ul>
        </button>
      </div>

      <template v-if="selectedConflict">
        <UAlert
          color="warning"
          variant="subtle"
          :title="selectedConflict.title"
          :description="`${selectedConflict.detail}. Wähle, welcher Termin verschoben wird, und eine Alternative.`"
        />

        <UCard>
          <template #header>
            <h2 class="font-medium">Termin verschieben</h2>
          </template>
          <div class="space-y-2">
            <label
              v-for="appointment in selectedConflict.appointments"
              :key="appointment.id"
              class="flex items-start gap-3 rounded-lg border p-3 cursor-pointer"
              :class="
                moveAppointmentId === appointment.id
                  ? 'border-primary-500 bg-primary-50/70 dark:bg-primary-950/30'
                  : 'border-neutral-200 dark:border-neutral-800'
              "
            >
              <input v-model="moveAppointmentId" type="radio" class="mt-1" :value="appointment.id" />
              <div class="min-w-0">
                <p class="font-medium">{{ appointmentTitle(appointment) }}</p>
                <p class="text-sm text-neutral-600 dark:text-neutral-400">
                  {{ formatDateTime(appointment.startsAt) }}–{{ formatTime(appointment.endsAt) }}
                </p>
                <div class="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                  <span v-if="formatAppointmentTeachers(appointment)">{{ teacherLabel }}: {{ formatAppointmentTeachers(appointment) }}</span>
                  <span v-if="appointment.resource">Ressource: {{ appointment.resource.name }}</span>
                  <UBadge
                    v-if="appointmentStatusLabel(appointment.status)"
                    :color="appointmentStatusColor(appointment.status)"
                    variant="subtle"
                  >
                    {{ appointmentStatusLabel(appointment.status) }}
                  </UBadge>
                </div>
              </div>
            </label>
          </div>
        </UCard>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-medium">Alternativen</h2>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-refresh-cw"
              :loading="alternativesLoading"
              :disabled="!moveAppointmentId"
              @click="loadAlternatives"
            />
          </div>
          <div v-if="alternativesLoading" class="text-sm text-neutral-500">Alternativen werden gesucht …</div>
          <div
            v-else-if="!alternatives.length"
            class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
          >
            Keine freie Alternative im Zeitraum gefunden. Passe den Termin manuell unter Termine an.
          </div>
          <button
            v-for="alternative in alternatives"
            :key="alternative.id"
            type="button"
            class="w-full text-left rounded-xl border p-4 transition hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            :class="
              selectedAlternativeId === alternative.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/40'
                : 'border-neutral-200 dark:border-neutral-800'
            "
            @click="selectedAlternativeId = alternative.id"
          >
            <p class="font-medium">{{ alternative.title }}</p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{{ alternative.detail }}</p>
          </button>
        </div>

        <UButton
          size="xl"
          block
          color="primary"
          :disabled="!selectedAlternative"
          :loading="applying"
          @click="applyAlternative"
        >
          Auswahl übernehmen
        </UButton>
      </template>
    </template>
  </UContainer>
</template>
