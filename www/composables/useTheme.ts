// Light / Dark theming. The choice is persisted and applied as `data-theme` on
// <html>; the site defaults to LIGHT. The first paint is themed by the inline head
// script in nuxt.config (no flash); this composable drives the toggle and later
// changes.
//
// The OS is deliberately not consulted. `prefers-color-scheme` decides nothing here —
// a visitor who has chosen nothing gets `DEFAULT_THEME`, and only their own choice
// changes it (#1217).
export type ThemeMode = 'light' | 'dark'

export const THEME_KEY = 'kimtos-theme'
export const THEME_MODES: ThemeMode[] = ['light', 'dark']

/**
 * What a visitor who has chosen nothing sees. STATED ONCE, on purpose.
 *
 * It used to be written in four places — the inline head script and its comment in
 * nuxt.config, the `useState` initial value, and `initTheme`'s fallback. The head script
 * runs before hydration, so any two of those disagreeing is a visible flash from one theme
 * to the other: exactly what that script exists to prevent. nuxt.config imports this and
 * builds the script from it, so there is nothing left to keep in step by hand.
 */
export const DEFAULT_THEME: ThemeMode = 'light'

/** The browser-chrome tint per theme (the `theme-color` meta). nuxt.config states the default
 *  one for the first paint; `plugins/theme.client.ts` hands the reactive value to unhead so it
 *  tracks the PAGE rather than the OS, which is what the media-query version did (#1217). */
export const THEME_COLORS: Record<ThemeMode, string> = { dark: '#0a0c12', light: '#f6f8fb' }

export const isMode = (v: unknown): v is ThemeMode => v === 'light' || v === 'dark'

export function useTheme() {
  const mode = useState<ThemeMode>('theme-mode', () => DEFAULT_THEME)

  function apply(m: ThemeMode) {
    if (import.meta.client) document.documentElement.setAttribute('data-theme', m)
  }

  function setTheme(m: ThemeMode) {
    mode.value = m
    if (import.meta.client) {
      try {
        localStorage.setItem(THEME_KEY, m)
      } catch {
        // storage blocked (private mode) — the choice just won't persist.
      }
    }
    apply(m)
  }

  /** Read the stored choice into reactive state (data-theme is already set by
   *  the head script; this keeps the toggle in sync). Called once, client-side. */
  function initTheme() {
    if (!import.meta.client) return
    let stored: string | null = null
    try {
      stored = localStorage.getItem(THEME_KEY)
    } catch {
      // ignore
    }
    const m = isMode(stored) ? stored : DEFAULT_THEME
    mode.value = m
    apply(m)
  }

  return { mode, setTheme, initTheme }
}
