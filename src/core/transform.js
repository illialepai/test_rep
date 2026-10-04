import { STYLES } from "./styles.js";
import { classifyChar, codePointLabel, unicodeCategory, validateOutput } from "./validate.js";

/**
 * Applies one style to an already-sanitized username, one code point at a
 * time. Characters with no mapping are kept and recorded, so the UI can say
 * which ones weren't styled instead of hiding it.
 */
export function transform(value, style) {
  const untransformed = [];
  let output = "";
  for (const ch of value) {
    const mapped = style.map[ch];
    if (mapped === undefined) {
      if (style.id !== "plain" && /[a-z0-9]/.test(ch)) untransformed.push(ch);
      output += ch;
    } else {
      output += mapped;
    }
  }
  return { output, untransformed };
}

/** Per-character breakdown with code points, used for the "Characters" panel. */
export function describeChars(output) {
  return [...output].map((ch) => ({
    char: ch,
    codePoint: codePointLabel(ch),
    category: unicodeCategory(ch),
    ...classifyChar(ch),
  }));
}

/**
 * Generates every registered style for a sanitized username. Styles that
 * change nothing (e.g. digits-only input in a letters-only style) are
 * dropped, except Standard, so there are no duplicate cards.
 */
export function generateAll(value) {
  const seen = new Set();
  const results = [];
  for (const style of STYLES) {
    const { output, untransformed } = transform(value, style);
    if (style.id !== "plain" && (output === value || seen.has(output))) continue;
    seen.add(output);
    results.push({
      style,
      output,
      untransformed,
      ...validateOutput(output, untransformed),
    });
  }
  return results;
}
