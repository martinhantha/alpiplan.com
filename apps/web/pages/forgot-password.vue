<script setup lang="ts">
definePageMeta({
  public: true,
  layout: false,
});

const { t } = useI18n();
const route = useRoute();

const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const pending = ref(false);
const sent = ref(false);
const errorMsg = ref("");

async function onSubmit() {
  errorMsg.value = "";
  pending.value = true;
  try {
    await $fetch("/api/auth/password/forgot", {
      method: "POST",
      body: { email: email.value.trim() },
    });
    sent.value = true;
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; statusMessage?: string };
    errorMsg.value = err?.data?.message || err?.statusMessage || t("password.forgotFailed");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div
    class="night-hero min-h-dvh flex flex-col items-center justify-center px-6 pt-[max(2rem,var(--app-safe-top))] pb-[max(12rem,var(--app-safe-bottom))] sm:pb-64"
  >
    <AlpineRidge class="absolute inset-x-0 bottom-0 -z-10 h-48 w-full sm:h-72" />

    <div class="w-full max-w-md space-y-8 animate-fade-in">
      <div class="text-center space-y-5">
        <AppLogo size="lg" inverted />
        <h1 class="font-display text-4xl leading-[1.05] sm:text-5xl">{{ $t("password.forgotTitle") }}</h1>
      </div>

      <UCard class="rounded-[1.75rem] shadow-(--shadow-lift) ring-0 text-neutral-900 dark:text-neutral-50">
        <template #header>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">{{ $t("password.forgotHint") }}</p>
        </template>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="soft"
          :title="errorMsg"
          class="mb-4"
          icon="i-lucide-circle-alert"
        />
        <UAlert
          v-if="sent"
          color="success"
          variant="soft"
          :title="$t('password.forgotSent')"
          icon="i-lucide-mail-check"
        />

        <form v-else class="space-y-4" @submit.prevent="onSubmit">
          <UFormField :label="$t('login.email')" name="email">
            <UInput
              v-model="email"
              type="email"
              autocomplete="username"
              size="lg"
              class="w-full"
              required
              :placeholder="$t('login.emailPlaceholder')"
            />
          </UFormField>
          <UButton type="submit" block size="lg" :loading="pending" :disabled="pending || !email.trim()">
            {{ $t("password.forgotSubmit") }}
          </UButton>
        </form>

        <template #footer>
          <p class="text-center">
            <NuxtLink to="/login" class="text-sm underline underline-offset-2 text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
              {{ $t("password.backToLogin") }}
            </NuxtLink>
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
