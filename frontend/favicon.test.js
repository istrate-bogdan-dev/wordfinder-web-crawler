const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const svg = fs.readFileSync(path.join(__dirname, "favicon.svg"), "utf8");

assert.match(
  svg,
  /viewBox="0 0 64 64"/,
  "favicon should use a square scalable viewBox"
);

assert.match(
  svg,
  /fill="#0A0D12"/,
  "favicon should use the WordFinder dark background"
);

assert.match(
  svg,
  /stroke="#32B57F"[\s\S]*stroke="#4BE0A2"[\s\S]*fill="#4BE0A2"/,
  "favicon should use the WordFinder green radar mark"
);

console.log("favicon tests passed");
