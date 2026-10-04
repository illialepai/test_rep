// End-to-end check in real Chromium: `npm run test:e2e`
// Needs Playwright (installed globally or locally). Screenshots go to $SHOT_DIR if set.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { server } from "../scripts/serve.mjs";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    return createRequire(globalRoot + "/")("playwright");
  }
}

const { chromium } = await loadPlaywright();
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;
const shots = process.env.SHOT_DIR;
const errors = [];
let passed = 0;

async function step(name, fn) {
  await fn();
  passed++;
  console.log("  ✓", name);
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" },
);

try {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 375, height: 740, isMobile: true, hasTouch: true },
  ]) {
    console.log(`\n${viewport.name} (${viewport.width}px)`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    // Google Fonts is optional (offline-safe), so its network failures are ignored.
    page.on("console", (m) => {
      if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url)) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    const clip = () => page.evaluate(() => navigator.clipboard.readText());

    await step("empty input shows an error and no cards", async () => {
      await page.click(".btn-generate");
      await page.waitForSelector(".msg-error");
      assert.match(await page.textContent(".msg-error"), /Enter a username/);
      assert.equal(await page.isHidden("#results"), true);
    });

    await step("emoji and symbols are reported, and the Remove button fixes them", async () => {
      await page.fill("#username", "cool😀name!");
      await page.press("#username", "Enter");
      assert.match(await page.textContent(".msg-error"), /U\+1F600/);
      await page.click("text=Remove unsupported characters");
      assert.equal(await page.inputValue("#username"), "coolname");
      await page.waitForSelector(".card");
    });

    await step("length, trailing period and @/space/case handling", async () => {
      await page.fill("#username", "x");
      await page.press("#username", "Enter");
      assert.match(await page.textContent(".msg-error"), /at least 2/);
      await page.fill("#username", "a".repeat(25));
      assert.equal(await page.textContent("#counter"), "25/24");
      await page.press("#username", "Enter");
      assert.match(await page.textContent(".msg-error"), /at most 24/);
      await page.fill("#username", "name.");
      await page.press("#username", "Enter");
      assert.match(await page.textContent(".msg-error"), /period/);
      await page.fill("#username", "@My User");
      await page.press("#username", "Enter");
      assert.equal(await page.locator(".msg-info").count(), 3);
      assert.equal(await page.textContent('[data-style="plain"] .handle-text'), "my_user");
    });

    await step("generate renders every style with real Unicode text", async () => {
      await page.fill("#username", "myusername");
      await page.click(".btn-generate");
      assert.equal(await page.locator(".card").count(), 19);
      const bold = await page.textContent('[data-style="bold"] .handle-text');
      assert.equal(bold, "𝐦𝐲𝐮𝐬𝐞𝐫𝐧𝐚𝐦𝐞");
      assert.equal(bold.codePointAt(0), 0x1d426);
      // The handle element must not rely on CSS transforms of the text.
      const tt = await page.$eval('[data-style="bold"] .handle', (el) => getComputedStyle(el).textTransform);
      assert.equal(tt, "none");
    });

    await step("Copy copies the exact string and shows Copied ✓, then resets", async () => {
      const btn = page.locator('[data-style="fraktur"] .btn-copy');
      await btn.click();
      assert.equal(await clip(), "𝔪𝔶𝔲𝔰𝔢𝔯𝔫𝔞𝔪𝔢");
      assert.match(await btn.textContent(), /Copied ✓/);
      await page.waitForTimeout(1800);
      assert.equal((await btn.textContent()).trim(), "Copy");
    });

    await step("clicking the username itself copies it", async () => {
      await page.click('[data-style="small-caps"] .handle');
      assert.equal(await clip(), "ᴍʏᴜꜱᴇʀɴᴀᴍᴇ");
      assert.match(await page.textContent('[data-style="small-caps"] .btn-copy'), /Copied/);
    });

    await step("Copy All copies a clean list of the shown styles", async () => {
      await page.click("#copy-all-slot button");
      const lines = (await clip()).split("\n");
      assert.equal(lines.length, 19);
      assert.equal(lines[0], "Standard: myusername");
      assert.ok(lines.includes("Bold: 𝐦𝐲𝐮𝐬𝐞𝐫𝐧𝐚𝐦𝐞"));
    });

    await step("compatibility filters work and Copy All follows the filter", async () => {
      await page.click('[data-filter="unsupported"]');
      assert.equal(await page.locator(".card").count(), 1);
      assert.equal(await page.getAttribute(".card", "data-style"), "circled");
      await page.click("#copy-all-slot button");
      assert.equal(await clip(), "Circled: ⓜⓨⓤⓢⓔⓡⓝⓐⓜⓔ");
      await page.click('[data-filter="likely"]');
      assert.equal(await page.locator(".card").count(), 2);
      await page.click('[data-filter="all"]');
      assert.equal(await page.locator(".card").count(), 19);
    });

    await step("Characters panel lists code points", async () => {
      const card = page.locator('[data-style="bold"]');
      await card.getByRole("button", { name: "Characters" }).click();
      assert.equal(await card.locator(".char").count(), 10);
      assert.equal(await card.locator(".char-cp").first().textContent(), "U+1D426");
      await card.getByRole("button", { name: "Characters" }).click();
      assert.equal(await card.locator(".details").isHidden(), true);
    });

    await step("Apply to TikTok copies and opens instructions; Escape/Done closes", async () => {
      await page.locator('[data-style="sans-bold"]').getByRole("button", { name: "Apply to TikTok" }).click();
      await page.waitForSelector("#apply-dialog[open]");
      assert.equal(await page.textContent("#apply-handle"), "𝗺𝘆𝘂𝘀𝗲𝗿𝗻𝗮𝗺𝗲");
      assert.equal(await clip(), "𝗺𝘆𝘂𝘀𝗲𝗿𝗻𝗮𝗺𝗲");
      assert.match(await page.textContent("#apply-dialog"), /Edit profile/);
      await page.click("#apply-copy");
      assert.match(await page.textContent("#apply-copy"), /Copied/);
      if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-dialog.png` });
      await page.keyboard.press("Escape");
      assert.equal(await page.isVisible("#apply-dialog"), false);
      await page.locator('[data-style="bold"]').getByRole("button", { name: "Apply to TikTok" }).click();
      await page.click("#apply-close");
      assert.equal(await page.isVisible("#apply-dialog"), false);
    });

    await step("keyboard: / focuses the input, Tab reaches card buttons", async () => {
      await page.locator("h1").click();
      await page.keyboard.press("/");
      assert.equal(await page.evaluate(() => document.activeElement.id), "username");
      await page.focus('[data-style="plain"] .handle');
      const focused = () => page.evaluate(() => document.activeElement.textContent);
      await page.keyboard.press("Tab");
      assert.match(await focused(), /Characters/);
      await page.keyboard.press("Enter");
      assert.equal(await page.isVisible('[data-style="plain"] .details'), true);
      await page.keyboard.press("Tab");
      assert.match(await focused(), /Copy/);
      await page.keyboard.press("Enter");
      assert.equal(await clip(), "myusername");
    });

    await step("no horizontal overflow", async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `page overflows by ${overflow}px`);
    });

    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${shots}/${viewport.name}.png`, fullPage: true });
    }
    await context.close();
  }

  assert.deepEqual(errors, [], "console errors: " + errors.join("\n"));
  console.log(`\n✓ ${passed} e2e checks passed, no console errors`);
} finally {
  await browser.close();
  server.close();
}
