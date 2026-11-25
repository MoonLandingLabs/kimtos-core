# Reference

## The voice palette

All 28 voices, in the order the app shows them. **Grade** is the model authors'
own assessment of that speaker, from A (best) down to F — it is reproduced
verbatim rather than reinterpreted, because it is a genuinely useful signal about
which voices are worth using. The four marked **Top** are the shortlist behind the
picker's **Top picks** filter, one per group.

### US · Female

| Voice   | Id           | Grade | Top |
| ------- | ------------ | ----- | --- |
| Heart   | `af_heart`   | A     | Yes |
| Bella   | `af_bella`   | A-    | -   |
| Nicole  | `af_nicole`  | B-    | -   |
| Aoede   | `af_aoede`   | C+    | -   |
| Kore    | `af_kore`    | C+    | -   |
| Sarah   | `af_sarah`   | C+    | -   |
| Nova    | `af_nova`    | C     | -   |
| Sky     | `af_sky`     | C-    | -   |
| Alloy   | `af_alloy`   | C     | -   |
| Jessica | `af_jessica` | D     | -   |
| River   | `af_river`   | D     | -   |

### US · Male

| Voice   | Id           | Grade | Top |
| ------- | ------------ | ----- | --- |
| Fenrir  | `am_fenrir`  | C+    | -   |
| Michael | `am_michael` | C+    | Yes |
| Puck    | `am_puck`    | C+    | -   |
| Echo    | `am_echo`    | D     | -   |
| Eric    | `am_eric`    | D     | -   |
| Liam    | `am_liam`    | D     | -   |
| Onyx    | `am_onyx`    | D     | -   |
| Santa   | `am_santa`   | D-    | -   |
| Adam    | `am_adam`    | F+    | -   |

### UK · Female

| Voice    | Id            | Grade | Top |
| -------- | ------------- | ----- | --- |
| Emma     | `bf_emma`     | B-    | Yes |
| Isabella | `bf_isabella` | C     | -   |
| Alice    | `bf_alice`    | D     | -   |
| Lily     | `bf_lily`     | D     | -   |

### UK · Male

| Voice  | Id          | Grade | Top |
| ------ | ----------- | ----- | --- |
| Fable  | `bm_fable`  | C     | -   |
| George | `bm_george` | C     | Yes |
| Daniel | `bm_daniel` | D     | -   |
| Lewis  | `bm_lewis`  | D     | -   |

A voice id encodes its group: the first letter is the accent (`a` for US, `b`
for UK) and the second is the gender (`f` or `m`). **Heart** is the default.

The model's repository also carries voices for other languages. They are
deliberately not shipped: they were trained against a different pronunciation
frontend from the one the extension runs, so they would be mispronounced rather
than merely accented.

## Controls

| Control          | Range / values                 | Notes                                                                                                                               |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Voice            | Any of the 28 above            | Click a card to select it. Persisted as the `voice` setting.                                                                        |
| Play a sample    | -                              | On every card and in the voice bar. Does not change the selection; click again to stop.                                             |
| Download a voice | -                              | The same control on a voice not held yet: fetches the model (first time) and that voice's file, with a progress bar, then plays it. |
| Search / filters | Name text, accent, gender, top | Narrow the picker grid. The count above the grid says how many voices are showing.                                                  |
| Speed            | 0.5x to 2x, 0.1x steps         | Applies to the next render, and is remembered. The only delivery control the model exposes.                                         |
| Speak            | -                              | Enabled once the text box is non-empty and no render is running. A sample playing never blocks it.                                  |
| Cancel           | -                              | Visible during a render; stops at the next chunk boundary.                                                                          |
| Download WAV     | -                              | Mono 16-bit PCM at 24 kHz, named from the first words of the text.                                                                  |
| Save to clips    | -                              | Files the clip in the sidebar and opens it. Replaced by `Saved to clips` when auto-save is on.                                      |

## Settings

Declared on the descriptor, so they appear both behind the settings control in
the app window's title bar and in **Settings ▸ Apps**.

| Setting         | Type   | Default | Effect                                                              |
| --------------- | ------ | ------- | ------------------------------------------------------------------- |
| Voice           | Select | Heart   | The voice the studio starts with; picking one in the app writes it. |
| Speaking speed  | Slider | 1.0x    | The studio's speed slider — the same stored value.                  |
| Save every clip | Toggle | Off     | Files each finished clip in the sidebar automatically.              |

## Output format

| Property    | Value                            |
| ----------- | -------------------------------- |
| Container   | WAV (RIFF)                       |
| Encoding    | 16-bit signed PCM                |
| Channels    | Mono                             |
| Sample rate | 24 kHz (the model's native rate) |

## Downloads and storage

| Item             | Size      | When it is fetched                                                             |
| ---------------- | --------- | ------------------------------------------------------------------------------ |
| Speech model     | ~90 MB    | Once, on install (prefetched) or on the first render.                          |
| Voice style file | ~0.5 MB   | The first time you use that particular voice.                                  |
| Saved clips      | Your WAVs | Never fetched — created locally and stored in the local database.              |
| Voice samples    | Small     | Never fetched — rendered once per voice on play, then kept for instant replay. |

Saved clips are capped at the 40 most recent; older ones are pruned as new ones
are added. Uninstalling the app offers to delete both the cached model files and
your saved clips.

## Agent tools (declared, dormant)

These are declared on the app descriptor and collected by the assistant's tool
registry, but no shipped on-device model can drive the tool loop, so none of them
runs today.

| Tool          | Parameters                 | Would do                                                     |
| ------------- | -------------------------- | ------------------------------------------------------------ |
| `list_voices` | -                          | List every voice with its id, accent and gender.             |
| `speak_text`  | `text`, `voice?`, `speed?` | Synthesise the text and save it as a clip, returning its id. |
| `list_clips`  | -                          | List saved clips with their id, name and voice.              |
| `delete_clip` | `id`                       | Delete one saved clip.                                       |

An unknown `voice` falls back to the default rather than failing, and every tool
returns a plain message on a bad argument instead of throwing.

## Attribution

Voice Studio speaks with **Kokoro-82M**, an Apache-2.0 text-to-speech model. The
voice palette and the pronunciation frontend are derived from the Apache-2.0
`kokoro-js` project. Both are attributed in the product's third-party notices,
which travel with the extension.
