const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

assert.doesNotMatch(
  html,
  /\sstyle=/,
  "main page should avoid inline style attributes so the production CSP can stay strict"
);

const advancedPanel = html.match(/<div class="advanced-panel" id="advancedPanel" hidden>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="field-row toggles">/);
assert.ok(advancedPanel, "advanced panel should remain separate from the main toggle row");
assert.doesNotMatch(
  advancedPanel[1],
  /id="includeVariants"/,
  "Include plurals should stay outside Advanced settings"
);
assert.match(
  advancedPanel[1],
  /id="matchMode"[\s\S]*id="searchScope"/,
  "Advanced settings should still contain Match mode and Search scope"
);

assert.match(
  html,
  /<label for="accessToken">Access key<\/label>[\s\S]*data-info-target="accessKeyInfo"[\s\S]*<input[^>]*type="password"[^>]*id="accessToken"/,
  "protected deployments should let users enter an access key with a contextual explanation"
);
assert.match(
  html,
  /id="accessKeyInfo"[\s\S]*live online version[\s\S]*internet[\s\S]*locally/i,
  "access key info should explain that the key is for live deployments and is usually not needed locally"
);

assert.match(
  html,
  /<p class="hint" id="statusHint" aria-live="polite">Ready to scan\.<\/p>/,
  "status hint should announce scan state changes politely to assistive technology"
);

assert.match(
  html,
  /<link rel="icon" type="image\/svg\+xml" href="\/static\/favicon\.svg\?v=wordfinder-logo" \/>/,
  "main page should expose the WordFinder favicon in browser tabs"
);

assert.match(
  html,
  /<canvas[^>]*id="crawlGraph"[^>]*role="img"[^>]*tabindex="0"[^>]*aria-describedby="graphTextSummary"/,
  "canvas graph should have an accessible role, keyboard focus, and a text summary"
);

assert.match(
  html,
  /id="graphTextSummary"[^>]*aria-live="polite"/,
  "graph text summary should be available for screen readers"
);

const toggleRow = html.match(/<div class="field-row toggles">([\s\S]*?)<\/div>\s*<button id="startBtn"/);
assert.ok(toggleRow, "main toggle row should appear before the start button");
assert.match(
  toggleRow[1],
  /id="caseSensitive"[\s\S]*data-info-target="caseSensitiveInfo"[\s\S]*id="includeVariants"[\s\S]*data-info-target="includeVariantsInfo"/,
  "Case sensitive and Include plurals should share the same toggle row with info buttons"
);
assert.match(
  toggleRow[1],
  /simple English plural forms/i,
  "Include plurals info should explain that the rule is limited to simple English plurals"
);

const graphLegend = html.match(/<div class="graph-legend">([\s\S]*?)<\/div>/);
assert.ok(graphLegend, "graph legend should be present");
assert.doesNotMatch(
  graphLegend[1],
  /waiting to scan/i,
  "graph legend should not include waiting to scan"
);
assert.match(
  graphLegend[1],
  /match found[\s\S]*no match[\s\S]*error \/ blocked/,
  "graph legend should keep the meaningful result states"
);

assert.match(
  html,
  /id="exportCsvBtn"[\s\S]*CSV[\s\S]*id="exportJsonBtn"[\s\S]*JSON/,
  "results panel should expose CSV and JSON export buttons"
);
assert.match(
  html,
  /<section class="panel results-panel" id="resultsPanel" hidden>/,
  "results panel should start hidden without relying on inline display:none"
);

assert.match(
  html,
  /<footer class="footer">[\s\S]*linkedin\.com\/in\/bogdan-cosmin-istrate[\s\S]*Copyright \(c\) 2026 Bogdan Istrate[\s\S]*href="\/terms"[\s\S]*Terms/,
  "footer should expose copyright, LinkedIn, and Terms links"
);

console.log("index tests passed");
