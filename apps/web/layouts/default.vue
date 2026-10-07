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

function navClass(to: string) {
  return route.path === to
    ? "bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-200"
    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-white";
}
</script>

<template>
  <div class="min-h-dvh text-neutral-900 dark:text-neutral-50 pb-[var(--app-safe-bottom)]">
    <aside
      class="hidden lg:flex fixed inset-y-0 left-0 z-20 w-72 xl:w-80 border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 pt-[var(--app-safe-top)]"
    >
      <div class="flex w-full h-dvh max-h-dvh flex-col p-4 gap-5 overflow-hidden">
        <div class="px-2 pt-3 shrink-0">
          <NuxtLink to="/" class="inline-flex max-w-full items-center" aria-label="Alpiplan">
            <AppLogo size="md" />
          </NuxtLink>
        </div>

        <nav class="flex-1 min-h-0 space-y-1 overflow-y-auto pr-1">
          <p class="eyebrow px-3 pb-1">{{ $t("layout.dashboard") }}</p>
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition"
            :class="navClass(link.to)"
            :aria-current="route.path === link.to ? 'page' : undefined"
          >
            <UIcon :name="link.icon" class="size-4 shrink-0" />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <div class="shrink-0 rounded-xl bg-neutral-50 p-3.5 ring-1 ring-neutral-200/80 dark:bg-neutral-950/60 dark:ring-neutral-800">
          <div class="flex items-center gap-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700 dark:bg-primary-900/60 dark:text-primary-200">
              {{ (user?.name || user?.email || "?").slice(0, 1).toUpperCase() }}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold truncate">{{ user?.name || user?.email || $t("layout.account") }}</p>
              <p class="text-xs text-neutral-500 truncate">
                {{ primaryTenant?.tenantName || $t("layout.noActiveTenant") }}
              </p>
            </div>
          </div>
          <ThemeSwitcher class="mt-4" />
          <div class="mt-2 grid grid-cols-2 gap-2">
            <UButton to="/settings" size="sm" variant="soft" color="neutral" icon="i-lucide-settings-2" block>
              {{ $t("layout.settings") }}
            </UButton>
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-log-out" block @click="logout()">
              {{ $t("layout.logout") }}
            </UButton>
          </div>
        </div>
      </div>
    </aside>

    <div class="flex w-full">
      <div class="hidden lg:block lg:w-72 xl:w-80 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <header
          class="sticky top-0 z-10 bg-neutral-50/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-950/80 lg:hidden pt-[var(--app-safe-top)]"
        >
          <div class="px-4 py-3 flex items-center justify-between gap-3">
            <NuxtLink to="/" class="inline-flex min-w-0 max-w-[65%] items-center" aria-label="Alpiplan">
              <AppLogo size="sm" />
            </NuxtLink>
            <div class="flex items-center gap-1">
              <ThemeSwitcher compact />
              <UButton to="/settings" size="sm" variant="ghost" color="neutral" icon="i-lucide-settings-2" />
              <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-log-out" @click="logout()" />
            </div>
          </div>
          <nav class="px-3 pb-3 flex gap-1 overflow-x-auto">
            <NuxtLink
              v-for="link in links"
              :key="link.to"
              :to="link.to"
              class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition"
              :class="navClass(link.to)"
              :aria-current="route.path === link.to ? 'page' : undefined"
            >
              <UIcon :name="link.icon" class="size-4" />
              {{ link.label }}
            </NuxtLink>
          </nav>
        </header>

        <main class="min-w-0 animate-fade-in">
          <slot />
        </main>
        <DevicePermissionsModal />
      </div>
    </div>
  </div>
</template>
