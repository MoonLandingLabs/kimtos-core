# Getting started

## Turn it on

1. Install **FakeForm** from the App Store (top right of the new tab). It is free
   and needs no account.
2. Open FakeForm and press **Allow on all sites**. FakeForm has to run on the
   pages you are testing, and the browser will only let it once you say so. It
   asks for nothing else — no history, no downloads, no network access.
3. Open any page with a form on it.

## The four actions

| Action                 | What it fills                                                  |
| ---------------------- | -------------------------------------------------------------- |
| **Fill this form**     | Every field in the form around whatever you last clicked into. |
| **Fill this input**    | Only the field you are in.                                     |
| **Fill everything**    | Every field on the page, across every form on it.              |
| **Undo the last fill** | Puts every field the last fill touched back exactly as it was. |

Each one is available three ways, and they all do the same thing:

- **A keyboard shortcut.** "Fill this form" is `Alt+Shift+F` and "Undo" is
  `Alt+Shift+Z` out of the box. The other two start unassigned. Set or change any
  of them at `chrome://extensions/shortcuts`.
- **The badge.** Click into any text field and a small FakeForm button appears in
  the corner of it, next to Grammit's and Clipboard's if you have those. Click it
  for a menu of all four actions. Drag it if it is in your way — it stays where you
  put it.
- **The right-click menu.** Right-click anywhere on the page and pick an action
  from the **FakeForm** submenu.

## Reading the result

A short message appears in the bottom-right corner saying how many fields were
filled. If one of them was a password, it is shown in that message — copy it if
you want to sign back in as the account you just made. It is shown once and never
stored.

## What it fills, and with what

FakeForm works out each field's meaning from what the page tells it: the `type` of
the input first, then the `autocomplete` value, then the words the page uses around
the field — its name, its id, its placeholder, its label. Punctuation does not
matter, so `user_name`, `user-name` and `userName` are all understood as the same
thing.

A few worth knowing about:

- **Dropdowns and radio buttons** get one of the choices the page already offers —
  never invented text, and never the "Please select…" placeholder.
- **Checkboxes** are ticked about two times in three, except a required one (a
  terms-and-conditions box), which is always ticked so the form will submit.
- **Numbers, dates and ranges** stay inside the `min`, `max` and `step` the page
  declares, and long values are cut to the field's `maxlength` — so what FakeForm
  writes passes the form's own validation.
- **Card numbers** pass the standard checksum, so a payment form accepts the shape.
  It is not a real card and no bank will authorise it.

## What it never touches

CAPTCHAs, hidden fields, disabled fields, read-only fields and file pickers. A
CAPTCHA exists precisely so that a program does not answer it, and a hidden field
usually carries a security token that filling would break.

## Undo, and what it means

FakeForm overwrites what is already in a field. That is the job — you invoked it on
purpose — and **Undo** is what makes it safe: it restores every field the last fill
touched, to the exact value it had, through the same path it used to write. Undo
covers the most recent fill; once the page is reloaded there is nothing left to
undo, because FakeForm keeps nothing.
