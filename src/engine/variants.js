/**
 * Character Analysis Engine: the variant index.
 *
 * Scans every character in the Unicode database once and records which visible characters can stand in
 * for which "visual key" (a UTS #39 skeleton). A character is indexed when one of these relations holds:
 *
 *   confusable     UTS #39 confusables.txt maps it to the key (Cyrillic а → a, I → l, Ȣ → 8)
 *   compatibility  its NFKC form is the key's text (𝗄, ｋ, ᵏ, ⓚ: math, fullwidth, super/subscript, circled…)
 *   small-capital  its name is "<SCRIPT> LETTER SMALL CAPITAL X" (ᴋ → k)
 *   diacritic      its canonical decomposition is the key's letter plus combining marks (ķ → k)
 *   modified       its name is "<SCRIPT> <CASE> LETTER X WITH …" without a decomposition (ƙ → k)
 *   enclosed       its name is "NEGATIVE CIRCLED/SQUARED LATIN CAPITAL LETTER X" (🅺 → K)
 *   prototype      it is itself a confusables prototype (l is the plain form of 1, I, |)
 *
 * Every entry carries how closely its glyph matches the key's plain form (similarity, 0–1), derived from
 * Unicode properties: decomposition tag, the style words in its name, script, category and case.
 */
import { codePoints } from "./ucd.js";

export const RELATION = {
  CONFUSABLE: "confusable",
  COMPATIBILITY: "compatibility",
  SMALL_CAPITAL: "small-capital",
  DIACRITIC: "diacritic",
  MODIFIED: "modified",
  ENCLOSED: "enclosed",
  PROTOTYPE: "prototype",
  CANONICAL: "canonical-equivalent",
};

/** How much a compatibility-decomposition tag changes the look of the base character. */
const TAG_SIMILARITY = {
  "<wide>": 0.9,
  "<narrow>": 0.92,
  "<noBreak>": 0.97,
  "<compat>": 0.8,
  "<small>": 0.75,
  "<initial>": 0.9,
  "<medial>": 0.9,
  "<final>": 0.9,
  "<isolated>": 0.9,
  "<super>": 0.5,
  "<sub>": 0.45,
  "<circle>": 0.35,
  "<fraction>": 0.35,
  "<square>": 0.3,
  "<vertical>": 0.3,
};

const TAG_FAMILY = {
  "<wide>": "Fullwidth",
  "<narrow>": "Halfwidth",
  "<noBreak>": "No-break form",
  "<compat>": "Compatibility form",
  "<small>": "Small form",
  "<initial>": "Initial form",
  "<medial>": "Medial form",
  "<final>": "Final form",
  "<isolated>": "Isolated form",
  "<super>": "Superscript",
  "<sub>": "Subscript",
  "<circle>": "Circled",
  "<fraction>": "Fraction",
  "<square>": "Squared",
  "<vertical>": "Vertical form",
};

/** Style words that appear in names of <font> characters (MATHEMATICAL SANS-SERIF BOLD SMALL K …). */
const FONT_STYLE_WORDS = [
  ["SANS-SERIF", 0.98],
  ["MONOSPACE", 0.93],
  ["BOLD", 0.9],
  ["ITALIC", 0.86],
  ["DOUBLE-STRUCK", 0.6],
  ["SEGMENTED", 0.6],
  ["OUTLINED", 0.5],
  ["SCRIPT", 0.55],
  ["FRAKTUR", 0.45],
  ["BLACK-LETTER", 0.45],
];

/** Letters whose lowercase is a smaller copy of the capital, so a small capital reads as the lowercase. */
const CASE_SHAPE_INVARIANT = new Set([..."cosuvwxz"]);

const SMALL_CAPITAL_NAME = /^(\w+) LETTER SMALL CAPITAL (.+)$/;
const MODIFIED_NAME = /^(\w+) (SMALL|CAPITAL) LETTER (.+?) WITH (.+)$/;
const ENCLOSED_NAME = /^NEGATIVE (CIRCLED|SQUARED) LATIN CAPITAL LETTER ([A-Z])$/;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u;

function fontStyle(name) {
  let factor = 1;
  const words = [];
  for (const [word, f] of FONT_STYLE_WORDS) {
    // "SCRIPT" also matches inside other words, so match whole words only.
    if (new RegExp(`(^| )${word}( |$)`).test(name)) {
      factor *= f;
      words.push(word.toLowerCase());
    }
  }
  if (!words.length) return { factor: 0.8, family: "Letterlike symbol" };
  const prefix = name.startsWith("MATHEMATICAL") ? "Math " : "";
  return { factor, family: (prefix + words.join(" ")).replace(/^./, (c) => c.toUpperCase()) };
}

export function caseOf(gc) {
  return gc === "Lu" || gc === "Lt" ? "upper" : gc === "Ll" ? "lower" : "none";
}

export class VariantIndex {
  constructor(ucd) {
    this.ucd = ucd;
    /** @type {Map<string, Map<string, object>>} key → (char → entry) */
    this.byKey = new Map();
    /** @type {Map<string, object[]>} char → every entry for that char */
    this.byChar = new Map();
    this.maxKeyLength = 1;
    this.build();
  }

  /**
   * Similarity of a plain base text to the prototype key it shares a skeleton with.
   * Same text (in NFD) is 1. Cross-script homoglyph letters of the same case are designed from the same
   * shapes, so they score highest; letter↔digit and symbol↔letter pairs differ more in most fonts.
   */
  prototypeSimilarity(base, key) {
    if (base.normalize("NFD") === key) return 1;
    const b = codePoints(base);
    const k = codePoints(key);
    if (b.length !== 1 || k.length !== 1) return 0.85;
    const { ucd } = this;
    const gb = ucd.category(b[0]);
    const gk = ucd.category(k[0]);
    let sim;
    if (gb[0] === "L" && gk[0] === "L") {
      const sameCase = caseOf(gb) === caseOf(gk) || caseOf(gb) === "none" || caseOf(gk) === "none";
      if (ucd.script(b[0]) !== ucd.script(k[0])) sim = sameCase ? 0.96 : 0.9;
      else sim = sameCase ? 0.88 : 0.86;
    } else if (gb[0] === "N" && gk[0] === "N") {
      sim = 0.9;
    } else if ("LN".includes(gb[0]) && "LN".includes(gk[0])) {
      sim = 0.82;
    } else {
      sim = 0.78;
    }
    if (/\bDOTLESS\b/.test(ucd.name(b[0]))) sim *= 0.8;
    return sim;
  }

  add(entry) {
    const { key, char } = entry;
    entry.similarity = entry.styleSimilarity * this.prototypeSimilarity(entry.base, key);
    let bucket = this.byKey.get(key);
    if (!bucket) this.byKey.set(key, (bucket = new Map()));
    const existing = bucket.get(char);
    if (existing && existing.similarity >= entry.similarity) return;
    bucket.set(char, entry);
    if (!this.byChar.has(char)) this.byChar.set(char, []);
    const list = this.byChar.get(char);
    if (existing) list.splice(list.indexOf(existing), 1);
    list.push(entry);
    this.maxKeyLength = Math.max(this.maxKeyLength, codePoints(key).length);
  }

  baseEntry(cp, extra) {
    const { ucd } = this;
    const char = String.fromCodePoint(cp);
    return {
      char,
      cp,
      name: ucd.name(cp),
      category: ucd.category(cp),
      script: ucd.script(cp),
      age: ucd.age(cp),
      rtl: ucd.isRightToLeft(cp),
      eligible: true,
      excludedReason: null,
      ...extra,
    };
  }

  allVisible(str) {
    return str.length > 0 && codePoints(str).every((cp) => this.ucd.isVisible(cp));
  }

  build() {
    const { ucd } = this;
    const seen = new Set();
    const candidates = [...ucd.listedCodePoints(), ...ucd.confusables.keys()];
    for (const cp of candidates) {
      if (seen.has(cp)) continue;
      seen.add(cp);
      if (!ucd.isVisible(cp) || REGIONAL_INDICATOR.test(String.fromCodePoint(cp))) continue;
      this.indexCharacter(cp);
    }
    // Prototype characters stand for themselves: "l" is the plain form that "1", "I" and "|" imitate,
    // so a desired "1" can be written with "l". Every character of every prototype gets an entry.
    for (const proto of new Set(ucd.confusables.values())) {
      for (const cp of codePoints(proto)) {
        if (!ucd.isVisible(cp)) continue;
        const char = String.fromCodePoint(cp);
        this.add(
          this.baseEntry(cp, {
            key: ucd.skeleton(char),
            base: char,
            relation: RELATION.PROTOTYPE,
            tag: null,
            family: "Plain",
            styleSimilarity: 1,
          }),
        );
      }
    }
  }

  indexCharacter(cp) {
    const { ucd } = this;
    const char = String.fromCodePoint(cp);
    const rec = ucd.get(cp);
    const name = rec.name;
    const nfc = char.normalize("NFC");
    const nfkc = char.normalize("NFKC");
    const nfd = char.normalize("NFD");
    const proto = ucd.prototype(cp);
    const skeleton = ucd.skeleton(char);

    if (nfc !== char) {
      // Canonical singletons (KELVIN SIGN → K, OHM SIGN → Ω) are the same string after NFC, so they can
      // never be a different username. Indexed for the analysis view only.
      if (this.allVisible(nfc)) {
        this.add(
          this.baseEntry(cp, {
            key: ucd.skeleton(nfc),
            base: nfc,
            relation: RELATION.CANONICAL,
            tag: null,
            family: "Canonical equivalent",
            styleSimilarity: 1,
            eligible: false,
            excludedReason: `Canonically equivalent to "${nfc}": Unicode normalization (NFC) turns it back into that character.`,
          }),
        );
      }
      return;
    }

    let structuralKey = null;
    if (nfkc !== char && this.allVisible(nfkc)) {
      const key = (structuralKey = ucd.skeleton(nfkc));
      let styleSimilarity;
      let family;
      if (rec.decompTag === "<font>") {
        ({ factor: styleSimilarity, family } = fontStyle(name));
      } else {
        styleSimilarity = TAG_SIMILARITY[rec.decompTag] ?? 0.8;
        family = TAG_FAMILY[rec.decompTag] ?? "Compatibility form";
      }
      // ſ (LONG S) normalizes to "s" but looks like "f": when UTS #39 says the glyph resembles something
      // other than its NFKC text, the NFKC relation is weak.
      if (proto !== undefined && skeleton !== key) styleSimilarity *= 0.4;
      this.add(this.baseEntry(cp, { key, base: nfkc, relation: RELATION.COMPATIBILITY, tag: rec.decompTag, family, styleSimilarity }));
    } else if (nfd !== char) {
      const [baseCp, ...marks] = codePoints(nfd);
      const base = String.fromCodePoint(baseCp);
      if (ucd.isVisible(baseCp) && marks.every((m) => ucd.category(m)[0] === "M")) {
        this.add(
          this.baseEntry(cp, {
            key: (structuralKey = ucd.skeleton(base)),
            base,
            relation: RELATION.DIACRITIC,
            tag: null,
            family: "Accented",
            marks: marks.length,
            styleSimilarity: marks.length === 1 ? 0.5 : 0.42,
          }),
        );
      }
    }

    // A styled form (𝐤) is also listed in confusables.txt under the same key; the style relation is the
    // more precise description of how it looks, so the confusable entry is only added for other keys.
    if (proto !== undefined && this.allVisible(proto) && structuralKey !== skeleton) {
      this.add(this.baseEntry(cp, { key: skeleton, base: char, relation: RELATION.CONFUSABLE, tag: null, family: "Plain", styleSimilarity: 1 }));
    }

    this.indexByName(cp, name, rec);
  }

  indexByName(cp, name, rec) {
    const { ucd } = this;
    let m = name.match(SMALL_CAPITAL_NAME);
    if (m) {
      const baseCp = ucd.lookupName(`${m[1]} SMALL LETTER ${m[2]}`);
      if (baseCp !== undefined) {
        const base = String.fromCodePoint(baseCp);
        this.add(
          this.baseEntry(cp, {
            key: ucd.skeleton(base),
            base,
            relation: RELATION.SMALL_CAPITAL,
            tag: null,
            family: "Small capital",
            styleSimilarity: CASE_SHAPE_INVARIANT.has(base) ? 0.85 : 0.55,
          }),
        );
      }
      return;
    }
    m = name.match(ENCLOSED_NAME);
    if (m) {
      const base = m[2];
      this.add(
        this.baseEntry(cp, { key: ucd.skeleton(base), base, relation: RELATION.ENCLOSED, tag: null, family: `Negative ${m[1].toLowerCase()}`, styleSimilarity: 0.28 }),
      );
      return;
    }
    m = name.match(MODIFIED_NAME);
    if (m && !rec.decomposition) {
      const baseCp = ucd.lookupName(`${m[1]} ${m[2]} LETTER ${m[3]}`);
      if (baseCp !== undefined && baseCp !== cp && ucd.isVisible(baseCp)) {
        const base = String.fromCodePoint(baseCp);
        this.add(
          this.baseEntry(cp, {
            key: ucd.skeleton(base),
            base,
            relation: RELATION.MODIFIED,
            tag: null,
            family: "Modified letter",
            detail: m[4].toLowerCase(),
            styleSimilarity: 0.45,
          }),
        );
      }
    }
  }

  /** Entries whose glyph stands for `key` (a skeleton string). */
  entriesFor(key) {
    const bucket = this.byKey.get(key);
    return bucket ? [...bucket.values()] : [];
  }

  entry(key, char) {
    return this.byKey.get(key)?.get(char);
  }

  get size() {
    let n = 0;
    for (const bucket of this.byKey.values()) n += bucket.size;
    return n;
  }
}
