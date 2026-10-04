/**
 * Operating-system helpers: open a URL in the user's default browser, copy text to the clipboard, and find
 * a Chromium-based browser that can show the app in its own window (--app mode).
 *
 * Everything takes `platform`, `env` and `spawnImpl` so tests can check the exact commands without running
 * them.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { isAllowedTikTokUrl } from "./tiktok.js";

/** Command that opens `url` in the default browser, so TikTok loads where the user is already signed in. */
export function openCommand(url, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [url] };
  // FileProtocolHandler takes the URL as one argument, so "&" and quotes need no cmd.exe escaping.
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

function run(command, args, { spawnImpl = spawn, input, env, timeoutMs = 5000, detached = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        stdio: [input === undefined ? "ignore" : "pipe", "ignore", "ignore"],
        detached,
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Some openers keep running (the browser itself); after the timeout assume success.
    const timer = setTimeout(() => {
      child.unref?.();
      done({ ok: true, timedOut: true });
    }, timeoutMs);
    child.on("error", (error) => done({ ok: false, error: error.message }));
    child.on("exit", (code) =>
      done(code === 0 ? { ok: true } : { ok: false, error: `${command} exited with code ${code}` }),
    );
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

export async function openExternal(url, { platform = process.platform, spawnImpl } = {}) {
  if (!isAllowedTikTokUrl(url)) throw new Error(`Refusing to open a non-TikTok URL: ${url}`);
  const { command, args } = openCommand(url, platform);
  const result = await run(command, args, { spawnImpl, detached: platform !== "win32" });
  return { opened: result.ok, command, error: result.error ?? null };
}

/** Clipboard commands to try, in order. */
export function clipboardCommands(text, platform = process.platform) {
  if (platform === "darwin") return [{ command: "pbcopy", args: [], input: text, env: { LANG: "en_US.UTF-8" } }];
  if (platform === "win32") {
    // Passing the text as Base64 avoids every console code-page and quoting problem.
    const b64 = Buffer.from(text, "utf8").toString("base64");
    const script = `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`;
    return [{ command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", script] }];
  }
  return [
    { command: "wl-copy", args: [], input: text },
    { command: "xclip", args: ["-selection", "clipboard"], input: text },
    { command: "xsel", args: ["--clipboard", "--input"], input: text },
  ];
}

/** Server-side clipboard copy, used when the window's own clipboard API is unavailable. */
export async function copyText(text, { platform = process.platform, spawnImpl } = {}) {
  const errors = [];
  for (const { command, args, input, env } of clipboardCommands(text, platform)) {
    const result = await run(command, args, { spawnImpl, input, env, timeoutMs: 3000 });
    if (result.ok) return { copied: true, method: command };
    errors.push(result.error);
  }
  return { copied: false, method: null, error: errors.join("; ") };
}

const APP_BROWSERS = {
  darwin: [
    "Google Chrome.app/Contents/MacOS/Google Chrome",
    "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "Chromium.app/Contents/MacOS/Chromium",
    "Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "Google\\Chrome\\Application\\chrome.exe",
    "Microsoft\\Edge\\Application\\msedge.exe",
    "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "Chromium\\Application\\chrome.exe",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
  ],
};

/** Path of a Chromium-based browser that supports --app windows, or null. */
export function findAppBrowser({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  home = homedir(),
} = {}) {
  if (env.MACHINE_APP_BROWSER) return exists(env.MACHINE_APP_BROWSER) ? env.MACHINE_APP_BROWSER : null;
  let candidates;
  if (platform === "darwin") {
    candidates = APP_BROWSERS.darwin.flatMap((p) => [join("/Applications", p), join(home, "Applications", p)]);
  } else if (platform === "win32") {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.ProgramW6432].filter(Boolean);
    candidates = APP_BROWSERS.win32.flatMap((p) => roots.map((r) => `${r}\\${p}`));
  } else {
    const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
    candidates = APP_BROWSERS.linux.flatMap((name) => dirs.map((d) => join(d, name)));
  }
  return candidates.find((p) => exists(p)) ?? null;
}

/** Folder for the app window's own browser profile (window size etc.). Holds no TikTok data. */
export function appDataDir({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "UsernameTransformationMachine");
  if (platform === "darwin") return join(home, "Library", "Application Support", "UsernameTransformationMachine");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "username-transformation-machine");
}

export function appWindowArgs(
  url,
  profileDir,
  { platform = process.platform, isRoot = process.getuid?.() === 0 } = {},
) {
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1380,920",
    "--disable-features=Translate",
  ];
  // Chromium refuses to start as root on Linux without this (containers, CI). Never needed for normal users.
  if (platform === "linux" && isRoot) args.push("--no-sandbox");
  return args;
}

export const system = { openExternal, copyText };
