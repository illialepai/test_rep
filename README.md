# TikTok Username Font Generator

Turns a TikTok **@username** into styled Unicode versions (𝐛𝐨𝐥𝐝, ᴀʙᴄ small caps, 𝔣𝔯𝔞𝔨𝔱𝔲𝔯, ｆｕｌｌｗｉｄｔｈ…).
Each version can be copied as real text and pasted into **Profile → Edit profile → Username**.

Every result is made of real Unicode code points, not a CSS font, so what you copy is the styled username itself.

## Run

```bash
npm start          # http://localhost:5173
```

No dependencies or build step. Any static file server works too (`npx serve .`).

## Test

```bash
npm test           # unit tests: every style mapping, validation, edge cases
npm run test:e2e   # Chromium via Playwright: copy, Copy All, filters, dialog, invalid input,
                   # desktop + mobile overflow, console errors
```

## Structure

```
index.html
src/
  core/               # no DOM here, so it can be unit tested in Node
    styles.js         # style registry: add a new style here
    transform.js      # applies a style; per-character breakdown
    validate.js       # input cleanup + compatibility status
  ui/
    components.js     # StyleCard, Messages, copy button
    clipboard.js      # Clipboard API with an execCommand fallback
  app.js              # state + wiring
  styles.css          # design tokens at the top
scripts/serve.mjs     # zero-dependency static server
tests/
```

### Adding a style

Append an entry to `STYLES` in `src/core/styles.js` with a `map` from `a–z`, `0–9`, `_`, `.` to replacement
characters. Unmapped characters stay plain and are reported in the UI. The compatibility status is worked out
automatically, and then add the expected output to `tests/core.test.js`.

## Compatibility statuses

TikTok says usernames may contain only **letters, numbers, underscores and periods** (2–24 characters, not
ending in a period). It doesn't say which Unicode letters it accepts, so each result is labelled from
character properties:

| Status                 | Meaning                                                                                               | Examples                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Likely compatible      | Plain a–z/0–9/\_/. or a Unicode letter that NFKC normalization leaves unchanged                       | `myname`, `ᴍʏɴᴀᴍᴇ`                 |
| May not work           | A letter or number that NFKC folds into plain text, so TikTok may save the plain version or reject it | `𝐦𝐲𝐧𝐚𝐦𝐞`, `ｍｙｎａｍｅ`, `ᵐʸⁿᵃᵐᵉ` |
| Unsupported characters | Symbols (not letters), or length/period rule broken                                                   | `ⓜⓨⓝⓐⓜⓔ`                           |

None of these are guarantees. TikTok decides when you press Save.

## Privacy

Runs entirely in the browser. It never asks for TikTok credentials and doesn't connect to TikTok. Not affiliated
with TikTok.
