<script setup lang="ts">
const error = useError();

const serverDown = computed(() => {
  const status = error.value?.statusCode ?? 500;
  return status === 502 || status === 503 || status === 504;
});

function retry() {
  clearError({ redirect: "/" });
}
</script>

<template>
  <div
    class="grid min-h-dvh place-items-center bg-neutral-950 px-6 py-16 text-neutral-50"
  >
    <main class="w-full max-w-md text-center">
      <AppLogo size="lg" inverted class="justify-center" />
      <template v-if="serverDown">
        <p class="mt-6 text-lg leading-relaxed text-neutral-300">
          Wir sind gleich wieder da. Die App wird gerade aktualisiert.
        </p>
        <UButton class="mt-6" size="lg" color="neutral" @click="retry">Erneut versuchen</UButton>
      </template>
      <template v-else>
        <p class="mt-6 text-lg text-neutral-300">Diese Seite gibt es nicht.</p>
        <UButton class="mt-6" size="lg" color="neutral" variant="soft" to="/">Zur Startseite</UButton>
      </template>
    </main>
  </div>
</template>
