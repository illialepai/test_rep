import { generateAll } from "./core/transform.js";
import { sanitizeInput, stripInvalid, MAX_LENGTH, STATUS_LABEL } from "./core/validate.js";
import { copyText } from "./ui/clipboard.js";
import { StyleCard, Messages, copyButton, flashCopied, statusBadge } from "./ui/components.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $("#gen-form"),
  input: $("#username"),
  counter: $("#counter"),
  messages: $("#messages"),
  results: $("#results"),
  grid: $("#grid"),
  filters: $("#filters"),
  summary: $("#summary"),
  copyAllSlot: $("#copy-all-slot"),
  empty: $("#empty"),
  dialog: $("#apply-dialog"),
  dialogHandle: $("#apply-handle"),
  dialogStatus: $("#apply-status"),
  dialogCopy: $("#apply-copy"),
  toast: $("#toast"),
};

const state = {
  results: [],
  filter: "all",
  applying: null,
};

/* ---------- toast ---------- */
let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

async function copy(text) {
  const ok = await copyText(text);
  toast(ok ? "Copied to clipboard" : "Couldn't copy. Select the text and copy it manually.");
  return ok;
}

/* ---------- input ---------- */
function updateCounter() {
  const len = [...els.input.value.trim().replace(/^@+/, "")].length;
  els.counter.textContent = `${len}/${MAX_LENGTH}`;
  els.counter.classList.toggle("over", len > MAX_LENGTH);
}

function generate() {
  const cleaned = sanitizeInput(els.input.value);
  els.messages.replaceChildren(
    Messages(cleaned, () => {
      els.input.value = stripInvalid(cleaned.value);
      updateCounter();
      els.input.focus();
      generate();
    }),
  );
  els.input.setAttribute("aria-invalid", String(cleaned.errors.length > 0));

  if (cleaned.errors.length) {
    state.results = [];
    render();
    return;
  }
  state.results = generateAll(cleaned.value);
  render();
}

/* ---------- results ---------- */
function visibleResults() {
  return state.filter === "all" ? state.results : state.results.filter((r) => r.status === state.filter);
}

function renderFilters() {
  const counts = { all: state.results.length, likely: 0, maybe: 0, unsupported: 0 };
  for (const r of state.results) counts[r.status]++;
  const options = [["all", "All"], ...Object.entries(STATUS_LABEL)];
  els.filters.replaceChildren(
    ...options.map(([key, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(state.filter === key));
      btn.dataset.filter = key;
      btn.disabled = counts[key] === 0 && key !== "all";
      btn.innerHTML = `<span></span><span class="chip-count">${counts[key]}</span>`;
      btn.firstChild.textContent = label;
      btn.addEventListener("click", () => {
        state.filter = key;
        render();
      });
      return btn;
    }),
  );
}

function render() {
  const has = state.results.length > 0;
  els.results.hidden = !has;
  els.empty.hidden = has;
  if (!has) return;

  if (state.filter !== "all" && !state.results.some((r) => r.status === state.filter)) state.filter = "all";
  renderFilters();

  const list = visibleResults();
  els.summary.textContent = `${list.length} style${list.length === 1 ? "" : "s"}`;
  els.grid.replaceChildren(...list.map((r, i) => StyleCard(r, i, { copy, apply: openApply })));

  els.copyAllSlot.replaceChildren(
    copyButton({
      label: "Copy All",
      className: "btn btn-secondary",
      ariaLabel: "Copy all shown usernames as a list",
      // One "Style: username" per line, without "@" because TikTok's
      // username field already shows the @.
      onCopy: () =>
        copy(
          visibleResults()
            .map((r) => `${r.style.name}: ${r.output}`)
            .join("\n"),
        ),
    }),
  );
}

/* ---------- Apply to TikTok dialog ---------- */
async function openApply(result) {
  state.applying = result;
  els.dialogHandle.textContent = result.output;
  els.dialogStatus.replaceChildren(statusBadge(result.status));
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else els.dialog.setAttribute("open", "");
  flashCopied(els.dialogCopy, await copy(result.output), "Copy again");
}

els.dialogCopy.addEventListener("click", async () => {
  if (state.applying) flashCopied(els.dialogCopy, await copy(state.applying.output), "Copy again");
});
$("#apply-close").addEventListener("click", () => els.dialog.close());
els.dialog.addEventListener("click", (e) => {
  if (e.target === els.dialog) els.dialog.close(); // backdrop click
});

/* ---------- wiring ---------- */
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});
els.input.addEventListener("input", updateCounter);
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== els.input && !els.dialog.open) {
    e.preventDefault();
    els.input.focus();
  }
});

updateCounter();
render();
