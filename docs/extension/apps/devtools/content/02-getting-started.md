# Getting Started

Open DevTools from the dock. The left rail lists every tool, grouped by kind
(Format, Encode / Decode, Generate, Convert, Inspect). Click a tool to load it
into the panel on the right; the first tool (**JSON**) is selected by default.
Nothing you type is stored — each tool just transforms your input on the spot.

## The two panel shapes

Most tools follow one of two layouts:

- **Input → Output** tools (JSON, Base64, URL, HTML entities, JWT decoder) give
  you an input box, one or more action buttons, and a read-only output box. Type
  or paste your text, press a button (e.g. **Format**, **Encode**, **Decode**),
  and the result appears. If the input is invalid, the error is shown inline in
  the output box.
- **Live** tools (Hash, Case convert, Color, Number base, Regex tester, Text
  diff) update as you type — no button to press. Results appear in labelled rows
  or a preview area.

A **copy** button sits next to every result, so you can grab the output with one
click.

## A few examples

- **Format some JSON.** Open **JSON**, paste a compact object into the input, and
  press **Format** to pretty-print it (or **Minify** to collapse it). If the JSON
  is malformed, the parse error tells you where.
- **Decode a JWT.** Open **JWT decoder**, paste a token, and press **Decode**. You
  get the header and payload as formatted JSON, plus human-readable notes for the
  `iat`, `nbf`, and `exp` claims — including whether the token has expired. No
  signature is checked and nothing leaves your machine.
- **Hash a secret.** Open **Hash (SHA)** and start typing; the SHA-1, SHA-256,
  SHA-384, and SHA-512 digests compute live, on-device, via the Web Crypto API.
- **Generate UUIDs.** Open **UUID**, set a count (1–100), and press **Generate**
  for that many random v4 UUIDs, one per line.
- **Convert a color.** Open **Color** and type a `#hex`, `rgb(…)`, or `hsl(…)`
  value — or use the swatch picker — to see all three representations at once.
- **Test a regex.** Open **Regex tester**, enter a pattern and flags, and paste
  sample text; matches are highlighted as you type, with a running match count.

## Everything runs locally

DevTools never contacts a server. Hashing and UUID generation use built-in
browser crypto, and every other tool is plain in-browser string manipulation.
That is the whole point: you can decode a token, hash a credential, or
pretty-print internal JSON without handing it to a website. Because nothing is
stored, closing the app clears everything — there is no history to revisit and
nothing to clean up.
