#!/usr/bin/env node
// Open the throwaway Chrome profile the recording rig uses, and leave it open so a
// person can sign in to the app once.
//
//   node scripts/open-shoot-profile.mjs
//
// The rig's `launch()` makes a fresh temp profile on every run, which is what keeps
// takes clean but also means a session signed in during one run is gone by the next.
// This opens a profile at a fixed path instead, so the sign-in survives, and prints
// the path for `record-demo.mjs` to reuse.
//
// Chrome is started detached: this process exits immediately and the window stays.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = join(ROOT, ".shoot-profile");
const PORT = Number(process.env.SHOOT_PORT ?? 9222);
const START_URL = process.env.SHOOT_URL ?? "https://app.keeperhub.com/workflows";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("Chrome not found in the usual places.");
  process.exit(1);
}

// A port something already answers on is not a port to launch onto: the rig would
// then drive whatever browser is holding it and log success while doing so.
let port = PORT;
for (let i = 0; i < 20; i++) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(400) });
    port += 1;
  } catch {
    break;
  }
}

mkdirSync(join(PROFILE, "Default"), { recursive: true });
const prefs = join(PROFILE, "Default", "Preferences");
if (!existsSync(prefs)) {
  // Translation bubbles do not exist in the DOM and only show up as a difference
  // between the page screenshot and the screen capture, one take too late.
  writeFileSync(
    prefs,
    JSON.stringify({
      translate: { enabled: false },
      translate_blocked_languages: ["en", "ko"],
      intl: { accept_languages: "en-US,en", selected_languages: "en-US,en" },
      browser: { has_seen_welcome_page: true },
      profile: { exit_type: "Normal", exited_cleanly: true },
    }),
  );
}

const child = spawn(
  CHROME,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE}`,
    "--window-position=0,0",
    "--window-size=1600,1000",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,TranslateUI",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    START_URL,
  ],
  { detached: true, stdio: "ignore" },
);
child.unref();

console.log("Chrome is opening. Sign in there, then leave the window as it is.");
console.log(`  profile : ${PROFILE}`);
console.log(`  port    : ${port}`);
console.log(`  opened  : ${START_URL}`);
console.log("");
console.log("This profile is git-ignored and is the one the recording will reuse.");
