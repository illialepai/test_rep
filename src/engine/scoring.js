/**
 * Scores used to rank candidates. None of these predict TikTok's decision; they estimate how a candidate
 * looks and how generally Unicode-safe it is, from character properties.
 */
import { codePoints } from "./ucd.js";

/**
 * Username rules TikTok documents publicly (at the time of writing). Used only to explain likely
 * rejections; TikTok's own validator is the final word and may differ.
 */
export const PLATFORM_RULES = {
  minLength: 2,
  maxLength: 24,
  documentedCharacters: /^[a-z0-9_.]$/,
};

/** UAX #31 Table 5, "Recommended Scripts" (plus Common/Inherited). Other scripts are limited-use or historic. */
export const RECOMMENDED_SCRIPTS = new Set([
  "Common",
  "Inherited",
  "Arabic",
  "Armenian",
  "Bengali",
  "Bopomofo",
  "Cyrillic",
  "Devanagari",
  "Ethiopic",
  "Georgian",
  "Greek",
  "Gujarati",
  "Gurmukhi",
  "Han",
  "Hangul",
  "Hebrew",
  "Hiragana",
  "Kannada",
  "Katakana",
  "Khmer",
  "Lao",
  "Latin",
  "Malayalam",
  "Myanmar",
  "Oriya",
  "Sinhala",
  "Tamil",
  "Telugu",
  "Thaana",
  "Thai",
  "Tibetan",
]);

const EMOJI = /\p{Emoji}/u;
const EMOJI_SAFE = /[0-9#*]/;

/** 0–1: how likely one character is to be accepted and displayed by a typical username system. */
export function characterCompatibility(ucd, cp) {
  const ch = String.fromCodePoint(cp);
  if (PLATFORM_RULES.documentedCharacters.test(ch)) return 1;
  if (/[A-Z]/.test(ch)) return 0.8;
  const gc = ucd.category(cp);
  let s;
  if (cp < 0x80) s = 0.15;
  else if (gc[0] === "L") s = 0.62;
  else if (gc === "Nd") s = 0.5;
  else if (gc[0] === "N") s = 0.35;
  else if (gc[0] === "M") s = 0.3;
  else s = 0.12;
  if (ch.normalize("NFKC") !== ch) s = Math.min(s, 0.3);
  if (!RECOMMENDED_SCRIPTS.has(ucd.script(cp))) s *= 0.5;
  if (cp > 0xffff) s *= 0.85;
  const age = ucd.age(cp) ?? 0;
  if (age >= 13) s *= 0.8;
  else if (age >= 10) s *= 0.9;
  if (EMOJI.test(ch) && !EMOJI_SAFE.test(ch)) s *= 0.6;
  if (ucd.isRightToLeft(cp)) s *= 0.3;
  return s;
}

export function similarityLabel(sim) {
  if (sim >= 0.9) return "Near-identical";
  if (sim >= 0.75) return "Very similar";
  if (sim >= 0.55) return "Similar";
  return "Distinguishable";
}

export const VISUALLY_SIMILAR_THRESHOLD = 0.55;

export function compatibilityLabel(score) {
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  if (score >= 20) return "Low";
  return "Very low";
}

/** Scripts that carry meaning (Common and Inherited are shared by all scripts). */
export function letterScripts(ucd, str) {
  const out = new Set();
  for (const cp of codePoints(str)) {
    const s = ucd.script(cp);
    if (s !== "Common" && s !== "Inherited") out.add(s);
  }
  return [...out];
}

export function counts(str) {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  return {
    codePoints: codePoints(str).length,
    utf16Units: str.length,
    graphemes: [...segmenter.segment(str)].length,
    utf8Bytes: Buffer.byteLength(str, "utf8"),
  };
}

/**
 * Compatibility estimate (0–100) for a whole candidate, with the reasons that lowered it.
 * Starts from the per-character compatibilities and applies string-level risks.
 */
export function compatibilityEstimate(ucd, candidate, desired, charScores) {
  const notes = [];
  const min = Math.min(...charScores);
  const mean = charScores.reduce((a, b) => a + b, 0) / charScores.length;
  let score = 100 * (0.5 * min + 0.5 * mean);
  const chars = [...candidate];

  const outside = chars.filter((c) => !PLATFORM_RULES.documentedCharacters.test(c.toLowerCase()));
  if (outside.length === 0)
    notes.push({ level: "good", text: "Uses only a–z, 0–9, _ and . (TikTok's documented character set)." });
  else {
    // Only plain a–z/0–9/_/. can reach "High": TikTok documents nothing else.
    score = Math.min(score, 60);
    notes.push({
      level: "warn",
      text: `${outside.length} of ${chars.length} characters are outside TikTok's documented username characters (letters, numbers, _ and .). TikTok may reject them.`,
    });
  }

  const scripts = letterScripts(ucd, candidate);
  if (scripts.length > 1) {
    score *= 0.65;
    notes.push({
      level: "warn",
      text: `Mixes scripts (${scripts.join(" + ")}). Many platforms block mixed-script names to prevent look-alikes.`,
    });
  }

  const limited = [
    ...new Set(chars.map((c) => ucd.script(c.codePointAt(0))).filter((s) => !RECOMMENDED_SCRIPTS.has(s))),
  ];
  if (limited.length)
    notes.push({
      level: "warn",
      text: `Uses a limited-use or historic script (${limited.join(", ")}); many devices have no font for it.`,
    });

  const nfkc = candidate.normalize("NFKC");
  if (nfkc === desired.normalize("NFKC")) {
    score *= 0.75;
    notes.push({
      level: "warn",
      text: `Compatibility normalization (NFKC) turns it back into "${desired}". A platform that normalizes would treat it as that exact username.`,
    });
  } else if (nfkc !== candidate) {
    notes.push({ level: "info", text: `Contains compatibility characters: NFKC changes it to "${nfkc}".` });
  }

  const lower = candidate.toLowerCase();
  if (lower !== candidate) {
    if (ucd.skeleton(lower) !== ucd.skeleton(desired.toLowerCase())) {
      score *= 0.75;
      notes.push({
        level: "warn",
        text: `The look depends on capital letters. If the platform lowercases usernames it becomes "${lower}".`,
      });
    } else {
      notes.push({
        level: "info",
        text: "Contains capital letters; platforms that lowercase usernames keep the same look.",
      });
    }
  }

  const length = chars.length;
  if (length < PLATFORM_RULES.minLength) {
    score *= 0.6;
    notes.push({
      level: "warn",
      text: `${length} character${length === 1 ? "" : "s"}: shorter than TikTok's documented ${PLATFORM_RULES.minLength}-character minimum.`,
    });
  }
  if (length > PLATFORM_RULES.maxLength) {
    score *= 0.5;
    notes.push({
      level: "warn",
      text: `Longer than TikTok's documented ${PLATFORM_RULES.maxLength}-character maximum.`,
    });
  }
  if (candidate.endsWith(".")) {
    score *= 0.5;
    notes.push({ level: "warn", text: "Ends with a period, which TikTok does not allow." });
  }

  const astral = chars.filter((c) => c.codePointAt(0) > 0xffff).length;
  if (astral)
    notes.push({
      level: "info",
      text: `${astral} character${astral === 1 ? " is" : "s are"} outside the Basic Multilingual Plane (2 UTF-16 units each).`,
    });

  const recent = chars.filter((c) => (ucd.age(c.codePointAt(0)) ?? 0) >= 10);
  if (recent.length)
    notes.push({
      level: "warn",
      text: "Uses characters added in Unicode 10 or later. Older phones may show them as empty boxes.",
    });

  if (chars.some((c) => EMOJI.test(c) && !EMOJI_SAFE.test(c))) {
    score *= 0.8;
    notes.push({ level: "warn", text: "Contains a character that some devices draw as an emoji." });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: compatibilityLabel(score), notes };
}

const BASELINE_FAMILIES = new Set([
  "Superscript",
  "Subscript",
  "Small capital",
  "Circled",
  "Squared",
  "Negative circled",
  "Negative squared",
]);

/** 0–1: whether the result reads as one consistent word (same style family, same baseline and size). */
export function readability(families) {
  const distinct = new Set(families);
  const shifted = families.filter((f) => BASELINE_FAMILIES.has(f)).length;
  let r = 1 - 0.15 * (distinct.size - 1);
  if (shifted > 0 && shifted < families.length) r -= 0.35 * (shifted / families.length);
  return Math.max(0.05, Math.min(1, r));
}

/** 0–1: how unchanged the string stays under normalization and case mapping. */
export function stability(str) {
  let s = 1;
  if (str.normalize("NFKC") !== str) s *= 0.5;
  if (str.toLowerCase() !== str) s *= 0.85;
  if (/\p{M}/u.test(str)) s *= 0.8;
  return s;
}

/**
 * Weights of the criteria that follow visual similarity, in the priority order of the ranking criteria:
 * character compatibility, number of transformed characters, readability, Unicode stability and the
 * compatibility estimate.
 */
export const SECONDARY_WEIGHTS = {
  characterCompatibility: 0.35,
  transformation: 0.25,
  readability: 0.15,
  stability: 0.15,
  compatibilityEstimate: 0.1,
};

/** How far the secondary criteria can move a candidate: at most 30% of its similarity. */
export const SECONDARY_SHARE = 0.3;

/**
 * Rank score: visual similarity first. The other criteria scale it by 0.7–1.0, so they decide between
 * candidates that look about equally close, but never lift a visibly different candidate above a
 * near-identical one.
 */
export function rankScore({
  similarity,
  characterCompatibility,
  transformation,
  readability,
  stability,
  compatibilityEstimate,
}) {
  const w = SECONDARY_WEIGHTS;
  const secondary =
    w.characterCompatibility * characterCompatibility +
    w.transformation * transformation +
    w.readability * readability +
    w.stability * stability +
    w.compatibilityEstimate * compatibilityEstimate;
  return similarity * (1 - SECONDARY_SHARE + SECONDARY_SHARE * secondary);
}

/** 1 when a single character is transformed, falling to 0.25 when every character is. */
export function transformationScore(transformed, total) {
  if (total <= 1) return 1;
  return 1 - (0.75 * (Math.max(1, transformed) - 1)) / (total - 1);
}
