/**
 * Input cleanup and output compatibility checks for TikTok usernames.
 *
 * TikTok's published rule: a username is 2–24 characters and may contain
 * only letters, numbers, underscores and periods, and it can't end with a
 * period. TikTok doesn't say which Unicode "letters" it accepts, and it may
 * normalize or reject styled characters when you save. So the statuses below
 * are an estimate from Unicode character properties, not a guarantee.
 */

export const MIN_LENGTH = 2;
export const MAX_LENGTH = 24;

/** Characters the generator knows how to style. */
const ALLOWED_INPUT = /^[a-z0-9_.]$/;

export const STATUS = {
  LIKELY: "likely",
  MAYBE: "maybe",
  UNSUPPORTED: "unsupported",
};

export const STATUS_LABEL = {
  likely: "Likely compatible",
  maybe: "May not work",
  unsupported: "Unsupported characters",
};

const STATUS_RANK = { likely: 0, maybe: 1, unsupported: 2 };

export function worstStatus(a, b) {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function codePointLabel(ch) {
  return "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Cleans the raw text typed by the user. Fixes that are safe and obvious
 * (leading "@", uppercase, spaces) are applied, and each one adds a notice so
 * nothing changes without the user being told. Characters that can't be
 * styled are reported as errors instead of being dropped.
 *
 * @returns {{ value: string, notices: string[], errors: string[], invalidChars: string[] }}
 */
export function sanitizeInput(raw) {
  const notices = [];
  const errors = [];
  let value = (raw ?? "").trim();

  if (value.startsWith("@")) {
    value = value.replace(/^@+/, "");
    notices.push("Removed the leading @. TikTok already shows it in front of your username.");
  }

  if (value === "") {
    errors.push("Enter a username to generate styles.");
    return { value, notices, errors, invalidChars: [] };
  }

  if (/\s/.test(value)) {
    value = value.replace(/\s+/g, "_");
    notices.push("Usernames can't contain spaces, so each space was replaced with _.");
  }

  if (value !== value.toLowerCase()) {
    value = value.toLowerCase();
    notices.push("TikTok usernames are lowercase, so capital letters were converted.");
  }

  // Iterate by code point so emoji and astral characters are reported whole.
  const invalid = [...new Set([...value].filter((ch) => !ALLOWED_INPUT.test(ch)))];
  if (invalid.length) {
    const list = invalid.map((ch) => `"${ch}" (${codePointLabel(ch)})`).join(", ");
    errors.push(`TikTok usernames can only contain letters a–z, numbers, _ and periods. Remove: ${list}.`);
  }

  const length = [...value].length;
  if (length < MIN_LENGTH) {
    errors.push(`Usernames need at least ${MIN_LENGTH} characters.`);
  } else if (length > MAX_LENGTH) {
    errors.push(`Usernames can be at most ${MAX_LENGTH} characters (this one has ${length}).`);
  }

  if (!invalid.length && value.endsWith(".")) {
    errors.push("TikTok usernames can't end with a period.");
  }

  return { value, notices, errors, invalidChars: invalid };
}

/** Removes every character the generator can't style (used by the "Remove them" fix). */
export function stripInvalid(value) {
  return [...value].filter((ch) => ALLOWED_INPUT.test(ch)).join("");
}

/**
 * Classifies one output character.
 *
 * - likely:      plain a–z / 0–9 / _ / . , or a Unicode letter/digit that NFKC
 *                normalization leaves unchanged (e.g. small caps ᴀ U+1D00).
 *                It meets the "letters and numbers" rule as Unicode defines it.
 * - maybe:       a letter or number that NFKC folds into another character
 *                (e.g. 𝐚 → a, ａ → a, ᵃ → a). Many sites normalize input this
 *                way, so TikTok may save the plain version or reject it.
 * - unsupported: anything else (symbols such as ⓐ, punctuation, emoji).
 */
export function classifyChar(ch) {
  if (ALLOWED_INPUT.test(ch)) {
    return { status: STATUS.LIKELY, reason: "Standard username character" };
  }
  const isLetterOrNumber = /^[\p{L}\p{N}]$/u.test(ch);
  const folded = ch.normalize("NFKC");
  // Fullwidth ＿ and ． are punctuation that fold to "_" and ".". Symbols such
  // as ⓐ also fold to "a", but they're still symbols, so they don't count.
  const isFoldingPunct = /^[\p{Pc}\p{Po}]$/u.test(ch) && /^[_.]$/.test(folded);

  if (isLetterOrNumber && folded === ch) {
    return { status: STATUS.LIKELY, reason: "Unicode letter, not normalized away" };
  }
  if (isLetterOrNumber || isFoldingPunct) {
    return {
      status: STATUS.MAYBE,
      reason: `Normalizes to "${folded}". TikTok may save it as plain text or reject it`,
    };
  }
  return { status: STATUS.UNSUPPORTED, reason: "Symbol, not a letter or number" };
}

export function unicodeCategory(ch) {
  const tests = [
    ["Ll", "Lowercase letter"],
    ["Lu", "Uppercase letter"],
    ["Lm", "Modifier letter"],
    ["Lo", "Other letter"],
    ["Nd", "Decimal digit"],
    ["No", "Other number"],
    ["Pc", "Connector punctuation"],
    ["Po", "Punctuation"],
    ["So", "Symbol"],
  ];
  for (const [cat, label] of tests) {
    if (new RegExp(`^\\p{${cat}}$`, "u").test(ch)) return { code: cat, label };
  }
  return { code: "?", label: "Other" };
}

/**
 * Checks a whole generated username.
 * @returns {{ status: string, warnings: string[], length: number }}
 */
export function validateOutput(output, untransformed = []) {
  const chars = [...output];
  let status = STATUS.LIKELY;
  const warnings = [];

  for (const ch of chars) status = worstStatus(status, classifyChar(ch).status);

  if (chars.length < MIN_LENGTH || chars.length > MAX_LENGTH) {
    status = STATUS.UNSUPPORTED;
    warnings.push(`Length ${chars.length} is outside TikTok's ${MIN_LENGTH}–${MAX_LENGTH} range.`);
  }
  if (output.endsWith(".") || output.endsWith("．")) {
    status = STATUS.UNSUPPORTED;
    warnings.push("Ends with a period.");
  }

  // A mix of styled and plain characters can look like a typo or an
  // impersonation attempt, so point out which characters had no equivalent.
  const letters = [...new Set(untransformed)].filter((c) => /[a-z]/.test(c));
  if (letters.length) {
    warnings.push(`No styled form for ${letters.map((c) => `"${c}"`).join(", ")}, so plain letters are mixed in.`);
  }

  // Look-alikes: several styles produce characters that look like a different
  // letter, which makes the username hard to read or search for.
  const lookalikes = [...new Set(output.match(/[ꜰꜱℯℊℴ]/gu) ?? [])];
  if (lookalikes.length) {
    warnings.push(
      `${lookalikes.join(" ")} can look like other letters on some devices. Check that it reads correctly.`,
    );
  }

  return { status, warnings, length: chars.length };
}
