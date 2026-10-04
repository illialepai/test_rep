/**
 * Username Transformation Engine.
 *
 * Takes the username the user wants to SEE and produces different underlying Unicode strings that render
 * like it. The desired text is turned into a sequence of visual keys (its UTS #39 skeleton). The engine
 * then builds a lattice over that sequence: every variant-index entry whose key matches a stretch of it is
 * an edge. A path through the lattice is a candidate string. Paths can mix relations per character
 * (Cyrillic а + plain l + math 𝖾 …), split one character into several (m → rn) or merge several into one
 * (fi → ﬁ). A beam search over the lattice collects the best paths, which are then scored and ranked.
 */
import { loadUnicodeDatabase, codePoints, codePointLabel } from "./ucd.js";
import { VariantIndex, RELATION } from "./variants.js";
import {
  characterCompatibility,
  compatibilityEstimate,
  counts,
  letterScripts,
  readability,
  rankScore as computeRankScore,
  SECONDARY_SHARE,
  SECONDARY_WEIGHTS,
  similarityLabel,
  stability,
  transformationScore,
  VISUALLY_SIMILAR_THRESHOLD,
} from "./scoring.js";

export const LIMITS = {
  maxDesiredLength: 32,
  maxExistingLength: 64,
  /** Longest run of desired characters one replacement may cover (fi → ﬁ, ffi → ﬃ). */
  maxSpan: 3,
  /** Most characters one desired character may be split into (m → rn). */
  maxPieces: 3,
  maxDepth: 8,
  defaultCount: 12,
  maxCount: 400,
};

export class InputError extends Error {
  constructor(message, field, code) {
    super(message);
    this.name = "InputError";
    this.field = field;
    this.code = code;
  }
}

const WHITESPACE = /[\s\p{Zs}]/u;

function cleanUsername(raw, field, label, maxLength, ucd) {
  if (raw === undefined || raw === null) raw = "";
  if (typeof raw !== "string") throw new InputError(`${label} must be text.`, field, "type");
  const notices = [];
  let value = raw.trim();
  if (value.startsWith("@")) {
    value = value.replace(/^@+/, "");
    notices.push(`Removed the leading @ from the ${label.toLowerCase()}. TikTok shows it in front of every username.`);
  }
  const nfc = value.normalize("NFC");
  if (nfc !== value) {
    notices.push(`The ${label.toLowerCase()} was converted to Unicode NFC (composed) form.`);
    value = nfc;
  }
  if (WHITESPACE.test(value)) throw new InputError(`${label} can't contain spaces. TikTok usernames are a single word.`, field, "whitespace");
  const invisible = [...new Set(codePoints(value))].filter((cp) => {
    const gc = ucd.category(cp);
    // Combining marks are fine: they render on the preceding character.
    return gc[0] !== "M" && !ucd.isVisible(cp);
  });
  if (invisible.length) {
    const list = invisible.map((cp) => `${codePointLabel(cp)} ${ucd.name(cp)}`).join(", ");
    throw new InputError(`${label} contains invisible, control or unassigned characters: ${list}. Enter only characters you can see.`, field, "invisible");
  }
  if (codePoints(value).length > maxLength) throw new InputError(`${label} is too long (maximum ${maxLength} characters).`, field, "length");
  return { value, notices };
}

function relationName(entry) {
  switch (entry.relation) {
    case RELATION.CONFUSABLE:
      if (entry.script === "Common") return entry.category[0] === "N" ? "Digit look-alike" : entry.category[0] === "L" ? "Letter look-alike" : "Symbol look-alike";
      return `${entry.script.replaceAll("_", " ")} look-alike`;
    case RELATION.PROTOTYPE:
      return "Plain look-alike";
    case RELATION.MODIFIED:
      return `Letter with ${entry.detail}`;
    case RELATION.DIACRITIC:
      return "Accented letter";
    default:
      return entry.family;
  }
}

/** Grouping key for "same style everywhere" candidates (all Cyrillic look-alikes, all fullwidth …). */
function styleKey(entry) {
  if (entry.relation === RELATION.CONFUSABLE || entry.relation === RELATION.PROTOTYPE) return `look-alike:${entry.script}`;
  return `style:${entry.family}`;
}

/** Visual family for readability: look-alikes and accented letters draw like plain text. */
function visualFamily(entry) {
  if ([RELATION.CONFUSABLE, RELATION.PROTOTYPE, RELATION.DIACRITIC, RELATION.MODIFIED].includes(entry.relation)) return "Plain";
  return entry.family;
}

export class UsernameTransformationEngine {
  constructor(ucd, index) {
    this.ucd = ucd;
    this.index = index;
  }

  stats() {
    return {
      unicodeVersion: this.ucd.version,
      confusablesVersion: this.ucd.confusablesVersion,
      characters: this.ucd.records.size,
      confusableMappings: this.ucd.confusables.size,
      variantKeys: this.index.byKey.size,
      variantEntries: this.index.size,
    };
  }

  validateDesired(raw) {
    const r = cleanUsername(raw, "desired", "Desired username", LIMITS.maxDesiredLength, this.ucd);
    if (!r.value) throw new InputError("Enter the username you want your profile to display.", "desired", "empty");
    return r;
  }

  validateExisting(raw) {
    return cleanUsername(raw, "existing", "Existing username", LIMITS.maxExistingLength, this.ucd);
  }

  // ---- lattice ---------------------------------------------------------------------------------------

  /** `exhaustive` lifts the search caps; the analysis view uses it to list every variant in the database. */
  buildContext(desired, depth, { exhaustive = false } = {}) {
    const { ucd, index } = this;
    const targets = [...desired];
    const keys = targets.map((t) => ucd.skeleton(t));
    const K = [];
    const bounds = [0];
    for (const k of keys) {
      K.push(...k);
      bounds.push(K.length);
    }
    const boundarySet = new Set(bounds);
    const allowRtl = codePoints(desired).some((cp) => ucd.isRightToLeft(cp));
    const edgesAt = K.map(() => []);
    // Short usernames can afford every variant; long ones rely on the beam search and "Generate more".
    const perPosition = exhaustive ? Infinity : Math.max(12 + 8 * depth, Math.floor(240 / targets.length));

    for (let p = 0; p < K.length; p++) {
      const edges = [];
      for (let L = 1; L <= index.maxKeyLength && p + L <= K.length; L++) {
        const key = K.slice(p, p + L).join("");
        for (const entry of index.entriesFor(key)) {
          if (!entry.eligible || (entry.rtl && !allowRtl)) continue;
          edges.push({ to: p + L, char: entry.char, key, entry, sim: entry.similarity });
        }
      }
      edges.sort((a, b) => b.sim - a.sim || a.char.localeCompare(b.char));
      edgesAt[p] = edges.slice(0, perPosition);
      // Combining marks in the desired text (é typed as e + ◌́) are kept as they are.
      if (ucd.category(K[p].codePointAt(0))[0] === "M") edgesAt[p].push({ to: p + 1, char: K[p], key: K[p], mark: true, sim: 1 });
    }
    targets.forEach((t, i) => {
      edgesAt[bounds[i]]?.push({ to: bounds[i + 1], char: t, key: keys[i], identity: true, sim: 1 });
    });
    return { desired, targets, keys, K, bounds, boundarySet, edgesAt, depth, exhaustive, n: targets.length };
  }

  targetSimilarity(t, key) {
    const e = this.index.entry(key, t);
    return e ? e.similarity : this.index.prototypeSimilarity(t, key);
  }

  /** Similarity between one replacement character and the one desired character it stands in for. */
  pairSimilarity(entry, t, key) {
    if (entry.char === t) return 1;
    const et = this.index.entry(key, t);
    const tBase = et?.base ?? t;
    if (entry.base === tBase) return entry.styleSimilarity * (et?.styleSimilarity ?? 1);
    return entry.similarity * this.targetSimilarity(t, key);
  }

  /** All minimal edge sequences that cover desired characters i..j-1 exactly. */
  enumerateFillers(ctx, i, j) {
    const { bounds, boundarySet, edgesAt } = ctx;
    const start = bounds[i];
    const end = bounds[j];
    const out = [];
    const limit = ctx.exhaustive ? 2000 : 150 + 100 * ctx.depth;
    // Fewer pieces first: whole replacements (𝗆, ﬁ, the unchanged character) before splits (r + n), so the
    // limit never cuts off the simple options.
    const walk = (p, path, pieces) => {
      if (out.length >= limit) return;
      if (p === end) {
        if (path.length === pieces) out.push(path);
        return;
      }
      if (path.length >= pieces) return;
      for (const e of edgesAt[p] ?? []) {
        if (e.to > end) continue;
        if (e.to < end && boundarySet.has(e.to)) continue;
        if (e.identity && j - i !== 1) continue;
        walk(e.to, [...path, e], pieces);
      }
    };
    for (let pieces = 1; pieces <= LIMITS.maxPieces; pieces++) walk(start, [], pieces);
    return out.map((edges) => this.evaluateFiller(ctx, i, j, edges)).filter(Boolean);
  }

  evaluateFiller(ctx, i, j, edges) {
    const { ucd } = this;
    const output = edges.map((e) => e.char).join("");
    const target = ctx.targets.slice(i, j).join("");
    const span = j - i;
    const base = { i, j, span, target, output, edges };
    if (output === target) {
      return { ...base, identity: true, sim: 1, transformed: 0, label: "Unchanged", styleKey: "plain", families: [...output].map(() => "Plain"), compat: this.meanCompat(output) };
    }
    // Same string after canonical normalization (e + ◌́ for é): not a different username.
    if (output.normalize("NFC") === target.normalize("NFC")) return null;

    let sim;
    let label;
    if (span === 1 && edges.length === 1) {
      const e = edges[0];
      sim = this.pairSimilarity(e.entry, ctx.targets[i], ctx.keys[i]);
      label = relationName(e.entry);
    } else {
      sim = edges.reduce((acc, e) => acc * (e.entry ? e.entry.similarity : 1), 1);
      for (let k = i; k < j; k++) sim *= this.targetSimilarity(ctx.targets[k], ctx.keys[k]);
      if (span > 1) label = `One character for “${target}”`;
      else label = `Sequence “${output}” for “${target}”`;
    }
    const families = edges.flatMap((e) => (e.entry ? [visualFamily(e.entry)] : e.mark ? [] : ["Plain"]));
    const keyed = edges.filter((e) => e.entry);
    const sk = keyed.length === 1 && span === 1 && edges.length === 1 ? styleKey(keyed[0].entry) : "sequence";
    const scripts = letterScripts(ucd, output);
    return { ...base, identity: false, sim, transformed: span, label, styleKey: sk, families, scripts, compat: this.meanCompat(output) };
  }

  meanCompat(str) {
    const cps = codePoints(str);
    return cps.reduce((a, cp) => a + characterCompatibility(this.ucd, cp), 0) / cps.length;
  }

  /** Additive stand-in for the rank score, used only to order the search. */
  fillerUtility(f, n) {
    const share = f.span / n;
    const secondary = 1 - SECONDARY_SHARE + SECONDARY_SHARE * SECONDARY_WEIGHTS.characterCompatibility * (f.compat - 1);
    return share * Math.log(Math.max(1e-6, f.sim * secondary));
  }

  spanFillers(ctx) {
    const { n, depth } = ctx;
    const cap = Math.max(20 + 20 * depth, Math.floor(400 / n));
    const result = [];
    for (let i = 0; i < n; i++) {
      const list = [];
      for (let j = i + 1; j <= Math.min(n, i + LIMITS.maxSpan); j++) list.push(...this.enumerateFillers(ctx, i, j));
      const seen = new Set();
      const unique = list.filter((f) => {
        const key = f.j + "|" + f.output;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (const f of unique) f.utility = this.fillerUtility(f, n);
      unique.sort((a, b) => Number(b.identity) - Number(a.identity) || b.utility - a.utility);
      result.push(unique.slice(0, cap));
    }
    return result;
  }

  /**
   * Beam search over desired-character boundaries. States are bucketed by how many characters they have
   * transformed so far, so the result holds the best 1-change, 2-change, 3-change … candidates instead of
   * only ever-smaller variations of the single best change.
   */
  beamSearch(ctx, fillers) {
    const { n, depth } = ctx;
    const beam = 20 + 20 * depth;
    const maxChanged = Math.min(n, 2 + 2 * depth);
    // states[i]: Map(changed count → [{u, f, prev}]); paths are linked lists until the end.
    const states = Array.from({ length: n + 1 }, () => new Map());
    states[0].set(0, [{ u: 0, f: null, prev: null }]);
    const push = (i, changed, state) => {
      if (!states[i].has(changed)) states[i].set(changed, []);
      states[i].get(changed).push(state);
    };
    for (let i = 0; i < n; i++) {
      for (const [changed, list] of states[i]) {
        list.sort((a, b) => b.u - a.u);
        for (const s of list.slice(0, beam)) {
          for (const f of fillers[i]) {
            const c = changed + f.transformed;
            if (c > maxChanged) continue;
            push(f.j, c, { u: s.u + f.utility, f, prev: s });
          }
        }
      }
      states[i] = null;
    }
    const paths = [];
    for (const [changed, list] of states[n]) {
      if (changed === 0) continue;
      list.sort((a, b) => b.u - a.u);
      for (const s of list.slice(0, beam)) {
        const path = [];
        for (let node = s; node.f; node = node.prev) path.push(node.f);
        paths.push(path.reverse());
      }
    }
    return paths;
  }

  /**
   * Every individual replacement on its own (all other characters unchanged), so each option the
   * analysis finds for a character, including merges like ﬁ and splits like rn, appears as a candidate.
   */
  singlePaths(ctx, fillers) {
    const identity = fillers.map((list) => list.find((f) => f.identity && f.span === 1));
    if (identity.some((f) => !f)) return [];
    const paths = [];
    fillers.forEach((list, i) => {
      for (const f of list) {
        if (f.identity) continue;
        paths.push([...identity.slice(0, i), f, ...identity.slice(f.j)]);
      }
    });
    return paths;
  }

  /** Same style at every position that has it: all Cyrillic look-alikes, all fullwidth, all math sans … */
  uniformPaths(ctx, fillers) {
    const { n } = ctx;
    const families = new Set();
    for (const list of fillers) for (const f of list) if (!f.identity && f.span === 1) families.add(f.styleKey);
    const paths = [];
    for (const fam of families) {
      if (fam === "sequence") continue;
      const path = [];
      let changed = 0;
      for (let i = 0; i < n; i++) {
        const best = fillers[i].filter((f) => f.span === 1 && f.styleKey === fam).sort((a, b) => b.sim - a.sim)[0];
        const pick = best ?? fillers[i].find((f) => f.identity && f.span === 1);
        if (!pick) break;
        if (best) changed++;
        path.push(pick);
      }
      if (path.length === n && changed >= Math.min(2, n)) paths.push(path);
    }
    // Every character transformed, choosing the most similar replacement for each.
    const all = [];
    for (let i = 0; i < n; i++) {
      const best = fillers[i].filter((f) => f.span === 1 && !f.identity).sort((a, b) => b.sim - a.sim || b.compat - a.compat)[0];
      const pick = best ?? fillers[i].find((f) => f.identity);
      if (!pick) return paths;
      all.push(pick);
    }
    paths.push(all);
    return paths;
  }

  // ---- scoring ---------------------------------------------------------------------------------------

  buildCandidate(ctx, path) {
    const { ucd } = this;
    const { desired, n } = ctx;
    const string = path.map((f) => f.output).join("");
    const perTarget = path.flatMap((f) => Array(f.span).fill(f.sim));
    const meanSim = perTarget.reduce((a, b) => a + b, 0) / perTarget.length;
    const similarity = 0.7 * meanSim + 0.3 * Math.min(...perTarget);
    const transformed = path.reduce((a, f) => a + f.transformed, 0);
    const cps = codePoints(string);
    const charScores = cps.map((cp) => characterCompatibility(ucd, cp));
    const characterCompat = charScores.reduce((a, b) => a + b, 0) / charScores.length;
    const families = path.flatMap((f) => f.families);
    const read = readability(families.length ? families : ["Plain"]);
    const stab = stability(string);
    const compatibility = compatibilityEstimate(ucd, string, desired, charScores);
    const transformScore = transformationScore(transformed, n);
    const rankScore = computeRankScore({
      similarity,
      characterCompatibility: characterCompat,
      transformation: transformScore,
      readability: read,
      stability: stab,
      compatibilityEstimate: compatibility.score / 100,
    });

    const changedPositions = new Set();
    let offset = 0;
    for (const f of path) {
      const len = codePoints(f.output).length;
      if (!f.identity) for (let k = 0; k < len; k++) changedPositions.add(offset + k);
      offset += len;
    }
    const nfc = string.normalize("NFC");
    const nfkc = string.normalize("NFKC");
    return {
      id: cps.map((cp) => cp.toString(16)).join("-"),
      string,
      codePoints: cps.map((cp, k) => ({
        codePoint: codePointLabel(cp),
        char: String.fromCodePoint(cp),
        name: ucd.name(cp),
        script: ucd.script(cp),
        category: ucd.category(cp),
        age: ucd.age(cp),
        changed: changedPositions.has(k),
      })),
      segments: path.map((f) => ({
        target: f.target,
        output: f.output,
        changed: !f.identity,
        relation: f.label,
        similarity: round(f.sim),
      })),
      counts: counts(string),
      normalization: {
        nfc,
        nfkc,
        nfd: string.normalize("NFD"),
        nfcStable: nfc === string,
        nfkcStable: nfkc === string,
        nfkcEqualsDesired: nfkc === desired.normalize("NFKC"),
        lowercase: string.toLowerCase(),
        skeleton: ucd.skeleton(string),
      },
      scripts: letterScripts(ucd, string),
      similarity: round(similarity),
      similarityLabel: similarityLabel(similarity),
      characterCompatibility: round(characterCompat),
      transformed,
      length: n,
      readability: round(read),
      stability: round(stab),
      compatibility,
      rankScore: round(rankScore, 4),
    };
  }

  // ---- public API --------------------------------------------------------------------------------------

  /** Character Analysis Engine output for the desired username. */
  analyze(rawDesired) {
    const { value: desired, notices } = this.validateDesired(rawDesired);
    return { desired, notices, ...this.describeAnalysis(desired) };
  }

  /** Every variant of every desired character (uncapped), plus multi-character replacements. */
  describeAnalysis(desired) {
    const { ucd, index } = this;
    const ctx = this.buildContext(desired, LIMITS.maxDepth, { exhaustive: true });
    const fillers = ctx.targets.map((_, i) => {
      const list = [];
      for (let j = i + 1; j <= Math.min(ctx.n, i + LIMITS.maxSpan); j++) list.push(...this.enumerateFillers(ctx, i, j));
      return list;
    });
    const characters = ctx.targets.map((t, i) => {
      const cp = t.codePointAt(0);
      const desc = ucd.describe(cp);
      const byQuality = (a, b) => b.sim - a.sim || b.compat - a.compat;
      const own = fillers[i].filter((f) => f.j === i + 1 && !f.identity);
      // Splits (m → r + n) multiply out into thousands of combinations; list only the best of them.
      const singles = own.filter((f) => f.edges.length === 1).sort(byQuality);
      const splits = own.filter((f) => f.edges.length > 1).sort(byQuality).slice(0, 25);
      own.length = 0;
      own.push(...[...singles, ...splits].sort(byQuality));
      const variants = own.map((f) => {
        const cps = codePoints(f.output);
        const nfkc = f.output.normalize("NFKC");
        return {
          string: f.output,
          codePoints: cps.map(codePointLabel),
          names: cps.map((c) => ucd.name(c)),
          scripts: [...new Set(cps.map((c) => ucd.script(c)))],
          categories: [...new Set(cps.map((c) => ucd.category(c)))],
          relation: f.label,
          similarity: round(f.sim),
          similarityLabel: similarityLabel(f.sim),
          visuallySimilar: f.sim >= VISUALLY_SIMILAR_THRESHOLD,
          compatibility: round(f.compat),
          nfc: f.output.normalize("NFC"),
          nfkc,
          nfkcStable: nfkc === f.output,
          age: Math.max(...cps.map((c) => ucd.age(c) ?? 0)),
        };
      });
      const excluded = index
        .entriesFor(ctx.keys[i])
        .filter((e) => e.char !== t && (!e.eligible || e.rtl))
        .map((e) => ({
          string: e.char,
          codePoint: codePointLabel(e.cp),
          name: e.name,
          reason: e.excludedReason ?? "Right-to-left character or Arabic digit: it can reorder the username when mixed with left-to-right text.",
        }));
      return {
        ...desc,
        index: i,
        skeleton: ctx.keys[i],
        skeletonCodePoints: codePoints(ctx.keys[i]).map(codePointLabel),
        supported: variants.length > 0,
        variantCount: variants.length,
        variants,
        excluded,
      };
    });
    const sequences = [];
    fillers.forEach((list) => {
      for (const f of list) {
        if (f.identity || f.span < 2) continue;
        sequences.push({ target: f.target, string: f.output, codePoints: codePoints(f.output).map(codePointLabel), relation: f.label, similarity: round(f.sim) });
      }
    });
    const unsupported = characters.filter((c) => !c.supported).map((c) => ({ char: c.char, codePoint: c.codePoint, name: c.name }));
    return { skeleton: ctx.K.join(""), characters, sequences, unsupported };
  }

  /**
   * Generates ranked candidates for the desired username.
   * @param {object} options
   * @param {number} options.count   how many top-ranked candidates to return
   * @param {number} options.depth   search depth; "Generate more" raises it to explore further
   */
  transform(rawDesired, { existing = "", count = LIMITS.defaultCount, depth = 1 } = {}) {
    const desiredInput = this.validateDesired(rawDesired);
    const existingInput = this.validateExisting(existing);
    const desired = desiredInput.value;
    depth = clampInt(depth, 1, LIMITS.maxDepth, 1);
    count = clampInt(count, 1, LIMITS.maxCount, LIMITS.defaultCount);

    const ctx = this.buildContext(desired, depth);
    const fillers = this.spanFillers(ctx);
    const paths = [...this.beamSearch(ctx, fillers), ...this.singlePaths(ctx, fillers), ...this.uniformPaths(ctx, fillers)];

    const byNfc = new Map();
    for (const path of paths) {
      if (path.every((f) => f.identity)) continue;
      const string = path.map((f) => f.output).join("");
      const nfc = string.normalize("NFC");
      if (nfc === desired.normalize("NFC") || byNfc.has(nfc)) continue;
      byNfc.set(nfc, this.buildCandidate(ctx, path));
    }
    const ranked = [...byNfc.values()].sort(compareCandidates);
    ranked.forEach((c, k) => (c.rank = k + 1));

    const analysis = this.describeAnalysis(desired);
    const notices = [...desiredInput.notices, ...existingInput.notices];
    if (existingInput.value && existingInput.value.toLowerCase() === desired.toLowerCase())
      notices.push("Your existing username already is the desired username; candidates below are different strings that look the same.");

    return {
      desired,
      existing: existingInput.value,
      notices,
      analysis,
      candidates: ranked.slice(0, count),
      total: ranked.length,
      depth,
      hasMore: ranked.length > count || (depth < LIMITS.maxDepth && ranked.length > 0),
      engine: this.stats(),
    };
  }
}

export function compareCandidates(a, b) {
  return b.rankScore - a.rankScore || b.similarity - a.similarity || (a.string < b.string ? -1 : a.string > b.string ? 1 : 0);
}

function round(x, digits = 3) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function createEngine({ dataDir } = {}) {
  const ucd = loadUnicodeDatabase(dataDir);
  return new UsernameTransformationEngine(ucd, new VariantIndex(ucd));
}

let shared = null;
/** One engine per process: the database is loaded and indexed once (about half a second). */
export function getEngine() {
  return (shared ??= createEngine());
}
