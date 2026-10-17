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
const tenantId = computed(() => primaryTenant.value?.tenantId ?? "");

const statusLabels: Record<AppointmentStatus, string> = {
  draft: "Entwurf",
  confirmed: "Bestätigt",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};
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
    { label: "Dieser Monat", from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    { label: "Dieses Jahr", from: `${thisYear}-01-01`, to: `${thisYear}-12-31` },
    { label: "Letztes Jahr", from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
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
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
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
    error.value = apiMessage(e, "Übersicht konnte nicht geladen werden");
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
    info.value = `${summary.value?.active ?? ""} Termine exportiert`.trim();
  } catch (e: unknown) {
    error.value = apiMessage(e, "Export fehlgeschlagen");
  } finally {
    exporting.value = false;
  }
}

async function downloadTemplate() {
  try {
    await downloadCsv({ template: "1" }, "termine_vorlage.csv");
  } catch (e: unknown) {
    error.value = apiMessage(e, "Vorlage konnte nicht geladen werden");
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
      info.value = `${result.toCreate} Termine importiert${result.newCustomers ? ` · ${result.newCustomers} neue Kunden` : ""}`;
      resetImport(false);
      await loadSummary();
    }
  } catch (e: unknown) {
    importResult.value = null;
    error.value = apiMessage(e, "Import fehlgeschlagen");
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

const CONFIRM_WORD = "LÖSCHEN";
const deleteMode = ref<"soft" | "permanent">("soft");
const canPurge = computed(() => Boolean(user.value?.isSuperadmin));
const deleteModeItems = [
  {
    value: "soft",
    label: "In den Papierkorb verschieben",
    description: "Termine verschwinden aus Kalender und Listen, können im Papierkorb einzeln wiederhergestellt werden.",
  },
  {
    value: "permanent",
    label: "Endgültig aus der Datenbank löschen",
    description: "Entfernt alle Termine im Zeitraum inkl. Papierkorb unwiderruflich. Vorher am besten exportieren.",
  },
];
const deleteConfirm = ref("");
const deleting = ref(false);

const deleteCount = computed(() => {
  if (!summary.value) return 0;
  return deleteMode.value === "permanent" ? summary.value.active + summary.value.inTrash : summary.value.active;
});
const canDelete = computed(
  () => deleteCount.value > 0 && deleteConfirm.value.trim().toUpperCase() === CONFIRM_WORD && !summaryLoading.value,
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
        ? `${result.deleted} Termine endgültig gelöscht`
        : `${result.deleted} Termine in den Papierkorb verschoben`;
    deleteConfirm.value = "";
  } catch (e: unknown) {
    error.value = apiMessage(e, "Löschen fehlgeschlagen");
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
      <p class="text-sm text-muted font-medium">Alpiplan · Termin-Daten</p>
      <h1 class="font-display text-3xl sm:text-4xl">Termin-Daten</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Termine von <strong>{{ primaryTenant?.tenantName || "—" }}</strong> als CSV exportieren, importieren oder für
        einen Zeitraum löschen.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
    <UAlert v-if="info" color="success" variant="soft" icon="i-lucide-circle-check" :title="info" />

    <div
      v-if="!primaryTenant"
      class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-600 dark:text-neutral-400"
    >
      Für die Datenverwaltung brauchst du eine Mandanten-Mitgliedschaft.
    </div>

    <template v-else>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-calendar-range" class="size-5 text-primary" />
            <h2 class="font-medium">Zeitraum</h2>
          </div>
        </template>
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Von">
              <UInput v-model="range.from" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Bis (einschließlich)">
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
          <p v-if="!rangeValid" class="text-sm text-error">„Von“ darf nicht nach „Bis“ liegen.</p>
          <div v-else class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-medium">
              <template v-if="summaryLoading">Wird geladen …</template>
              <template v-else>{{ summary?.active ?? 0 }} Termine im Zeitraum</template>
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
                Papierkorb: {{ summary.inTrash }}
              </UBadge>
            </template>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-download" class="size-5 text-primary" />
            <h2 class="font-medium">Exportieren</h2>
          </div>
        </template>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="text-sm text-neutral-600 dark:text-neutral-400 max-w-xl">
            Alle Termine im Zeitraum {{ rangeLabel }} als CSV (Trennzeichen „;“, UTF-8) – direkt in Excel, Numbers
            oder LibreOffice zu öffnen. Zeiten in Ortszeit (Europe/Rome).
          </p>
          <UButton
            icon="i-lucide-file-down"
            :loading="exporting"
            :disabled="!rangeValid || !summary?.active"
            @click="exportCsv"
          >
            CSV exportieren
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-upload" class="size-5 text-primary" />
              <h2 class="font-medium">Importieren</h2>
            </div>
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-file-spreadsheet" @click="downloadTemplate">
              Vorlage herunterladen
            </UButton>
          </div>
        </template>
        <div class="space-y-4">
          <div class="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
            <p>
              Pflichtspalten: <strong>Beginn</strong> und <strong>Ende</strong> (z. B. <code>2026-12-27 10:00</code>
              oder <code>27.12.2026 10:00</code>). Termintyp, Lehrer und Ressource müssen mit vorhandenen Namen
              übereinstimmen; unbekannte Kunden werden neu angelegt.
            </p>
            <p>
              Die Datei wird zuerst geprüft – importiert wird nur, wenn alle Zeilen gültig sind. Termine mit einer
              bereits vorhandenen ID werden übersprungen. Es findet keine Konfliktprüfung statt.
            </p>
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
              CSV-Datei wählen
            </UButton>
            <span v-if="importFileName" class="text-sm truncate max-w-xs">{{ importFileName }}</span>
            <UButton
              v-if="importFileName"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              aria-label="Datei entfernen"
              @click="resetImport()"
            />
          </div>

          <div v-if="importResult && !importResult.imported" class="space-y-3">
            <div class="flex flex-wrap gap-2 text-sm">
              <UBadge color="neutral" variant="subtle">{{ importResult.totalRows }} Zeilen</UBadge>
              <UBadge color="primary" variant="subtle">{{ importResult.toCreate }} neu</UBadge>
              <UBadge v-if="importResult.skipped" color="neutral" variant="outline">
                {{ importResult.skipped }} übersprungen
              </UBadge>
              <UBadge v-if="importResult.newCustomers" color="success" variant="subtle">
                {{ importResult.newCustomers }} neue Kunden
              </UBadge>
              <UBadge v-if="importResult.errors.length" color="error" variant="subtle">
                {{ importResult.errors.length }} Fehler
              </UBadge>
            </div>

            <div
              v-if="importResult.errors.length"
              class="rounded-md border border-error/30 bg-error/5 p-3 max-h-64 overflow-y-auto"
            >
              <p class="text-sm font-medium text-error mb-2">Bitte korrigieren und Datei erneut wählen:</p>
              <ul class="space-y-1 text-sm">
                <li v-for="issue in importResult.errors.slice(0, 100)" :key="issue.line">
                  <span class="font-mono text-xs text-neutral-500">Zeile {{ issue.line }}</span>
                  · {{ issue.message }}
                </li>
              </ul>
              <p v-if="importResult.errors.length > 100" class="mt-2 text-xs text-neutral-500">
                … und {{ importResult.errors.length - 100 }} weitere
              </p>
            </div>

            <UButton
              icon="i-lucide-check"
              :loading="importing"
              :disabled="!canImport || importing"
              @click="runImport(false)"
            >
              {{ importResult.toCreate }} Termine importieren
            </UButton>
          </div>
        </div>
      </UCard>

      <UCard class="ring-1 ring-error/30">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-trash-2" class="size-5 text-error" />
            <h2 class="font-medium">Zeitraum löschen</h2>
          </div>
        </template>
        <div class="space-y-4">
          <URadioGroup v-if="canPurge" v-model="deleteMode" :items="deleteModeItems" />
          <p v-else class="text-sm text-muted">
            Termine im Zeitraum werden in den Papierkorb verschoben und können dort einzeln wiederhergestellt werden.
          </p>

          <UAlert
            v-if="deleteMode === 'permanent'"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Dieser Vorgang kann nicht rückgängig gemacht werden."
          />

          <UFormField :label="`Zur Bestätigung „${CONFIRM_WORD}“ eingeben`">
            <UInput v-model="deleteConfirm" class="w-full sm:w-64" autocomplete="off" :placeholder="CONFIRM_WORD" />
          </UFormField>

          <UButton
            color="error"
            :variant="deleteMode === 'permanent' ? 'solid' : 'soft'"
            icon="i-lucide-trash-2"
            :loading="deleting"
            :disabled="!canDelete || deleting"
            @click="deleteRange"
          >
            {{ deleteCount }} Termine im Zeitraum {{ rangeLabel }}
            {{ deleteMode === "permanent" ? "endgültig löschen" : "löschen" }}
          </UButton>
        </div>
      </UCard>
    </template>
  </UContainer>
</template>
