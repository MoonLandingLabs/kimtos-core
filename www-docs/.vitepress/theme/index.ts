// Extend the VitePress default theme with the kimtos brand tokens + the small
// app-grid / app-tagline components used on the Apps pages. Everything is driven
// off brand tokens so light/dark track automatically.
//
// The docs site is fully static: no backend, no accounts, no support widget, no
// cookie banner. Kimtos v1 is free and open source (MIT) and runs in the browser.
import DefaultTheme from 'vitepress/theme';
import { useRoute, type Theme } from 'vitepress';
import { defineComponent, h, onMounted, nextTick, watch } from 'vue';
import AppChangelog from './AppChangelog.vue';
import DocsFooter from './DocsFooter.vue';
import './custom.css';

/**
 * Remove any "New" badge whose 30 days have elapsed (#1114).
 *
 * The site is STATIC: the badge is baked in at build time from an app's first-release date, so
 * without this it would linger past its window until the next build. The build stamps each
 * badge with a `data-new-until` date (the day it should stop showing); this drops the badge on
 * or after that day. ISO `YYYY-MM-DD` strings compare lexicographically the same as
 * chronologically, so a plain `<=` is the whole test — no Date parsing, no timezone edge.
 *
 * It runs on first mount and after every client-side navigation, because VitePress re-renders
 * the destination page from its built markup — which carries the badge again — on each nav.
 */
const sweepExpiredNewBadges = (): void => {
  const today = new Date().toISOString().slice(0, 10);
  for (const el of document.querySelectorAll('[data-new-until]')) {
    const until = el.getAttribute('data-new-until');
    if (until && until <= today) el.remove();
  }
};

// Wrap the default layout to expire stale "New" badges and to add our own footer. Slots are
// forwarded so the wrapper is transparent to the default theme.
const Layout = defineComponent({
  name: 'KimtosLayout',
  setup(_props, { slots }) {
    // Expire stale "New" badges on this static site (#1114) — once on load, and again after
    // each navigation, since VitePress re-renders the page's built markup (badge included) on
    // every client-side route change. nextTick lets that render land before we sweep it.
    const route = useRoute();
    onMounted(() => void nextTick(sweepExpiredNewBadges));
    watch(
      () => route.path,
      () => void nextTick(sweepExpiredNewBadges),
    );
    // VitePress's default footer only renders on pages without a sidebar, which is
    // almost none of a docs site — not "persistent". The layout-bottom slot renders on
    // EVERY page, so our own footer lives there. It carries the outbound links, including
    // the open-source (MIT) link to the repository.
    return () =>
      h(DefaultTheme.Layout, null, {
        ...slots,
        'layout-bottom': () => [...(slots['layout-bottom']?.() ?? []), h(DocsFooter)],
      });
  },
});

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // The app-page Changelog section (a few entries + a "Read more" modal of the full history).
    app.component('AppChangelog', AppChangelog);
  },
} satisfies Theme;
