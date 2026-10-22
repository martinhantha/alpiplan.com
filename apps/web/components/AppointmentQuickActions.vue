<script setup lang="ts">
import { Capacitor } from "@capacitor/core";
import { AlpiplanDevice } from "@alpiplan/capacitor-call-hints";
import type { DropdownMenuItem } from "@nuxt/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
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
    showDuplicate?: boolean;
  }>(),
  {
    loading: false,
    compact: false,
    showComplete: true,
    showDelete: true,
    showEdit: true,
    showDuplicate: false,
  },
);

const emit = defineEmits<{
  complete: [];
  delete: [];
  edit: [];
  duplicate: [];
}>();

const { t } = useI18n();
const { device } = useDeviceCapabilities();
const { primaryTenant } = useAuth();
const { whatsappApp } = useWhatsAppPreference();
const savingContact = ref(false);
const removingContact = ref(false);
const contactSaveState = ref<"idle" | "saved" | "error" | "removed">("idle");

/** Ab 1500px: alle Buttons sichtbar; darunter Telefon/WhatsApp/Erledigt + ⋮-Menü. */
const isWideLayout = ref(true);
let wideMedia: MediaQueryList | null = null;

function syncWideLayout() {
  isWideLayout.value = wideMedia?.matches ?? true;
}

onMounted(() => {
  wideMedia = window.matchMedia("(min-width: 1500px)");
  syncWideLayout();
  wideMedia.addEventListener("change", syncWideLayout);
});

onUnmounted(() => {
  wideMedia?.removeEventListener("change", syncWideLayout);
});

const phone = computed(() => resolveAppointmentPhone(props.appointment));
const { lookup, checking: checkingContact, canDelete: canDeleteDeviceContact, savedOnDevice, refresh: refreshContact } =
  useDeviceContactLookup(phone);
const telHref = computed(() => (phone.value ? toTelHref(phone.value) : null));
const whatsappHref = computed(() => (phone.value ? toWhatsAppHref(phone.value) : null));
const whatsappLabel = computed(() => whatsappAppLabel(whatsappApp.value));

const btnSize = computed(() => (props.compact ? "xs" : "sm"));
const iconOnlyPrimary = computed(() => props.compact || !isWideLayout.value);
const showLabels = computed(() => !props.compact && isWideLayout.value);

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
const canDuplicate = computed(() => props.showDuplicate);

const overflowItems = computed((): DropdownMenuItem[][] => {
  const items: DropdownMenuItem[] = [];
  if (canSaveContact.value) {
    items.push({
      label: t("actions.saveContact"),
      icon: "i-lucide-user-plus",
      onSelect: () => void saveDeviceContact(),
    });
  } else if (canRemoveContact.value) {
    items.push({
      label: lookup.value.match?.googleSynced ? t("actions.removeFromGoogle") : t("actions.removeContact"),
      icon: "i-lucide-user-minus",
      onSelect: () => void removeDeviceContact(),
    });
  }
  if (canEdit.value) {
    items.push({ label: t("common.edit"), icon: "i-lucide-pencil", onSelect: () => emit("edit") });
  }
  if (canDuplicate.value) {
    items.push({ label: t("common.duplicate"), icon: "i-lucide-copy-plus", onSelect: () => emit("duplicate") });
  }
  if (canDelete.value) {
    items.push({
      label: t("common.delete"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => emit("delete"),
    });
  }
  return items.length ? [items] : [];
});

const showOverflowMenu = computed(() => !isWideLayout.value && overflowItems.value.length > 0);

const hasActions = computed(
  () =>
    Boolean(
      telHref.value ||
        whatsappHref.value ||
        canSaveContact.value ||
        canRemoveContact.value ||
        canEdit.value ||
        canDuplicate.value ||
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
  const label = name ? t("actions.namedContact", { name }) : t("actions.thisContact");
  const ok = window.confirm(
    lookup.value.match?.googleSynced
      ? t("actions.confirmRemoveGoogle", { label })
      : t("actions.confirmRemovePhone", { label }),
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
  <div
    v-if="hasActions"
    class="ml-auto flex shrink-0 items-center justify-end gap-1.5"
    :class="isWideLayout ? 'flex-wrap' : 'flex-nowrap'"
  >
    <UButton
      v-if="telHref"
      :href="telHref"
      :size="btnSize"
      color="neutral"
      variant="soft"
      icon="i-lucide-phone"
      :square="iconOnlyPrimary"
      :aria-label="t('actions.call')"
      :title="t('actions.call')"
    >
      <span v-if="showLabels">{{ t("actions.call") }}</span>
    </UButton>
    <UButton
      v-if="whatsappHref"
      :href="whatsappHref"
      target="_blank"
      rel="noopener noreferrer"
      :size="btnSize"
      color="success"
      variant="soft"
      icon="i-lucide-message-circle"
      :square="iconOnlyPrimary"
      :aria-label="t('actions.openWhatsapp', { app: whatsappLabel })"
      :title="whatsappLabel"
      @click="onWhatsAppClick"
    >
      <span v-if="showLabels">{{ whatsappLabel }}</span>
    </UButton>
    <UButton
      v-if="canSaveContact && isWideLayout"
      :size="btnSize"
      color="neutral"
      variant="soft"
      icon="i-lucide-user-plus"
      :loading="savingContact || checkingContact"
      :square="compact"
      :aria-label="t('actions.saveContactPhone')"
      :title="t('actions.saveContactPhone')"
      @click="saveDeviceContact"
    >
      <span v-if="showLabels">{{ contactSaveState === "error" ? t("common.error") : t("actions.contact") }}</span>
    </UButton>
    <UButton
      v-else-if="canRemoveContact && isWideLayout"
      :size="btnSize"
      color="neutral"
      variant="soft"
      icon="i-lucide-user-minus"
      :loading="removingContact || checkingContact"
      :square="compact"
      :aria-label="lookup.match?.googleSynced ? t('actions.removeFromGoogle') : t('actions.removeFromPhone')"
      :title="
        lookup.match?.displayName
          ? lookup.match.googleSynced
            ? t('actions.savedAsRemoveGoogle', { name: lookup.match.displayName })
            : t('actions.savedAsRemovePhone', { name: lookup.match.displayName })
          : lookup.match?.googleSynced
            ? t('actions.removeFromGoogle')
            : t('actions.removeFromPhone')
      "
      @click="removeDeviceContact"
    >
      <span v-if="showLabels">{{ contactSaveState === "error" ? t("common.error") : t("common.remove") }}</span>
    </UButton>
    <UButton
      v-if="canEdit && isWideLayout"
      :size="btnSize"
      color="neutral"
      variant="soft"
      icon="i-lucide-pencil"
      :square="compact"
      :aria-label="t('actions.editAppointment')"
      :title="t('common.edit')"
      @click="emit('edit')"
    >
      <span v-if="showLabels">{{ t("common.edit") }}</span>
    </UButton>
    <UButton
      v-if="canDuplicate && isWideLayout"
      :size="btnSize"
      color="neutral"
      variant="soft"
      icon="i-lucide-copy-plus"
      :square="compact"
      :aria-label="t('actions.duplicateAppointment')"
      :title="t('common.duplicate')"
      @click="emit('duplicate')"
    >
      <span v-if="showLabels">{{ t("common.duplicate") }}</span>
    </UButton>
    <UButton
      v-if="canComplete"
      :size="btnSize"
      color="success"
      :variant="compact ? 'ghost' : 'soft'"
      icon="i-lucide-check"
      :loading="loading"
      :square="iconOnlyPrimary"
      :aria-label="t('actions.markDone')"
      :title="t('actions.done')"
      @click="emit('complete')"
    >
      <span v-if="showLabels">{{ t("actions.done") }}</span>
    </UButton>
    <UButton
      v-if="canDelete && isWideLayout"
      :size="btnSize"
      color="error"
      :variant="compact ? 'ghost' : 'soft'"
      icon="i-lucide-trash-2"
      :loading="loading"
      :square="compact"
      :aria-label="t('actions.deleteAppointment')"
      :title="t('common.delete')"
      @click="emit('delete')"
    >
      <span v-if="showLabels">{{ t("common.delete") }}</span>
    </UButton>
    <UDropdownMenu v-if="showOverflowMenu" :items="overflowItems" :content="{ align: 'end' }">
      <UButton
        :size="btnSize"
        color="neutral"
        variant="soft"
        icon="i-lucide-ellipsis-vertical"
        square
        :aria-label="t('common.moreActions')"
        :title="t('common.moreActions')"
      />
    </UDropdownMenu>
  </div>
</template>
