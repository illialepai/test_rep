import { api } from "./api.js";
import { copyText } from "./clipboard.js";
import { bar, clear, compatClass, h, pct } from "./dom.js";
import { previewFont, renderedMatch } from "./render-check.js";

const PAGE = 12;
const REJECTED_MESSAGE = "TikTok rejected this candidate. Try another candidate.";
const RENDER_WARNING = 0.6;

const $ = (id) => document.getElementById(id);
const els = {
  form: $("transform-form"),
  existing: $("existing"),
  desired: $("desired"),
  transform: $("transform"),
  messages: $("messages"),
  pipeline: $("pipeline"),
  engineInfo: $("engine-info"),
  engineStatus: $("engine-status"),
  quit: $("quit"),
  analysisEmpty: $("analysis-empty"),
  tiles: $("analysis-tiles"),
  detail: $("analysis-detail"),
  summary: $("summary"),
  resultsEmpty: $("results-empty"),
  cards: $("cards"),
  showCodePoints: $("show-codepoints"),
  copyAll: $("copy-all"),
  more: $("generate-more"),
  clear: $("clear"),
  dialog: $("submit-dialog"),
  dialogCandidate: $("dialog-candidate"),
  stepCopy: $("step-copy"),
  stepOpen: $("step-open"),
  outcome: $("outcome"),
  accepted: $("outcome-accepted"),
  rejected: $("outcome-rejected"),
  backToList: $("back-to-list"),
  dialogX: $("dialog-x"),
  toast: $("toast"),
};

const state = {
  desired: "",
  existing: "",
  candidates: [],
  analysis: null,
  total: 0,
  depth: 1,
  count: PAGE,
  hasMore: false,
  sort: "rank",
  showCodePoints: false,
  selectedChar: 0,
  rejected: new Set(),
  accepted: null,
  active: null,
  busy: false,
};

// ---- engine status -------------------------------------------------------------------------------

async function loadInfo() {
  try {
    const info = await api.info();
    const e = info.engine;
    els.engineInfo.textContent =
      `Username Transformation Engine · Unicode ${e.unicodeVersion} · ${e.characters.toLocaleString("en")} characters · ` +
      `${e.confusableMappings.toLocaleString("en")} UTS #39 confusables · ${e.variantEntries.toLocaleString("en")} variant mappings`;
    setStatus("ready", "Engine ready");
  } catch (error) {
    els.engineInfo.textContent = error.message;
    setStatus("error", "Offline");
  }
}

function setStatus(stateName, text) {
  els.engineStatus.dataset.state = stateName;
  els.engineStatus.lastElementChild.textContent = text;
}

// ---- messages and toast ------------------------------------------------------------------------------

function showMessages(list) {
  clear(els.messages);
  for (const { level, text } of list)
    els.messages.append(h("p", { class: `msg msg-${level}`, role: level === "error" ? "alert" : null }, text));
}

let toastTimer;
function toast(text, level = "info") {
  els.toast.textContent = text;
  els.toast.dataset.level = level;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

// ---- pipeline ----------------------------------------------------------------------------------------

function setPipeline(status, outputs = {}) {
  for (const li of els.pipeline.children) {
    li.dataset.state = status;
    li.querySelector(".stage-out").textContent = outputs[li.dataset.stage] ?? "";
  }
}

// ---- transform -----------------------------------------------------------------------------------------

async function runTransform(event) {
  event?.preventDefault();
  if (state.busy) return;
  const desired = els.desired.value;
  const existing = els.existing.value;
  setBusy(true);
  setPipeline("running");
  showMessages([]);
  els.desired.removeAttribute("aria-invalid");
  els.existing.removeAttribute("aria-invalid");
  try {
    const data = await api.transform({ desired, existing, count: PAGE, depth: 1 });
    Object.assign(state, {
      desired: data.desired,
      existing: data.existing,
      candidates: data.candidates,
      analysis: data.analysis,
      total: data.total,
      depth: data.depth,
      count: PAGE,
      hasMore: data.hasMore,
      selectedChar: 0,
      rejected: new Set(),
      accepted: null,
    });
    const variantTotal = data.analysis.characters.reduce((a, c) => a + c.variantCount, 0);
    setPipeline("done", {
      analyze: `${data.analysis.characters.length} char${data.analysis.characters.length === 1 ? "" : "s"}`,
      search: `${variantTotal} variants`,
      generate: `${data.total} strings`,
      rank: data.total ? `top ${pct(data.candidates[0].similarity)}` : "—",
    });
    const messages = data.notices.map((text) => ({ level: "info", text }));
    if (data.analysis.unsupported.length) {
      const list = data.analysis.unsupported.map((u) => `“${u.char}” ${u.codePoint} ${u.name}`).join(", ");
      messages.push({
        level: "warn",
        text: `No visible Unicode alternatives for ${list}. ${data.total ? "These characters stay as typed." : ""}`,
      });
    }
    if (!data.total)
      messages.push({
        level: "error",
        text: `No candidates: no character of “${data.desired}” has a visible Unicode alternative.`,
      });
    showMessages(messages);
    render();
  } catch (error) {
    setPipeline("error");
    showMessages([{ level: "error", text: error.message }]);
    const field = error.field === "existing" ? els.existing : els.desired;
    field.setAttribute("aria-invalid", "true");
    field.focus();
  } finally {
    setBusy(false);
  }
}

async function generateMore() {
  if (state.busy || !state.desired) return;
  setBusy(true);
  try {
    const depth = state.depth + 1;
    const count = state.count + PAGE;
    const data = await api.transform({ desired: state.desired, existing: state.existing, count, depth });
    const known = new Set(state.candidates.map((c) => c.id));
    const fresh = data.candidates.filter((c) => !known.has(c.id)).slice(0, PAGE);
    state.candidates.push(...fresh);
    Object.assign(state, {
      depth: data.depth,
      count: state.candidates.length,
      total: data.total,
      hasMore: data.hasMore && fresh.length > 0,
    });
    render();
    toast(
      fresh.length
        ? `Added ${fresh.length} more candidate${fresh.length === 1 ? "" : "s"}.`
        : "No further candidates found.",
    );
  } catch (error) {
    showMessages([{ level: "error", text: error.message }]);
  } finally {
    setBusy(false);
  }
}

function clearAll() {
  Object.assign(state, {
    desired: "",
    candidates: [],
    analysis: null,
    total: 0,
    depth: 1,
    count: PAGE,
    hasMore: false,
    rejected: new Set(),
    accepted: null,
  });
  els.desired.value = "";
  showMessages([]);
  setPipeline("idle");
  render();
  els.desired.focus();
}

function setBusy(busy) {
  state.busy = busy;
  els.transform.disabled = busy;
  els.transform.textContent = busy ? "Transforming…" : "Transform";
  document.body.classList.toggle("busy", busy);
  updateToolbar();
}

function updateToolbar() {
  const has = state.candidates.length > 0;
  els.copyAll.disabled = !has || state.busy;
  els.more.disabled = !has || !state.hasMore || state.busy;
  els.clear.disabled = (!has && !state.analysis) || state.busy;
}

// ---- sorting -------------------------------------------------------------------------------------------

const SORTS = {
  rank: (a, b) => b.rankScore - a.rankScore || a.rank - b.rank,
  similarity: (a, b) => b.similarity - a.similarity || a.rank - b.rank,
  rendered: (a, b) => rendered(b) - rendered(a) || a.rank - b.rank,
  compatibility: (a, b) => b.compatibility.score - a.compatibility.score || a.rank - b.rank,
};

let font;
/** Rendered match on this computer, computed once per candidate. */
function rendered(c) {
  if (c.rendered === undefined) {
    font ??= previewFont();
    try {
      c.rendered = renderedMatch(state.desired, c.string, font);
    } catch {
      c.rendered = null;
    }
  }
  return c.rendered ?? 0;
}

function sortedCandidates() {
  return [...state.candidates].sort(
    (a, b) => Number(state.rejected.has(a.id)) - Number(state.rejected.has(b.id)) || SORTS[state.sort](a, b),
  );
}

// ---- rendering -----------------------------------------------------------------------------------------

function render() {
  renderAnalysis();
  renderResults();
  updateToolbar();
}

function renderResults() {
  clear(els.cards);
  const list = sortedCandidates();
  els.resultsEmpty.hidden = list.length > 0;
  if (!list.length) {
    els.summary.textContent = "";
    if (state.analysis) els.resultsEmpty.textContent = `No candidates for “${state.desired}”.`;
    else
      els.resultsEmpty.replaceChildren(
        "Enter a desired username and press ",
        h("strong", {}, "Transform"),
        ". Candidates appear here, ranked.",
      );
    return;
  }
  const sortName = {
    rank: "overall rank",
    similarity: "visual similarity",
    rendered: "rendered match on this computer",
    compatibility: "compatibility",
  }[state.sort];
  els.summary.textContent = `Showing ${list.length} of ${state.total} candidates for @${state.desired} · sorted by ${sortName}`;
  els.cards.append(...list.map(renderCard));
}

function renderCard(c) {
  const rejected = state.rejected.has(c.id);
  const accepted = state.accepted === c.id;
  const match = rendered(c);
  const changedCount = c.segments.filter((s) => s.changed).length;
  const relations = [...new Set(c.segments.filter((s) => s.changed).map((s) => s.relation))].join(", ");

  const underlying = h(
    "div",
    { class: "cp-strip", "aria-label": "Underlying Unicode" },
    c.codePoints.map((cp) =>
      h(
        "span",
        { class: `cp${cp.changed ? " changed" : ""}`, title: `${cp.codePoint} ${cp.name} (${cp.script})` },
        h("span", { class: "cp-char" }, cp.char),
        h("span", { class: "cp-code" }, cp.codePoint),
      ),
    ),
  );

  const norm = c.normalization;
  const normText = [
    norm.nfcStable ? "NFC: unchanged" : `NFC: “${norm.nfc}”`,
    norm.nfkcStable ? "NFKC: unchanged" : `NFKC: “${norm.nfkc}”${norm.nfkcEqualsDesired ? " (= desired)" : ""}`,
  ].join(" · ");

  const card = h(
    "article",
    {
      class: `card${rejected ? " is-rejected" : ""}${accepted ? " is-accepted" : ""}`,
      dataset: {
        id: c.id,
        rank: c.rank,
        similarity: c.similarity,
        compat: c.compatibility.score,
        rendered: match.toFixed(4),
      },
      "aria-label": `Candidate ${c.rank}`,
    },
    h(
      "header",
      { class: "card-head" },
      h("span", { class: "rank" }, `#${c.rank}`),
      h("span", { class: "chip chip-sim" }, `${pct(c.similarity)} · ${c.similarityLabel}`),
      h("span", { class: `chip ${compatClass(c.compatibility.label)}` }, `Compatibility: ${c.compatibility.label}`),
      match < RENDER_WARNING &&
        h(
          "span",
          {
            class: "chip chip-warn",
            title:
              "Drawn with this computer's fonts, it looks clearly different from the target or shows a missing-glyph box.",
          },
          "Looks different here",
        ),
      rejected && h("span", { class: "chip chip-rejected" }, "Rejected by TikTok"),
      accepted && h("span", { class: "chip chip-accepted" }, "You reported: accepted"),
    ),
    h(
      "div",
      { class: "visual" },
      h("span", { class: "visual-label" }, "Visual result"),
      h(
        "div",
        { class: "preview" },
        h("span", { class: "preview-at" }, "@"),
        h("span", { class: "preview-text" }, c.string),
      ),
      h("span", { class: "visual-target" }, `target @${state.desired}`),
    ),
    h(
      "dl",
      { class: "facts" },
      fact("Underlying Unicode", underlying),
      fact("Similarity", h("span", { class: "metric" }, bar(c.similarity, "bar-sim"), h("b", {}, pct(c.similarity)))),
      fact(
        "Rendered match",
        h(
          "span",
          {
            class: "metric",
            title:
              "Ink overlap with the target when drawn with this computer's fonts. Other devices (and TikTok) may draw it differently.",
          },
          bar(match, "bar-render"),
          h("b", {}, pct(match)),
          h("span", { class: "faint" }, "on this computer"),
        ),
      ),
      fact(
        "Compatibility",
        h(
          "span",
          { class: "metric" },
          bar(c.compatibility.score / 100, compatClass(c.compatibility.label)),
          h("b", {}, `${c.compatibility.label} · ${c.compatibility.score}/100`),
        ),
      ),
      fact(
        "Characters",
        `${c.counts.codePoints} code point${c.counts.codePoints === 1 ? "" : "s"} · ${c.counts.utf16Units} UTF-16 · ${c.counts.graphemes} visible · ${c.counts.utf8Bytes} bytes`,
      ),
      fact("Normalized", normText),
      fact("Transformed", `${c.transformed} of ${c.length} · ${relations || "—"}`),
    ),
    state.showCodePoints && codePointTable(c),
    h(
      "details",
      { class: "more" },
      h(
        "summary",
        {},
        `Ranking details and ${c.compatibility.notes.filter((n) => n.level === "warn").length} warnings`,
      ),
      h(
        "ul",
        { class: "scores" },
        h(
          "li",
          {},
          `Rank score ${c.rankScore.toFixed(3)} · readability ${pct(c.readability)} · Unicode stability ${pct(c.stability)} · character compatibility ${pct(c.characterCompatibility)}`,
        ),
        h(
          "li",
          {},
          `Scripts: ${c.scripts.length ? c.scripts.join(", ") : "Common only"} · UTS #39 skeleton matches the target`,
        ),
        c.segments
          .filter((s) => s.changed)
          .map((s) => h("li", {}, `“${s.target}” → “${s.output}”: ${s.relation}, ${pct(s.similarity)} similar`)),
      ),
      h(
        "ul",
        { class: "notes" },
        c.compatibility.notes.map((n) => h("li", { class: `note note-${n.level}` }, n.text)),
      ),
    ),
    h(
      "footer",
      { class: "card-actions" },
      h(
        "button",
        { type: "button", class: "btn btn-ghost", "data-action": "copy", onclick: () => copyCandidate(c) },
        "Copy",
      ),
      h(
        "button",
        { type: "button", class: "btn btn-primary", "data-action": "use", onclick: () => useCandidate(c) },
        "Use this candidate",
      ),
    ),
  );
  if (changedCount === 0) card.classList.add("is-unchanged");
  return card;
}

function fact(label, value) {
  return [h("dt", {}, label), h("dd", {}, value)];
}

function codePointTable(c) {
  return h(
    "div",
    { class: "cp-table-wrap" },
    h(
      "table",
      { class: "cp-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "Char"),
          h("th", {}, "Code point"),
          h("th", {}, "Name"),
          h("th", {}, "Script"),
          h("th", { title: "Unicode version that added the character" }, "Since"),
        ),
      ),
      h(
        "tbody",
        {},
        c.codePoints.map((cp) =>
          h(
            "tr",
            { class: cp.changed ? "changed" : "" },
            h("td", { class: "cp-table-char" }, cp.char),
            h("td", { class: "mono" }, cp.codePoint),
            h("td", {}, cp.name),
            h("td", {}, cp.script),
            h("td", {}, cp.age ? String(cp.age) : "—"),
          ),
        ),
      ),
    ),
  );
}

function renderAnalysis() {
  clear(els.tiles);
  clear(els.detail);
  const a = state.analysis;
  els.analysisEmpty.hidden = Boolean(a);
  if (!a) return;
  a.characters.forEach((ch, i) => {
    els.tiles.append(
      h(
        "button",
        {
          type: "button",
          class: `tile${ch.supported ? "" : " unsupported"}`,
          role: "tab",
          "aria-selected": String(i === state.selectedChar),
          onclick: () => {
            state.selectedChar = i;
            renderAnalysis();
          },
        },
        h("span", { class: "tile-glyph" }, ch.char),
        h("span", { class: "tile-code" }, ch.codePoint),
        h(
          "span",
          { class: "tile-count" },
          ch.supported ? `${ch.variantCount} variant${ch.variantCount === 1 ? "" : "s"}` : "no alternatives",
        ),
      ),
    );
  });
  const ch = a.characters[state.selectedChar] ?? a.characters[0];
  els.detail.append(
    h(
      "div",
      { class: "char-head" },
      h("span", { class: "char-glyph" }, ch.char),
      h(
        "dl",
        { class: "char-facts" },
        fact("Code point", ch.codePoint),
        fact("Name", ch.name),
        fact("Category · script", `${ch.category} · ${ch.script}${ch.age ? ` · Unicode ${ch.age}` : ""}`),
        fact("Normalization", `NFC “${ch.nfc}” · NFKC “${ch.nfkc}”`),
        fact("Visual key (UTS #39)", `“${ch.skeleton}” ${ch.skeletonCodePoints.join(" ")}`),
      ),
    ),
  );
  if (!ch.variants.length) {
    els.detail.append(
      h(
        "p",
        { class: "placeholder" },
        "The Unicode database has no visible alternative for this character. It stays as typed in every candidate.",
      ),
    );
  } else {
    els.detail.append(
      h(
        "div",
        { class: "variant-scroll" },
        h(
          "table",
          { class: "variant-table" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              ["Variant", "Code points", "Relation", "Similarity", "Similar?", "Compat.", "NFKC"].map((t) =>
                h("th", {}, t),
              ),
            ),
          ),
          h(
            "tbody",
            {},
            ch.variants.map((v) =>
              h(
                "tr",
                {},
                h("td", { class: "variant-char" }, v.string),
                h("td", { class: "mono", title: v.names.join(" + ") }, v.codePoints.join(" ")),
                h("td", {}, v.relation),
                h("td", {}, h("span", { class: "metric" }, bar(v.similarity, "bar-sim"), pct(v.similarity))),
                h("td", {}, v.visuallySimilar ? "Yes" : "No"),
                h("td", {}, pct(v.compatibility)),
                h("td", {}, v.nfkcStable ? "stable" : `→ “${v.nfkc}”`),
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (ch.excluded.length) {
    els.detail.append(
      h(
        "details",
        { class: "excluded" },
        h("summary", {}, `${ch.excluded.length} excluded`),
        h(
          "ul",
          {},
          ch.excluded.map((x) => h("li", {}, `${x.string} ${x.codePoint} ${x.name}: ${x.reason}`)),
        ),
      ),
    );
  }
  const seq = a.sequences.filter((s) => s.target.includes(ch.char));
  if (seq.length) {
    els.detail.append(
      h(
        "p",
        { class: "sequences" },
        "Multi-character replacements: ",
        seq.map((s) => `“${s.string}” for “${s.target}” (${s.codePoints.join(" ")})`).join(", "),
      ),
    );
  }
}

// ---- copy ----------------------------------------------------------------------------------------------

async function copyCandidate(c) {
  const result = await copyText(c.string, api.clipboard);
  if (result.copied) toast(`Copied “${c.string}” · ${c.codePoints.map((x) => x.codePoint).join(" ")}`);
  else toast("Couldn't copy automatically. Select the preview text and copy it.", "error");
  return result;
}

async function copyAll() {
  const lines = sortedCandidates().map(
    (c) =>
      `${c.string}\t${c.codePoints.map((x) => x.codePoint).join(" ")}\tsimilarity ${pct(c.similarity)}\tcompatibility ${c.compatibility.label}`,
  );
  const result = await copyText(lines.join("\n"), api.clipboard);
  toast(
    result.copied ? `Copied ${lines.length} candidates.` : "Couldn't copy automatically.",
    result.copied ? "info" : "error",
  );
}

// ---- submission flow -----------------------------------------------------------------------------------

function setStep(li, stepState, ...content) {
  li.dataset.state = stepState;
  li.querySelector(".step-body").replaceChildren(...content.flat());
}

async function useCandidate(c) {
  state.active = c;
  clear(els.outcome);
  els.dialogCandidate.replaceChildren(
    h(
      "div",
      { class: "preview preview-small" },
      h("span", { class: "preview-at" }, "@"),
      h("span", { class: "preview-text" }, c.string),
    ),
    h("div", { class: "mono dialog-cps" }, c.codePoints.map((x) => x.codePoint).join(" ")),
  );
  setStep(els.stepCopy, "running", "Copying…");
  setStep(els.stepOpen, "pending", "Waiting…");
  if (!els.dialog.open) els.dialog.showModal();

  // Copy first: the clipboard needs the click's user activation.
  const copied = await copyText(c.string, api.clipboard);
  if (copied.copied) setStep(els.stepCopy, "done", `Copied to your clipboard: “${c.string}”.`);
  else
    setStep(
      els.stepCopy,
      "error",
      "Couldn't copy automatically. Select this and copy it: ",
      h("input", { class: "manual-copy", readonly: true, value: c.string, onfocus: (e) => e.target.select() }),
    );

  await openTikTok();
}

async function openTikTok() {
  setStep(els.stepOpen, "running", "Opening TikTok…");
  try {
    const r = await api.open({ purpose: "edit", existing: state.existing });
    const again = h("button", { type: "button", class: "btn btn-ghost btn-small", onclick: openTikTok }, "Open again");
    if (r.opened)
      setStep(els.stepOpen, "done", "Opened in your default browser: ", h("code", { class: "url" }, r.url), " ", again);
    else
      setStep(
        els.stepOpen,
        "error",
        "Couldn't open your browser automatically. Go to ",
        h("code", { class: "url" }, r.url),
        " ",
        again,
      );
    if (!state.existing)
      els.stepOpen
        .querySelector(".step-body")
        .append(
          h(
            "div",
            { class: "hint" },
            "No existing username given, so TikTok's home page opened. Click Profile to get to Edit profile.",
          ),
        );
  } catch (error) {
    setStep(els.stepOpen, "error", error.message);
  }
}

function reportRejected() {
  const c = state.active;
  if (!c) return;
  state.rejected.add(c.id);
  if (state.accepted === c.id) state.accepted = null;
  els.outcome.replaceChildren(
    h("p", { class: "msg msg-error", role: "alert" }, REJECTED_MESSAGE),
    h(
      "button",
      { type: "button", class: "btn btn-primary", "data-action": "return", onclick: backToList },
      "Return to candidate list",
    ),
  );
  renderResults();
}

function reportAccepted() {
  const c = state.active;
  if (!c) return;
  state.accepted = c.id;
  state.rejected.delete(c.id);
  els.outcome.replaceChildren(
    h(
      "p",
      { class: "msg msg-info" },
      `You reported that TikTok accepted “${c.string}”. This app can't confirm it; your TikTok profile is the only proof. Check that it shows the new username.`,
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost",
        onclick: () =>
          api
            .open({ purpose: "verify", username: c.string })
            .then((r) => toast(r.opened ? "Opened the profile in your browser." : `Go to ${r.url}`)),
      },
      "Open the new profile to check",
    ),
  );
  renderResults();
}

function backToList() {
  const id = state.active?.id;
  els.dialog.close();
  const card = id && els.cards.querySelector(`[data-id="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ block: "center", behavior: "smooth" });
  card?.querySelector("button")?.focus({ preventScroll: true });
}

// ---- wiring --------------------------------------------------------------------------------------------

els.form.addEventListener("submit", runTransform);
els.more.addEventListener("click", generateMore);
els.clear.addEventListener("click", clearAll);
els.copyAll.addEventListener("click", copyAll);
els.showCodePoints.addEventListener("change", () => {
  state.showCodePoints = els.showCodePoints.checked;
  renderResults();
});
for (const button of document.querySelectorAll("[data-sort]")) {
  button.addEventListener("click", () => {
    state.sort = button.dataset.sort;
    for (const b of document.querySelectorAll("[data-sort]")) b.setAttribute("aria-pressed", String(b === button));
    renderResults();
  });
}
els.accepted.addEventListener("click", reportAccepted);
els.rejected.addEventListener("click", reportRejected);
els.backToList.addEventListener("click", backToList);
els.dialogX.addEventListener("click", () => els.dialog.close());
els.quit.addEventListener("click", async () => {
  try {
    await api.quit();
  } catch {
    // already stopped
  }
  document.body.replaceChildren(
    h(
      "main",
      { class: "stopped" },
      h("h1", {}, "The machine has stopped."),
      h("p", {}, "You can close this window. Run npm start to use it again."),
    ),
  );
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    els.desired.focus();
  }
});

setPipeline("idle");
render();
loadInfo();
els.desired.focus();
