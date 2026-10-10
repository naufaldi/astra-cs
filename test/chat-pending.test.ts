import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Listener = (event: { key?: string; shiftKey?: boolean; preventDefault: () => void }) => void;

type Fake = {
  tagName: string;
  className: string;
  textContent: string;
  disabled: boolean;
  value: string;
  children: Fake[];
  parent: Fake | null;
  attrs: Record<string, string>;
  listeners: Record<string, Listener>;
  focused: boolean;
  dateTime: string;
  setAttribute: (name: string, value: string) => void;
  append: (...nodes: Fake[]) => void;
  addEventListener: (type: string, fn: Listener) => void;
  remove: () => void;
  scrollIntoView: () => void;
  focus: () => void;
  requestSubmit?: () => void;
};

type ChatGate = {
  resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  reject: (error: unknown) => void;
};

function createElement(tag: string): Fake {
  const element: Fake = {
    tagName: tag,
    className: "",
    textContent: "",
    disabled: false,
    value: "",
    children: [],
    parent: null,
    attrs: {},
    listeners: {},
    focused: false,
    dateTime: "",
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    remove() {
      const siblings = this.parent?.children;
      if (!siblings) {
        return;
      }
      const index = siblings.indexOf(this);
      if (index >= 0) {
        siblings.splice(index, 1);
      }
      this.parent = null;
    },
    scrollIntoView() {},
    focus() {
      this.focused = true;
    },
  };
  return element;
}

function boot() {
  const elements = new Map<string, Fake>();
  for (const [selector, tag] of [
    ["#transcript", "ol"],
    ["#composer", "form"],
    ["#pesan", "textarea"],
    ["#brand", "p"],
    ["#send", "button"],
  ] as const) {
    elements.set(selector, createElement(tag));
  }
  const form = elements.get("#composer");
  const field = elements.get("#pesan");
  const send = elements.get("#send");
  const transcript = elements.get("#transcript");
  if (!form || !field || !send || !transcript) {
    throw new Error("missing chat controls");
  }
  form.requestSubmit = () => {
    form.listeners.submit?.({ preventDefault() {} });
  };
  const calls: { url: string; body: string }[] = [];
  let chat: ChatGate | null = null;
  const store = new Map<string, string>();
  const context = vm.createContext({
    document: {
      querySelector: (selector: string) => elements.get(selector) ?? null,
      createElement,
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    location: { search: "" },
    fetch: (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).startsWith("/brand")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: "Demo" }) });
      }
      return new Promise((resolve, reject) => {
        chat = { resolve, reject };
      });
    },
    URLSearchParams,
    Intl,
  });
  vm.runInContext(readFileSync(new URL("../web/draft.js", import.meta.url), "utf8"), context);
  return {
    form,
    field,
    send,
    transcript,
    calls,
    gate: () => chat,
  };
}

function bubbleText(item: Fake): string {
  return item.children.map((child) => child.textContent).join(" ");
}

function typingBubbles(transcript: Fake): Fake[] {
  return transcript.children.filter((item) => item.className.split(/\s+/).includes("typing"));
}

async function settle(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    await Promise.resolve();
  }
}

const answer = {
  ok: true,
  status: 200,
  json: async () => ({
    reply: "Harga Cabai Rawit di Jawa Timur adalah Rp51.250 per kg.",
    draft: {
      commodity: "Cabai Rawit",
      provinces: ["Jawa Timur"],
      tradingDate: "2026-10-08",
      facts: [],
      claimedPrice: null,
    },
    outcome: "answered",
    choices: [{ message: { content: "Harga Cabai Rawit di Jawa Timur adalah Rp51.250 per kg." } }],
  }),
};

describe("chat waits with a typing bubble", () => {
  it("styles the typing dots", () => {
    const css = readFileSync(new URL("../web/chat.css", import.meta.url), "utf8");
    expect(css).toContain(".typing-dots");
    expect(css).toContain("@keyframes typing-blink");
  });

  it("disables send and submit until /chat answers, then removes the bubble", async () => {
    const page = boot();
    await settle();
    page.field.value = "harga cabai di jawa timur?";
    page.form.requestSubmit?.();
    expect(page.send.disabled).toBe(true);
    expect(page.field.disabled).toBe(true);
    expect(typingBubbles(page.transcript)).toHaveLength(1);
    expect(typingBubbles(page.transcript)[0]?.attrs["aria-label"]).toBe("Sedang mengetik");
    expect(typingBubbles(page.transcript)[0]?.children[0]?.children).toHaveLength(3);
    const visitors = () => page.transcript.children.filter((item) => item.className.includes("visitor"));
    expect(visitors()).toHaveLength(1);
    page.field.value = "cabai rawit?";
    page.form.requestSubmit?.();
    page.field.listeners.keydown?.({ key: "Enter", shiftKey: false, preventDefault() {} });
    expect(visitors()).toHaveLength(1);
    expect(page.calls.filter((call) => !call.url.startsWith("/brand"))).toHaveLength(1);
    expect(page.calls.find((call) => !call.url.startsWith("/brand"))?.body).toContain("harga cabai di jawa timur?");

    page.gate()?.resolve(answer);
    await settle();
    expect(typingBubbles(page.transcript)).toHaveLength(0);
    expect(page.transcript.children.some((item) => bubbleText(item).includes("Rp51.250"))).toBe(true);
    expect(page.send.disabled).toBe(false);
    expect(page.field.disabled).toBe(false);
    expect(page.field.focused).toBe(true);
  });

  it("clears the typing bubble and re-enables submit when the request fails", async () => {
    const page = boot();
    await settle();
    page.field.value = "cabai?";
    page.form.requestSubmit?.();
    expect(page.send.disabled).toBe(true);
    expect(page.field.disabled).toBe(true);
    page.gate()?.reject(new Error("offline"));
    await settle();
    expect(typingBubbles(page.transcript)).toHaveLength(0);
    expect(page.transcript.children.some((item) => bubbleText(item).includes("Maaf, terjadi gangguan."))).toBe(true);
    expect(page.send.disabled).toBe(false);
    expect(page.field.disabled).toBe(false);
  });
});
