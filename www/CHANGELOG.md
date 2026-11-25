# Changelog

## 1.2.1 — 2026-11-25

- The privacy page, terms, FAQ and privacy summary now say that Kimtos makes no network request except the AI model downloads you start, from Hugging Face
- The weather, trending-article and PDF-by-URL network cases were removed from the privacy page and the list of third parties

## 1.2.0 — 2026-07-27

- Give the extension a session model, and run the apps in one tab
- Renew the access token on a 401 instead of running on an expired one

## 1.1.0 — 2026-07-21

- Converge the billing page on the plan the user just bought
- Restore focus to <main> when a confirmed action removes its trigger
- Name useToast's param for the text it escapes, and enforce it
- Trap focus inside the confirm dialog with inert
- Land the confirm-dialog review fixes that #773 left behind
- Restore the promo self-review fixes lost from PR #798
- Send a typed promo code to checkout even if Apply was not pressed
- Restore the OAuth self-heal commit lost from PR #772
- Replace the native window.confirm with an in-app dialog
- Stop a deleted account obtaining a session by any route
- Never report a failed checkout as a successful payment
- Make BACKEND_URL the one name for the backend, and make it apply
- Define a prettier style for every workspace, enforce it, and sweep
- Remove dead DEFAULTS.modelsUrl, correct the stale cdn.ts comment
- Bump pinia from 3.0.4 to 4.0.2
- Bump @pinia/nuxt from 0.11.3 to 1.0.1
- Serve non-English OCR language packs from our CDN, not jsDelivr
- Serve every model from our HF org via the CDN — no third-party runtime fetch

<!-- The newest entry IS this deployable's version. There is nowhere else it is declared. -->

## 1.0.0 — 2026-07-06

- Initial release.
