<!-- The site chrome, in the one place every page inherits it from.
     It used to be hand-mounted inside pages/index.vue, so the home page was the
     only page that had a nav or a footer at all — and /privacy, the URL the
     Chrome Web Store links to, was a dead end (#159). A page added later starts
     with the chrome now; it cannot be forgotten. -->
<template>
  <TheNav />
  <slot />
  <TheFooter />
</template>
