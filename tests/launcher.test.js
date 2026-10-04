// Runs the real launcher (bin/machine.mjs) as a child process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/machine.mjs", import.meta.url));
const skipOnWindows = process.platform === "win32" ? "fake browser is a shell script" : false;

function launch(args, env = {}) {
  const child = spawn(process.execPath, [BIN, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const waitFor = (re, ms = 15000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${re}; output:\n${out}`)), ms);
      const check = () => {
        const m = out.match(re);
        if (m) {
          clearTimeout(timer);
          child.stdout.off("data", check);
          resolve(m);
        }
      };
      child.stdout.on("data", check);
      check();
    });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, waitFor, exited, output: () => out };
}

test("--help prints usage", async () => {
  const run = launch(["--help"]);
  assert.equal(await run.exited, 0);
  assert.match(run.output(), /Usage: npm start/);
});

test("unknown options fail with usage", async () => {
  const run = launch(["--bogus"]);
  assert.equal(await run.exited, 2);
  assert.match(run.output(), /Unknown option: --bogus/);
});

test("--no-window serves the machine on 127.0.0.1 and stops on SIGTERM", async () => {
  const run = launch(["--no-window", "--port", "0"]);
  const [, url] = await run.waitFor(/Running at (http:\/\/127\.0\.0\.1:\d+\/)/);
  assert.match(run.output(), /Unicode 16\.0\.0/);
  const info = await (await fetch(url + "api/info")).json();
  assert.equal(info.app, "Username Transformation Machine");
  const html = await (await fetch(url)).text();
  assert.match(html, /Username Transformation Machine/);
  run.child.kill("SIGTERM");
  assert.equal(await run.exited, 0);
});

function fakeBrowser(dir, { stayOpenMs }) {
  const log = join(dir, "browser-args.json");
  const script = join(dir, "fake-browser.mjs");
  writeFileSync(
    script,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const app = args.find((a) => a.startsWith("--app=")).slice(6);
const res = await fetch(app);
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, status: res.status }));
setTimeout(() => process.exit(0), ${stayOpenMs});
`,
  );
  chmodSync(script, 0o755);
  return { script, log };
}

test("opens an app window and stops when the window closes", { skip: skipOnWindows, timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "utm-"));
  const { script, log } = fakeBrowser(dir, { stayOpenMs: 4500 });
  const run = launch([], { MACHINE_APP_BROWSER: script, XDG_CONFIG_HOME: dir });
  await run.waitFor(/Opened the app window/);
  assert.equal(await run.exited, 0);
  assert.match(run.output(), /App window closed/);
  const { args, status } = JSON.parse(readFileSync(log, "utf8"));
  assert.equal(status, 200, "the window could load the app");
  assert.ok(args.some((a) => /^--app=http:\/\/127\.0\.0\.1:\d+\/$/.test(a)));
  assert.ok(args.includes(`--user-data-dir=${join(dir, "username-transformation-machine", "window-profile")}`));
  assert.ok(existsSync(join(dir, "username-transformation-machine", "window-profile")));
});

test(
  "keeps running when the window is handed to an already open one",
  { skip: skipOnWindows, timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "utm-"));
    const { script } = fakeBrowser(dir, { stayOpenMs: 0 });
    const run = launch([], { MACHINE_APP_BROWSER: script, XDG_CONFIG_HOME: dir });
    await run.waitFor(/handed to an already open window/);
    assert.equal(run.child.exitCode, null, "still running");
    run.child.kill("SIGTERM");
    assert.equal(await run.exited, 0);
  },
);
