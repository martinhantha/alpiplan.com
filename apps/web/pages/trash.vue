<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

type TrashKind = "appointment" | "customer" | "lessonType" | "member";
type TrashFilter = "all" | TrashKind;

interface TrashItem {
  kind: TrashKind;
  id: string;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  deletedByName: string | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TrashCounts {
  appointment: number;
  customer: number;
  lessonType: number;
  member: number;
  total: number;
}

const { primaryTenant, canManageTenant } = useAuth();

const items = ref<TrashItem[]>([]);
const pagination = ref<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
const counts = ref<TrashCounts>({
  appointment: 0,
  customer: 0,
  lessonType: 0,
  member: 0,
  total: 0,
});
const loading = ref(false);
const restoringId = ref("");
const error = ref("");
const info = ref("");
const page = ref(1);

const filters = reactive({
  q: "",
  kind: "all" as TrashFilter,
});

const kindOptions: Array<{ value: TrashFilter; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "appointment", label: "Termine" },
  { value: "customer", label: "Kunden" },
  { value: "lessonType", label: "Termintypen" },
  { value: "member", label: "Benutzer" },
];

const kindBadge: Record<TrashKind, { label: string; color: "primary" | "neutral" | "warning" | "success" }> = {
  appointment: { label: "Termin", color: "primary" },
  customer: { label: "Kunde", color: "success" },
  lessonType: { label: "Termintyp", color: "warning" },
  member: { label: "Benutzer", color: "neutral" },
};

const canLoad = computed(() => Boolean(primaryTenant.value?.tenantId) && canManageTenant.value);

function countFor(kind: TrashFilter) {
  if (kind === "all") return counts.value.total;
  return counts.value[kind];
}

function formatDeletedAt(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

async function loadTrash() {
  if (!primaryTenant.value?.tenantId || !canManageTenant.value) {
    items.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const response = await $fetch<{
      data: TrashItem[];
      pagination: Pagination;
      counts: TrashCounts;
    }>(`/api/v1/tenants/${primaryTenant.value.tenantId}/trash`, {
      credentials: "include",
      query: {
        q: filters.q || undefined,
        kind: filters.kind === "all" ? undefined : filters.kind,
        page: page.value,
        pageSize: pagination.value.pageSize,
      },
    });
    items.value = response.data;
    pagination.value = response.pagination;
    counts.value = response.counts;
    if (!response.data.length && page.value > 1 && response.pagination.totalPages < page.value) {
      page.value = response.pagination.totalPages;
      await loadTrash();
    }
  } catch (e: unknown) {
    error.value = apiMessage(e, "Papierkorb konnte nicht geladen werden");
  } finally {
    loading.value = false;
  }
}

function setKind(kind: TrashFilter) {
  filters.kind = kind;
  page.value = 1;
  loadTrash();
}

function applySearch() {
  page.value = 1;
  loadTrash();
}

async function restoreItem(item: TrashItem) {
  if (!primaryTenant.value?.tenantId) return;
  restoringId.value = item.id;
  error.value = "";
  info.value = "";
  try {
    await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/trash/${item.kind}/${item.id}/restore`, {
      method: "POST",
      credentials: "include",
    });
    info.value = `„${item.title}“ wiederhergestellt`;
    await loadTrash();
  } catch (e: unknown) {
    error.value = apiMessage(e, "Eintrag konnte nicht wiederhergestellt werden");
  } finally {
    restoringId.value = "";
  }
}

function goToPage(target: number) {
  const next = Math.max(1, Math.min(pagination.value.totalPages, target));
  if (next === page.value) return;
  page.value = next;
  loadTrash();
}

onMounted(loadTrash);
watch(
  () => primaryTenant.value?.tenantId,
  () => {
    page.value = 1;
    loadTrash();
  },
);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div>
      <p class="text-sm text-muted font-medium">Alpiplan · Papierkorb</p>
      <h1 class="font-display text-3xl sm:text-4xl">
        Papierkorb
        <span class="ml-2 text-sm font-normal text-neutral-500">({{ pagination.total }})</span>
      </h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Gelöschte Daten von <strong>{{ primaryTenant?.tenantName || "—" }}</strong> wiederherstellen.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="option in kindOptions"
        :key="option.value"
        size="sm"
        :variant="filters.kind === option.value ? 'soft' : 'outline'"
        :color="filters.kind === option.value ? 'primary' : 'neutral'"
        @click="setKind(option.value)"
      >
        {{ option.label }}
        <UBadge
          v-if="countFor(option.value)"
          :color="filters.kind === option.value ? 'primary' : 'neutral'"
          variant="subtle"
          class="ml-1"
        >
          {{ countFor(option.value) }}
        </UBadge>
      </UButton>
    </div>

    <form class="flex gap-2" @submit.prevent="applySearch">
      <UInput
        v-model="filters.q"
        class="flex-1"
        placeholder="Suche nach Name, Kontakt oder E-Mail"
        icon="i-lucide-search"
      />
      <UButton type="submit" :disabled="!canLoad" :loading="loading" icon="i-lucide-search">
        Suchen
      </UButton>
    </form>

    <div
      v-if="!primaryTenant"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Für den Papierkorb brauchst du eine Mandanten-Mitgliedschaft.
    </div>
    <div
      v-else-if="!items.length && !loading"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Keine gelöschten Einträge gefunden.
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="item in items" :key="`${item.kind}-${item.id}`">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <UBadge :color="kindBadge[item.kind].color" variant="subtle">
                {{ kindBadge[item.kind].label }}
              </UBadge>
              <p class="font-medium truncate">{{ item.title }}</p>
            </div>
            <p v-if="item.subtitle" class="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              {{ item.subtitle }}
            </p>
            <p class="text-xs text-neutral-500 mt-1">
              Gelöscht am {{ formatDeletedAt(item.deletedAt) }}
              <span v-if="item.deletedByName"> · von {{ item.deletedByName }}</span>
            </p>
          </div>
          <UButton
            size="sm"
            color="primary"
            variant="soft"
            icon="i-lucide-rotate-ccw"
            :loading="restoringId === item.id"
            @click="restoreItem(item)"
          >
            Wiederherstellen
          </UButton>
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
