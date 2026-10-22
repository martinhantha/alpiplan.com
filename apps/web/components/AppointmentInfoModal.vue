<script setup lang="ts">
import { computed } from "vue";
import { useAuth } from "../composables/useAuth";
import { useAppointmentStatus } from "../composables/useAppointmentStatus";
import { useAppLocale } from "../composables/useAppLocale";
import {
  formatTeachersForViewer,
  resolveAppointmentPhone,
  type AppointmentContactSource,
} from "../utils/appointment-contact";

interface InfoAppointment extends AppointmentContactSource {
  startsAt: string;
  endsAt: string;
  status: string;
  unstructuredNote?: string | null;
  teacher?: { id: string; displayName: string } | null;
  teachers?: { id: string; displayName: string }[] | null;
  resource?: { name: string } | null;
  lessonType?: { name: string } | null;
  customer?: {
    displayName?: string | null;
    phones?: { e164: string | null; raw: string | null; isPrimary: boolean }[] | null;
  } | null;
}

const props = withDefaults(
  defineProps<{
    appointment?: InfoAppointment | null;
    canEdit?: boolean;
  }>(),
  { appointment: null, canEdit: false },
);

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  edit: [];
}>();

const { primaryTenant, teacherLabel, resourcesEnabled, canPlanAllAppointments } = useAuth();
const { appointmentStatusLabel, appointmentStatusColor } = useAppointmentStatus();
const { t, intlLocale } = useAppLocale();

const title = computed(() => {
  const appointment = props.appointment;
  if (!appointment) return "";
  return appointment.customer?.displayName || appointment.appointmentContactText || t("home.noContact");
});

const contactText = computed(() => {
  const text = props.appointment?.appointmentContactText?.trim();
  if (!text || text === title.value) return "";
  return text;
});

const phone = computed(() => (props.appointment ? resolveAppointmentPhone(props.appointment) : null));

const teachers = computed(() => {
  if (!props.appointment) return "";
  return formatTeachersForViewer(props.appointment, {
    teacherProfileId: primaryTenant.value?.teacherProfileId,
    canManageTenant: canPlanAllAppointments.value,
  });
});

const whenLabel = computed(() => {
  const appointment = props.appointment;
  if (!appointment) return "";
  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  const date = new Intl.DateTimeFormat(intlLocale.value, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat(intlLocale.value, { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time.format(start)}–${time.format(end)}`;
});

const modalUi = {
  overlay: "bg-elevated/75",
  content:
    "max-w-md w-[calc(100vw-1rem)] flex flex-col overflow-hidden top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 " +
    "max-h-[min(90dvh,calc(100dvh-var(--app-safe-top)-var(--app-safe-bottom)-0.5rem))] rounded-xl shadow-lg ring ring-default",
  header: "px-4 py-3 shrink-0 border-b border-neutral-200/80 dark:border-neutral-800/80",
  body: "flex-1 min-h-0 overflow-y-auto px-4 py-3",
  footer: "px-4 py-3 shrink-0 border-t border-neutral-200/80 dark:border-neutral-800/80",
};

function close() {
  open.value = false;
}

function edit() {
  emit("edit");
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :ui="modalUi">
    <template #header>
      <div class="flex w-full items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate font-medium">{{ title }}</h2>
          <UBadge
            v-if="appointment && appointmentStatusLabel(appointment.status)"
            :color="appointmentStatusColor(appointment.status)"
            variant="subtle"
            class="mt-1.5"
          >
            {{ appointmentStatusLabel(appointment.status) }}
          </UBadge>
        </div>
        <UButton size="md" variant="ghost" color="neutral" icon="i-lucide-x" @click="close" />
      </div>
    </template>
    <template v-if="appointment" #body>
      <dl class="space-y-3 text-sm">
        <div>
          <dt class="text-xs text-neutral-500">{{ t("appointment.info.time") }}</dt>
          <dd class="mt-0.5">{{ whenLabel }}</dd>
        </div>
        <div v-if="appointment.customer?.displayName">
          <dt class="text-xs text-neutral-500">{{ t("quickCapture.customer") }}</dt>
          <dd class="mt-0.5">{{ appointment.customer.displayName }}</dd>
        </div>
        <div v-if="contactText">
          <dt class="text-xs text-neutral-500">{{ t("appointment.info.contact") }}</dt>
          <dd class="mt-0.5 whitespace-pre-wrap">{{ contactText }}</dd>
        </div>
        <div v-if="phone">
          <dt class="text-xs text-neutral-500">{{ t("quickCapture.phone") }}</dt>
          <dd class="mt-0.5">
            <a :href="`tel:${phone}`" class="text-primary-600 hover:underline dark:text-primary-400">{{ phone }}</a>
          </dd>
        </div>
        <div v-if="teachers">
          <dt class="text-xs text-neutral-500">{{ teacherLabel }}</dt>
          <dd class="mt-0.5">{{ teachers }}</dd>
        </div>
        <div v-if="appointment.lessonType">
          <dt class="text-xs text-neutral-500">{{ t("quickCapture.lessonType") }}</dt>
          <dd class="mt-0.5">{{ appointment.lessonType.name }}</dd>
        </div>
        <div v-if="resourcesEnabled && appointment.resource">
          <dt class="text-xs text-neutral-500">{{ t("quickCapture.resource") }}</dt>
          <dd class="mt-0.5">{{ appointment.resource.name }}</dd>
        </div>
        <div v-if="appointment.unstructuredNote?.trim()">
          <dt class="text-xs text-neutral-500">{{ t("appointment.info.note") }}</dt>
          <dd class="mt-0.5 whitespace-pre-wrap">{{ appointment.unstructuredNote }}</dd>
        </div>
      </dl>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="close">{{ t("quickCapture.close") }}</UButton>
        <UButton v-if="canEdit" color="primary" icon="i-lucide-pencil" @click="edit">
          {{ t("home.editAppointment") }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
