<script setup lang="ts">
import { de, en, it } from "@nuxt/ui/locale";

const { locale } = useI18n();
const uiLocale = computed(() => ({ de, en, it })[locale.value as "de" | "en" | "it"] ?? de);
</script>

<template>
  <!-- :toaster="null" vermeidet den UToaster-Wrapper (Reka ToastProvider), der sonst
       bei toaster=undefined aktiv ist und in Kombination mit NuxtRouteAnnouncer / Slots
       zu "Cannot read properties of null (reading 'ce')" führen kann. -->
  <UApp :toaster="null" :locale="uiLocale">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AppointmentCreatedAlert />
    <AppointmentReminderAlert />
    <AppointmentBriefingAlert />
    <AppUpdatePrompt />
    <AndroidAppointmentsWidgetSync />
  </UApp>
</template>
