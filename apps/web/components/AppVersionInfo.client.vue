<script setup lang="ts">
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const { t, locale } = useI18n();

const commit = ref("");
const builtAt = ref("");
const nativeVersion = ref("");

const builtAtLabel = computed(() => {
  if (!builtAt.value) return "";
  return new Intl.DateTimeFormat(locale.value, {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(builtAt.value));
});

onMounted(async () => {
  try {
    const { web } = await $fetch<{ web: { commit: string; builtAt: string } }>("/api/app-version");
    commit.value = web.commit.slice(0, 7);
    builtAt.value = web.builtAt;
  } catch {
    // ignore
  }
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("App")) {
    try {
      const { version, build } = await App.getInfo();
      nativeVersion.value = `${version} (${build})`;
    } catch {
      // ignore
    }
  }
});
</script>

<template>
  <div class="pt-4 text-center text-xs text-neutral-500 dark:text-neutral-400 space-y-0.5 select-text">
    <p v-if="nativeVersion">{{ t("settings.version.app") }} {{ nativeVersion }}</p>
    <p v-if="commit || builtAtLabel">
      {{ t("settings.version.web") }}
      <span v-if="commit" class="font-mono">{{ commit }}</span>
      <template v-if="commit && builtAtLabel"> · </template>
      <span v-if="builtAtLabel">{{ builtAtLabel }}</span>
    </p>
  </div>
</template>
