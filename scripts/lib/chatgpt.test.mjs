import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const source = page.match(/async function openChatGPT\([^]*?\n\}/)?.[0];
assert.ok(source, "the page's ChatGPT entry point exists");

test("web login and questions open the same ChatGPT website, with the prompt encoded", async () => {
  const calls = [];
  const context = vm.createContext({ inApp: false, CHATGPT: "https://chatgpt.com/", window: { open: (...args) => calls.push(args) } });
  vm.runInContext(source, context);
  await context.openChatGPT();
  const prompt = "帮我复习 & q=another #题目";
  await context.openChatGPT(prompt);
  assert.deepEqual(calls, [
    ["https://chatgpt.com/", "_blank", "noopener"],
    [`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, "_blank", "noopener"],
  ]);
});

test("Android login and questions use the embedded panel, and a launch failure is reported", async () => {
  const calls = [];
  const messages = [];
  const context = vm.createContext({ inApp: true, document: { documentElement: { dataset: { theme: "light" } } }, toast: (message) => messages.push(message), window: { Capacitor: {
    nativePromise: async (plugin, method, options) => {
      calls.push([plugin, method, options.prompt, options.theme]);
      if (options.prompt === "fail") throw new Error("Panel unavailable");
    },
  } } });
  vm.runInContext(source, context);
  assert.equal(await context.openChatGPT(), true);
  assert.equal(await context.openChatGPT("你好"), true);
  assert.equal(await context.openChatGPT("fail"), false);
  assert.deepEqual(calls, [["ChatGPTPanel", "open", "", "light"], ["ChatGPTPanel", "open", "你好", "light"], ["ChatGPTPanel", "open", "fail", "light"]]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /面板/);
});
