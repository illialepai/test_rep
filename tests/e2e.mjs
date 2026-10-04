// End-to-end test of the desktop UI in real Chromium: `npm run test:e2e`
// Needs Playwright (installed globally or locally). Screenshots go to $SHOT_DIR if set.
// The OS actions (open browser, OS clipboard) are replaced by recorders so the test can assert on them.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { getEngine } from "../src/engine/engine.js";
import { createMachineServer } from "../src/app/server.js";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    return createRequire(globalRoot + "/")("playwright");
  }
}

const opened = [];
let quitCalled = false;
const server = createMachineServer({
  engine: getEngine(),
  system: {
    openExternal: async (url) => (opened.push(url), { opened: true }),
    copyText: async () => ({ copied: true, method: "test" }),
  },
  onQuit: () => (quitCalled = true),
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const shots = process.env.SHOT_DIR;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" },
);
const errors = [];
let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log("  ✓", name);
}

async function newPage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  // Chromium logs every 4xx response; the validation-error steps cause 400s on purpose.
  page.on(
    "console",
    (m) => m.type() === "error" && !/status of 400 \(Bad Request\)/.test(m.text()) && errors.push(m.text()),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#engine-status[data-state="ready"]');
  return page;
}

async function transform(page, desired, existing = "") {
  await page.fill("#existing", existing);
  await page.fill("#desired", desired);
  await page.click("#transform");
  await page.waitForFunction(
    () =>
      !document.body.classList.contains("busy") &&
      document.querySelector('#pipeline li[data-stage="rank"]').dataset.state !== "running",
  );
}

const cardData = (page) =>
  page.$$eval(".card", (cards) =>
    cards.map((c) => ({
      id: c.dataset.id,
      rank: +c.dataset.rank,
      similarity: +c.dataset.similarity,
      compat: +c.dataset.compat,
      rendered: +c.dataset.rendered,
      text: c.querySelector(".preview-text").textContent,
      rejected: c.classList.contains("is-rejected"),
    })),
  );
const nonIncreasing = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

try {
  console.log("\ndesktop 1440×900");
  const page = await newPage(1440, 900);

  await step("engine loads the Unicode database", async () => {
    assert.match(await page.textContent("#engine-info"), /Unicode 16\.0\.0 .* variant mappings/);
    assert.equal(await page.isVisible("#results-empty"), true);
    assert.equal(await page.isDisabled("#copy-all"), true);
  });

  await step("desktop layout: input and analysis side by side, results below, no horizontal scroll", async () => {
    const consoleBox = await page.locator(".console").boundingBox();
    const analysisBox = await page.locator(".analysis").boundingBox();
    const resultsBox = await page.locator(".results").boundingBox();
    assert.ok(analysisBox.x > consoleBox.x + consoleBox.width - 1, "analysis is right of the input panel");
    assert.ok(Math.abs(analysisBox.y - consoleBox.y) < 2, "same row");
    assert.ok(resultsBox.y >= consoleBox.y + consoleBox.height, "results below");
    assert.ok(await noHorizontalScroll(page));
  });

  await step("error: empty desired username", async () => {
    await transform(page, "");
    assert.match(await page.textContent(".msg-error"), /Enter the username you want your profile to display/);
    assert.equal(await page.getAttribute("#desired", "aria-invalid"), "true");
    assert.equal(await page.locator(".card").count(), 0);
  });

  await step("error: spaces and invisible characters", async () => {
    await transform(page, "a b");
    assert.match(await page.textContent(".msg-error"), /can't contain spaces/);
    await transform(page, "a​b");
    assert.match(await page.textContent(".msg-error"), /U\+200B ZERO WIDTH SPACE/);
    await transform(page, "alex", "bad name");
    assert.equal(await page.getAttribute("#existing", "aria-invalid"), "true");
  });

  await step("transform alex: ranked cards, analysis, pipeline", async () => {
    await transform(page, "alex", "@old.name");
    const cards = await cardData(page);
    assert.equal(cards.length, 12);
    assert.deepEqual(
      cards.map((c) => c.rank),
      [...Array(12).keys()].map((i) => i + 1),
    );
    assert.ok(cards[0].similarity >= 0.95);
    assert.ok(!cards.some((c) => c.text === "alex"), "never the plain desired string");
    assert.match(await page.textContent("#summary"), /Showing 12 of \d+ candidates for @alex/);
    assert.match(await page.textContent(".msg-info"), /Removed the leading @/);
    assert.equal(await page.locator(".tile").count(), 4);
    assert.ok((await page.locator(".variant-table tbody tr").count()) > 10, "variant table for a");
    await page.locator(".tile").nth(3).click();
    assert.equal(await page.textContent(".char-glyph"), "x");
    assert.equal(await page.locator('#pipeline li[data-state="done"]').count(), 4);
    const first = page.locator(".card").first();
    assert.match(await first.textContent(), /Underlying Unicode.*U\+0061/s);
    assert.match(await first.textContent(), /Similarity.*Compatibility.*Characters.*Normalized/s);
    assert.equal((await first.locator(".cp.changed").count()) >= 1, true, "changed code points are highlighted");
    assert.ok(await noHorizontalScroll(page));
    if (shots) await page.screenshot({ path: `${shots}/desktop-results.png`, fullPage: true });
  });

  await step("cards sit in at least three columns at 1440px", async () => {
    const xs = new Set(
      await page.locator(".card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x))),
    );
    assert.ok(xs.size >= 3, `columns: ${xs.size}`);
  });

  await step("show Unicode code points", async () => {
    assert.equal(await page.locator(".cp-table").count(), 0);
    await page.check("#show-codepoints");
    assert.equal(await page.locator(".cp-table").count(), 12);
    assert.match(await page.locator(".cp-table").first().textContent(), /LATIN SMALL LETTER A/);
    await page.uncheck("#show-codepoints");
    assert.equal(await page.locator(".cp-table").count(), 0);
  });

  await step("sort by similarity, rendered match, compatibility, rank", async () => {
    await page.click('[data-sort="similarity"]');
    assert.ok(nonIncreasing((await cardData(page)).map((c) => c.similarity)));
    await page.click('[data-sort="rendered"]');
    const rendered = (await cardData(page)).map((c) => c.rendered);
    assert.ok(nonIncreasing(rendered));
    assert.ok(rendered.every((r) => r >= 0 && r <= 1));
    await page.click('[data-sort="compatibility"]');
    assert.ok(nonIncreasing((await cardData(page)).map((c) => c.compat)));
    assert.match(await page.textContent("#summary"), /sorted by compatibility/);
    await page.click('[data-sort="rank"]');
    assert.deepEqual(
      (await cardData(page)).map((c) => c.rank),
      [...Array(12).keys()].map((i) => i + 1),
    );
  });

  await step("copy one candidate to the clipboard", async () => {
    const first = (await cardData(page))[0];
    await page.locator('.card [data-action="copy"]').first().click();
    assert.equal(await clip(page), first.text);
    await page.waitForSelector(".toast.show");
    assert.match(await page.textContent("#toast"), /Copied/);
  });

  await step("copy all", async () => {
    await page.click("#copy-all");
    const lines = (await clip(page)).split("\n");
    const cards = await cardData(page);
    assert.equal(lines.length, cards.length);
    lines.forEach((line, i) => assert.ok(line.startsWith(cards[i].text + "\t"), line));
    assert.match(lines[0], /U\+[0-9A-F]{4}.*similarity \d+%.*compatibility/);
  });

  await step("generate more appends new, unique candidates", async () => {
    await page.click("#generate-more");
    await page.waitForFunction(() => document.querySelectorAll(".card").length > 12);
    const cards = await cardData(page);
    assert.equal(cards.length, 24);
    assert.equal(new Set(cards.map((c) => c.id)).size, 24, "no duplicates");
    assert.equal(new Set(cards.map((c) => c.text.normalize("NFC"))).size, 24, "no canonical duplicates");
  });

  await step("use this candidate: copies, opens TikTok in the browser, explains the steps", async () => {
    opened.length = 0;
    const target = (await cardData(page))[1];
    await page.locator('.card [data-action="use"]').nth(1).click();
    await page.waitForSelector("#submit-dialog[open]");
    await page.waitForSelector('#step-open[data-state="done"]');
    assert.equal(await page.getAttribute("#step-copy", "data-state"), "done");
    assert.equal(await clip(page), target.text);
    assert.deepEqual(opened, ["https://www.tiktok.com/@old.name"]);
    assert.match(await page.textContent("#step-open"), /https:\/\/www\.tiktok\.com\/@old\.name/);
    assert.match(await page.textContent("#submit-dialog"), /Edit profile.*Username/s);
    assert.match(await page.textContent("#submit-dialog"), /never marks a username as changed/);
    if (shots) await page.screenshot({ path: `${shots}/desktop-submit.png` });
  });

  await step("TikTok rejected: shows the message and returns to the list", async () => {
    const target = (await cardData(page))[1];
    await page.click("#outcome-rejected");
    assert.equal(
      await page.textContent("#outcome .msg-error"),
      "TikTok rejected this candidate. Try another candidate.",
    );
    await page.click('#outcome [data-action="return"]');
    assert.equal(await page.isVisible("#submit-dialog"), false);
    const cards = await cardData(page);
    const rejected = cards.find((c) => c.id === target.id);
    assert.equal(rejected.rejected, true);
    assert.equal(cards.at(-1).id, target.id, "rejected candidates move to the end");
    assert.match(await page.locator(`.card[data-id="${target.id}"]`).textContent(), /Rejected by TikTok/);
  });

  await step("TikTok accepted: only reported, with a way to verify on TikTok", async () => {
    opened.length = 0;
    const target = (await cardData(page))[0];
    await page.locator('.card [data-action="use"]').first().click();
    await page.waitForSelector('#step-open[data-state="done"]');
    await page.click("#outcome-accepted");
    assert.match(await page.textContent("#outcome"), /You reported that TikTok accepted .* can't confirm it/s);
    await page.click("#outcome button");
    await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("Opened the profile"));
    assert.equal(opened.at(-1), "https://www.tiktok.com/@" + encodeURIComponent(target.text));
    await page.click("#back-to-list");
    assert.match(await page.locator(`.card[data-id="${target.id}"]`).textContent(), /You reported: accepted/);
  });

  await step("one-character input: k", async () => {
    await transform(page, "k");
    const texts = (await cardData(page)).map((c) => c.text);
    assert.ok(texts.includes("𝗄"), texts.join(" "));
    assert.equal(await page.locator(".tile").count(), 1);
  });

  await step("uppercase, numbers and mixed alphanumeric", async () => {
    await transform(page, "K");
    assert.ok((await cardData(page)).some((c) => c.text === "Κ" || c.text === "К"));
    await transform(page, "8");
    assert.ok((await cardData(page)).length > 5);
    await transform(page, "user123");
    assert.equal((await cardData(page)).length, 12);
  });

  await step("unsupported characters", async () => {
    await transform(page, "🔥");
    assert.match(await page.textContent("#messages"), /No visible Unicode alternatives for “🔥” U\+1F525 FIRE/);
    assert.match(await page.textContent("#messages"), /No candidates/);
    assert.equal(await page.locator(".card").count(), 0);
    await transform(page, "a🔥");
    assert.ok((await page.locator(".card").count()) > 0);
    assert.match(await page.textContent(".msg-warn"), /FIRE/);
  });

  await step("clear", async () => {
    await page.click("#clear");
    assert.equal(await page.locator(".card").count(), 0);
    assert.equal(await page.inputValue("#desired"), "");
    assert.equal(await page.isVisible("#results-empty"), true);
    assert.equal(await page.isDisabled("#clear"), true);
  });

  await step("keyboard: / focuses the desired field, Enter transforms", async () => {
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    assert.equal(await page.evaluate(() => document.activeElement.id), "desired");
    await page.keyboard.type("ok");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".card");
  });

  for (const [w, h] of [
    [1280, 800],
    [1024, 768],
  ]) {
    console.log(`\ndesktop ${w}×${h}`);
    const p = await newPage(w, h);
    await step(`layout at ${w}px has no horizontal scroll and readable cards`, async () => {
      await transform(p, "alex", "old.name");
      assert.ok(await noHorizontalScroll(p));
      const widths = await p.locator(".card").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      assert.ok(
        widths.every((x) => x >= 320),
        `card widths ${widths}`,
      );
      await p.check("#show-codepoints");
      assert.ok(await noHorizontalScroll(p));
      if (shots) await p.screenshot({ path: `${shots}/desktop-${w}.png` });
    });
    await p.context().close();
  }

  await step("quit stops the machine", async () => {
    await page.click("#quit");
    await page.waitForSelector(".stopped");
    assert.equal(quitCalled, true);
  });

  await step("no console errors", async () => {
    assert.deepEqual(errors, []);
  });

  console.log(`\n${passed} end-to-end checks passed`);
} finally {
  await browser.close();
  server.close();
}
