import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  appDataDir,
  appWindowArgs,
  clipboardCommands,
  copyText,
  findAppBrowser,
  openCommand,
  openExternal,
} from "../src/app/system.js";
import { isAllowedTikTokUrl, profileUrl, submissionUrl } from "../src/app/tiktok.js";

/** A spawn() stand-in that records calls and exits with the given codes (or fails to start). */
function fakeSpawn(outcomes) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const outcome = outcomes[calls.length] ?? 0;
    const child = new EventEmitter();
    const call = { command, args, options, input: "" };
    calls.push(call);
    child.stdin = Object.assign(new EventEmitter(), { end: (data) => (call.input = data) });
    child.unref = () => {};
    setImmediate(() =>
      outcome === "missing" ? child.emit("error", new Error(`spawn ${command} ENOENT`)) : child.emit("exit", outcome),
    );
    return child;
  };
  return { spawnImpl, calls };
}

test("default-browser commands per platform", () => {
  const url = "https://www.tiktok.com/@a&b";
  assert.deepEqual(openCommand(url, "darwin"), { command: "open", args: [url] });
  assert.deepEqual(openCommand(url, "win32"), { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] });
  assert.deepEqual(openCommand(url, "linux"), { command: "xdg-open", args: [url] });
});

test("openExternal runs the opener and reports the result", async () => {
  const { spawnImpl, calls } = fakeSpawn([0]);
  const r = await openExternal("https://www.tiktok.com/@old.name", { platform: "linux", spawnImpl });
  assert.equal(r.opened, true);
  assert.equal(calls[0].command, "xdg-open");
  assert.deepEqual(calls[0].args, ["https://www.tiktok.com/@old.name"]);

  const failing = fakeSpawn(["missing"]);
  const r2 = await openExternal("https://www.tiktok.com/", { platform: "linux", spawnImpl: failing.spawnImpl });
  assert.equal(r2.opened, false);
  assert.match(r2.error, /ENOENT/);
});

test("openExternal refuses anything but www.tiktok.com over https", async () => {
  for (const url of [
    "http://www.tiktok.com/",
    "https://evil.example/",
    "https://www.tiktok.com.evil.example/",
    "https://user:pw@www.tiktok.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    assert.equal(isAllowedTikTokUrl(url), false, url);
    await assert.rejects(openExternal(url, { spawnImpl: fakeSpawn([0]).spawnImpl }), /non-TikTok/);
  }
});

test("TikTok URLs are built from usernames", () => {
  assert.equal(profileUrl("old.name"), "https://www.tiktok.com/@old.name");
  assert.equal(profileUrl("𝗄"), "https://www.tiktok.com/@%F0%9D%97%84");
  assert.equal(submissionUrl({ existing: "me" }), "https://www.tiktok.com/@me");
  assert.equal(submissionUrl({}), "https://www.tiktok.com/");
  assert.equal(submissionUrl({ purpose: "verify", username: "аlex" }), "https://www.tiktok.com/@%D0%B0lex");
  assert.throws(() => submissionUrl({ purpose: "verify" }));
});

test("clipboard commands per platform", () => {
  assert.equal(clipboardCommands("x", "darwin")[0].command, "pbcopy");
  const win = clipboardCommands("аlex 𝗄", "win32")[0];
  assert.equal(win.command, "powershell");
  const b64 = win.args.at(-1).match(/FromBase64String\('([^']+)'\)/)[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), "аlex 𝗄", "text travels as UTF-8 Base64");
  assert.deepEqual(
    clipboardCommands("x", "linux").map((c) => c.command),
    ["wl-copy", "xclip", "xsel"],
  );
});

test("copyText falls through to the next clipboard tool", async () => {
  const { spawnImpl, calls } = fakeSpawn(["missing", 0]);
  const r = await copyText("аlex", { platform: "linux", spawnImpl });
  assert.deepEqual(r, { copied: true, method: "xclip" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input, "аlex");

  const none = fakeSpawn(["missing", "missing", 1]);
  const r2 = await copyText("x", { platform: "linux", spawnImpl: none.spawnImpl });
  assert.equal(r2.copied, false);
});

test("finds a Chromium-based browser for the app window", () => {
  const exists = (p) => p === "/usr/bin/chromium";
  assert.equal(
    findAppBrowser({ platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, exists }),
    "/usr/bin/chromium",
  );
  assert.equal(findAppBrowser({ platform: "linux", env: { PATH: "/nowhere" }, exists }), null);
  const mac = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
  assert.equal(findAppBrowser({ platform: "darwin", env: {}, exists: (p) => p === mac, home: "/Users/me" }), mac);
  const win = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assert.equal(
    findAppBrowser({
      platform: "win32",
      env: { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
      exists: (p) => p === win,
    }),
    win,
  );
  assert.equal(
    findAppBrowser({ platform: "linux", env: { MACHINE_APP_BROWSER: "/opt/x" }, exists: () => true }),
    "/opt/x",
  );
});

test("app window arguments", () => {
  const args = appWindowArgs("http://127.0.0.1:1/", "/tmp/p", { platform: "darwin", isRoot: false });
  assert.ok(args.includes("--app=http://127.0.0.1:1/"));
  assert.ok(args.includes("--user-data-dir=/tmp/p"));
  assert.ok(!args.includes("--no-sandbox"));
  assert.ok(appWindowArgs("u", "p", { platform: "linux", isRoot: true }).includes("--no-sandbox"));
  assert.ok(!appWindowArgs("u", "p", { platform: "linux", isRoot: false }).includes("--no-sandbox"));
});

test("app data folders", () => {
  assert.match(
    appDataDir({ platform: "win32", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, home: "C:\\Users\\me" }),
    /UsernameTransformationMachine$/,
  );
  assert.equal(
    appDataDir({ platform: "darwin", env: {}, home: "/Users/me" }),
    "/Users/me/Library/Application Support/UsernameTransformationMachine",
  );
  assert.equal(
    appDataDir({ platform: "linux", env: {}, home: "/home/me" }),
    "/home/me/.config/username-transformation-machine",
  );
});
