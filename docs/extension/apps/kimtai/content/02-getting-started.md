# Getting Started

Open KimtAI from the dock. Before you can chat you need the model on your device,
so the first thing to do is download it.

## The model

<!-- generated:kimtai-models -->

Click **Models** in the header to see it, with its size and — once you have used
it — its measured speed on your machine.

- **Download** — fetches the model's files once and caches them; a progress bar
  shows the one-time download. You can close the overlay and it **continues in
  the background**.
- **Cancel** — sits next to the progress bar while a download is running, and is
  still there if you close the overlay and reopen it. It stops the transfer for
  real. Files that had already arrived in full stay cached, so downloading again
  picks up from them rather than starting over. There is no Pause: the loader
  fetches whole files and cannot continue one from where it stopped, so a Pause
  button could only throw the current file away — which is what Cancel does.
- **Remove** — frees its cached files (your other apps are untouched). You can
  download it again later.

It is only ever downloaded when you ask; nothing is prefetched behind your back.

## Start chatting

Type in the composer and press **Enter** (Shift+Enter for a newline). The first
time you send in a session, the active model loads — you will see
"Downloading model…", then "Warming up…", then replies stream in token by token.

- **Stop** — the Send button becomes **Stop** while generating; click it to
  interrupt.
- **Retry** — regenerate the last reply.
- **Edit & resend** — edit one of your own messages to branch the conversation
  from there.
- **Copy** — copy any reply.

If you have no model yet and try to send, KimtAI opens the Model Library for you.

## GPU vs CPU

If your browser supports **WebGPU**, models run on the GPU (fast). If not, KimtAI
falls back to **CPU (WASM)**, which is much slower — so a small model is
recommended there. The model chip in the header shows which the current model is
using (`· GPU` or `· CPU`), and replies show a rough tokens/second rate.

To save memory, the resident model is **freed automatically when idle** (after a
few minutes, or sooner when the tab is hidden) and reloaded on your next message.

## Tune a chat

Click the **sliders** icon to adjust the current conversation:

- **System prompt** — the persona / behaviour for this chat (the default comes
  from the app's settings).
- **Creativity** — temperature, from _Precise_ to _Wild_.
- **Response length** — Short, Medium, Long, or Max.

These are saved per conversation, so different chats can behave differently.

## Manage conversations

The left sidebar lists your chats. Every conversation is saved locally as you go.

- **New chat** — start a fresh conversation.
- **Pin / Rename** — from a chat's menu.
- **Export .md** — download a conversation as a Markdown file.
- **Search** — filter chats by title.
- **Delete** — remove one, or multi-select to **batch delete** with an undo.

## What KimtAI cannot do

KimtAI **chats — it does not act.** It cannot add a task, save a note, edit an
image, or change anything in your other apps, and it cannot search the web. Ask
it to and it will tell you it cannot, rather than claim it did.

This is a deliberate limit, not an oversight. Models small enough to run on your
own device — with no server and no data leaving the machine — are not yet
reliable enough to be trusted with actions on your behalf. A model that
_confidently reports_ doing something it never did is worse than one that simply
says no, so until an on-device model can do it dependably, KimtAI stays a
chat assistant.

If you want your notes and PDFs searched and answered _from_, that is **Thoth** —
a separate app that indexes your own content and answers with citations.
