# Overview

**FakeForm** fills a form with believable fake data in one keypress, so you can
test it without typing "test test test" into forty boxes. Press the shortcut on a
signup page and it works out what each field is asking for — a name, an e-mail, a
postcode, a card number, a date of birth — and writes something that looks like a
real answer. It is part of the kimtos new-tab app suite.

Everything is invented **on your device**. FakeForm has no dataset to download and
no service to call: it generates every value in your browser, on the spot. That is
not a compromise we worked for — a form filler is local by nature. It makes data
up; there is nothing for it to fetch.

FakeForm is free, like every app, and needs no account. Its badge, its shortcuts and its
right-click menu only exist when the app is installed.

> This app is under active development. This booklet describes what the code
> currently supports.

## Highlights

- **Three actions** — fill the form you are in, fill only the field you are in, or
  fill every field on the page, across forms.
- **Undo** — one action puts every field back exactly as it was, including
  checkboxes, radio buttons and dropdowns. Nothing FakeForm does is one-way.
- **It works on React, Vue and Angular apps** — the values are written the way the
  browser writes them, so the framework behind the page actually receives them and
  the form submits with real data in it.
- **Believable, not random** — one person per fill. The first name, the surname,
  the full name, the username and the e-mail on a form all belong to the same
  invented human, so a filled form reads like a filled form.
- **Safe to submit** — e-mail addresses use the reserved `example.com` family and
  phone numbers the 555-01xx range set aside for fiction, so a test submission
  cannot reach a real stranger.
- **It knows what to leave alone** — CAPTCHAs, hidden fields, disabled and
  read-only fields and file pickers are never touched.
- **Passwords are filled**, and the one it used is shown to you, so you can log
  back in as the account you just created.
- **Nothing is stored.** FakeForm has no history, no saved profiles and no
  settings. The data it invents is typed into the page and forgotten.

## What it is not

FakeForm does not remember anything. There is no list of past fills, no saved
"personas", and nothing of yours in the shared database — which is why it does not
appear in AnubisDB. Every fill starts from nothing.

It also does not sync anything between browsers, because there is nothing to sync.
The reference product offers cross-browser settings sync as a headline feature;
that is a server, and this app has no configuration to put on one.
