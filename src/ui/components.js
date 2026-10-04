import { describeChars } from "../core/transform.js";
import { STATUS_LABEL } from "../core/validate.js";

/** Small DOM helper: h("div", { class: "x", onclick }, child1, "text", …) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val === undefined || val === null || val === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), val);
    else if (key === "class") el.className = val;
    else if (key === "dataset") Object.assign(el.dataset, val);
    else el.setAttribute(key, val === true ? "" : val);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

/**
 * Turns a button into a copy button: it shows "Copied ✓" briefly, then goes
 * back to its label. Clicking again restarts the timer.
 */
export function flashCopied(button, ok, label = "Copy") {
  clearTimeout(button._resetTimer);
  button.classList.toggle("is-copied", ok);
  button.classList.toggle("is-failed", !ok);
  button.innerHTML = ok ? "<span>Copied ✓</span>" : "<span>Copy failed</span>";
  button._resetTimer = setTimeout(() => {
    button.classList.remove("is-copied", "is-failed");
    button.innerHTML = `${COPY_ICON}<span>${label}</span>`;
  }, 1600);
}

export function copyButton({ label = "Copy", className = "btn btn-copy", onCopy, ariaLabel }) {
  const btn = h("button", { type: "button", class: className, "aria-label": ariaLabel });
  btn.innerHTML = `${COPY_ICON}<span>${label}</span>`;
  btn.addEventListener("click", async () => flashCopied(btn, await onCopy(), label));
  return btn;
}

export function statusBadge(status) {
  return h(
    "span",
    { class: `badge badge-${status}` },
    h("span", { class: "dot", "aria-hidden": "true" }),
    STATUS_LABEL[status],
  );
}

/** Per-character table: glyph, code point, Unicode category, compatibility. */
function charBreakdown(output) {
  return h(
    "ul",
    { class: "chars", "aria-label": "Unicode characters in this username" },
    describeChars(output).map((c) =>
      h(
        "li",
        { class: `char char-${c.status}`, title: `${c.category.label}. ${c.reason}` },
        h("span", { class: "char-glyph" }, c.char),
        h("span", { class: "char-cp" }, c.codePoint),
        h("span", { class: "char-cat" }, c.category.code),
      ),
    ),
  );
}

/**
 * One generated username card.
 * @param {object} result   one entry from generateAll()
 * @param {object} handlers { copy(text) => Promise<boolean>, apply(result) }
 */
export function StyleCard(result, index, handlers) {
  const { style, output, status, warnings, length } = result;
  const detailsId = `chars-${style.id}`;

  const handle = h(
    "button",
    {
      type: "button",
      class: "handle",
      lang: "und",
      "aria-label": `Copy ${style.name} username`,
      title: "Click to copy",
    },
    h("span", { class: "at", "aria-hidden": "true" }, "@"),
    h("span", { class: "handle-text" }, output),
  );

  const copyBtn = copyButton({
    ariaLabel: `Copy ${style.name} username`,
    onCopy: () => handlers.copy(output),
  });

  // Clicking the username itself copies it too, using the same feedback.
  handle.addEventListener("click", async () => {
    const ok = await handlers.copy(output);
    flashCopied(copyBtn, ok);
    handle.classList.remove("pulse");
    void handle.offsetWidth; // restart the animation
    handle.classList.add("pulse");
  });

  const details = h("div", { class: "details", id: detailsId, hidden: true }, charBreakdown(output));
  const toggle = h(
    "button",
    { type: "button", class: "toggle", "aria-expanded": "false", "aria-controls": detailsId },
    "Characters",
    h("span", { class: "chev", "aria-hidden": "true" }, "▾"),
  );
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    details.hidden = !open;
  });

  const applyBtn = h(
    "button",
    { type: "button", class: "btn btn-ghost", onclick: () => handlers.apply(result) },
    "Apply to TikTok",
  );

  return h(
    "article",
    { class: "card", dataset: { status, style: style.id }, style: `--i:${index}` },
    h("header", { class: "card-head" }, h("h3", { class: "card-title" }, style.name), statusBadge(status)),
    handle,
    h(
      "div",
      { class: "card-meta-row" },
      h("p", { class: "card-meta" }, `${length}/24 characters`, style.note ? ` · ${style.note}` : ""),
      toggle,
    ),
    warnings.length
      ? h(
          "ul",
          { class: "warnings" },
          warnings.map((w) => h("li", {}, w)),
        )
      : null,
    h("div", { class: "card-actions" }, copyBtn, applyBtn),
    details,
  );
}

/** Info / error notices under the input. */
export function Messages({ notices, errors, invalidChars }, onStrip) {
  const items = [];
  for (const e of errors) items.push(h("li", { class: "msg msg-error" }, e));
  for (const n of notices) items.push(h("li", { class: "msg msg-info" }, n));
  const list = h("ul", { class: "msgs" }, items);
  if (invalidChars.length) {
    list.append(
      h(
        "li",
        { class: "msg msg-action" },
        h("button", { type: "button", class: "btn btn-small", onclick: onStrip }, "Remove unsupported characters"),
      ),
    );
  }
  return list;
}
