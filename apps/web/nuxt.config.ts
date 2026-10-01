export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@nuxtjs/i18n"],
  i18n: {
    restructureDir: false,
    locales: [
      { code: "de", name: "Deutsch", file: "de.json" },
      { code: "en", name: "English", file: "en.json" },
      { code: "it", name: "Italiano", file: "it.json" },
    ],
    defaultLocale: "de",
    lazy: true,
    langDir: "locales",
    bundle: {
      optimizeTranslationDirective: false,
    },
    strategy: "no_prefix",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "alpiplan.locale",
      fallbackLocale: "de",
    },
  },
  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },
  compatibilityDate: "2025-04-01",
  runtimeConfig: {
    /** HttpOnly-Session-Cookie (nur Server) */
    authCookie: process.env.AUTH_COOKIE_NAME ?? "alpiplan_at",
    public: {
      demoEmail: process.env.NUXT_PUBLIC_DEMO_EMAIL ?? "demo@alpiplan.local",
    },
  },
  nitro: {
    rollupConfig: {
      external: ["@prisma/client", ".prisma/client"],
    },
    routeRules: {
      "/api/v1/tenants/**/events": {
        headers: {
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      },
    },
  },
  vite: {
    optimizeDeps: {
      include: ["@capacitor/core", "@capacitor-community/contacts", "@alpiplan/capacitor-call-hints"],
    },
    resolve: {
      dedupe: [
        "vue",
        "@vue/runtime-core",
        "@vue/runtime-dom",
        "@vue/server-renderer",
        "@vue/shared",
      ],
    },
  },
  // Reka (Nuxt UI) als CJS aus node_modules lädt sonst ein anderes @vue/runtime-core als der SSR-Bundle.
  ssr: {
    noExternal: ["reka-ui", "vaul-vue", "@alpiplan/device-capabilities", "@alpiplan/capacitor-call-hints"],
  },
  app: {
    head: {
      title: "Alpiplan",
      meta: [
        { name: "description", content: "Alpiplan — Prototyp Schnellerfassung & Planung" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "theme-color", content: "#16121f", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#0c0814", media: "(prefers-color-scheme: dark)" },
      ],
      link: [
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
    },
  },
});
