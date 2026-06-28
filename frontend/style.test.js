const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

assert.match(
  css,
  /\.feed-details\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\}/,
  "hidden feed details must stay hidden even though .feed-details uses display:flex"
);

assert.match(
  css,
  /\.advanced-chevron\s*\{[\s\S]*?width:\s*22px;[\s\S]*?height:\s*22px;[\s\S]*?font-size:\s*15px;[\s\S]*?\}/,
  "advanced settings dropdown indicator should stay large enough to read as a control"
);

assert.match(
  css,
  /\.advanced-panel\s+\.field\s*\{[\s\S]*?position:\s*relative;[\s\S]*?\}/,
  "advanced field info popovers must position next to their own labels"
);

assert.match(
  css,
  /\.field-with-info\s*\{[\s\S]*?position:\s*relative;[\s\S]*?\}/,
  "standalone field info popovers must position next to their own labels"
);

assert.match(
  css,
  /\.field-with-info\s+\.info-popover\s*\{[\s\S]*?top:\s*calc\(100% \+ 8px\);[\s\S]*?\}/,
  "standalone field info popovers should not cover their own inputs"
);

assert.match(
  css,
  /input\[type="text"\],[\s\S]*?input\[type="url"\],[\s\S]*?input\[type="password"\],[\s\S]*?input\[type="number"\],[\s\S]*?select\s*\{/,
  "password inputs should share the same visual styling as the other text fields"
);

assert.match(
  css,
  /\.matching-grid\s+\.info-popover\s*\{[\s\S]*?width:\s*240px;[\s\S]*?right:\s*auto;[\s\S]*?\}/,
  "matching control info popovers should be readable while staying anchored to their fields"
);

assert.match(
  css,
  /\.toggle-option\s*\{[\s\S]*?position:\s*relative;[\s\S]*?display:\s*inline-flex;[\s\S]*?\}/,
  "toggle info popovers should anchor next to their option labels"
);

assert.match(
  css,
  /\.toggle-option\s+\.info-popover\s*\{[\s\S]*?width:\s*280px;[\s\S]*?right:\s*auto;[\s\S]*?\}/,
  "toggle explanations should be wide enough for plain-language examples"
);

assert.doesNotMatch(
  css,
  /\.toggle-option:last-child\s+\.info-popover\s*\{/,
  "include plurals popover should use the same left-aligned position as case sensitive"
);

assert.match(
  css,
  /\.sr-only\s*\{[\s\S]*?position:\s*absolute !important;[\s\S]*?clip:\s*rect\(0, 0, 0, 0\) !important;/,
  "screen-reader-only text should remain available to assistive technology"
);

assert.match(
  css,
  /\.export-btn\s*\{[\s\S]*?font-family:\s*var\(--font-display\);[\s\S]*?cursor:\s*pointer;/,
  "export buttons should use compact control styling"
);

assert.match(
  css,
  /\.footer\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?\}/,
  "footer links should remain readable and wrap safely"
);

assert.match(
  css,
  /\.footer\s+a\s*\{[\s\S]*?color:\s*var\(--text-dim\);[\s\S]*?text-decoration:\s*none;[\s\S]*?\}/,
  "footer links should match the existing dark UI"
);

assert.match(
  css,
  /\.terms-layout\s*\{[\s\S]*?max-width:\s*860px;[\s\S]*?padding:\s*32px 40px 80px;[\s\S]*?\}/,
  "terms page should use a constrained reading width"
);

assert.match(
  css,
  /prefers-reduced-motion:\s*reduce[\s\S]*?scroll-behavior:\s*auto !important;/,
  "reduced motion should disable smooth scrolling behavior"
);

console.log("style tests passed");
