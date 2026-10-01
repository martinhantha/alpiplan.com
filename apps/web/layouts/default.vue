<script setup lang="ts">
const route = useRoute();
const { user, primaryTenant, logout, canManageTenant } = useAuth();
const { t } = useI18n();

const links = computed(() => {
  const base = [
    { to: "/", label: t("nav.home"), icon: "i-lucide-house" },
    { to: "/appointments", label: t("nav.appointments"), icon: "i-lucide-calendar-days" },
    { to: "/archive", label: t("nav.archive"), icon: "i-lucide-archive" },
  ];
  if (canManageTenant.value) {
    base.push(
      { to: "/users", label: t("nav.users"), icon: "i-lucide-users" },
      { to: "/lesson-types", label: t("nav.lessonTypes"), icon: "i-lucide-list-checks" },
      { to: "/conflicts", label: t("nav.conflicts"), icon: "i-lucide-git-merge" },
      { to: "/trash", label: t("nav.trash"), icon: "i-lucide-trash-2" },
    );
  }
  if (user.value?.isSuperadmin) {
    base.push({ to: "/tenants", label: t("nav.tenants"), icon: "i-lucide-building-2" });
  }
  return base;
});
</script>

<template>
  <div class="min-h-dvh bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 pb-[var(--app-safe-bottom)]">
    <aside
      class="hidden lg:flex fixed inset-y-0 left-0 z-20 w-72 xl:w-80 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 pt-[var(--app-safe-top)]"
    >
      <div class="flex w-full h-dvh max-h-dvh flex-col p-4 gap-4 overflow-hidden">
        <div class="px-2 pt-2 shrink-0">
          <NuxtLink to="/" class="inline-flex items-center" aria-label="Alpiplan">
            <AppLogo class="h-8" />
          </NuxtLink>
          <p class="mt-1 text-xs text-neutral-500">{{ $t("layout.dashboard") }}</p>
        </div>

        <nav class="space-y-1 overflow-y-auto flex-1 min-h-0 pr-1">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
            :class="
              route.path === link.to
                ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/40 dark:text-primary-100'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'
            "
          >
            <UIcon :name="link.icon" class="size-4" />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <div class="shrink-0">
          <UCard>
            <p class="text-sm font-medium truncate">{{ user?.name || user?.email || $t("layout.account") }}</p>
            <p class="text-xs text-neutral-500 truncate mt-1">
              {{ primaryTenant?.tenantName || $t("layout.noActiveTenant") }}
            </p>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <UButton to="/settings" size="sm" variant="soft" color="neutral" icon="i-lucide-settings-2">
                {{ $t("layout.settings") }}
              </UButton>
              <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-log-out" @click="logout()">
                {{ $t("layout.logout") }}
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </aside>

    <div class="flex w-full">
      <div class="hidden lg:block lg:w-72 xl:w-80 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <header class="sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-800 bg-white/85 dark:bg-neutral-950/85 backdrop-blur lg:hidden pt-[var(--app-safe-top)]">
          <div class="px-4 py-3 flex items-center justify-between gap-3">
            <NuxtLink to="/" class="inline-flex items-center min-w-0" aria-label="Alpiplan">
              <AppLogo class="h-7" />
            </NuxtLink>
            <div class="flex items-center gap-2">
              <UButton to="/settings" size="sm" variant="ghost" color="neutral" icon="i-lucide-settings-2" />
              <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-log-out" @click="logout()" />
            </div>
          </div>
          <div class="px-2 pb-3 flex gap-1 overflow-x-auto">
            <UButton
              v-for="link in links"
              :key="link.to"
              :to="link.to"
              size="sm"
              :icon="link.icon"
              :variant="route.path === link.to ? 'soft' : 'ghost'"
              color="neutral"
            >
              {{ link.label }}
            </UButton>
          </div>
        </header>

        <main class="min-w-0">
          <slot />
        </main>
        <DevicePermissionsModal />
      </div>
    </div>
  </div>
</template>
