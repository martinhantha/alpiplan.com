<script setup lang="ts">
import { Capacitor } from "@capacitor/core";
import { AlpiplanDevice } from "@alpiplan/capacitor-call-hints";
import { computed, ref } from "vue";
import { useAuth } from "../composables/useAuth";
import { useDeviceCapabilities } from "../composables/useDeviceCapabilities";
import { useDeviceContactLookup } from "../composables/useDeviceContactLookup";
import { useWhatsAppPreference } from "../composables/useWhatsAppPreference";
import {
  resolveAppointmentDisplayName,
  resolveAppointmentPhone,
  resolveContactOrganization,
  toTelHref,
  type AppointmentContactSource,
} from "../utils/appointment-contact";
import { toWhatsAppHref, whatsappAppLabel } from "../utils/whatsapp";

const props = withDefaults(
  defineProps<{
    appointment: AppointmentContactSource & { status: string };
    loading?: boolean;
    compact?: boolean;
    showComplete?: boolean;
    showDelete?: boolean;
    showEdit?: boolean;
  }>(),
  {
    loading: false,
    compact: false,
    showComplete: true,
    showDelete: true,
    showEdit: true,
  },
);

const emit = defineEmits<{
  complete: [];
  delete: [];
  edit: [];
}>();

const { device } = useDeviceCapabilities();
const { primaryTenant } = useAuth();
const { whatsappApp } = useWhatsAppPreference();
const savingContact = ref(false);
const removingContact = ref(false);
const contactSaveState = ref<"idle" | "saved" | "error" | "removed">("idle");

const phone = computed(() => resolveAppointmentPhone(props.appointment));
const { lookup, checking: checkingContact, canDelete: canDeleteDeviceContact, savedOnDevice, refresh: refreshContact } =
  useDeviceContactLookup(phone);
const telHref = computed(() => (phone.value ? toTelHref(phone.value) : null));
const whatsappHref = computed(() => (phone.value ? toWhatsAppHref(phone.value) : null));
const whatsappLabel = computed(() => whatsappAppLabel(whatsappApp.value));

async function onWhatsAppClick(event: Event) {
  if (whatsappApp.value !== "business" || !Capacitor.isNativePlatform()) return;
  event.preventDefault();
  if (!phone.value) return;
  try {
    await AlpiplanDevice.openWhatsApp({ phone: phone.value, app: "business" });
  } catch {
    // WhatsApp Business missing or native plugin not yet rebuilt.
  }
}

const canSaveContact = computed(
  () => device.value.features.saveContact && Boolean(phone.value) && !savedOnDevice.value,
);
const canRemoveContact = computed(
  () => canDeleteDeviceContact.value && savedOnDevice.value && Boolean(phone.value),
);
const canComplete = computed(
  () =>
    props.showComplete &&
    props.appointment.status !== "completed" &&
    props.appointment.status !== "cancelled",
);
const canDelete = computed(() => props.showDelete);
const canEdit = computed(() => props.showEdit);
const hasActions = computed(
  () =>
    Boolean(
      telHref.value ||
        whatsappHref.value ||
        canSaveContact.value ||
        canRemoveContact.value ||
        canEdit.value ||
        canComplete.value ||
        canDelete.value,
    ),
);

async function saveDeviceContact() {
  if (!phone.value || !canSaveContact.value) return;
  savingContact.value = true;
  contactSaveState.value = "idle";
  try {
    await device.value.saveOrUpdateDeviceContact({
      displayName: resolveAppointmentDisplayName(props.appointment, primaryTenant.value?.tenantName),
      phoneE164: phone.value,
      organization: resolveContactOrganization(primaryTenant.value?.tenantName),
    });
    await refreshContact();
    contactSaveState.value = "saved";
  } catch {
    contactSaveState.value = "error";
  } finally {
    savingContact.value = false;
  }
}

async function removeDeviceContact() {
  if (!phone.value || !canRemoveContact.value) return;
  const name = lookup.value.match?.displayName?.trim();
  const label = name ? `Kontakt „${name}“` : "Diesen Kontakt";
  const ok = window.confirm(
    lookup.value.match?.googleSynced
      ? `${label} ist mit Google Kontakte synchronisiert und wird dort ebenfalls gelöscht. Fortfahren?`
      : `${label} wirklich vom Telefon entfernen?`,
  );
  if (!ok) return;
  removingContact.value = true;
  contactSaveState.value = "idle";
  try {
    await device.value.deleteDeviceContact(phone.value);
    await refreshContact();
    contactSaveState.value = "removed";
  } catch {
    contactSaveState.value = "error";
  } finally {
    removingContact.value = false;
  }
}
</script>

<template>
  <div v-if="hasActions" class="flex flex-wrap items-center justify-end gap-1.5">
    <UButton
      v-if="telHref"
      :href="telHref"
      :size="compact ? 'xs' : 'sm'"
      color="neutral"
      variant="soft"
      icon="i-lucide-phone"
      :square="compact"
      aria-label="Anrufen"
      title="Anrufen"
    >
      <span v-if="!compact" class="hidden sm:inline">Anrufen</span>
    </UButton>
    <UButton
      v-if="whatsappHref"
      :href="whatsappHref"
      target="_blank"
      rel="noopener noreferrer"
      :size="compact ? 'xs' : 'sm'"
      color="success"
      variant="soft"
      icon="i-lucide-message-circle"
      :square="compact"
      :aria-label="`${whatsappLabel} öffnen`"
      :title="whatsappLabel"
      @click="onWhatsAppClick"
    >
      <span v-if="!compact" class="hidden sm:inline">{{ whatsappLabel }}</span>
    </UButton>
    <UButton
      v-if="canSaveContact"
      :size="compact ? 'xs' : 'sm'"
      color="neutral"
      variant="soft"
      icon="i-lucide-user-plus"
      :loading="savingContact || checkingContact"
      :square="compact"
      aria-label="Kontakt aufs Telefon speichern"
      title="Kontakt aufs Telefon speichern"
      @click="saveDeviceContact"
    >
      <span v-if="!compact" class="hidden sm:inline">
        {{ contactSaveState === "error" ? "Fehler" : "Kontakt" }}
      </span>
    </UButton>
    <UButton
      v-else-if="canRemoveContact"
      :size="compact ? 'xs' : 'sm'"
      color="neutral"
      variant="soft"
      icon="i-lucide-user-minus"
      :loading="removingContact || checkingContact"
      :square="compact"
      :aria-label="lookup.match?.googleSynced ? 'Aus Google Kontakte entfernen' : 'Kontakt vom Telefon entfernen'"
      :title="
        lookup.match?.displayName
          ? `Gespeichert als „${lookup.match.displayName}“ – ${lookup.match.googleSynced ? 'aus Google Kontakte entfernen' : 'vom Telefon entfernen'}`
          : lookup.match?.googleSynced
            ? 'Aus Google Kontakte entfernen'
            : 'Kontakt vom Telefon entfernen'
      "
      @click="removeDeviceContact"
    >
      <span v-if="!compact" class="hidden sm:inline">
        {{ contactSaveState === "error" ? "Fehler" : "Entfernen" }}
      </span>
    </UButton>
    <UButton
      v-if="canEdit"
      :size="compact ? 'xs' : 'sm'"
      color="neutral"
      variant="soft"
      icon="i-lucide-pencil"
      :square="compact"
      aria-label="Termin bearbeiten"
      title="Bearbeiten"
      @click="emit('edit')"
    >
      <span v-if="!compact" class="hidden sm:inline">Bearbeiten</span>
    </UButton>
    <UButton
      v-if="canComplete"
      :size="compact ? 'xs' : 'sm'"
      color="success"
      :variant="compact ? 'ghost' : 'soft'"
      icon="i-lucide-check"
      :loading="loading"
      :square="compact"
      aria-label="Als erledigt markieren"
      title="Erledigt"
      @click="emit('complete')"
    >
      <span v-if="!compact" class="hidden sm:inline">Erledigt</span>
    </UButton>
    <UButton
      v-if="canDelete"
      :size="compact ? 'xs' : 'sm'"
      color="error"
      :variant="compact ? 'ghost' : 'soft'"
      icon="i-lucide-trash-2"
      :loading="loading"
      :square="compact"
      aria-label="Termin löschen"
      title="Löschen"
      @click="emit('delete')"
    >
      <span v-if="!compact" class="hidden sm:inline">Löschen</span>
    </UButton>
  </div>
</template>
