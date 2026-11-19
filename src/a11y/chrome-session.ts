/**
 * Opens installed Google Chrome as a normal browser, then attaches Playwright.
 * Cloudflare's automatic check finishes in that window and keeps blocking Playwright's own browser.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

export interface RealChromeSession {
  browser: Browser;
  context: BrowserContext;
  /** Open this URL in Chrome with Playwright detached, so the security check can finish. */
  showUrl: (url: string) => Promise<boolean>;
  close: () => Promise<void>;
}

export async function openRealChrome(startUrl: string): Promise<RealChromeSession | undefined> {
  const executable = await findChrome();
  if (!executable) {
    return undefined;
  }
  const profile = await mkdtemp(path.join(os.tmpdir(), "migralens-chrome-"));
  const port = await freePort();
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--remote-allow-origins=*",
      "--window-size=1280,720",
      startUrl
    ],
    { stdio: "ignore", detached: process.platform !== "win32" }
  );
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const session: RealChromeSession = {
    get browser() {
      if (!browser) {
        throw new Error("Google Chrome is not connected.");
      }
      return browser;
    },
    get context() {
      if (!context) {
        throw new Error("Google Chrome is not connected.");
      }
      return context;
    },
    showUrl,
    close
  };

  async function close(): Promise<void> {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    context = undefined;
    stopChrome(child);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }

  async function showUrl(url: string): Promise<boolean> {
    await disconnect();
    const current = await debugPage(port);
    if (!current || !sameUrl(current.url ?? "", url)) {
      await rawNavigate(port, url);
    }
    let cleared = await waitForRealTitle(port, 45_000);
    if (!cleared) {
      await rawNavigate(port, url);
      cleared = await waitForRealTitle(port, 30_000);
    }
    await connect();
    return cleared;
  }

  async function disconnect(): Promise<void> {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    context = undefined;
  }

  async function connect(): Promise<void> {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    context = browser.contexts()[0];
    if (!context) {
      throw new Error("Google Chrome did not open a page.");
    }
  }

  try {
    await waitForDebugger(port, 20_000);
    const ready = await showUrl(startUrl);
    if (!ready) {
      throw new Error("The page stayed on the security check and was not scanned.");
    }
    return session;
  } catch (error) {
    await close();
    throw error;
  }
}

async function findChrome(): Promise<string | undefined> {
  const fromEnv = process.env.CHROME_PATH?.trim();
  const candidates = [
    fromEnv,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable"
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next install path.
    }
  }
  return undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function stopChrome(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process group is already gone.
    }
  }
  child.kill("SIGKILL");
}

async function waitForDebugger(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error("Google Chrome did not open a debugging port.");
}

interface DebugPage {
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function waitForRealTitle(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < deadline) {
    const page = await debugPage(port);
    if (page && isRealTitle(page.title ?? "")) {
      stable += 1;
      if (stable >= 2) {
        return true;
      }
    } else {
      stable = 0;
    }
    await sleep(500);
  }
  return false;
}

async function debugPage(port: number): Promise<DebugPage | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) {
      return undefined;
    }
    const pages = (await response.json()) as DebugPage[];
    return pages.find((item) => item.type === "page");
  } catch {
    return undefined;
  }
}

function isRealTitle(title: string): boolean {
  const text = title.trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (
    text.includes("just a moment") ||
    text.includes("security verification") ||
    text.includes("verify you are human") ||
    text.includes("performing security")
  ) {
    return false;
  }
  return !/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(text);
}

function sameUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const pathA = a.pathname.replace(/\/+$/, "") || "/";
    const pathB = b.pathname.replace(/\/+$/, "") || "/";
    return a.origin === b.origin && pathA === pathB;
  } catch {
    return false;
  }
}

async function rawNavigate(port: number, url: string): Promise<void> {
  const page = await debugPage(port);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Google Chrome has no page to open.");
  }
  const SocketCtor = (globalThis as { WebSocket?: new (url: string) => ChromeSocket }).WebSocket;
  if (!SocketCtor) {
    throw new Error("This Node version cannot open a Chrome debugging socket.");
  }
  const socket = new SocketCtor(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve();
    };
    const fail = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(new Error("Could not navigate in Google Chrome."));
    };
    const timer = setTimeout(finish, 20_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Page.enable" }));
      socket.send(JSON.stringify({ id: 2, method: "Page.navigate", params: { url } }));
    });
    socket.addEventListener("message", (event) => {
      const data = event.data;
      const payload = typeof data === "string" ? data : "";
      if (payload.includes("loadEventFired") || payload.includes("frameStoppedLoading")) {
        finish();
      }
    });
    socket.addEventListener("error", fail);
  });
}

interface ChromeSocket {
  addEventListener(type: "open" | "message" | "error", listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
