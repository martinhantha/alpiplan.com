<script setup lang="ts">
const { t } = useI18n();
const {
  webUpdateAvailable,
  nativeUpdate,
  installing,
  installNativeUpdate,
  dismissNativeUpdate,
  reloadWeb,
} = useAppUpdate();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="nativeUpdate"
      class="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40"
      style="padding-top: max(1rem, var(--app-safe-top)); padding-bottom: max(1rem, var(--app-safe-bottom))"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
    >
      <div class="w-full max-w-md rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-neutral-900 shadow-lg p-4">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-lg bg-primary-100 dark:bg-primary-900/50 p-2">
            <UIcon name="i-lucide-download" class="size-5 text-primary-700 dark:text-primary-200" />
          </div>
          <div class="min-w-0 flex-1">
            <p id="app-update-title" class="text-sm font-semibold">
              {{ nativeUpdate.required ? t("appUpdate.requiredTitle") : t("appUpdate.optionalTitle") }}
            </p>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {{ nativeUpdate.required ? t("appUpdate.requiredBody") : t("appUpdate.optionalBody") }}
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <UButton
                v-if="!nativeUpdate.required"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="dismissNativeUpdate"
              >
                {{ t("appUpdate.later") }}
              </UButton>
              <UButton
                size="xs"
                color="primary"
                icon="i-lucide-download"
                :loading="installing"
                @click="installNativeUpdate"
              >
                {{ t("appUpdate.install") }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="webUpdateAvailable"
      class="fixed inset-x-0 bottom-0 z-[85] flex justify-center p-3 pointer-events-none"
      style="padding-bottom: max(0.75rem, var(--app-safe-bottom))"
      role="status"
    >
      <div class="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-neutral-900 shadow-lg px-4 py-3">
        <UIcon name="i-lucide-refresh-cw" class="size-5 shrink-0 text-primary-600 dark:text-primary-300" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">{{ t("appUpdate.webTitle") }}</p>
          <p class="text-xs text-neutral-600 dark:text-neutral-400">{{ t("appUpdate.webBody") }}</p>
        </div>
        <UButton size="xs" color="primary" @click="reloadWeb">{{ t("appUpdate.reload") }}</UButton>
      </div>
    </div>
  </Teleport>
</template>
