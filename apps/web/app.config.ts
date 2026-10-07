export default defineAppConfig({
  ui: {
    colors: {
      primary: "dusk",
      secondary: "glow",
      neutral: "neutral",
    },
    button: {
      slots: {
        base: "rounded-md font-semibold transition-[background-color,color,box-shadow,transform] duration-200",
      },
    },
    card: {
      slots: {
        root: "shadow-(--shadow-soft)",
      },
    },
  },
});
