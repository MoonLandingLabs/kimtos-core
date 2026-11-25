# Overview

**DevTools** is a toolbox of everyday developer utilities — format some JSON,
decode a JWT, hash a secret, test a regular expression, convert a color — all in
one place. A left rail lists the tools grouped by kind; picking one renders it
into the panel on the right. It is part of the kimtos new-tab app suite.

Everything is **fully on-device**. Each tool is a pure transform built from plain
browser APIs (`JSON`, `TextEncoder`, the Web Crypto API, `crypto.randomUUID`,
and the like). There is no backend, no account, and no network call — the point
is that you can decode a token or hash a secret without pasting sensitive data
into some random website. The tools are **stateless**: nothing you type is saved,
so there is no history and no stored data to manage.

## The tools

The utilities are grouped into five categories:

| Category        | Tool              | What it does                                                                                                           |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Format          | **JSON**          | Pretty-print, minify, or validate a JSON string.                                                                       |
| Encode / Decode | **Base64**        | Encode text to Base64 or decode it back (Unicode-safe).                                                                |
| Encode / Decode | **URL**           | Encode a full URL, encode a single query component, or decode either.                                                  |
| Encode / Decode | **HTML entities** | Escape text for HTML, or unescape entities back to characters.                                                         |
| Encode / Decode | **JWT decoder**   | Decode a JSON Web Token's header and payload (no signature check), with issued / not-before / expiry timestamps.       |
| Generate        | **Hash (SHA)**    | Compute SHA-1, SHA-256, SHA-384, and SHA-512 hashes of your text.                                                      |
| Generate        | **UUID**          | Generate one or more random RFC-4122 v4 UUIDs.                                                                         |
| Generate        | **Lorem ipsum**   | Generate placeholder paragraphs.                                                                                       |
| Convert         | **Case convert**  | Convert between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, Sentence case, and dot.case. |
| Convert         | **Color**         | Convert a color between HEX, RGB, and HSL, with a color picker.                                                        |
| Convert         | **Timestamp**     | Convert between Unix timestamps (seconds or milliseconds) and human dates.                                             |
| Convert         | **Number base**   | Convert an integer between decimal, hexadecimal, binary, and octal.                                                    |
| Inspect         | **Regex tester**  | Test a regular expression against sample text, with matches highlighted and a match count.                             |
| Inspect         | **Text diff**     | Compare two blocks of text line by line, with additions and deletions marked.                                          |

## Privacy model

DevTools stores nothing. Every tool is a one-shot transform: text goes in, a
result comes out, and neither is written to disk or sent anywhere.

- **No storage** — there is no history, no settings, and no records in the
  suite's shared database.
- **No network** — hashing uses the Web Crypto API, UUIDs use
  `crypto.randomUUID`, and every other tool is plain in-browser string work.
- **No signature or key handling** — the JWT decoder only reads the header and
  payload; it never verifies signatures, because there is no secret on-device.

Because the tools are stateless, there is nothing to back up and nothing to
delete — closing the app leaves no trace.
