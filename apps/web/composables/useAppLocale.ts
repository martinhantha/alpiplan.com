export const APP_LOCALE_CODES = ["de", "en", "it"] as const;
export type AppLocaleCode = (typeof APP_LOCALE_CODES)[number];

const BCP47: Record<AppLocaleCode, string> = {
  de: "de-DE",
  en: "en-GB",
  it: "it-IT",
};

export function isAppLocaleCode(value: string): value is AppLocaleCode {
  return (APP_LOCALE_CODES as readonly string[]).includes(value);
}

export function bcp47ForAppLocale(code: AppLocaleCode): string {
  return BCP47[code];
}

export function useAppLocale() {
  const { locale, locales, setLocale, t } = useI18n();

  const intlLocale = computed(() => {
    const code = locale.value;
    return isAppLocaleCode(code) ? bcp47ForAppLocale(code) : BCP47.de;
  });

  async function setAppLocale(code: AppLocaleCode) {
    await setLocale(code);
  }

  return { locale, locales, setAppLocale, intlLocale, t };
}
