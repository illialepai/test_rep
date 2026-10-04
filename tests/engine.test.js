import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getEngine, InputError, LIMITS } from "../src/engine/engine.js";
import { compatibilityLabel, PLATFORM_RULES, readability, stability, transformationScore } from "../src/engine/scoring.js";

const engine = getEngine();
const pool = (desired, opts = {}) => engine.transform(desired, { count: LIMITS.maxCount, ...opts });
const strings = (result) => result.candidates.map((c) => c.string);
const cps = (str) => Array.from(str, (ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");

function assertCandidateShape(c, desired) {
  assert.notEqual(c.string, desired, "never returns the desired string itself");
  assert.notEqual(c.string.normalize("NFC"), desired.normalize("NFC"), "never returns a canonical equivalent");
  assert.equal(c.codePoints.map((x) => x.codePoint).join(" "), cps(c.string), "code points match the string");
  assert.equal(c.counts.codePoints, [...c.string].length);
  assert.equal(c.counts.utf16Units, c.string.length);
  assert.equal(c.normalization.nfc, c.string.normalize("NFC"));
  assert.equal(c.normalization.nfkc, c.string.normalize("NFKC"));
  assert.equal(c.normalization.nfkcStable, c.string.normalize("NFKC") === c.string);
  for (const key of ["similarity", "characterCompatibility", "readability", "stability"]) assert.ok(c[key] >= 0 && c[key] <= 1, `${key} in 0..1`);
  assert.ok(c.compatibility.score >= 0 && c.compatibility.score <= 100);
  assert.equal(c.compatibility.label, compatibilityLabel(c.compatibility.score));
  assert.ok(c.transformed >= 1, "at least one character transformed");
  assert.ok(c.segments.some((s) => s.changed));
  assert.equal(c.segments.map((s) => s.output).join(""), c.string);
  assert.equal(c.segments.map((s) => s.target).join(""), desired);
  // Every candidate renders like the target according to UTS #39 or a compatibility/style relation;
  // with only look-alike relations the skeletons are equal.
  if (c.segments.every((s) => !s.changed || /look-alike/.test(s.relation))) {
    assert.equal(c.normalization.skeleton, engine.ucd.skeleton(desired), `${c.string} skeleton`);
  }
}

describe("one-character inputs", () => {
  test("k → math, fullwidth, small capital, superscript … variants", () => {
    const r = pool("k");
    const s = strings(r);
    for (const expected of ["𝗄", "ｋ", "𝐤", "ᴋ", "ᵏ", "ₖ", "ķ", "ⓚ"]) assert.ok(s.includes(expected), `has ${expected} (${cps(expected)})`);
    assert.ok(!s.includes("k"));
    assert.ok(!s.includes("K"), "KELVIN SIGN is K, not k");
    for (const c of r.candidates) assertCandidateShape(c, "k");
    const top = r.candidates.find((c) => c.string === "𝗄");
    assert.equal(top.codePoints[0].name, "MATHEMATICAL SANS-SERIF SMALL K");
    assert.ok(top.similarity >= 0.95);
    assert.equal(top.normalization.nfkcEqualsDesired, true);
    assert.ok(top.compatibility.notes.some((n) => /NFKC/.test(n.text)));
    assert.ok(top.compatibility.notes.some((n) => /shorter than TikTok/.test(n.text)), "1 character is below the documented minimum");
  });

  test("8 → Bengali/Gurmukhi digits, Latin OU and math digits", () => {
    const s = strings(pool("8"));
    for (const expected of ["৪", "੪", "ȣ", "𝟖", "８", "⁸"]) assert.ok(s.includes(expected), `has ${expected}`);
  });

  test("m → the ASCII sequence rn (split into two characters)", () => {
    const r = pool("m");
    const rn = r.candidates.find((c) => c.string === "rn");
    assert.ok(rn, "rn is a candidate");
    assert.ok(rn.rank <= 3, "plain-ASCII rn ranks near the top");
    assert.equal(rn.compatibility.label, "High");
    assert.equal(rn.segments.length, 1);
    assert.equal(rn.segments[0].target, "m");
  });

  test("fi → the ligature ﬁ (one character for two)", () => {
    const r = pool("fi");
    const lig = r.candidates.find((c) => c.string === "ﬁ");
    assert.ok(lig, "ﬁ is a candidate");
    assert.equal(lig.normalization.nfkc, "fi");
    assert.ok(r.analysis.sequences.some((x) => x.string === "ﬁ" && x.target === "fi"));
  });
});

describe("multiple-character inputs", () => {
  test("alex: characters are examined independently and mixed", () => {
    const r = pool("alex");
    assert.deepEqual(
      r.analysis.characters.map((c) => c.char),
      ["a", "l", "e", "x"],
    );
    for (const c of r.analysis.characters) assert.ok(c.variantCount > 10, `${c.char} has variants`);
    const s = strings(r);
    assert.ok(s.includes("аlex"), "Cyrillic а only");
    assert.ok(s.includes("aleх"), "Cyrillic х only");
    // Mixed relations inside one candidate (not one style forced on every character).
    const mixed = r.candidates.find((c) => new Set(c.segments.filter((x) => x.changed).map((x) => x.relation)).size > 1);
    assert.ok(mixed, "a candidate mixes different relations");
    // Fully transformed candidates exist too.
    assert.ok(r.candidates.some((c) => c.transformed === 4));
    for (const c of r.candidates) assertCandidateShape(c, "alex");
  });

  test("top candidates for alex are near-identical", () => {
    const r = engine.transform("alex");
    assert.equal(r.candidates.length, LIMITS.defaultCount);
    assert.ok(r.candidates[0].similarity >= 0.95);
    assert.equal(r.candidates[0].transformed, 1);
    assert.ok(r.total > 100);
  });

  test("uniform-style candidates are included", () => {
    const s = strings(pool("alex"));
    assert.ok(s.includes("ａｌｅｘ"), "all fullwidth");
    assert.ok(s.includes("𝖺𝗅𝖾𝗑"), "all math sans-serif");
  });
});

describe("case and digits", () => {
  test("uppercase K → Greek Kappa, Cyrillic Ka, Cherokee …", () => {
    const r = pool("K");
    const s = strings(r);
    for (const expected of ["Κ", "К", "Ꮶ", "Ｋ", "𝐊"]) assert.ok(s.includes(expected), `has ${expected}`);
    const excluded = r.analysis.characters[0].excluded;
    assert.ok(excluded.some((x) => x.codePoint === "U+212A" && /Canonically equivalent/.test(x.reason)));
  });

  test("lowercase input stays lowercase-looking; uppercase look-alikes are flagged", () => {
    const r = pool("alex");
    const capitalI = r.candidates.find((c) => c.string === "aIex");
    assert.ok(capitalI, "capital I stands in for l");
    assert.ok(capitalI.compatibility.notes.some((n) => /lowercases/.test(n.text)));
  });

  test("numbers: 1 → l and 0 → O", () => {
    assert.ok(strings(pool("1")).includes("l"));
    assert.ok(strings(pool("0")).includes("O"));
  });

  test("mixed alphanumeric usernames", () => {
    const r = pool("user123");
    const plain = r.candidates.find((c) => c.string === "userl23");
    assert.ok(plain, "l for 1");
    assert.equal(plain.compatibility.label, "High");
    const byCompat = [...r.candidates].sort((a, b) => b.compatibility.score - a.compatibility.score);
    assert.match(byCompat[0].string, /^[a-z0-9_.]+$/, "the most compatible candidate is plain ASCII");
    assert.ok(r.candidates[0].similarity >= plain.similarity, "similarity leads the default ranking");
    for (const c of r.candidates) assertCandidateShape(c, "user123");
  });

  test("periods and underscores are kept or replaced", () => {
    const r = pool("a.b_c");
    for (const c of r.candidates) assertCandidateShape(c, "a.b_c");
  });
});

describe("unsupported characters", () => {
  test("an emoji alone has no candidates and is reported", () => {
    const r = engine.transform("🔥");
    assert.equal(r.total, 0);
    assert.deepEqual(r.analysis.unsupported, [{ char: "🔥", codePoint: "U+1F525", name: "FIRE" }]);
    assert.equal(r.hasMore, false);
  });

  test("unsupported characters stay as typed while others transform", () => {
    const r = pool("a🔥");
    assert.ok(r.total > 0);
    for (const c of r.candidates) {
      assert.ok(c.string.endsWith("🔥"));
      assertCandidateShape(c, "a🔥");
    }
    assert.equal(r.analysis.characters[1].supported, false);
  });

  test("right-to-left look-alikes are excluded for left-to-right targets", () => {
    const r = pool("l");
    const bidi = (ch) => engine.ucd.get(ch.codePointAt(0)).bidi;
    assert.ok(!r.candidates.some((c) => [...c.string].some((ch) => ["R", "AL", "AN"].includes(bidi(ch)))), "no R, AL or AN characters");
    assert.ok(!strings(r).includes("ו"), "HEBREW LETTER VAV is excluded");
    assert.ok(r.analysis.characters[0].excluded.some((x) => /Right-to-left/.test(x.reason)));
  });
});

describe("Unicode normalization", () => {
  test("input is converted to NFC", () => {
    const r = engine.transform("é");
    assert.equal(r.desired, "é");
    assert.ok(r.notices.some((n) => /NFC/.test(n)));
  });

  test("candidates for é keep the accent and never collapse back to é", () => {
    const r = pool("é");
    assert.ok(r.total > 0);
    for (const c of r.candidates) {
      assert.notEqual(c.string.normalize("NFC"), "é");
      assertCandidateShape(c, "é");
    }
    assert.ok(strings(r).includes("е́"), "Cyrillic е + combining acute");
  });

  test("compatibility characters report their NFKC form", () => {
    const c = pool("alex").candidates.find((x) => x.string === "ａｌｅｘ");
    assert.equal(c.normalization.nfkc, "alex");
    assert.equal(c.normalization.nfkcStable, false);
    assert.equal(c.normalization.nfkcEqualsDesired, true);
    assert.ok(c.stability < 1);
  });
});

describe("duplicates and ranking", () => {
  test("no duplicate strings or canonical duplicates", () => {
    for (const d of ["alex", "k", "user123", "m", "o0o"]) {
      const r = pool(d, { depth: 3 });
      const nfc = r.candidates.map((c) => c.string.normalize("NFC"));
      assert.equal(new Set(nfc).size, nfc.length, d);
      const ids = r.candidates.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  test("candidates are sorted by rank score and numbered", () => {
    const r = pool("alex");
    r.candidates.forEach((c, i) => {
      assert.equal(c.rank, i + 1);
      if (i) assert.ok(r.candidates[i - 1].rankScore >= c.rankScore);
    });
  });

  test("visual similarity dominates: identical-looking beats stylized", () => {
    const r = pool("k");
    const rank = (s) => r.candidates.find((c) => c.string === s).rank;
    assert.ok(rank("𝗄") < rank("𝔨"), "sans-serif before fraktur");
    assert.ok(rank("𝗄") < rank("ⓚ"), "sans-serif before circled");
  });

  test("fewer transformed characters rank higher at equal similarity", () => {
    const r = pool("alex");
    const one = r.candidates.find((c) => c.string === "аlex");
    const two = r.candidates.find((c) => c.string === "аlеx");
    assert.ok(one && two);
    assert.ok(one.rank < two.rank);
  });

  test("generate more: higher depth finds more and keeps earlier results stable", () => {
    const d1 = engine.transform("alex", { count: 12, depth: 1 });
    const d2 = engine.transform("alex", { count: 24, depth: 2 });
    assert.ok(d2.total >= d1.total);
    assert.equal(d2.candidates.length, 24);
    const top1 = new Set(d1.candidates.slice(0, 6).map((c) => c.string));
    assert.ok(d2.candidates.slice(0, 12).filter((c) => top1.has(c.string)).length >= 5, "top results stay on top");
    assert.equal(d1.hasMore, true);
  });

  test("results are deterministic", () => {
    assert.deepEqual(strings(engine.transform("alex")), strings(engine.transform("alex")));
  });
});

describe("error handling", () => {
  const cases = [
    ["", "empty"],
    ["   ", "empty"],
    ["@", "empty"],
    ["a b", "whitespace"],
    ["a​b", "invisible"],
    ["a\u0000", "invisible"],
    ["a‮b", "invisible"],
    ["x".repeat(LIMITS.maxDesiredLength + 1), "length"],
    [42, "type"],
  ];
  for (const [input, code] of cases) {
    test(`rejects ${JSON.stringify(input)} (${code})`, () => {
      assert.throws(
        () => engine.transform(input),
        (err) => err instanceof InputError && err.code === code && err.field === "desired" && err.message.length > 10,
      );
    });
  }

  test("strips a leading @ with a notice", () => {
    const r = engine.transform("@alex", { existing: "@old.name" });
    assert.equal(r.desired, "alex");
    assert.equal(r.existing, "old.name");
    assert.equal(r.notices.length, 2);
  });

  test("validates the existing username too", () => {
    assert.throws(
      () => engine.transform("alex", { existing: "has space" }),
      (err) => err instanceof InputError && err.field === "existing",
    );
  });

  test("count and depth are clamped", () => {
    const r = engine.transform("ab", { count: "abc", depth: 999 });
    assert.equal(r.depth, LIMITS.maxDepth);
    assert.equal(r.candidates.length, Math.min(LIMITS.defaultCount, r.total));
  });

  test("a 32-character username transforms quickly", () => {
    const t = performance.now();
    const r = engine.transform("abcdefghijklmnopqrstuvwxyz012345", { depth: 2 });
    assert.ok(r.total > 50);
    assert.ok(performance.now() - t < 5000);
  });
});

describe("scoring helpers", () => {
  test("transformation score favours fewer changes", () => {
    assert.equal(transformationScore(1, 1), 1);
    assert.equal(transformationScore(1, 4), 1);
    assert.equal(transformationScore(4, 4), 0.25);
  });

  test("readability drops for mixed styles and baselines", () => {
    assert.equal(readability(["Plain", "Plain"]), 1);
    assert.ok(readability(["Plain", "Superscript"]) < readability(["Plain", "Fullwidth"]));
  });

  test("stability", () => {
    assert.equal(stability("alex"), 1);
    assert.ok(stability("ａlex") < 1);
  });

  test("documented platform rules", () => {
    assert.equal(PLATFORM_RULES.minLength, 2);
    assert.equal(PLATFORM_RULES.maxLength, 24);
    assert.ok(PLATFORM_RULES.documentedCharacters.test("_"));
    assert.ok(!PLATFORM_RULES.documentedCharacters.test("а"));
  });

  test("only plain a–z/0–9/_/. candidates reach High compatibility", () => {
    for (const c of pool("alex").candidates) {
      if (c.compatibility.label === "High") assert.match(c.string.toLowerCase(), /^[a-z0-9_.]+$/);
    }
  });
});
