const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "terms.html"), "utf8");

assert.match(
  html,
  /<title>Word Finder - Terms<\/title>/,
  "terms page should have a clear title"
);

assert.match(
  html,
  /<link rel="icon" type="image\/svg\+xml" href="\/static\/favicon\.svg\?v=wordfinder-logo" \/>/,
  "terms page should expose the WordFinder favicon in browser tabs"
);

assert.match(
  html,
  /portfolio project[\s\S]*educational proof of concept/i,
  "terms should clearly frame WordFinder as an educational portfolio project"
);

assert.match(
  html,
  /Use WordFinder only on websites that you own, manage, or are authorized\s+to test/i,
  "terms should tell users to scan only authorized websites"
);

assert.match(
  html,
  /No Warranty[\s\S]*provided as-is/i,
  "terms should include a no-warranty statement"
);

assert.match(
  html,
  /MIT License/i,
  "terms should reference the public source license"
);

assert.match(
  html,
  /linkedin\.com\/in\/bogdan-cosmin-istrate/,
  "terms should link to Bogdan Istrate's LinkedIn profile"
);

assert.match(
  html,
  /href="\/"/,
  "terms should link back to the main app"
);

console.log("terms tests passed");
