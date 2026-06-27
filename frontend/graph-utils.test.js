const assert = require("assert");
const {
  configureScanInfoText,
  connectedUrls,
  clampTooltipPosition,
  edgeTouchesUrl,
  feedDetailsPresentation,
  feedLinkHref,
  graphResultAction,
  hitTestNode,
  keywordHighlightPattern,
  liveCrawlMapInfoText,
  liveStatsInfoText,
  MATCH_MODES,
  matchingDecisionSummary,
  PAGE_STATUSES,
  roadmapInfoText,
  resultsInfoText,
  scanFeedInfoText,
  SEARCH_SCOPES,
  roadmapRowsPresentation,
  screenToWorld,
  statusPresentation,
  updateDepthStatsFromPage,
} = require("./graph-utils.js");

const transform = { x: 40, y: -10, scale: 2 };

assert.deepStrictEqual(screenToWorld(140, 90, transform), { x: 50, y: 50 });
assert.deepStrictEqual(MATCH_MODES, ["exact_word", "partial", "phrase"]);
assert.deepStrictEqual(SEARCH_SCOPES, ["visible_text", "visible_plus_metadata", "full_html"]);
assert.deepStrictEqual(PAGE_STATUSES, [
  "pending",
  "ok",
  "no_match",
  "skipped_type",
  "error",
  "skipped_robots",
]);

const nodes = [
  { url: "root", x: 10, y: 10, r: 7 },
  { url: "child", x: 30, y: 10, r: 5 },
];

assert.strictEqual(hitTestNode(nodes, 30, 10).url, "child");
assert.strictEqual(hitTestNode(nodes, 80, 80), null);

const edges = [
  { from: "root", to: "child" },
  { from: "root", to: "other" },
  { from: "nested", to: "child" },
];

assert.deepStrictEqual(
  Array.from(connectedUrls("child", edges)).sort(),
  ["child", "nested", "root"].sort()
);

assert.strictEqual(edgeTouchesUrl({ from: "root", to: "child" }, "child"), true);
assert.strictEqual(edgeTouchesUrl({ from: "nested", to: "child" }, "child"), true);
assert.strictEqual(edgeTouchesUrl({ from: "root", to: "other" }, "child"), false);
assert.strictEqual(edgeTouchesUrl({ from: "root", to: "other" }, null), false);

assert.strictEqual(graphResultAction("node"), "select-only");
assert.strictEqual(graphResultAction("tooltip-action"), "open-result");
assert.strictEqual(graphResultAction("tooltip"), "select-only");

assert.strictEqual(
  feedLinkHref("https://www.siemens-energy.com/global/en/home.html"),
  "https://www.siemens-energy.com/global/en/home.html"
);
assert.strictEqual(feedLinkHref("not a url"), "#");

assert.strictEqual(
  configureScanInfoText(),
  "Use this panel to choose where the scan starts, what word or phrase to look for, how many pages WordFinder may check, and how strict the match should be."
);
assert.strictEqual(
  liveCrawlMapInfoText(),
  "Shows the pages WordFinder is checking and how they connect. Select a dot to explore nearby pages without leaving the map."
);
assert.strictEqual(
  liveStatsInfoText(),
  "Shows the main scan numbers: how many pages were checked, how many keyword matches were found, and how many pages contain at least one result."
);
assert.strictEqual(
  scanFeedInfoText(),
  "Shows each page as WordFinder checks it, including whether the keyword was found, how many links were discovered, and how long the page took."
);
assert.strictEqual(
  resultsInfoText(),
  "Shows only the pages where WordFinder found the keyword. Each card includes the page, how many times the word appears, and short text examples."
);
assert.deepStrictEqual(
  feedDetailsPresentation({ links_found: 126, elapsed_ms: 234 }),
  [
    { label: "Possible next pages", value: "126" },
    { label: "Time checked", value: "234ms" },
  ]
);
assert.deepStrictEqual(
  feedDetailsPresentation({ links_found: undefined, elapsed_ms: undefined }),
  []
);

assert.deepStrictEqual(
  clampTooltipPosition(
    { x: 760, y: 330 },
    { width: 780, height: 360 },
    { width: 300, height: 126 },
    { offset: 12, margin: 10 }
  ),
  { x: 470, y: 224 }
);

assert.deepStrictEqual(
  clampTooltipPosition(
    { x: 20, y: 18 },
    { width: 780, height: 360 },
    { width: 300, height: 126 },
    { offset: 12, margin: 10 }
  ),
  { x: 32, y: 30 }
);

const pendingStatus = statusPresentation("pending");
const noMatchStatus = statusPresentation("no_match");
assert.strictEqual(pendingStatus.label, "not checked yet");
assert.strictEqual(pendingStatus.color, "#6FA8FF");
assert.notStrictEqual(pendingStatus.color, noMatchStatus.color);

assert.deepStrictEqual(
  roadmapRowsPresentation([
    { depth: 0, found: 1, checked: 1, remaining: 0 },
    { depth: 1, found: 42, checked: 12, remaining: 30 },
    { depth: 2, found: 31, checked: 7, remaining: 24 },
  ]),
  [
    { label: "Start page", progress: "1 of 1 checked", remaining: "All checked" },
    { label: "1 step from start", progress: "12 of 42 checked", remaining: "30 still possible" },
    { label: "2 steps from start", progress: "7 of 31 checked", remaining: "24 still possible" },
  ]
);

assert.strictEqual(
  roadmapInfoText("Start page"),
  "The first page you entered before starting the scan."
);
assert.strictEqual(
  roadmapInfoText("1 step from start"),
  "Pages found directly from links on the start page."
);
assert.strictEqual(
  roadmapInfoText("2 steps from start"),
  "Pages found from links on the previous group of pages."
);

assert.deepStrictEqual(
  keywordHighlightPattern("battery", {
    matchMode: "exact_word",
    includeVariants: true,
    caseSensitive: false,
  }),
  { source: "\\b(?:batteries|battery)\\b", flags: "gi" }
);

assert.deepStrictEqual(
  keywordHighlightPattern("clean energy", {
    matchMode: "phrase",
    includeVariants: false,
    caseSensitive: true,
  }),
  { source: "\\bclean\\s+energy\\b", flags: "g" }
);

assert.deepStrictEqual(
  keywordHighlightPattern("energy", {
    matchMode: "unknown_mode",
    caseSensitive: false,
  }),
  { source: "\\b(?:energy)\\b", flags: "gi" }
);

assert.strictEqual(
  matchingDecisionSummary({
    matchMode: "exact_word",
    includeVariants: true,
    searchScope: "visible_plus_metadata",
    caseSensitive: false,
  }),
  "Searching visible text plus metadata, case-insensitive, exact whole-word matches, including plurals."
);

assert.strictEqual(
  matchingDecisionSummary({
    matchMode: "partial",
    includeVariants: false,
    searchScope: "full_html",
    caseSensitive: true,
  }),
  "Searching full HTML, case-sensitive, partial matches."
);

assert.strictEqual(
  matchingDecisionSummary({
    matchMode: "unknown_mode",
    searchScope: "unknown_scope",
    caseSensitive: false,
  }),
  "Searching visible text, case-insensitive, exact whole-word matches."
);

let localDepthStats = updateDepthStatsFromPage([], { depth: 0, links_found: 7 }, 2);
localDepthStats = updateDepthStatsFromPage(localDepthStats, { depth: 1, links_found: 3 }, 2);
assert.deepStrictEqual(localDepthStats, [
  { depth: 0, found: 1, checked: 1, remaining: 0 },
  { depth: 1, found: 7, checked: 1, remaining: 6 },
  { depth: 2, found: 3, checked: 0, remaining: 3 },
]);

const dedupedFallbackDepthStats = updateDepthStatsFromPage(
  [],
  { depth: 0, links_found: 7, links_enqueued: 3 },
  1
);
assert.deepStrictEqual(dedupedFallbackDepthStats, [
  { depth: 0, found: 1, checked: 1, remaining: 0 },
  { depth: 1, found: 3, checked: 0, remaining: 3 },
]);

console.log("graph utils tests passed");
