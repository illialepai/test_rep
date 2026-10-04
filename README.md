# TikTok Username Transformation Machine

A desktop utility. You enter the username you want your TikTok profile to **display**, and the machine finds
_different underlying Unicode strings_ that render like it. It shows each candidate's visual preview, exact code
points, normalization forms, a similarity score and a compatibility estimate, ranked. You pick one, the machine
copies it and opens TikTok in your normal browser, and you submit it there yourself.

```
DESIRED USERNAME  ──►  Username Transformation Engine  ──►  UNDERLYING UNICODE CANDIDATES
      alex                                                   аlex   U+0430 U+006C U+0065 U+0078  (98%)
                                                             aleх   U+0061 U+006C U+0065 U+0445  (98%)
                                                             𝖺𝗅𝖾𝗑   U+1D5BA U+1D5C5 U+1D5BE U+1D5D1 …
```

It is not a font generator: nothing is forced into one style. Each character is analysed on its own against the
Unicode database, and candidates mix whatever representation fits each position best.

## Start it

Requires **Node.js 18.17 or newer**. There are no dependencies to install.

```bash
npm start
```

- The machine opens in its own window if Chrome, Edge, Chromium or Brave is installed (app mode, separate
  window profile). Close the window to stop it.
- `npm run start:tab` opens it as a tab in your default browser instead; stop it with **Quit** or `Ctrl+C`.
- `npm run serve` only starts the local server (`127.0.0.1`, random port) and prints the address.

## Using it

1. Enter your **existing username** (used only to open your own profile page) and the **desired username**.
2. Press **Transform**. The four engine stages light up: analyze characters → search the Unicode database →
   generate combinations → rank.
3. **Character analysis** lists every character's code point, name, category, script, NFC/NFKC forms, UTS #39
   visual key and every visible variant found, with similarity and compatibility. It also lists excluded
   characters and why.
4. **Transformation results**: sort by rank, similarity, rendered match or compatibility. Show the full code-point
   table, copy one candidate, copy all, generate more, or clear.
5. **Use this candidate** copies it to the clipboard and opens `https://www.tiktok.com/@<existing username>` in
   your default browser, where you are already signed in.
6. In TikTok: **Edit profile → Username**, paste, **Save**. In the phone app: Profile → Edit profile → Username.
7. Tell the machine what TikTok said. **TikTok rejected it** shows _"TikTok rejected this candidate. Try another
   candidate."_ and takes you back to the list, with that candidate marked and moved to the end. **TikTok
   accepted it** is recorded as _your report_ only, with a button to open the new profile and check.

### What it never does

- It never asks for, reads or stores passwords, cookies, session IDs or tokens.
- It never calls TikTok's API, logs in, fills TikTok's forms or touches CAPTCHA, rate limits or validation.
- It never claims a username was changed. Only TikTok can confirm that.
- It never promises a candidate will work. TikTok decides what is valid and available.

Don't use look-alike usernames to impersonate other people or brands.

### What to expect from TikTok

TikTok documents usernames as **letters, numbers, underscores and periods, 2–24 characters**. It doesn't say which
Unicode "letters" it accepts. Candidates outside plain `a–z 0–9 _ .` are therefore capped at **Medium**
compatibility, and many will be rejected. A one-character desired username (like `k`) only has one-character
candidates, below the documented 2-character minimum; the card says so. Plain-ASCII candidates (`rn` for `m`,
`l` for `1`) are the most likely to be accepted but look less identical. The compatibility notes on each card
explain every risk found.

## How the Username Transformation Engine works

### 1. Unicode database (`src/engine/ucd.js`)

The official Unicode **16.0** data files are vendored in `data/unicode/` and parsed at startup (about 0.3 s):

- `UnicodeData.txt`: names, general category, bidi class, decomposition tags (`<font>`, `<wide>`, `<super>` …)
- `Scripts.txt`: script per character
- `DerivedAge.txt`: the Unicode version that introduced each character (a proxy for font coverage)
- `confusables.txt` (UTS #39): visual confusable prototypes

Normalization uses the runtime's ICU (`String.prototype.normalize`, Unicode 16 in Node 22). The UTS #39
**skeleton** (NFD → drop default-ignorables → map to prototypes → NFD) is the "visual key" of a string.

### 2. Character Analysis Engine (`src/engine/variants.js`)

One pass over all ~40,000 listed characters builds a variant index of **10,330 mappings** under 3,808 visual keys.
Each visible character is indexed under the key it imitates, with one of these relations:

| Relation      | Source                                                    | Example          |
| ------------- | --------------------------------------------------------- | ---------------- |
| confusable    | UTS #39 confusables.txt                                   | а (Cyrillic) → a |
| compatibility | NFKC form + decomposition tag + style words in the name   | 𝗄 ｋ ᵏ ₖ ⓚ → k   |
| small-capital | name `… LETTER SMALL CAPITAL X`                           | ᴋ → k            |
| diacritic     | canonical decomposition into the letter + combining marks | ķ → k            |
| modified      | name `… LETTER X WITH HOOK/STROKE…`                       | ƙ → k            |
| enclosed      | name `NEGATIVE CIRCLED/SQUARED LATIN CAPITAL LETTER X`    | 🅺 → K            |
| prototype     | the plain form other characters imitate                   | l for 1          |

Every entry gets a similarity from its properties: the decomposition tag (fullwidth 0.9, superscript 0.5, circled
0.35 …), the style words in its name (SANS-SERIF 0.98, BOLD 0.9, ITALIC 0.86, SCRIPT 0.55, FRAKTUR 0.45 …), and
for confusables the category, case and script pair (a cross-script homoglyph letter of the same case is 0.96,
letter↔digit 0.82, symbol↔letter 0.78).

Characters that can never be a different username are excluded and listed with the reason: canonical equivalents
like KELVIN SIGN (NFC turns it into K), invisible or default-ignorable characters, regional indicators, and
right-to-left letters or Arabic digits that would reorder a left-to-right username.

### 3. Candidate generation (`src/engine/engine.js`)

The desired username becomes a sequence of visual keys. The engine builds a **lattice** over it: every index entry
whose key matches a stretch of that sequence is an edge. A path through the lattice is a candidate string. That
handles single swaps (а for a), one character split into several (`rn` for `m`), and several merged into one (`ﬁ`
for `fi`). Combining marks in the input are kept (`е́` for `é`). Candidates come from:

- a **beam search** bucketed by the number of transformed characters (best 1-change, 2-change, … candidates)
- every single replacement on its own
- uniform-style strings (all fullwidth, all Cyrillic look-alikes, all math sans-serif …) and an all-transformed one

Candidates are deduplicated by their NFC form. The desired string itself and its canonical equivalents are
excluded. **Generate more** raises the search depth and appends only new candidates.

### 4. Scores and ranking (`src/engine/scoring.js`)

- **Similarity**: per-character similarity, 70% mean + 30% worst character.
- **Character compatibility**: per character. Plain `a–z 0–9 _ .` = 1. Lower for other letters, NFKC-unstable
  characters, symbols, non-recommended scripts (UAX #31), astral-plane characters, characters added in Unicode
  10+, emoji-capable characters and RTL characters.
- **Compatibility estimate** (0–100, High/Medium/Low/Very low): per-character scores plus string-level risks such
  as mixed scripts, folding back to the desired name under NFKC, depending on capital letters, and TikTok's
  documented length rules.
- **Readability**: consistent style and baseline. **Unicode stability**: unchanged by NFKC, lowercasing and
  combining marks.
- **Rank** = `similarity × (0.7 + 0.3 × secondary)`, where `secondary` weighs character compatibility (0.35),
  fewer transformed characters (0.25), readability (0.15), stability (0.15) and the compatibility estimate (0.10).
  Visual similarity always leads; the rest decides between candidates that look about equally close.

**Rendered match** (`src/ui/render-check.js`) is measured in the window: the desired name and the candidate are
drawn with this computer's fonts, and their ink overlap is compared with 1-pixel tolerance. It catches glyphs that
look different on your system or render as empty boxes. It is shown on every card and available as a sort.

## Test

```bash
npm test           # 77 unit/integration tests: database, engine, scoring, server, OS helpers, launcher
npm run test:e2e   # 23 checks in real Chromium via Playwright (UI flows, clipboard, navigation, layouts)
npm run test:all   # both
```

`test:e2e` needs Playwright (local or global install). It replaces the OS actions (open browser, OS clipboard)
with recorders so it can assert the exact TikTok URL opened. Set `SHOT_DIR=/some/dir` to save screenshots.

## Structure

```
bin/machine.mjs          desktop launcher (app window / browser tab / server only)
data/unicode/            official Unicode 16.0 data files + Unicode License V3
src/engine/
  ucd.js                 Unicode database loader, skeleton()
  variants.js            Character Analysis Engine: variant index and similarity
  scoring.js             compatibility, readability, stability, rank score, TikTok's documented rules
  engine.js              Username Transformation Engine: validation, lattice, search, ranking, analysis
src/app/
  server.js              local HTTP API (127.0.0.1 only, Host/Origin checks, per-launch token, CSP)
  system.js              open default browser, OS clipboard fallback, app-window browser lookup
  tiktok.js              the only URLs the app may open (www.tiktok.com, built from usernames)
src/ui/                  the window: index.html, styles.css, app.js, render-check.js, clipboard.js …
tests/                   *.test.js (node --test) and e2e.mjs (Playwright)
```

Not affiliated with TikTok.
