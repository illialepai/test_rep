import { test } from "node:test";
import assert from "node:assert/strict";
import { codePointLabel, codePoints, loadUnicodeDatabase, parseConfusables, parseRangeFile, parseUnicodeData } from "../src/engine/ucd.js";
import { VariantIndex, RELATION } from "../src/engine/variants.js";

const ucd = loadUnicodeDatabase();

test("loads the vendored Unicode 16 data files", () => {
  assert.equal(ucd.version, "16.0.0");
  assert.equal(ucd.confusablesVersion, "16.0.0");
  assert.ok(ucd.records.size > 39000);
  assert.ok(ucd.confusables.size > 6000);
});

test("names, categories, scripts and ages come from the database", () => {
  assert.equal(ucd.name(0x6b), "LATIN SMALL LETTER K");
  assert.equal(ucd.name(0x1d5c4), "MATHEMATICAL SANS-SERIF SMALL K");
  assert.equal(ucd.category(0x1d5c4), "Ll");
  assert.equal(ucd.get(0x1d5c4).decompTag, "<font>");
  assert.equal(ucd.get(0xff4b).decompTag, "<wide>");
  assert.equal(ucd.script(0x430), "Cyrillic");
  assert.equal(ucd.script(0x38), "Common");
  assert.equal(ucd.age(0x430), 1.1);
  assert.equal(ucd.age(0x1d4f), 4);
});

test("range entries get algorithmic names", () => {
  assert.equal(ucd.name(0xac00), "HANGUL SYLLABLE GA");
  assert.equal(ucd.name(0xd7a3), "HANGUL SYLLABLE HIH");
  assert.equal(ucd.name(0x4e2d), "CJK UNIFIED IDEOGRAPH-4E2D");
  assert.equal(ucd.category(0x4e2d), "Lo");
  assert.equal(ucd.get(0x0378), null, "unassigned code point");
  assert.equal(ucd.category(0x0378), "Cn");
});

test("visibility excludes controls, spaces, marks and invisible characters", () => {
  assert.equal(ucd.isVisible(0x41), true);
  for (const cp of [0x00, 0x20, 0xa0, 0x200b, 0x200d, 0x2060, 0x3164, 0xfe0f, 0x0301, 0xe000, 0xfffe, 0x0378]) {
    assert.equal(ucd.isVisible(cp), false, codePointLabel(cp));
  }
});

test("UTS #39 skeleton maps confusables to their prototypes", () => {
  assert.equal(ucd.skeleton("m"), "rn");
  assert.equal(ucd.skeleton("rn"), "rn");
  assert.equal(ucd.skeleton("1"), "l");
  assert.equal(ucd.skeleton("I"), "l");
  assert.equal(ucd.skeleton("аlех"), "alex", "Cyrillic а е х");
  assert.equal(ucd.skeleton("0"), "O");
  assert.equal(ucd.skeleton("a​b"), "ab", "default ignorables are dropped");
  assert.equal(ucd.skeleton("é"), "é");
});

test("parsers handle the file formats", () => {
  const { records, ranges } = parseUnicodeData("0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;\n4E00;<CJK Ideograph, First>;Lo;0;L;;;;;N;;;;;\n9FFF;<CJK Ideograph, Last>;Lo;0;L;;;;;N;;;;;\n");
  assert.equal(records.get(0x41).lower, 0x61);
  assert.deepEqual(ranges[0], { start: 0x4e00, end: 0x9fff, label: "CJK Ideograph", gc: "Lo", ccc: 0, bidi: "L" });
  assert.deepEqual(parseRangeFile("0000..001F ; Common # Cc\n0041 ; Latin\n"), [
    [0, 0x1f, "Common"],
    [0x41, 0x41, "Latin"],
  ]);
  const conf = parseConfusables("﻿# Version: 16.0.0\n006D ;\t0072 006E ;\tMA\t# m → rn\n");
  assert.equal(conf.version, "16.0.0");
  assert.equal(conf.map.get(0x6d), "rn");
});

test("codePoints iterates astral characters whole", () => {
  assert.deepEqual(codePoints("a𝗄"), [0x61, 0x1d5c4]);
  assert.equal(codePointLabel(0x1d5c4), "U+1D5C4");
});

test("variant index is built dynamically for every key", () => {
  const index = new VariantIndex(ucd);
  assert.ok(index.size > 9000, `indexed ${index.size}`);
  const forK = new Map(index.entriesFor("k").map((e) => [e.char, e]));
  assert.equal(forK.get("𝗄").relation, RELATION.COMPATIBILITY);
  assert.equal(forK.get("𝗄").family, "Math sans-serif");
  assert.equal(forK.get("ｋ").family, "Fullwidth");
  assert.equal(forK.get("ᵏ").family, "Superscript");
  assert.equal(forK.get("ₖ").family, "Subscript");
  assert.equal(forK.get("ⓚ").family, "Circled");
  assert.equal(forK.get("ᴋ").relation, RELATION.SMALL_CAPITAL);
  assert.equal(forK.get("ķ").relation, RELATION.DIACRITIC);
  assert.equal(forK.get("ƙ").relation, RELATION.MODIFIED);
  assert.ok(forK.get("𝗄").similarity > forK.get("𝔨").similarity, "sans-serif looks closer than fraktur");
  assert.equal(index.entry("a", "а").relation, RELATION.CONFUSABLE);
  assert.equal(index.entry("K", "K").eligible, false, "KELVIN SIGN is canonically equivalent to K");
  assert.equal(index.entry("K", "🅺").relation, RELATION.ENCLOSED);
});
