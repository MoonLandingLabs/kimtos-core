// `v-reveal` — fade/slide a section in when it scrolls into view (matches the
// original site's IntersectionObserver reveal). Client-only: the element renders
// normally in the prerendered HTML, then the directive adds `reveal` (the hidden
// start state) and `is-in` on intersect.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', {
    mounted(el: HTMLElement) {
      el.classList.add('reveal')
      if (!('IntersectionObserver' in window)) {
        el.classList.add('is-in')
        return
      }
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              el.classList.add('is-in')
              io.unobserve(el)
            }
          }
        },
        { threshold: 0.1 },
      )
      io.observe(el)
    },
  })
})
