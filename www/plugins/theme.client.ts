// Sync the reactive theme state from localStorage on startup, so the nav toggle
// reflects the persisted choice. The actual first-paint theming is done earlier
// by the inline head script (nuxt.config) to avoid a flash.
export default defineNuxtPlugin(() => {
  const { mode, initTheme } = useTheme()
  initTheme()

  // Keep the browser-chrome tint on the theme the page is actually showing (#1217). It used to
  // be two `prefers-color-scheme` metas, which the site itself no longer follows — so a visitor
  // on a dark OS got a light page with a dark address bar.
  //
  // This goes through useHead rather than a setAttribute in `apply()`, because unhead OWNS that
  // tag: a direct write during startup is overwritten when the head hydrates, so the tint was
  // correct after a toggle and wrong again after a reload. Handing unhead the reactive value is
  // the only version that survives both.
  useHead({
    meta: [{ name: 'theme-color', content: () => THEME_COLORS[mode.value] }],
  })
})
