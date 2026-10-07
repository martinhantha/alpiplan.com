<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

interface AppointmentListItem {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  version: number;
  appointmentContactText: string | null;
  teacher: { id: string; displayName: string } | null;
  resource: { id: string; name: string } | null;
  lessonType: { id: string; name: string } | null;
  customer: { id: string; displayName: string } | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const { primaryTenant, teacherLabel, canManageTenant, canAccessWorkspace } = useAuth();
const { appointmentStatusLabel, appointmentStatusColor } = useAppointmentStatus();
const { intlLocale } = useAppLocale();

interface SchedulingOptions {
  teachers: { id: string; displayName: string }[];
}

const appointments = ref<AppointmentListItem[]>([]);
const pagination = ref<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
const options = ref<SchedulingOptions | null>(null);
const loading = ref(false);
const error = ref("");
const savingId = ref("");
const filterOpen = ref(false);

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInputValue(now),
  };
}

function lastMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    from: toDateInputValue(from),
    to: toDateInputValue(to),
  };
}

function currentYearRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-01-01`,
    to: toDateInputValue(now),
  };
}

function lastYearRange() {
  const year = new Date().getFullYear() - 1;
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

const initialRange = currentMonthRange();
const filters = reactive({
  q: "",
  teacherId: "",
  status: "completed,cancelled",
  from: initialRange.from,
  to: initialRange.to,
});
const page = ref(1);
const pageSize = ref(25);

const statusOptions = [
  { value: "completed,cancelled", label: "Archiv (alle)" },
  { value: "completed", label: "Nur erledigt" },
  { value: "cancelled", label: "Nur storniert" },
];

const canLoad = computed(() => Boolean(primaryTenant.value?.tenantId));

const activeFilterCount = computed(() => {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.teacherId) n += 1;
  if (filters.status !== "completed,cancelled") n += 1;
  if (filters.from) n += 1;
  if (filters.to) n += 1;
  return n;
});

const rangeLabel = computed(() => {
  if (!pagination.value.total) return "0 Termine";
  const start = (pagination.value.page - 1) * pagination.value.pageSize + 1;
  const end = Math.min(pagination.value.page * pagination.value.pageSize, pagination.value.total);
  return `${start}–${end} von ${pagination.value.total}`;
});

function appointmentTitle(appointment: AppointmentListItem) {
  return appointment.customer?.displayName || appointment.appointmentContactText || "Termin ohne Kontakt";
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

function toIsoDateStart(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

function toIsoDateEndExclusive(dateValue: string) {
  const end = new Date(`${dateValue}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return end.toISOString();
}

async function loadArchive() {
  if (!primaryTenant.value?.tenantId) {
    appointments.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const response = await $fetch<{ data: AppointmentListItem[]; pagination: Pagination }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/appointments`,
      {
        credentials: "include",
        query: {
          q: filters.q || undefined,
          teacherId: filters.teacherId || undefined,
          status: filters.status,
          from: filters.from ? toIsoDateStart(filters.from) : undefined,
          to: filters.to ? toIsoDateEndExclusive(filters.to) : undefined,
          page: page.value,
          pageSize: pageSize.value,
          sort: "desc",
        },
      },
    );
    appointments.value = response.data;
    pagination.value = response.pagination;
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value = err.data?.data?.message || err.data?.message || err.statusMessage || "Archiv konnte nicht geladen werden";
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  page.value = 1;
  loadArchive();
}

function applyDatePreset(preset: "currentMonth" | "lastMonth" | "currentYear" | "lastYear") {
  const ranges = {
    currentMonth: currentMonthRange,
    lastMonth: lastMonthRange,
    currentYear: currentYearRange,
    lastYear: lastYearRange,
  };
  const range = ranges[preset]();
  filters.from = range.from;
  filters.to = range.to;
  applyFilters();
}

const activeDatePreset = computed(() => {
  const presets = {
    currentMonth: currentMonthRange(),
    lastMonth: lastMonthRange(),
    currentYear: currentYearRange(),
    lastYear: lastYearRange(),
  };
  return (
    (Object.keys(presets) as Array<keyof typeof presets>).find(
      (key) => filters.from === presets[key].from && filters.to === presets[key].to,
    ) ?? ""
  );
});

async function loadOptions() {
  if (!primaryTenant.value?.tenantId) return;
  options.value = await $fetch<SchedulingOptions>(
    `/api/v1/tenants/${primaryTenant.value.tenantId}/scheduling/options`,
    { credentials: "include" },
  );
}

function resetFilters() {
  const range = currentMonthRange();
  filters.q = "";
  filters.teacherId = "";
  filters.status = "completed,cancelled";
  filters.from = range.from;
  filters.to = range.to;
  page.value = 1;
  loadArchive();
}

async function reactivateAppointment(appointment: AppointmentListItem) {
  if (!primaryTenant.value?.tenantId) return;
  savingId.value = appointment.id;
  error.value = "";
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${appointment.id}`, {
      method: "PATCH",
      credentials: "include",
      body: { status: "confirmed" },
      headers: { "If-Match": String(appointment.version) },
    });
    await loadArchive();
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value = err.data?.data?.message || err.data?.message || err.statusMessage || "Termin konnte nicht reaktiviert werden";
  } finally {
    savingId.value = "";
  }
}

async function deleteAppointment(appointment: AppointmentListItem) {
  if (!primaryTenant.value?.tenantId) return;
  if (!confirm(`Termin „${appointmentTitle(appointment)}“ wirklich löschen? Er kann im Papierkorb wiederhergestellt werden.`)) return;
  savingId.value = appointment.id;
  error.value = "";
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${appointment.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await loadArchive();
  } catch (e: unknown) {
    const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
    error.value =
      err.data?.data?.message || err.data?.message || err.statusMessage || "Termin konnte nicht gelöscht werden";
  } finally {
    savingId.value = "";
  }
}

function goToPage(target: number) {
  const next = Math.max(1, Math.min(pagination.value.totalPages, target));
  if (next === page.value) return;
  page.value = next;
  loadArchive();
}

watch(pageSize, () => {
  page.value = 1;
  loadArchive();
});

onMounted(async () => {
  await loadOptions();
  await loadArchive();
});

useAppointmentListSync(loadArchive);

watch(
  () => primaryTenant.value?.tenantId,
  async () => {
    page.value = 1;
    await loadOptions();
    await loadArchive();
  },
);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p class="text-sm text-muted font-medium">Alpiplan · Archiv</p>
        <h1 class="font-display text-3xl sm:text-4xl">
          Termin-Archiv
          <span class="ml-2 text-sm font-normal text-neutral-500">({{ pagination.total }})</span>
        </h1>
        <p v-if="!canManageTenant" class="mt-1 text-sm text-neutral-500">
          Nur eigene Termine. Löschen nur durch Admin.
        </p>
      </div>
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-filter"
        aria-label="Filter"
        title="Filter"
        @click="filterOpen = !filterOpen"
      >
        <span class="hidden sm:inline">Filter</span>
        <UBadge v-if="activeFilterCount" color="primary" variant="subtle" class="sm:ml-1">
          {{ activeFilterCount }}
        </UBadge>
        <UIcon
          :name="filterOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="ml-1 size-4 hidden sm:inline-flex"
        />
      </UButton>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="sm"
        :variant="activeDatePreset === 'currentMonth' ? 'soft' : 'outline'"
        :color="activeDatePreset === 'currentMonth' ? 'primary' : 'neutral'"
        @click="applyDatePreset('currentMonth')"
      >
        Dieser Monat
      </UButton>
      <UButton
        size="sm"
        :variant="activeDatePreset === 'lastMonth' ? 'soft' : 'outline'"
        :color="activeDatePreset === 'lastMonth' ? 'primary' : 'neutral'"
        @click="applyDatePreset('lastMonth')"
      >
        Letzter Monat
      </UButton>
      <UButton
        size="sm"
        :variant="activeDatePreset === 'currentYear' ? 'soft' : 'outline'"
        :color="activeDatePreset === 'currentYear' ? 'primary' : 'neutral'"
        @click="applyDatePreset('currentYear')"
      >
        Dieses Jahr
      </UButton>
      <UButton
        size="sm"
        :variant="activeDatePreset === 'lastYear' ? 'soft' : 'outline'"
        :color="activeDatePreset === 'lastYear' ? 'primary' : 'neutral'"
        @click="applyDatePreset('lastYear')"
      >
        Letztes Jahr
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :title="error"
    />

    <UCard v-if="filterOpen">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium">Filter</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="filterOpen = false" />
        </div>
      </template>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <UInput v-model="filters.q" placeholder="Suche Kunde oder Kontakttext" />
        <select
          v-if="canManageTenant"
          v-model="filters.teacherId"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="">Alle {{ teacherLabel }}</option>
          <option v-for="teacher in options?.teachers || []" :key="teacher.id" :value="teacher.id">
            {{ teacher.displayName }}
          </option>
        </select>
        <select
          v-model="filters.status"
          class="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
        >
          <option v-for="status in statusOptions" :key="status.label" :value="status.value">
            {{ status.label }}
          </option>
        </select>
        <UInput v-model="filters.from" type="date" aria-label="Von" />
        <UInput v-model="filters.to" type="date" aria-label="Bis" />
      </div>
      <template #footer>
        <div class="flex gap-2">
          <UButton :disabled="!canLoad" :loading="loading" icon="i-lucide-search" @click="applyFilters">
            Anwenden
          </UButton>
          <UButton variant="ghost" color="neutral" @click="resetFilters">
            Zurücksetzen
          </UButton>
        </div>
      </template>
    </UCard>

    <div class="flex items-center justify-between gap-3 text-sm text-neutral-600 dark:text-neutral-400">
      <span>{{ rangeLabel }}</span>
      <div class="flex items-center gap-2">
        <span>Pro Seite</span>
        <select
          v-model.number="pageSize"
          class="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
        >
          <option :value="10">10</option>
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </div>
    </div>

    <div v-if="!primaryTenant" class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400">
      Für das Archiv brauchst du eine Mandanten-Mitgliedschaft.
    </div>
    <div v-else-if="!appointments.length && !loading" class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400">
      Keine archivierten Termine gefunden.
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="appointment in appointments" :key="appointment.id">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-medium">{{ appointmentTitle(appointment) }}</p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ formatDateTime(appointment.startsAt) }}–{{ formatDateTime(appointment.endsAt).split(', ').pop() }}
            </p>
            <p v-if="appointment.teacher" class="mt-1 text-xs text-neutral-500">
              {{ teacherLabel }}: {{ appointment.teacher.displayName }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              v-if="appointmentStatusLabel(appointment.status)"
              :color="appointmentStatusColor(appointment.status)"
              variant="subtle"
            >
              {{ appointmentStatusLabel(appointment.status) }}
            </UBadge>
            <UButton
              v-if="canAccessWorkspace"
              size="sm"
              color="primary"
              variant="soft"
              icon="i-lucide-rotate-ccw"
              :loading="savingId === appointment.id"
              @click="reactivateAppointment(appointment)"
            >
              Reaktivieren
            </UButton>
            <UButton
              v-if="canManageTenant"
              size="sm"
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :loading="savingId === appointment.id"
              @click="deleteAppointment(appointment)"
            >
              Löschen
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <div
      v-if="pagination.totalPages > 1"
      class="flex items-center justify-between gap-3 pt-2"
    >
      <UButton
        size="sm"
        variant="outline"
        color="neutral"
        icon="i-lucide-chevron-left"
        :disabled="pagination.page <= 1 || loading"
        @click="goToPage(pagination.page - 1)"
      >
        Zurück
      </UButton>
      <span class="text-sm text-neutral-600 dark:text-neutral-400">
        Seite {{ pagination.page }} / {{ pagination.totalPages }}
      </span>
      <UButton
        size="sm"
        variant="outline"
        color="neutral"
        trailing-icon="i-lucide-chevron-right"
        :disabled="pagination.page >= pagination.totalPages || loading"
        @click="goToPage(pagination.page + 1)"
      >
        Weiter
      </UButton>
    </div>
  </UContainer>
</template>
