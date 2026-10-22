<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

type AppointmentStatus = "draft" | "confirmed" | "completed" | "cancelled";

interface RangeSummary {
  from: string;
  to: string;
  active: number;
  inTrash: number;
  byStatus: Record<AppointmentStatus, number>;
}

interface ImportIssue {
  line: number;
  message: string;
}

interface ImportResult {
  dryRun: boolean;
  imported: boolean;
  totalRows: number;
  toCreate: number;
  skipped: number;
  newCustomers: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

const { user, primaryTenant, canManageTenant } = useAuth();
const { t, intlLocale } = useAppLocale();
const tenantId = computed(() => primaryTenant.value?.tenantId ?? "");

const statusLabels = computed<Record<AppointmentStatus, string>>(() => ({
  draft: t("dataPage.statusDraft"),
  confirmed: t("dataPage.statusConfirmed"),
  completed: t("dataPage.statusDone"),
  cancelled: t("dataPage.statusCancelled"),
}));
const statusColors: Record<AppointmentStatus, "warning" | "primary" | "success" | "neutral"> = {
  draft: "warning",
  confirmed: "primary",
  completed: "success",
  cancelled: "neutral",
};

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const thisYear = new Date().getFullYear();
const range = reactive({ from: `${thisYear}-01-01`, to: `${thisYear}-12-31` });

const presets = computed(() => {
  const now = new Date();
  return [
    { label: t("dataPage.thisMonth"), from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    { label: t("dataPage.thisYear"), from: `${thisYear}-01-01`, to: `${thisYear}-12-31` },
    { label: t("dataPage.lastYear"), from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
  ];
});

function applyPreset(preset: { from: string; to: string }) {
  range.from = preset.from;
  range.to = preset.to;
}

const rangeValid = computed(() => Boolean(range.from && range.to && range.from <= range.to));

const summary = ref<RangeSummary | null>(null);
const summaryLoading = ref(false);
const error = ref("");
const info = ref("");

function apiMessage(e: unknown, fallback: string) {
  const err = e as { data?: { data?: { message?: string }; message?: string }; statusMessage?: string };
  return err.data?.data?.message || err.data?.message || err.statusMessage || fallback;
}

function formatDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale.value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

const rangeLabel = computed(() => (rangeValid.value ? `${formatDay(range.from)} – ${formatDay(range.to)}` : "—"));

async function loadSummary() {
  if (!tenantId.value || !canManageTenant.value || !rangeValid.value) {
    summary.value = null;
    return;
  }
  summaryLoading.value = true;
  try {
    summary.value = await $fetch<RangeSummary>(`/api/v1/tenants/${tenantId.value}/appointments/range-summary`, {
      credentials: "include",
      query: { from: range.from, to: range.to },
    });
  } catch (e: unknown) {
    summary.value = null;
    error.value = apiMessage(e, t("dataPage.summaryFailed"));
  } finally {
    summaryLoading.value = false;
  }
}

// --- Export ---

const exporting = ref(false);

async function downloadCsv(query: Record<string, string>, fallbackName: string) {
  const response = await $fetch.raw<Blob>(`/api/v1/tenants/${tenantId.value}/appointments/export`, {
    credentials: "include",
    query,
    responseType: "blob",
  });
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(response._data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportCsv() {
  if (!rangeValid.value) return;
  exporting.value = true;
  error.value = "";
  info.value = "";
  try {
    await downloadCsv({ from: range.from, to: range.to }, "termine.csv");
    info.value = t("dataPage.exported", { count: summary.value?.active ?? 0 });
  } catch (e: unknown) {
    error.value = apiMessage(e, t("dataPage.exportFailed"));
  } finally {
    exporting.value = false;
  }
}

async function downloadTemplate() {
  try {
    await downloadCsv({ template: "1" }, "termine_vorlage.csv");
  } catch (e: unknown) {
    error.value = apiMessage(e, t("dataPage.templateFailed"));
  }
}

// --- Import ---

const fileInput = ref<HTMLInputElement | null>(null);
const importFileName = ref("");
const importCsv = ref("");
const importResult = ref<ImportResult | null>(null);
const importing = ref(false);

/** Excel often saves CSV as Windows-1252; fall back to it when the file is not valid UTF-8. */
async function readFileText(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

async function runImport(dryRun: boolean) {
  if (!importCsv.value) return;
  importing.value = true;
  error.value = "";
  info.value = "";
  try {
    const result = await $fetch<ImportResult>(`/api/v1/tenants/${tenantId.value}/appointments/import`, {
      method: "POST",
      credentials: "include",
      body: { csv: importCsv.value, dryRun },
    });
    importResult.value = result;
    if (result.imported) {
      info.value = result.newCustomers
        ? t("dataPage.importedWithCustomers", { count: result.toCreate, customers: result.newCustomers })
        : t("dataPage.imported", { count: result.toCreate });
      resetImport(false);
      await loadSummary();
    }
  } catch (e: unknown) {
    importResult.value = null;
    error.value = apiMessage(e, t("dataPage.importFailed"));
  } finally {
    importing.value = false;
  }
}

async function onFileSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  importResult.value = null;
  if (!file) return;
  importFileName.value = file.name;
  importCsv.value = await readFileText(file);
  await runImport(true);
}

function resetImport(clearResult = true) {
  importCsv.value = "";
  importFileName.value = "";
  if (clearResult) importResult.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

const canImport = computed(
  () => Boolean(importCsv.value && importResult.value && !importResult.value.errors.length && importResult.value.toCreate > 0),
);

// --- Delete ---

const confirmWord = computed(() => t("dataPage.confirmWord"));
const deleteMode = ref<"soft" | "permanent">("soft");
const canPurge = computed(() => Boolean(user.value?.isSuperadmin));
const deleteModeItems = computed(() => [
  {
    value: "soft",
    label: t("dataPage.deleteSoft"),
    description: t("dataPage.deleteSoftHint"),
  },
  {
    value: "permanent",
    label: t("dataPage.deleteHard"),
    description: t("dataPage.deleteHardHint"),
  },
]);
const deleteConfirm = ref("");
const deleting = ref(false);

const deleteCount = computed(() => {
  if (!summary.value) return 0;
  return deleteMode.value === "permanent" ? summary.value.active + summary.value.inTrash : summary.value.active;
});
const canDelete = computed(
  () => deleteCount.value > 0 && deleteConfirm.value.trim().toUpperCase() === confirmWord.value.toUpperCase() && !summaryLoading.value,
);

async function deleteRange() {
  if (!canDelete.value) return;
  deleting.value = true;
  error.value = "";
  info.value = "";
  try {
    const result = await $fetch<{ deleted: number; mode: "soft" | "permanent" }>(
      `/api/v1/tenants/${tenantId.value}/appointments/range-delete`,
      {
        method: "POST",
        credentials: "include",
        body: { from: range.from, to: range.to, mode: deleteMode.value, expectedCount: deleteCount.value },
      },
    );
    info.value =
      result.mode === "permanent"
        ? t("dataPage.deletedPermanent", { count: result.deleted })
        : t("dataPage.deletedSoft", { count: result.deleted });
    deleteConfirm.value = "";
  } catch (e: unknown) {
    error.value = apiMessage(e, t("common.deleteFailed"));
  } finally {
    deleting.value = false;
    await loadSummary();
  }
}

onMounted(loadSummary);
watch(() => [range.from, range.to, tenantId.value], () => {
  deleteConfirm.value = "";
  loadSummary();
});
watch(deleteMode, () => {
  deleteConfirm.value = "";
});
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div>
      <p class="text-sm text-muted font-medium">{{ t("dataPage.breadcrumb") }}</p>
      <h1 class="font-display text-3xl sm:text-4xl">{{ t("dataPage.title") }}</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {{ t("dataPage.subtitle", { tenant: primaryTenant?.tenantName || "—" }) }}
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <div
      v-if="!primaryTenant"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      {{ t("dataPage.membershipRequired") }}
    </div>

    <template v-else>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-calendar-range" class="size-5 text-primary" />
            <h2 class="font-medium">{{ t("dataPage.range") }}</h2>
          </div>
        </template>
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField :label="t('common.from')">
              <UInput v-model="range.from" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="t('dataPage.toInclusive')">
              <UInput v-model="range.to" type="date" class="w-full" />
            </UFormField>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="preset in presets"
              :key="preset.label"
              size="xs"
              :variant="range.from === preset.from && range.to === preset.to ? 'soft' : 'outline'"
              :color="range.from === preset.from && range.to === preset.to ? 'primary' : 'neutral'"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </UButton>
          </div>
          <p v-if="!rangeValid" class="text-sm text-error">{{ t("dataPage.rangeOrder") }}</p>
          <div v-else class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-medium">
              <template v-if="summaryLoading">{{ t("common.loading") }}</template>
              <template v-else>{{ t("dataPage.inRange", { count: summary?.active ?? 0 }) }}</template>
            </span>
            <template v-if="summary && !summaryLoading">
              <UBadge
                v-for="(count, status) in summary.byStatus"
                v-show="count"
                :key="status"
                :color="statusColors[status]"
                variant="subtle"
              >
                {{ statusLabels[status] }}: {{ count }}
              </UBadge>
              <UBadge v-if="summary.inTrash" color="neutral" variant="outline">
                {{ t("dataPage.trash", { count: summary.inTrash }) }}
              </UBadge>
            </template>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-download" class="size-5 text-primary" />
            <h2 class="font-medium">{{ t("dataPage.export") }}</h2>
          </div>
        </template>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="text-sm text-neutral-600 dark:text-neutral-400 max-w-xl">
            {{ t("dataPage.exportHint", { range: rangeLabel }) }}
          </p>
          <UButton
            icon="i-lucide-file-down"
            :loading="exporting"
            :disabled="!rangeValid || !summary?.active"
            @click="exportCsv"
          >
            {{ t("dataPage.exportCsv") }}
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-upload" class="size-5 text-primary" />
              <h2 class="font-medium">{{ t("dataPage.import") }}</h2>
            </div>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-file-spreadsheet" @click="downloadTemplate">
              {{ t("dataPage.downloadTemplate") }}
            </UButton>
          </div>
        </template>
        <div class="space-y-4">
          <div class="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
            <p>{{ t("dataPage.requiredColumns") }}</p>
            <p>{{ t("dataPage.validateFirst") }}</p>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              @change="onFileSelected"
            />
            <UButton
              variant="outline"
              color="neutral"
              icon="i-lucide-file-up"
              :loading="importing && !importResult"
              @click="fileInput?.click()"
            >
              {{ t("dataPage.chooseFile") }}
            </UButton>
            <span v-if="importFileName" class="text-sm truncate max-w-xs">{{ importFileName }}</span>
            <UButton
              v-if="importFileName"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              :aria-label="t('dataPage.removeFile')"
              @click="resetImport()"
            />
          </div>

          <div v-if="importResult && !importResult.imported" class="space-y-3">
            <div class="flex flex-wrap gap-2 text-sm">
              <UBadge color="neutral" variant="subtle">{{ t("dataPage.rows", { count: importResult.totalRows }) }}</UBadge>
              <UBadge color="primary" variant="subtle">{{ t("dataPage.toCreate", { count: importResult.toCreate }) }}</UBadge>
              <UBadge v-if="importResult.skipped" color="neutral" variant="outline">
                {{ t("dataPage.skipped", { count: importResult.skipped }) }}
              </UBadge>
              <UBadge v-if="importResult.newCustomers" color="success" variant="subtle">
                {{ t("dataPage.newCustomers", { count: importResult.newCustomers }) }}
              </UBadge>
              <UBadge v-if="importResult.errors.length" color="error" variant="subtle">
                {{ t("dataPage.errors", { count: importResult.errors.length }) }}
              </UBadge>
            </div>

            <div
              v-if="importResult.errors.length"
              class="rounded-md border border-error/30 bg-error/5 p-3 max-h-64 overflow-y-auto"
            >
              <p class="text-sm font-medium text-error mb-2">{{ t("dataPage.fixAndRetry") }}</p>
              <ul class="space-y-1 text-sm">
                <li v-for="issue in importResult.errors.slice(0, 100)" :key="issue.line">
                  <span class="font-mono text-xs text-neutral-500">{{ t("dataPage.line", { line: issue.line }) }}</span>
                  · {{ issue.message }}
                </li>
              </ul>
              <p v-if="importResult.errors.length > 100" class="mt-2 text-xs text-neutral-500">
                {{ t("dataPage.moreErrors", { count: importResult.errors.length - 100 }) }}
              </p>
            </div>

            <UButton
              icon="i-lucide-check"
              :loading="importing"
              :disabled="!canImport || importing"
              @click="runImport(false)"
            >
              {{ t("dataPage.importCount", { count: importResult.toCreate }) }}
            </UButton>
          </div>
        </div>
      </UCard>

      <UCard class="ring-1 ring-error/30">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-trash-2" class="size-5 text-error" />
            <h2 class="font-medium">{{ t("dataPage.deleteRange") }}</h2>
          </div>
        </template>
        <div class="space-y-4">
          <URadioGroup v-if="canPurge" v-model="deleteMode" :items="deleteModeItems" />
          <p v-else class="text-sm text-muted">
            {{ t("dataPage.softHint") }}
          </p>

          <UAlert
            v-if="deleteMode === 'permanent'"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('dataPage.permanentWarning')"
          />

          <UFormField :label="t('dataPage.confirmLabel', { word: confirmWord })">
            <UInput v-model="deleteConfirm" class="w-full sm:w-64" autocomplete="off" :placeholder="confirmWord" />
          </UFormField>

          <UButton
            color="error"
            :variant="deleteMode === 'permanent' ? 'solid' : 'soft'"
            icon="i-lucide-trash-2"
            :loading="deleting"
            :disabled="!canDelete || deleting"
            @click="deleteRange"
          >
            {{
              t("dataPage.deleteButton", {
                count: deleteCount,
                range: rangeLabel,
                mode: deleteMode === "permanent" ? t("dataPage.deletePermanent") : t("dataPage.deleteSoftVerb"),
              })
            }}
          </UButton>
        </div>
      </UCard>
    </template>
  </UContainer>
</template>
