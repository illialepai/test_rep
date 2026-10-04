/**
 * Centralized username style registry.
 *
 * Every style maps the characters TikTok allows in a username
 * (a–z, 0–9, "_" and ".") to replacement Unicode characters. The input is
 * always lowercased first, because TikTok usernames are lowercase, so styles
 * only need lowercase + digit + "_" + "." mappings.
 *
 * To add a style, append an object to STYLES:
 *   {
 *     id:    "unique-id",
 *     name:  "Shown on the card",
 *     group: "math" | "letterlike" | "enclosed" | "plain",
 *     map:   { a: "…", …, "0": "…", … }   // characters not listed stay as-is
 *     note:  "optional caveat shown in the UI"
 *   }
 * The compatibility check (validate.js) runs on whatever the map produces, so
 * a new style is automatically labelled. Nothing here is a CSS font: every
 * value is a real Unicode code point that survives copy/paste.
 */

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/**
 * Builds a map from the Mathematical Alphanumeric Symbols block
 * (U+1D400–U+1D7FF). Each style is a run of 26 lowercase letters (and
 * sometimes 10 digits) at a fixed start code point.
 *
 * A few letters were encoded earlier in the Letterlike Symbols block
 * (U+2100–U+214F), which leaves "holes" in the math block. Those reserved
 * code points render as tofu, so they must be replaced by the older
 * character, which is what `holes` is for (e.g. italic h → ℎ U+210E).
 */
function mathMap(lowerStart, digitStart = null, holes = {}) {
  const map = {};
  [...LOWER].forEach((ch, i) => {
    map[ch] = holes[ch] ?? String.fromCodePoint(lowerStart + i);
  });
  if (digitStart !== null) {
    [...DIGITS].forEach((ch, i) => {
      map[ch] = String.fromCodePoint(digitStart + i);
    });
  }
  return map;
}

/** Zips a source alphabet with a same-length list of replacements. */
function zipMap(from, to) {
  const target = [...to];
  const map = {};
  [...from].forEach((ch, i) => {
    // "·" marks "no Unicode equivalent exists": leave the original character.
    if (target[i] && target[i] !== "·") map[ch] = target[i];
  });
  return map;
}

export const STYLES = [
  {
    id: "plain",
    name: "Standard",
    group: "plain",
    map: {},
    note: "Plain a–z / 0–9. TikTok's official username format.",
  },
  {
    // IPA / phonetic small capitals, mostly U+1D00–U+1D22 plus a few from
    // Latin Extended. Unicode has no small-capital Q or X, so those stay plain.
    id: "small-caps",
    name: "Small Caps",
    group: "letterlike",
    map: zipMap(LOWER, "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘ·ʀꜱᴛᴜᴠᴡ·ʏᴢ"),
  },
  {
    id: "bold",
    name: "Bold",
    group: "math",
    map: mathMap(0x1d41a, 0x1d7ce),
  },
  {
    // U+1D455 (italic h) is reserved; Planck constant ℎ U+210E is used instead.
    id: "italic",
    name: "Italic",
    group: "math",
    map: mathMap(0x1d44e, null, { h: "ℎ" }),
  },
  {
    id: "bold-italic",
    name: "Bold Italic",
    group: "math",
    map: mathMap(0x1d482),
  },
  {
    id: "sans",
    name: "Sans",
    group: "math",
    map: mathMap(0x1d5ba, 0x1d7e2),
  },
  {
    id: "sans-bold",
    name: "Sans Bold",
    group: "math",
    map: mathMap(0x1d5ee, 0x1d7ec),
  },
  {
    id: "sans-italic",
    name: "Sans Italic",
    group: "math",
    map: mathMap(0x1d622),
  },
  {
    id: "sans-bold-italic",
    name: "Sans Bold Italic",
    group: "math",
    map: mathMap(0x1d656),
  },
  {
    id: "monospace",
    name: "Monospace",
    group: "math",
    map: mathMap(0x1d68a, 0x1d7f6),
  },
  {
    // Script e, g, o are holes filled by ℯ U+212F, ℊ U+210A, ℴ U+2134.
    id: "script",
    name: "Script",
    group: "math",
    map: mathMap(0x1d4b6, null, { e: "ℯ", g: "ℊ", o: "ℴ" }),
  },
  {
    id: "bold-script",
    name: "Bold Script",
    group: "math",
    map: mathMap(0x1d4ea),
  },
  {
    id: "fraktur",
    name: "Fraktur",
    group: "math",
    map: mathMap(0x1d51e),
  },
  {
    id: "bold-fraktur",
    name: "Bold Fraktur",
    group: "math",
    map: mathMap(0x1d586),
  },
  {
    id: "double-struck",
    name: "Double-Struck",
    group: "math",
    map: mathMap(0x1d552, 0x1d7d8),
  },
  {
    // Halfwidth and Fullwidth Forms block (U+FF00–U+FFEF). Fullwidth also
    // has its own low line ＿ (U+FF3F) and full stop ． (U+FF0E).
    id: "fullwidth",
    name: "Fullwidth",
    group: "letterlike",
    map: {
      ...zipMap(LOWER, [...LOWER].map((c) => String.fromCodePoint(c.codePointAt(0) - 0x61 + 0xff41)).join("")),
      ...zipMap(DIGITS, "０１２３４５６７８９"),
      _: "＿",
      ".": "．",
    },
  },
  {
    // Enclosed Alphanumerics (U+2460–U+24FF). These are symbols (category So),
    // not letters, so they fail TikTok's letters/numbers rule.
    id: "circled",
    name: "Circled",
    group: "enclosed",
    map: {
      ...zipMap(LOWER, "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ"),
      ...zipMap(DIGITS, "⓪①②③④⑤⑥⑦⑧⑨"),
    },
  },
  {
    // Modifier letters (U+02B0–U+02FF, U+1D2C–U+1DBF) and superscript digits.
    // There is no widely supported superscript q, so q stays plain.
    id: "superscript",
    name: "Superscript",
    group: "letterlike",
    map: {
      ...zipMap(LOWER, "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ·ʳˢᵗᵘᵛʷˣʸᶻ"),
      ...zipMap(DIGITS, "⁰¹²³⁴⁵⁶⁷⁸⁹"),
    },
  },
  {
    // Unicode only encodes subscripts for some letters (U+2090–U+209C,
    // U+1D62–U+1D6A, U+2C7C). Letters without one stay plain.
    id: "subscript",
    name: "Subscript",
    group: "letterlike",
    map: {
      ...zipMap(LOWER, "ₐ···ₑ··ₕᵢⱼₖₗₘₙₒₚ·ᵣₛₜᵤᵥ·ₓ··"),
      ...zipMap(DIGITS, "₀₁₂₃₄₅₆₇₈₉"),
    },
  },
];

export function getStyle(id) {
  return STYLES.find((s) => s.id === id);
}
