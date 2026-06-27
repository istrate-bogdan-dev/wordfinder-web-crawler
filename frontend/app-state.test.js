const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

assert.match(
  appSource,
  /function setRunningState\(isRunning\) \{[\s\S]*?els\.startBtn\.disabled = isRunning;[\s\S]*?els\.stopBtn\.disabled = !isRunning;[\s\S]*?isRunning \? "Scanning.*?" : "Start scan"/,
  "setRunning should disable Start and enable Stop while a scan is running"
);

assert.match(
  appSource,
  /const reducedMotionQuery = window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\);[\s\S]*?if \(!reducedMotionQuery\?\.matches\) \{[\s\S]*?this\._physicsStep\(\);/,
  "graph physics should pause when the user prefers reduced motion"
);

assert.match(
  appSource,
  /function resetUI\(\) \{[\s\S]*?els\.statPages\.textContent = "0";[\s\S]*?els\.resultsList\.innerHTML = "";[\s\S]*?latestDepthStats = \[\];/,
  "resetUI should clear previous scan counters, results, and roadmap state"
);

assert.match(
  appSource,
  /if \(type === "page_done"\) \{[\s\S]*?addFeedItem\(payload\);[\s\S]*?if \(payload\.match_count > 0\) \{[\s\S]*?addResultCard\(payload\);/,
  "page_done events should update the feed and add a result card only when matches exist"
);

assert.match(
  appSource,
  /else if \(type === "done"\) \{[\s\S]*?setRunningState\(false\);[\s\S]*?Scan complete/,
  "done events should stop the running state and show completion feedback"
);

assert.match(
  appSource,
  /else if \(type === "error"\) \{[\s\S]*?setRunningState\(false\);[\s\S]*?els\.statusHint\.style\.color = "var\(--error\)";/,
  "error events should stop the running state and show error feedback"
);

assert.match(
  appSource,
  /function normalizeStartUrlInput\(\) \{[\s\S]*?https:\/\/\$\{value\}[\s\S]*?setCustomValidity\(""\)[\s\S]*?parsed\.protocol !== "http:" && parsed\.protocol !== "https:"[\s\S]*?els\.startUrl\.checkValidity\(\)[\s\S]*?els\.startUrl\.reportValidity\(\);/,
  "start URL validation should prepend https://, require http(s), and use native URL validation"
);

assert.match(
  appSource,
  /function exportResultsAsJson\(\) \{[\s\S]*?JSON\.stringify\(resultRows, null, 2\)[\s\S]*?function exportResultsAsCsv\(\) \{[\s\S]*?wordfinder-results\.csv/,
  "results should be exportable as JSON and CSV"
);

assert.match(
  appSource,
  /function csvCell\(value\) \{[\s\S]*?\^\[=\+\\-@\][\s\S]*?safeText\.replace/,
  "CSV export should neutralize formula-like cells before writing them"
);

assert.match(
  appSource,
  /els\.exportCsvBtn\.addEventListener\("click", exportResultsAsCsv\);[\s\S]*?els\.exportJsonBtn\.addEventListener\("click", exportResultsAsJson\);/,
  "export buttons should be wired to the export handlers"
);

console.log("app state tests passed");
