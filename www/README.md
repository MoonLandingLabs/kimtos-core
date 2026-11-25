# @kimtos/www

The KimtOS **marketing site** — Nuxt 4 (Vue 3, TypeScript), fully static. There is no backend,
no accounts and no runtime server: `nuxt generate` prerenders every page. KimtOS v1 is free and
open source (MIT).

## Develop

```
make www          # nuxt dev -> http://localhost:8799
```

## Build

```
make www-build    # -> www/.output/public  (static)
```

Deploy `www/.output/public` to any static host. The build bakes in no site address: there are no
canonical URLs, no sitemap and no feed, so it works from any origin or sub-path-free host.
