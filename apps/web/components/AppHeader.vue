<script setup lang="ts">
const { user, primaryTenant, logout } = useAuth();
</script>

<template>
  <header
    class="bg-neutral-50/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-950/80"
  >
    <UContainer class="flex h-14 items-center justify-between gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <NuxtLink to="/" class="inline-flex h-8 shrink-0 items-center" aria-label="Alpiplan">
          <AppLogo size="sm" />
        </NuxtLink>
        <span
          v-if="primaryTenant"
          class="hidden sm:inline text-xs font-medium text-neutral-600 dark:text-neutral-400 truncate max-w-[14rem]"
          :title="primaryTenant.tenantName"
        >
          {{ primaryTenant.tenantName }}
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton
          v-if="user?.isSuperadmin"
          to="/#superadmin"
          color="secondary"
          variant="soft"
          size="sm"
          icon="i-lucide-shield-check"
        >
          <span class="hidden sm:inline">Superadmin</span>
        </UButton>
        <span class="text-sm text-neutral-600 dark:text-neutral-400 hidden sm:inline truncate max-w-[12rem]">
          {{ user?.name || user?.email }}
        </span>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-log-out"
          aria-label="Abmelden"
          @click="logout()"
        >
          <span class="hidden sm:inline">Abmelden</span>
        </UButton>
      </div>
    </UContainer>
  </header>
</template>
