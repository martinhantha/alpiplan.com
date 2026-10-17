<script setup lang="ts">
import type { AuthSession } from "~/types/auth";

definePageMeta({
  public: true,
  layout: false,
});

const MIN_LENGTH = 6;

const { t } = useI18n();
const route = useRoute();
const session = useState<AuthSession | null>("auth:session", () => null);

const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));

const { data: tokenInfo, pending: checking } = await useFetch<
  { valid: false } | { valid: true; purpose: "reset" | "setup"; email: string }
>("/api/auth/password/token", {
  query: { token },
  server: false,
});

const password = ref("");
const confirm = ref("");
const pending = ref(false);
const errorMsg = ref("");

const title = computed(() =>
  tokenInfo.value?.valid && tokenInfo.value.purpose === "setup" ? t("password.setupTitle") : t("password.resetTitle"),
);

async function onSubmit() {
  errorMsg.value = "";
  if (password.value.length < MIN_LENGTH) {
    errorMsg.value = t("password.minLength", { min: MIN_LENGTH });
    return;
  }
  if (password.value !== confirm.value) {
    errorMsg.value = t("password.mismatch");
    return;
  }
  pending.value = true;
  try {
    session.value = await $fetch<AuthSession>("/api/auth/password/reset", {
      method: "POST",
      body: { token: token.value, password: password.value },
      credentials: "include",
    });
    await navigateTo("/");
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; statusMessage?: string };
    errorMsg.value = err?.data?.message || err?.statusMessage || t("password.failed");
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
        <h1 class="font-display text-4xl leading-[1.05] sm:text-5xl">{{ title }}</h1>
      </div>

      <UCard class="rounded-[1.75rem] shadow-(--shadow-lift) ring-0 text-neutral-900 dark:text-neutral-50">
        <p v-if="checking || !tokenInfo" class="text-sm text-neutral-500">{{ $t("password.checking") }}</p>

        <div v-else-if="!tokenInfo.valid" class="space-y-4">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-link-2-off"
            :title="$t('password.invalidTitle')"
            :description="$t('password.invalidHint')"
          />
          <UButton to="/forgot-password" block size="lg" variant="soft">
            {{ $t("password.requestNew") }}
          </UButton>
        </div>

        <form v-else class="space-y-4" @submit.prevent="onSubmit">
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ $t("password.resetHint", { email: tokenInfo.email }) }}
          </p>
          <UAlert v-if="errorMsg" color="error" variant="soft" :title="errorMsg" icon="i-lucide-circle-alert" />
          <input type="email" :value="tokenInfo.email" autocomplete="username" class="hidden" readonly />
          <UFormField :label="$t('password.newPassword')" :hint="$t('password.minLength', { min: MIN_LENGTH })" name="password">
            <UInput v-model="password" type="password" autocomplete="new-password" size="lg" class="w-full" />
          </UFormField>
          <UFormField :label="$t('password.confirmPassword')" name="confirm">
            <UInput v-model="confirm" type="password" autocomplete="new-password" size="lg" class="w-full" />
          </UFormField>
          <UButton type="submit" block size="lg" :loading="pending" :disabled="pending">
            {{ $t("password.submit") }}
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
