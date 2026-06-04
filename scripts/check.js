"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "index.html",
  "styles.css",
  "game.js",
  "README.md",
  "LICENSE",
  "package.json"
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "game.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

assert.ok(html.includes('rel="stylesheet" href="styles.css"'), "HTML links stylesheet");
assert.ok(html.includes('<script src="game.js"></script>'), "HTML links game script");
assert.ok(html.includes('id="start-button"'), "HTML includes start button");
assert.ok(html.includes('id="challenge-button"'), "HTML includes challenge link button");
assert.ok(html.includes('data-lane-button="0"'), "HTML includes lane controls");
assert.ok(css.includes("@media (max-width: 760px)"), "CSS includes mobile layout");
assert.ok(css.includes(".result-panel[hidden]"), "CSS preserves hidden result state");
assert.ok(js.includes("module.exports = core"), "core functions are testable");
assert.ok(js.includes("resolveChallengeDate"), "game supports challenge date links");
assert.ok(readme.includes("## How to run"), "README includes run section");
assert.ok(readme.includes("## Inspiration"), "README includes inspiration section");
assert.ok(readme.includes("## Why it may be worth a star"), "README includes star value section");
assert.ok(readme.includes("?date=YYYY-MM-DD"), "README documents challenge links");

const combined = [html, css, js, readme].join("\n");
assert.ok(!combined.includes("/Users/"), "no local absolute user paths");
assert.ok(!combined.includes("gho_"), "no GitHub token fragment");
assert.ok(!/\bTODO\b/i.test(combined), "no TODO placeholders");
assert.ok(!/https:\/\/images\.|unsplash|pexels|pixabay/i.test(combined), "no borrowed stock assets");

console.log("project checks passed");
