import { applyUiScaleDocument, DEFAULT_UI_SCALE, normalizeUiScale } from "~/utils/ui-scale";

export default defineNuxtPlugin(() => {
  const cookie = useCookie<string>("alpiplan_ui_scale", {
    default: () => DEFAULT_UI_SCALE,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  const { user } = useAuth();

  const scale = computed(() => normalizeUiScale(user.value?.uiScale ?? cookie.value));

  useHead({
    htmlAttrs: {
      "data-ui-scale": scale,
    },
  });

  watch(
    scale,
    (value) => {
      if (cookie.value !== value) cookie.value = value;
      applyUiScaleDocument(value);
    },
    { immediate: true },
  );
});
