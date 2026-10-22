<script setup lang="ts">
import { permissionLabel } from "../composables/useNativePermissions";

const { speechRecognitionEnabled } = useAuth();
const { t } = useI18n();
const {
  open,
  requesting,
  lastError,
  isNative,
  microphoneGranted,
  contactsGranted,
  callHintsSupported,
  callerIdGranted,
  notificationsSupported,
  notificationsGranted,
  anyAskable,
  anyDenied,
  requestNow,
  openAppSettings,
} = useNativePermissions({ autoPrompt: true, needMicrophone: speechRecognitionEnabled });
</script>

<template>
  <UModal v-if="isNative" v-model:open="open" :ui="{ content: 'max-w-md' }">
    <template #header>
      <h2 class="font-medium">{{ t("permissions.title") }}</h2>
    </template>
    <template #body>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        {{ speechRecognitionEnabled ? t("permissions.introMic") : t("permissions.introNoMic") }}<template v-if="callHintsSupported">{{ t("permissions.callerHint") }}</template>{{ t("permissions.introEnd") }}
      </p>
      <ul class="mt-4 space-y-2 text-sm">
        <li v-if="speechRecognitionEnabled" class="flex items-center justify-between gap-3">
          <span>{{ t("common.microphone") }}</span>
          <UBadge :color="microphoneGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(microphoneGranted, t) }}
          </UBadge>
        </li>
        <li class="flex items-center justify-between gap-3">
          <span>{{ t("common.contacts") }}</span>
          <UBadge :color="contactsGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(contactsGranted, t) }}
          </UBadge>
        </li>
        <li v-if="callHintsSupported" class="flex items-center justify-between gap-3">
          <span>{{ t("common.callerId") }}</span>
          <UBadge :color="callerIdGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(callerIdGranted, t) }}
          </UBadge>
        </li>
        <li v-if="notificationsSupported" class="flex items-center justify-between gap-3">
          <span>{{ t("common.notifications") }}</span>
          <UBadge :color="notificationsGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(notificationsGranted, t) }}
          </UBadge>
        </li>
      </ul>
      <p v-if="anyDenied" class="mt-3 text-xs text-neutral-500">
        {{ t("permissions.deniedHint") }}
      </p>
      <p v-if="lastError" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ lastError }}</p>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton type="button" variant="ghost" color="neutral" @click="open = false">{{ t("common.later") }}</UButton>
        <UButton
          v-if="anyDenied"
          type="button"
          variant="soft"
          color="neutral"
          icon="i-lucide-settings-2"
          @click="openAppSettings"
        >
          {{ t("common.settings") }}
        </UButton>
        <UButton
          type="button"
          color="primary"
          icon="i-lucide-shield-check"
          :loading="requesting"
          :disabled="!anyAskable || requesting"
          @click="requestNow"
        >
          {{ t("common.allowNow") }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
