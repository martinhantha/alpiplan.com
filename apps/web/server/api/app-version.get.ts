function toVersionCode(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export default defineEventHandler(() => {
  const { appUpdate, build } = useRuntimeConfig();
  return {
    web: {
      commit: String(process.env.SOURCE_COMMIT || build.commit || ""),
      builtAt: String(build.builtAt ?? ""),
    },
    android: {
      minVersionCode: toVersionCode(appUpdate.androidMinVersionCode),
    },
    ios: {
      minVersionCode: toVersionCode(appUpdate.iosMinVersionCode),
      appStoreId: String(appUpdate.iosAppStoreId ?? ""),
      country: String(appUpdate.iosCountry ?? ""),
    },
  };
});
