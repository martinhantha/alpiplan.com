<script setup lang="ts">
definePageMeta({
  public: true,
  layout: false,
});

const config = useRuntimeConfig().public;
const { login } = useAuth();
const { t } = useI18n();

const email = ref();
const password = ref("");
const pending = ref(false);
const errorMsg = ref("");

const route = useRoute();

async function onSubmit() {
  errorMsg.value = "";
  pending.value = true;
  try {
    await login(email.value.trim(), password.value);
    const raw = route.query.redirect;
    const redirect = typeof raw === "string" ? raw : null;
    const safe =
      redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
    await navigateTo(safe);
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; statusMessage?: string };
    errorMsg.value = err?.data?.message || err?.statusMessage || t("login.failed");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div
    class="min-h-dvh flex flex-col items-center justify-center p-6 pt-[max(1.5rem,var(--app-safe-top))] pb-[max(1.5rem,var(--app-safe-bottom))] bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50"
  >
    <div class="w-full max-w-md space-y-6">
      <div class="text-center space-y-3">
        <AppLogo class="mx-auto h-10" />
        <h1 class="text-2xl font-semibold tracking-tight">{{ $t("login.title") }}</h1>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {{ $t("login.subtitle") }}
        </p>
      </div>

      <UCard>
        <template #header>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ $t("login.cardHint") }}
          </p>
        </template>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="soft"
          :title="errorMsg"
          class="mb-4"
          icon="i-lucide-circle-alert"
        />

        <form class="space-y-4" @submit.prevent="onSubmit">
          <UFormField :label="$t('login.email')" name="email">
            <UInput
              v-model="email"
              type="email"
              autocomplete="username"
              size="lg"
              class="w-full"
              :placeholder="$t('login.emailPlaceholder')"
            />
          </UFormField>
          <UFormField :label="$t('login.password')" name="password">
            <UInput
              v-model="password"
              type="password"
              autocomplete="current-password"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UButton type="submit" block size="lg" :loading="pending" :disabled="pending">
            {{ $t("login.submit") }}
          </UButton>
        </form>

        <!-- <template #footer>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
           
          </p>
        </template> -->
      </UCard>
    </div>
  </div>
</template>
