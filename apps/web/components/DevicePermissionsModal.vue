<script setup lang="ts">
import { permissionLabel } from "../composables/useNativePermissions";

const { speechRecognitionEnabled } = useAuth();
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
      <h2 class="font-medium">Geräteberechtigungen</h2>
    </template>
    <template #body>
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        Alpiplan braucht
        <template v-if="speechRecognitionEnabled">Mikrofon (Spracheingabe) und </template>
        Kontakte (Adressbuch)<template v-if="callHintsSupported">,
        Anrufer-ID (Nummer des letzten Anrufs als Vorschlag, optional)</template>
        sowie Benachrichtigungen für neue und verschobene Termine. Die Systemabfragen erscheinen nacheinander.
      </p>
      <ul class="mt-4 space-y-2 text-sm">
        <li v-if="speechRecognitionEnabled" class="flex items-center justify-between gap-3">
          <span>Mikrofon</span>
          <UBadge :color="microphoneGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(microphoneGranted) }}
          </UBadge>
        </li>
        <li class="flex items-center justify-between gap-3">
          <span>Kontakte</span>
          <UBadge :color="contactsGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(contactsGranted) }}
          </UBadge>
        </li>
        <li v-if="callHintsSupported" class="flex items-center justify-between gap-3">
          <span>Anrufer-ID</span>
          <UBadge :color="callerIdGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(callerIdGranted) }}
          </UBadge>
        </li>
        <li v-if="notificationsSupported" class="flex items-center justify-between gap-3">
          <span>Benachrichtigungen</span>
          <UBadge :color="notificationsGranted ? 'success' : 'neutral'" variant="subtle">
            {{ permissionLabel(notificationsGranted) }}
          </UBadge>
        </li>
      </ul>
      <p v-if="anyDenied" class="mt-3 text-xs text-neutral-500">
        Abgelehnte Rechte fragt das System nicht erneut ab — bitte in den App-Einstellungen einschalten.
      </p>
      <p v-if="lastError" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ lastError }}</p>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton type="button" variant="ghost" color="neutral" @click="open = false">Später</UButton>
        <UButton
          v-if="anyDenied"
          type="button"
          variant="soft"
          color="neutral"
          icon="i-lucide-settings-2"
          @click="openAppSettings"
        >
          Einstellungen
        </UButton>
        <UButton
          type="button"
          color="primary"
          icon="i-lucide-shield-check"
          :loading="requesting"
          :disabled="!anyAskable || requesting"
          @click="requestNow"
        >
          Jetzt erlauben
        </UButton>
      </div>
    </template>
  </UModal>
</template>
