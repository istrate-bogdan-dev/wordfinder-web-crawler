const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

assert.match(
  appSource,
  /els\.feed\.appendChild\(item\);/,
  "scan feed should append each page so rows stay in scan order"
);

assert.doesNotMatch(
  appSource,
  /els\.feed\.scrollTop\s*=\s*els\.feed\.scrollHeight;/,
  "scan feed should not auto-scroll to the newest row after each page"
);

assert.match(
  appSource,
  /els\.resultsList\.appendChild\(card\);/,
  "result cards should append so pages with results stay in scan order"
);

assert.match(
  appSource,
  /new WebSocket\(`\$\{protocol\}:\/\/\$\{location\.host\}\/ws\/crawl`\)/,
  "frontend should connect to the WebSocket without putting the access key in the URL"
);

assert.match(
  appSource,
  /access_token: accessToken,[\s\S]*?start_url: startUrl,/,
  "frontend should pass the optional access key in the first WebSocket payload"
);

assert.match(
  appSource,
  /event\.code === 1008 \|\| event\.code === 1013 \|\| event\.code === 1006/,
  "frontend should show rejection messages for unauthorized, overloaded, or pre-handshake failed scans"
);

assert.doesNotMatch(
  appSource,
  /els\.resultsList\.prepend\(card\);/,
  "result cards should not be prepended because that reverses scan order"
);

assert.match(
  cssSource,
  /\.feed\s*\{[\s\S]*?flex-direction:\s*column;/,
  "scan feed should render rows from top to bottom"
);

assert.doesNotMatch(
  cssSource,
  /\.feed\s*\{[\s\S]*?flex-direction:\s*column-reverse;/,
  "scan feed CSS should not visually reverse scan order"
);

console.log("app order tests passed");
