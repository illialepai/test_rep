/**
 * Unicode Character Database loader.
 *
 * Reads the official Unicode data files vendored in data/unicode (UnicodeData.txt, Scripts.txt,
 * DerivedAge.txt and the UTS #39 confusables.txt) and answers per-character questions: name,
 * general category, bidi class, decomposition tag, script, age, confusable prototype and the
 * UTS #39 skeleton. Normalization itself uses the runtime's ICU (String.prototype.normalize).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "unicode");

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const NONCHARACTER = /\p{Noncharacter_Code_Point}/u;
/** General categories that never render as a standalone visible glyph. */
const INVISIBLE_CATEGORIES = new Set(["Cc", "Cf", "Cs", "Co", "Cn", "Zs", "Zl", "Zp", "Mn", "Me", "Mc"]);

export function hex(cp) {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

export function codePointLabel(cp) {
  return "U+" + hex(cp);
}

/** Code points of a string, iterating by code point (astral characters stay whole). */
export function codePoints(str) {
  return Array.from(str, (ch) => ch.codePointAt(0));
}

// Hangul syllable names are algorithmic (Unicode §3.12), so UnicodeData.txt only lists the range.
const JAMO_L = ["G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"];
const JAMO_V = [
  "A",
  "AE",
  "YA",
  "YAE",
  "EO",
  "E",
  "YEO",
  "YE",
  "O",
  "WA",
  "WAE",
  "OE",
  "YO",
  "U",
  "WEO",
  "WE",
  "WI",
  "YU",
  "EU",
  "YI",
  "I",
];
const JAMO_T = [
  "",
  "G",
  "GG",
  "GS",
  "N",
  "NJ",
  "NH",
  "D",
  "L",
  "LG",
  "LM",
  "LB",
  "LS",
  "LT",
  "LP",
  "LH",
  "M",
  "B",
  "BS",
  "S",
  "SS",
  "NG",
  "J",
  "C",
  "K",
  "T",
  "P",
  "H",
];

function hangulName(cp) {
  const s = cp - 0xac00;
  const l = Math.floor(s / 588);
  const v = Math.floor((s % 588) / 28);
  const t = s % 28;
  return "HANGUL SYLLABLE " + JAMO_L[l] + JAMO_V[v] + JAMO_T[t];
}

function rangeName(label, cp) {
  if (label.startsWith("Hangul Syllable")) return hangulName(cp);
  if (label.startsWith("CJK Ideograph")) return "CJK UNIFIED IDEOGRAPH-" + hex(cp);
  if (label.startsWith("Tangut Ideograph")) return "TANGUT IDEOGRAPH-" + hex(cp);
  return `<${label.toLowerCase()}-${hex(cp)}>`;
}

function stripComment(line) {
  const i = line.indexOf("#");
  return (i === -1 ? line : line.slice(0, i)).trim();
}

/** Parses "XXXX..YYYY ; Value" files (Scripts.txt, DerivedAge.txt) into sorted [start, end, value] ranges. */
export function parseRangeFile(text) {
  const ranges = [];
  for (const raw of text.split("\n")) {
    const line = stripComment(raw);
    if (!line) continue;
    const [span, value] = line.split(";").map((s) => s.trim());
    const [a, b] = span.split("..");
    ranges.push([parseInt(a, 16), parseInt(b ?? a, 16), value]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  return ranges;
}

function lookupRange(ranges, cp) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b, value] = ranges[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return value;
  }
  return undefined;
}

export function parseUnicodeData(text) {
  const records = new Map();
  const ranges = [];
  let pendingFirst = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.split(";");
    const cp = parseInt(f[0], 16);
    let name = f[1];
    const base = { gc: f[2], ccc: Number(f[3]), bidi: f[4] };
    if (name.endsWith(", First>")) {
      pendingFirst = { cp, label: name.slice(1, -", First>".length), ...base };
      continue;
    }
    if (name.endsWith(", Last>") && pendingFirst) {
      ranges.push({
        start: pendingFirst.cp,
        end: cp,
        label: pendingFirst.label,
        gc: base.gc,
        ccc: base.ccc,
        bidi: base.bidi,
      });
      pendingFirst = null;
      continue;
    }
    if (name === "<control>") name = f[10] ? `<control> ${f[10]}` : "<control>";
    let decompTag = null;
    let decomposition = null;
    if (f[5]) {
      const parts = f[5].split(" ");
      if (parts[0].startsWith("<")) decompTag = parts.shift();
      decomposition = parts.map((p) => parseInt(p, 16));
    }
    records.set(cp, {
      cp,
      name,
      ...base,
      decompTag,
      decomposition,
      upper: f[12] ? parseInt(f[12], 16) : null,
      lower: f[13] ? parseInt(f[13], 16) : null,
    });
  }
  return { records, ranges };
}

/** Parses UTS #39 confusables.txt: source code point → prototype string. */
export function parseConfusables(text) {
  const map = new Map();
  let version = null;
  for (const raw of text.replace(/^﻿/, "").split("\n")) {
    const v = raw.match(/^#\s*Version:\s*([\d.]+)/);
    if (v) version = v[1];
    const line = stripComment(raw);
    if (!line) continue;
    const [source, target] = line.split(";").map((s) => s.trim());
    const target_ = String.fromCodePoint(...target.split(/\s+/).map((h) => parseInt(h, 16)));
    map.set(parseInt(source, 16), target_);
  }
  return { map, version };
}

function headerVersion(text) {
  const m = text.match(/^#\s*\w+-(\d+\.\d+\.\d+)\.txt/m);
  return m ? m[1] : null;
}

export class UnicodeDatabase {
  constructor({ unicodeData, scripts, ages, confusables, version, confusablesVersion }) {
    this.records = unicodeData.records;
    this.ranges = unicodeData.ranges;
    this.scripts = scripts;
    this.ages = ages;
    this.confusables = confusables;
    this.version = version;
    this.confusablesVersion = confusablesVersion;
    this.nameIndex = new Map();
    for (const rec of this.records.values()) this.nameIndex.set(rec.name, rec.cp);
  }

  /** Full record for a code point, or null when it is unassigned. */
  get(cp) {
    const rec = this.records.get(cp);
    if (rec) return rec;
    for (const r of this.ranges) {
      if (cp >= r.start && cp <= r.end) {
        return {
          cp,
          name: rangeName(r.label, cp),
          gc: r.gc,
          ccc: r.ccc,
          bidi: r.bidi,
          decompTag: null,
          decomposition: null,
          upper: null,
          lower: null,
        };
      }
    }
    return null;
  }

  name(cp) {
    return this.get(cp)?.name ?? `<unassigned-${hex(cp)}>`;
  }

  category(cp) {
    return this.get(cp)?.gc ?? "Cn";
  }

  script(cp) {
    return lookupRange(this.scripts, cp) ?? "Unknown";
  }

  /** Unicode version that introduced the code point, as a number (e.g. 3.2), or null. */
  age(cp) {
    const v = lookupRange(this.ages, cp);
    return v ? Number(v) : null;
  }

  lookupName(name) {
    return this.nameIndex.get(name);
  }

  prototype(cp) {
    return this.confusables.get(cp);
  }

  /** True for characters that draw a visible glyph on their own (no controls, spaces, marks, invisibles). */
  isVisible(cp) {
    const gc = this.category(cp);
    if (INVISIBLE_CATEGORIES.has(gc)) return false;
    const ch = String.fromCodePoint(cp);
    return !DEFAULT_IGNORABLE.test(ch) && !NONCHARACTER.test(ch);
  }

  /** Right-to-left letters (R, AL) and Arabic digits (AN) change bidi ordering next to other characters. */
  isRightToLeft(cp) {
    const bidi = this.get(cp)?.bidi;
    return bidi === "R" || bidi === "AL" || bidi === "AN";
  }

  /** UTS #39 skeleton: NFD, drop default ignorables, map each character to its prototype, NFD again. */
  skeleton(str) {
    let out = "";
    for (const ch of str.normalize("NFD")) {
      if (DEFAULT_IGNORABLE.test(ch)) continue;
      out += this.confusables.get(ch.codePointAt(0)) ?? ch;
    }
    return out.normalize("NFD");
  }

  /** Every explicitly listed code point (ranges such as CJK ideographs are not expanded). */
  *listedCodePoints() {
    yield* this.records.keys();
  }

  /** Display-oriented description of one character. */
  describe(cp) {
    const rec = this.get(cp);
    const ch = String.fromCodePoint(cp);
    return {
      char: ch,
      cp,
      codePoint: codePointLabel(cp),
      name: rec?.name ?? `<unassigned-${hex(cp)}>`,
      category: rec?.gc ?? "Cn",
      script: this.script(cp),
      age: this.age(cp),
      bidi: rec?.bidi ?? null,
      decompositionTag: rec?.decompTag ?? null,
      nfc: ch.normalize("NFC"),
      nfkc: ch.normalize("NFKC"),
      visible: this.isVisible(cp),
    };
  }
}

export function loadUnicodeDatabase(dir = DEFAULT_DATA_DIR) {
  const read = (file) => readFileSync(join(dir, file), "utf8");
  const scriptsText = read("Scripts.txt");
  const confusables = parseConfusables(read("confusables.txt"));
  return new UnicodeDatabase({
    unicodeData: parseUnicodeData(read("UnicodeData.txt")),
    scripts: parseRangeFile(scriptsText),
    ages: parseRangeFile(read("DerivedAge.txt")),
    confusables: confusables.map,
    version: headerVersion(scriptsText),
    confusablesVersion: confusables.version,
  });
}
