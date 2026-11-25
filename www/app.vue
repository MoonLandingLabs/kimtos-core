<!-- NuxtLayout is load-bearing: a project that defines its own app.vue does NOT get
     layouts unless the page is wrapped in it, and the failure is silent — layouts/
     simply never renders. ToastHost and ConfirmHost stay outside, so neither is
     clipped by the chrome. -->
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ToastHost />
  <ConfirmHost />
</template>
