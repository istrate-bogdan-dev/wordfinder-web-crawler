(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.WordFinderGraphUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const MATCH_MODES = Object.freeze(["exact_word", "partial", "phrase"]);
  const SEARCH_SCOPES = Object.freeze(["visible_text", "visible_plus_metadata", "full_html"]);
  const PAGE_STATUSES = Object.freeze([
    "pending",
    "ok",
    "no_match",
    "skipped_type",
    "error",
    "skipped_robots",
  ]);

  const SEARCH_SCOPE_LABELS = Object.freeze({
    visible_text: "visible text",
    visible_plus_metadata: "visible text plus metadata",
    full_html: "full HTML",
  });

  const MATCH_MODE_LABELS = Object.freeze({
    exact_word: "exact whole-word matches",
    partial: "partial matches",
    phrase: "phrase matches",
  });

  const STATUS_PRESENTATIONS = Object.freeze({
    pending: { label: "not checked yet", color: "#6FA8FF" },
    ok: { label: "match found", color: "#4BE0A2" },
    no_match: { label: "no match", color: "#4F5E75" },
    skipped_type: { label: "skipped type", color: "#4F5E75" },
    error: { label: "error", color: "#FF6B5E" },
    skipped_robots: { label: "blocked by robots.txt", color: "#FF6B5E" },
  });

  function normalizeMatchMode(value) {
    return MATCH_MODES.includes(value) ? value : "exact_word";
  }

  function normalizeSearchScope(value) {
    return SEARCH_SCOPES.includes(value) ? value : "visible_text";
  }

  function screenToWorld(x, y, transform) {
    return {
      x: (x - transform.x) / transform.scale,
      y: (y - transform.y) / transform.scale,
    };
  }

  function hitTestNode(nodes, x, y) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const radius = node.r || 5;
      const dx = x - node.x;
      const dy = y - node.y;
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        return node;
      }
    }
    return null;
  }

  function connectedUrls(url, edges) {
    const urls = new Set([url]);
    for (const edge of edges) {
      if (edge.from === url) urls.add(edge.to);
      if (edge.to === url) urls.add(edge.from);
    }
    return urls;
  }

  function edgeTouchesUrl(edge, url) {
    if (!url) return false;
    return edge.from === url || edge.to === url;
  }

  function graphResultAction(source) {
    return source === "tooltip-action" ? "open-result" : "select-only";
  }

  function feedLinkHref(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
    } catch {
      return "#";
    }
    return "#";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function simpleVariants(word) {
    if (!/^[A-Za-z]+$/.test(word)) return [word];
    const variants = new Set([word]);
    const lower = word.toLowerCase();
    if (lower.endsWith("y") && word.length > 1 && !"aeiou".includes(lower[lower.length - 2])) {
      variants.add(`${word.slice(0, -1)}ies`);
    } else if (
      lower.endsWith("s")
      || lower.endsWith("x")
      || lower.endsWith("z")
      || lower.endsWith("ch")
      || lower.endsWith("sh")
    ) {
      variants.add(`${word}es`);
    } else {
      variants.add(`${word}s`);
    }
    return Array.from(variants).sort((a, b) => b.length - a.length);
  }

  function keywordHighlightPattern(keyword, options = {}) {
    const cleanKeyword = String(keyword || "").trim();
    if (!cleanKeyword) return null;

    const matchMode = normalizeMatchMode(options.matchMode);
    const flags = options.caseSensitive ? "g" : "gi";
    if (matchMode === "phrase") {
      const source = cleanKeyword.split(/\s+/).map(escapeRegExp).join("\\s+");
      return { source: `\\b${source}\\b`, flags };
    }

    const terms = options.includeVariants && matchMode !== "phrase"
      ? simpleVariants(cleanKeyword)
      : [cleanKeyword];
    const alternatives = terms.map(escapeRegExp).join("|");
    if (matchMode === "partial") {
      return { source: `(?:${alternatives})`, flags };
    }
    return { source: `\\b(?:${alternatives})\\b`, flags };
  }

  function matchingDecisionSummary(options = {}) {
    const matchMode = normalizeMatchMode(options.matchMode);
    const scopeLabel = SEARCH_SCOPE_LABELS[normalizeSearchScope(options.searchScope)];
    const caseLabel = options.caseSensitive ? "case-sensitive" : "case-insensitive";
    const modeLabel = MATCH_MODE_LABELS[matchMode];
    const variants = options.includeVariants && matchMode !== "partial"
      ? ", including plurals"
      : "";

    return `Searching ${scopeLabel}, ${caseLabel}, ${modeLabel}${variants}.`;
  }

  function configureScanInfoText() {
    return "Use this panel to choose where the scan starts, what word or phrase to look for, how many pages WordFinder may check, and how strict the match should be.";
  }

  function liveCrawlMapInfoText() {
    return "Shows the pages WordFinder is checking and how they connect. Select a dot to explore nearby pages without leaving the map.";
  }

  function liveStatsInfoText() {
    return "Shows the main scan numbers: how many pages were checked, how many keyword matches were found, and how many pages contain at least one result.";
  }

  function scanFeedInfoText() {
    return "Shows each page as WordFinder checks it, including whether the keyword was found, how many links were discovered, and how long the page took.";
  }

  function resultsInfoText() {
    return "Shows pages where the keyword was found. CSV is for spreadsheet review; JSON is for dashboards, automations, and other tools.";
  }

  function feedDetailsPresentation(payload) {
    const rows = [];
    if (Number.isFinite(payload.links_found)) {
      rows.push({ label: "Possible next pages", value: String(payload.links_found) });
    }
    if (Number.isFinite(payload.elapsed_ms)) {
      rows.push({ label: "Time checked", value: `${payload.elapsed_ms}ms` });
    }
    return rows;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampTooltipPosition(point, container, tooltip, options = {}) {
    const offset = options.offset ?? 12;
    const margin = options.margin ?? 10;
    const maxX = Math.max(margin, container.width - tooltip.width - margin);
    const maxY = Math.max(margin, container.height - tooltip.height - margin);
    return {
      x: clamp(point.x + offset, margin, maxX),
      y: clamp(point.y + offset, margin, maxY),
    };
  }

  function statusPresentation(status) {
    return STATUS_PRESENTATIONS[status] || { label: status, color: "#A7B2C3" };
  }

  function roadmapLabel(depth) {
    if (depth === 0) return "Start page";
    const stepWord = depth === 1 ? "step" : "steps";
    return `${depth} ${stepWord} from start`;
  }

  function roadmapRowsPresentation(rows) {
    return rows.filter(row => (Number.isFinite(row.found) ? row.found : 0) > 0).map((row) => {
      const found = Number.isFinite(row.found) ? row.found : 0;
      const checked = Number.isFinite(row.checked) ? row.checked : 0;
      const remaining = Number.isFinite(row.remaining) ? row.remaining : Math.max(0, found - checked);
      return {
        label: roadmapLabel(row.depth),
        progress: `${checked} of ${found} checked`,
        remaining: remaining > 0 ? `${remaining} still possible` : "All checked",
      };
    });
  }

  function roadmapInfoText(label) {
    if (label === "Start page") {
      return "The first page you entered before starting the scan.";
    }
    if (label === "1 step from start") {
      return "Pages found directly from links on the start page.";
    }
    return "Pages found from links on the previous group of pages.";
  }

  function normalizeDepthStats(rows, maxDepth) {
    const byDepth = new Map();
    for (const row of rows || []) {
      if (!Number.isFinite(row.depth)) continue;
      byDepth.set(row.depth, {
        depth: row.depth,
        found: Number.isFinite(row.found) ? row.found : 0,
        checked: Number.isFinite(row.checked) ? row.checked : 0,
      });
    }

    const normalized = [];
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const row = byDepth.get(depth) || { depth, found: 0, checked: 0 };
      normalized.push({
        depth,
        found: row.found,
        checked: row.checked,
        remaining: Math.max(0, row.found - row.checked),
      });
    }
    return normalized;
  }

  function updateDepthStatsFromPage(rows, payload, maxDepth) {
    const safeMaxDepth = Number.isFinite(maxDepth) ? maxDepth : 0;
    const depth = Number.isFinite(payload.depth) ? payload.depth : 0;
    const linksFound = Number.isFinite(payload.links_enqueued)
      ? payload.links_enqueued
      : (Number.isFinite(payload.links_found) ? payload.links_found : 0);
    const nextRows = normalizeDepthStats(rows, safeMaxDepth);

    if (depth <= safeMaxDepth) {
      const current = nextRows[depth];
      current.found = Math.max(current.found, current.checked + 1);
      current.checked += 1;
      current.remaining = Math.max(0, current.found - current.checked);
    }

    const childDepth = depth + 1;
    if (childDepth <= safeMaxDepth) {
      const child = nextRows[childDepth];
      child.found += linksFound;
      child.remaining = Math.max(0, child.found - child.checked);
    }

    return nextRows;
  }

  return {
    clampTooltipPosition,
    configureScanInfoText,
    connectedUrls,
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
  };
});
