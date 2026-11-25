# Changelog

## 1.1.0 — 2026-07-27

- Give the extension a session model, and run the apps in one tab

## 1.0.5 — 2026-07-23

- Stop now works while the model is still loading: the reply you cancelled is never written, the composer goes straight back to Send, and the message you had already sent is kept. The model finishes loading in the background, so your next message does not wait for it again

## 1.0.4 — 2026-07-22

- Stop takes effect the moment you press it: the reply keeps the text streamed so far instead of waiting for the model to wind down
- Leaving a conversation mid-reply no longer releases the model — your next message reuses it instead of loading it again

## 1.0.3 — 2026-07-22

- Starting or opening another conversation while a reply is still being written now ends that reply properly: the composer goes back to Send instead of staying stuck on Stop, the message you had already sent is kept in the chat you sent it in, and the abandoned reply can no longer land in whichever conversation you moved to. The model is released when you leave, so the next message reloads it from the cache
- Retry works again in a conversation you have reopened, or come back to after the model was released — it loads the model the way sending does instead of doing nothing
- Chat history rows show when each conversation was last updated

## 1.0.2 — 2026-07-22

- Cancel a model download from the Model Library — the control is there whether you just started it or came back to one already running, and files that had already arrived stay cached so downloading again resumes from them

## 1.0.1 — 2026-07-21

- Defer to the browser's search provider, drop the engine picker

## 1.0.0 — 2026-07-06

- Initial release.
