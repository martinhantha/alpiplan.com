<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";

interface LessonType {
  id: string;
  tenantId: string;
  name: string;
  defaultDurationMin: number | null;
  createdAt: string;
  updatedAt: string;
}

const { user, primaryTenant } = useAuth();

const isSuperadmin = computed(() => Boolean(user.value?.isSuperadmin));
const isTenantAdmin = computed(() => primaryTenant.value?.role === "ADMIN");
const canEdit = computed(() => isSuperadmin.value || isTenantAdmin.value);
const useDuration = computed(() => primaryTenant.value?.useDefaultDuration ?? true);

const lessonTypes = ref<LessonType[]>([]);
const loading = ref(false);
const savingId = ref("");
const error = ref("");
const info = ref("");

const filterOpen = ref(false);
const filters = reactive({ q: "" });

const dialogOpen = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editingId = ref<string | null>(null);
const form = reactive({
  name: "",
  defaultDurationMin: 30 as number | null,
});

const filtered = computed(() => {
  const q = filters.q.trim().toLowerCase();
  if (!q) return lessonTypes.value;
  return lessonTypes.value.filter((l) => l.name.toLowerCase().includes(q));
});

const activeFilterCount = computed(() => (filters.q ? 1 : 0));

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

async function load() {
  if (!primaryTenant.value?.tenantId) {
    lessonTypes.value = [];
    return;
  }
  loading.value = true;
  try {
    const response = await $fetch<{ data: LessonType[] }>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types`,
      { credentials: "include" },
    );
    lessonTypes.value = response.data;
  } catch (e: unknown) {
    setError(apiMessage(e, "Termintypen konnten nicht geladen werden"));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  dialogMode.value = "create";
  editingId.value = null;
  form.name = "";
  form.defaultDurationMin = 30;
  dialogOpen.value = true;
}

function openEdit(item: LessonType) {
  dialogMode.value = "edit";
  editingId.value = item.id;
  form.name = item.name;
  form.defaultDurationMin = item.defaultDurationMin;
  dialogOpen.value = true;
}

async function submit() {
  if (!primaryTenant.value?.tenantId) return;
  if (!form.name.trim()) {
    setError("Name ist erforderlich");
    return;
  }
  loading.value = true;
  try {
    const body = {
      name: form.name.trim(),
      defaultDurationMin: form.defaultDurationMin === null ? null : Number(form.defaultDurationMin),
    };
    if (dialogMode.value === "create") {
      await $fetch(`/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types`, {
        method: "POST",
        credentials: "include",
        body,
      });
      setInfo("Termintyp erstellt");
    } else if (editingId.value) {
      await $fetch(
        `/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types/${editingId.value}`,
        { method: "PATCH", credentials: "include", body },
      );
      setInfo("Termintyp aktualisiert");
    }
    dialogOpen.value = false;
    await load();
  } catch (e: unknown) {
    setError(apiMessage(e, "Speichern fehlgeschlagen"));
  } finally {
    loading.value = false;
  }
}

async function remove(item: LessonType) {
  if (!primaryTenant.value?.tenantId) return;
  if (!confirm(`Termintyp „${item.name}“ löschen? Er kann im Papierkorb wiederhergestellt werden.`)) return;
  savingId.value = item.id;
  try {
    await $fetch(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/lesson-types/${item.id}`,
      { method: "DELETE", credentials: "include" },
    );
    setInfo("Termintyp gelöscht");
    await load();
  } catch (e: unknown) {
    setError(apiMessage(e, "Löschen fehlgeschlagen"));
  } finally {
    savingId.value = "";
  }
}

onMounted(load);
watch(() => primaryTenant.value?.tenantId, load);
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p class="text-sm text-muted font-medium">Alpiplan · Termintypen</p>
        <h1 class="font-display text-3xl sm:text-4xl">
          Termintypen
          <span class="ml-2 text-sm font-normal text-neutral-500">({{ filtered.length }})</span>
        </h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Mandant <strong>{{ primaryTenant?.tenantName || "—" }}</strong>
          <UBadge v-if="canEdit" color="primary" variant="subtle" class="ml-1">{{ isSuperadmin ? 'SUPERADMIN' : 'ADMIN' }}</UBadge>
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
          icon="i-lucide-plus"
          color="primary"
          @click="openCreate"
        >
          Termintyp hinzufügen
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
        <UInput v-model="filters.q" placeholder="Suche nach Name" />
      </div>
    </UCard>

    <div
      v-if="!filtered.length && !loading"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Keine Termintypen vorhanden.
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="item in filtered" :key="item.id">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <p class="font-medium truncate">{{ item.name }}</p>
            <p v-if="useDuration" class="text-xs text-neutral-500 mt-1">
              Standard-Dauer:
              <span class="font-medium">
                {{ item.defaultDurationMin ? `${item.defaultDurationMin} min` : "—" }}
              </span>
            </p>
          </div>
          <div v-if="canEdit" class="flex items-center gap-2 shrink-0">
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-pencil"
              @click="openEdit(item)"
            >
              Bearbeiten
            </UButton>
            <UButton
              size="sm"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              :loading="savingId === item.id"
              @click="remove(item)"
            >
              Löschen
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <UModal v-model:open="dialogOpen" :ui="{ content: 'max-w-lg' }">
      <template #header>
        <div class="flex items-center justify-between gap-3 w-full">
          <h2 class="font-medium">
            {{ dialogMode === "create" ? "Termintyp hinzufügen" : "Termintyp bearbeiten" }}
          </h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="dialogOpen = false" />
        </div>
      </template>
      <template #body>
        <form class="space-y-3" @submit.prevent="submit">
          <UFormField label="Name">
            <UInput v-model="form.name" placeholder="z. B. Klavier 30min" />
          </UFormField>
          <UFormField v-if="useDuration" label="Standard-Dauer (Minuten)" hint="optional, 5 – 1440">
            <UInput v-model.number="form.defaultDurationMin" type="number" min="5" max="1440" />
          </UFormField>
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            title="Dauer ist für diesen Mandanten deaktiviert"
            description="Die Termin-Dauer wird pro Termin manuell gesetzt."
          />
          <p v-if="!useDuration" class="text-xs text-neutral-500">
            Aktivieren in <strong>Einstellungen → Allgemein</strong>.
          </p>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="dialogOpen = false">Abbrechen</UButton>
          <UButton
            color="primary"
            :loading="loading"
            :icon="dialogMode === 'create' ? 'i-lucide-plus' : 'i-lucide-save'"
            @click="submit"
          >
            {{ dialogMode === "create" ? "Hinzufügen" : "Speichern" }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
