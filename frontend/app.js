/* ============================================================
   WordFinder — app.js
   Handles: the WebSocket connection, live dashboard updates,
   and the animated crawl graph (the page's signature element).
   ============================================================ */

(() => {
  "use strict";

  // ---------- DOM references ----------
  const els = {
    startUrl: document.getElementById("startUrl"),
    keyword: document.getElementById("keyword"),
    accessToken: document.getElementById("accessToken"),
    advancedToggle: document.getElementById("advancedToggle"),
    advancedPanel: document.getElementById("advancedPanel"),
    advancedSummary: document.getElementById("advancedSummary"),
    maxDepth: document.getElementById("maxDepth"),
    maxPages: document.getElementById("maxPages"),
    maxConcurrency: document.getElementById("maxConcurrency"),
    matchMode: document.getElementById("matchMode"),
    searchScope: document.getElementById("searchScope"),
    includeVariants: document.getElementById("includeVariants"),
    matchingDecisionSummary: document.getElementById("matchingDecisionSummary"),
    caseSensitive: document.getElementById("caseSensitive"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    statusHint: document.getElementById("statusHint"),
    statPages: document.getElementById("statPages"),
    statMatches: document.getElementById("statMatches"),
    statPagesWithMatch: document.getElementById("statPagesWithMatch"),
    statSpeed: document.getElementById("statSpeed"),
    progressFill: document.getElementById("progressFill"),
    progressCaption: document.getElementById("progressCaption"),
    feed: document.getElementById("feed"),
    resultsPanel: document.getElementById("resultsPanel"),
    resultsList: document.getElementById("resultsList"),
    canvas: document.getElementById("crawlGraph"),
    graphTooltip: document.getElementById("graphTooltip"),
    graphFitView: document.getElementById("graphFitView"),
    graphResetView: document.getElementById("graphResetView"),
    graphPlaceholder: document.getElementById("graphPlaceholder"),
    graphTextSummary: document.getElementById("graphTextSummary"),
    statsDetailsToggle: document.getElementById("statsDetailsToggle"),
    statsDetails: document.getElementById("statsDetails"),
    roadmapList: document.getElementById("roadmapList"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    configureScanInfoText: document.getElementById("configureScanInfoText"),
    liveCrawlMapInfoText: document.getElementById("liveCrawlMapInfoText"),
    liveStatsInfoText: document.getElementById("liveStatsInfoText"),
    scanFeedInfoText: document.getElementById("scanFeedInfoText"),
    resultsInfoText: document.getElementById("resultsInfoText"),
  };

  let ws = null;
  let pagesWithMatch = 0;
  let totalElapsed = 0;
  let totalTimed = 0;
  let maxDepthConfigured = 2;
  let maxPagesConfigured = 60;
  let maxConcurrencyConfigured = 8;
  let latestDepthStats = [];
  let resultRows = [];
  const numberControls = window.WordFinderNumberControls;
  const graphUtils = window.WordFinderGraphUtils;
  const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  // ============================================================
  // Crawl graph — animated canvas (the page's signature element)
  // Each page becomes a node; parent→child relationships become
  // lines. Nodes pulse when added, and change color based on
  // status. Layout: simple radial force simulation, good enough
  // for a few dozen-hundred nodes, no external libraries.
  // ============================================================
  class CrawlGraph {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.tooltip = options.tooltip;
      this.fitButton = options.fitButton;
      this.resetButton = options.resetButton;
      this.onOpenResult = options.onOpenResult;
      this.nodes = new Map(); // url -> node
      this.edges = [];
      this.animFrame = null;
      this.transform = { x: 0, y: 0, scale: 1 };
      this.hoveredNode = null;
      this.selectedUrl = null;
      this.connectedSelection = new Set();
      this.draggingNode = null;
      this.isPanning = false;
      this.pointerStart = null;
      this.lastPointer = null;
      this._resize();
      window.addEventListener("resize", () => this._resize());
      this._bindEvents();
      this._loop();
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.width = rect.width;
      this.height = rect.height;
    }

    reset() {
      this.nodes.clear();
      this.edges = [];
      this.selectedUrl = null;
      this.connectedSelection.clear();
      this.hoveredNode = null;
      this.draggingNode = null;
      this.isPanning = false;
      this.transform = { x: 0, y: 0, scale: 1 };
      this._hideTooltip();
    }

    addNode(url, depth, parentUrl, status, meta = {}) {
      if (this.nodes.has(url)) {
        const n = this.nodes.get(url);
        n.status = status;
        n.title = meta.title || n.title;
        n.matchCount = meta.match_count ?? n.matchCount;
        n.linksFound = meta.links_found ?? n.linksFound;
        n.elapsedMs = meta.elapsed_ms ?? n.elapsedMs;
        n.pulse = 1;
        return;
      }

      const siblingCount = this.edges.filter(edge => edge.from === parentUrl).length;
      const angle = parentUrl
        ? (siblingCount * 0.72) + (Math.random() - 0.5) * 0.35
        : Math.random() * Math.PI * 2;
      const distance = 78 + depth * 12;
      let x, y;

      if (parentUrl && this.nodes.has(parentUrl)) {
        const p = this.nodes.get(parentUrl);
        x = p.x + Math.cos(angle) * distance;
        y = p.y + Math.sin(angle) * distance;
      } else {
        x = this.width / 2;
        y = this.height / 2;
      }

      const node = {
        url,
        depth,
        status: status || "pending",
        title: meta.title || "",
        matchCount: meta.match_count || 0,
        linksFound: meta.links_found,
        elapsedMs: meta.elapsed_ms,
        x,
        y,
        pulse: 1,
        vx: 0,
        vy: 0,
      };
      this.nodes.set(url, node);

      if (parentUrl && this.nodes.has(parentUrl)) {
        this.edges.push({ from: parentUrl, to: url });
      }
    }

    setStatus(url, status) {
      const n = this.nodes.get(url);
      if (n) { n.status = status; n.pulse = 1; }
    }

    selectNode(url) {
      if (this.selectedUrl === url) {
        this.selectedUrl = null;
        this.connectedSelection.clear();
        this._hideTooltip();
        return;
      }
      this.selectedUrl = url;
      this.connectedSelection = graphUtils.connectedUrls(url, this.edges);
      const node = this.nodes.get(url);
      if (node) node.pulse = 1;
    }

    resetView() {
      this.transform = { x: 0, y: 0, scale: 1 };
      this.selectedUrl = null;
      this.connectedSelection.clear();
    }

    fitToGraph() {
      const nodes = Array.from(this.nodes.values());
      if (!nodes.length) {
        this.resetView();
        return;
      }
      const padding = 70;
      const minX = Math.min(...nodes.map(n => n.x));
      const maxX = Math.max(...nodes.map(n => n.x));
      const minY = Math.min(...nodes.map(n => n.y));
      const maxY = Math.max(...nodes.map(n => n.y));
      const graphWidth = Math.max(1, maxX - minX);
      const graphHeight = Math.max(1, maxY - minY);
      const scale = clamp(
        Math.min(this.width / (graphWidth + padding), this.height / (graphHeight + padding)),
        0.45,
        2.4
      );
      this.transform.scale = scale;
      this.transform.x = (this.width - (minX + maxX) * scale) / 2;
      this.transform.y = (this.height - (minY + maxY) * scale) / 2;
    }

    _bindEvents() {
      this.canvas.addEventListener("pointerdown", (event) => this._onPointerDown(event));
      this.canvas.addEventListener("pointermove", (event) => this._onPointerMove(event));
      this.canvas.addEventListener("pointerup", (event) => this._onPointerUp(event));
      this.canvas.addEventListener("pointercancel", (event) => this._onPointerUp(event));
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.draggingNode && !this.isPanning && !this.selectedUrl) {
          this.hoveredNode = null;
          this._hideTooltip();
        }
      });
      this.canvas.addEventListener("wheel", (event) => this._onWheel(event), { passive: false });
      this.canvas.addEventListener("dblclick", () => this.fitToGraph());
      this.fitButton?.addEventListener("click", () => this.fitToGraph());
      this.resetButton?.addEventListener("click", () => this.resetView());
      this.tooltip?.addEventListener("click", (event) => this._onTooltipClick(event));
    }

    _screenPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    _worldPoint(event) {
      const point = this._screenPoint(event);
      return graphUtils.screenToWorld(point.x, point.y, this.transform);
    }

    _hitTest(event) {
      const point = this._worldPoint(event);
      return graphUtils.hitTestNode(this._nodeListWithRadius(), point.x, point.y);
    }

    _onPointerDown(event) {
      const point = this._screenPoint(event);
      const node = this._hitTest(event);
      this.pointerStart = { ...point, node };
      this.lastPointer = point;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add("is-dragging");

      if (node) {
        this.draggingNode = this.nodes.get(node.url);
        this.draggingNode.vx = 0;
        this.draggingNode.vy = 0;
      } else {
        this.isPanning = true;
      }
    }

    _onPointerMove(event) {
      const point = this._screenPoint(event);

      if (this.draggingNode) {
        const world = graphUtils.screenToWorld(point.x, point.y, this.transform);
        this.draggingNode.x = world.x;
        this.draggingNode.y = world.y;
        this.draggingNode.vx = 0;
        this.draggingNode.vy = 0;
      } else if (this.isPanning && this.lastPointer) {
        this.transform.x += point.x - this.lastPointer.x;
        this.transform.y += point.y - this.lastPointer.y;
      } else {
        const nextHoveredNode = this._hitTest(event);
        if (nextHoveredNode) {
          this.hoveredNode = nextHoveredNode;
          this._updateTooltip(point);
        } else if (!this.selectedUrl) {
          this.hoveredNode = null;
          this._hideTooltip();
        }
      }

      this.lastPointer = point;
    }

    _onPointerUp(event) {
      const point = this._screenPoint(event);
      const moved = this.pointerStart
        ? Math.hypot(point.x - this.pointerStart.x, point.y - this.pointerStart.y)
        : 0;

      if (this.pointerStart?.node && moved < 5) {
        this.selectNode(this.pointerStart.node.url);
        this.hoveredNode = this.nodes.get(this.pointerStart.node.url);
        this._updateTooltip(point);
      }

      this.draggingNode = null;
      this.isPanning = false;
      this.pointerStart = null;
      this.lastPointer = null;
      this.canvas.classList.remove("is-dragging");
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    }

    _onWheel(event) {
      event.preventDefault();
      const point = this._screenPoint(event);
      const before = graphUtils.screenToWorld(point.x, point.y, this.transform);
      const factor = event.deltaY < 0 ? 1.12 : 0.88;
      const nextScale = clamp(this.transform.scale * factor, 0.35, 3.2);
      this.transform.scale = nextScale;
      this.transform.x = point.x - before.x * nextScale;
      this.transform.y = point.y - before.y * nextScale;
    }

    _colorFor(status) {
      return graphUtils.statusPresentation(status).color;
    }

    _nodeRadius(node) {
      const matchBoost = Math.min(8, Math.sqrt(node.matchCount || 0) * 1.8);
      return (node.depth === 0 ? 7.5 : 5.2) + matchBoost;
    }

    _nodeListWithRadius() {
      return Array.from(this.nodes.values()).map(node => ({
        ...node,
        r: this._nodeRadius(node) + 5,
      }));
    }

    _loop() {
      if (!reducedMotionQuery?.matches) {
        this._physicsStep();
      }
      this._draw();
      this.animFrame = requestAnimationFrame(() => this._loop());
    }

    _physicsStep() {
      const nodeArr = Array.from(this.nodes.values());
      const cx = this.width / 2, cy = this.height / 2;

      for (const e of this.edges) {
        const a = this.nodes.get(e.from);
        const b = this.nodes.get(e.to);
        if (!a || !b || a === this.draggingNode || b === this.draggingNode) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const target = 70 + Math.max(a.depth, b.depth) * 10;
        const force = (dist - target) * 0.012;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const n of nodeArr) {
        if (n === this.draggingNode) continue;
        n.vx += (cx - n.x) * 0.0009;
        n.vy += (cy - n.y) * 0.0009;
      }

      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const a = nodeArr[i], b = nodeArr[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const distSq = Math.max(1, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const repel = Math.min(0.16, 190 / distSq);
          const collision = Math.max(0, (this._nodeRadius(a) + this._nodeRadius(b) + 16 - dist) * 0.018);
          const force = repel + collision;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          if (a !== this.draggingNode) { a.vx -= fx; a.vy -= fy; }
          if (b !== this.draggingNode) { b.vx += fx; b.vy += fy; }
        }
      }

      for (const n of nodeArr) {
        if (n === this.draggingNode) continue;
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx; n.y += n.vy;
        if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - 0.04);
      }
    }

    _draw() {
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      this._drawGrid(ctx);

      ctx.save();
      ctx.translate(this.transform.x, this.transform.y);
      ctx.scale(this.transform.scale, this.transform.scale);

      for (const e of this.edges) {
        const a = this.nodes.get(e.from);
        const b = this.nodes.get(e.to);
        if (!a || !b) continue;
        const selectedEdge = graphUtils.edgeTouchesUrl(e, this.selectedUrl);
        const selectedContext = this.selectedUrl && this.connectedSelection.has(a.url) && this.connectedSelection.has(b.url);
        const edgeAlpha = selectedEdge ? 1 : selectedContext ? 0.42 : this._nodeAlpha(a) * this._nodeAlpha(b);

        if (selectedEdge) {
          ctx.globalAlpha = 0.42;
          ctx.strokeStyle = "rgba(75, 224, 162, 0.95)";
          ctx.lineWidth = 10 / this.transform.scale;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        ctx.strokeStyle = selectedEdge
          ? "rgba(92, 255, 181, 1)"
          : selectedContext
            ? "rgba(75, 224, 162, 0.42)"
            : "rgba(167, 178, 195, 0.24)";
        ctx.lineWidth = selectedEdge ? 4.4 / this.transform.scale : 1 / this.transform.scale;
        ctx.globalAlpha = edgeAlpha;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of this.nodes.values()) {
        const baseR = this._nodeRadius(n);
        const r = baseR + n.pulse * 5;
        const color = this._colorFor(n.status);
        const alpha = this._nodeAlpha(n);
        ctx.globalAlpha = alpha;

        if (n.pulse > 0) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + n.pulse * 6, 0, Math.PI * 2);
          ctx.fillStyle = this._rgba(color, 0.15 * n.pulse);
          ctx.fill();
        }

        if (this.selectedUrl === n.url || this.hoveredNode?.url === n.url) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, baseR + 6, 0, Math.PI * 2);
          ctx.strokeStyle = this.selectedUrl === n.url ? "#F2F5F7" : "rgba(75, 224, 162, 0.72)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, baseR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (n.depth === 0) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#F2F5F7";
          ctx.stroke();
        }

        if ((this.hoveredNode?.url === n.url || this.selectedUrl === n.url) && this.transform.scale > 0.65) {
          ctx.font = "11px Inter, sans-serif";
          ctx.fillStyle = "#F2F5F7";
          ctx.globalAlpha = Math.min(1, alpha + 0.25);
          ctx.fillText(this._labelFor(n), n.x + baseR + 7, n.y + 4);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    _drawGrid(ctx) {
      const gap = 34 * this.transform.scale;
      if (gap < 14) return;
      const offsetX = this.transform.x % gap;
      const offsetY = this.transform.y % gap;
      ctx.strokeStyle = "rgba(167, 178, 195, 0.055)";
      ctx.lineWidth = 1;
      for (let x = offsetX; x < this.width; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
        ctx.stroke();
      }
      for (let y = offsetY; y < this.height; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y);
        ctx.stroke();
      }
    }

    _updateTooltip(point) {
      if (!this.tooltip || !this.hoveredNode) {
        this._hideTooltip();
        return;
      }
      const node = this.hoveredNode;
      const isSelected = this.selectedUrl === node.url;
      const title = node.title || shortenUrl(node.url);
      const statusLabel = graphUtils.statusPresentation(node.status).label;
      this.tooltip.innerHTML = `
        <div class="graph-tooltip-title">${escapeHtml(title)}</div>
        <div class="graph-tooltip-url">${escapeHtml(shortenUrl(node.url))}</div>
        <div class="graph-tooltip-meta">
          <span>depth ${node.depth}</span>
          <span>${statusLabel}</span>
          <span>${node.matchCount || 0} matches</span>
          ${Number.isFinite(node.linksFound) ? `<span>${node.linksFound} links</span>` : ""}
        </div>
        ${isSelected && node.matchCount > 0 ? '<button type="button" class="graph-tooltip-action" data-graph-action="open-result">View result</button>' : ""}
      `;
      this.tooltip.dataset.url = node.url;
      this.tooltip.classList.toggle("is-actionable", isSelected && node.matchCount > 0);
      this.tooltip.style.left = "0px";
      this.tooltip.style.top = "0px";
      this.tooltip.style.visibility = "hidden";
      this.tooltip.hidden = false;

      const canvasRect = this.canvas.getBoundingClientRect();
      const tooltipRect = this.tooltip.getBoundingClientRect();
      const position = graphUtils.clampTooltipPosition(
        point,
        { width: canvasRect.width, height: canvasRect.height },
        { width: tooltipRect.width, height: tooltipRect.height },
        { offset: 12, margin: 10 }
      );
      this.tooltip.style.left = `${position.x}px`;
      this.tooltip.style.top = `${position.y}px`;
      this.tooltip.style.visibility = "";
    }

    _onTooltipClick(event) {
      const actionElement = event.target.closest("[data-graph-action]");
      const source = actionElement ? "tooltip-action" : "tooltip";
      if (graphUtils.graphResultAction(source) !== "open-result") return;
      const url = this.tooltip?.dataset.url;
      if (url && this.onOpenResult) this.onOpenResult(url);
    }

    _hideTooltip() {
      if (this.tooltip) {
        this.tooltip.hidden = true;
        this.tooltip.classList.remove("is-actionable");
        this.tooltip.style.visibility = "";
        delete this.tooltip.dataset.url;
      }
    }

    _nodeAlpha(node) {
      if (!this.selectedUrl) return 1;
      return this.connectedSelection.has(node.url) ? 1 : 0.22;
    }

    _labelFor(node) {
      const title = node.title || shortenUrl(node.url);
      return title.length > 34 ? `${title.slice(0, 31)}...` : title;
    }

    _rgba(hex, alpha) {
      const colors = {
        "#4BE0A2": "75, 224, 162",
        "#6FA8FF": "111, 168, 255",
        "#FF6B5E": "255, 107, 94",
        "#4F5E75": "79, 94, 117",
        "#A7B2C3": "167, 178, 195",
      };
      return `rgba(${colors[hex] || "167, 178, 195"}, ${alpha})`;
    }

    destroy() {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  const graph = new CrawlGraph(els.canvas, {
    tooltip: els.graphTooltip,
    fitButton: els.graphFitView,
    resetButton: els.graphResetView,
    onOpenResult: focusResultByUrl,
  });

  // ============================================================
  // Application logic
  // ============================================================

  function inputBounds(input) {
    return {
      min: Number(input.min),
      max: Number(input.max),
      fallback: Number(input.defaultValue),
    };
  }

  function readBoundedNumber(input) {
    const { min, max, fallback } = inputBounds(input);
    const value = numberControls.clampNumber(
      numberControls.toFiniteNumber(input.value, fallback),
      min,
      max
    );
    input.value = String(value);
    return value;
  }

  function updateAdvancedSummary() {
    const depth = readBoundedNumber(els.maxDepth);
    const pages = readBoundedNumber(els.maxPages);
    const concurrency = readBoundedNumber(els.maxConcurrency);
    els.advancedSummary.textContent = `Depth ${depth} · ${pages} pages · ${concurrency} at once`;
  }

  function readMatchingOptions() {
    const matchMode = els.matchMode.value;
    return {
      matchMode,
      searchScope: els.searchScope.value,
      includeVariants: els.includeVariants.checked && matchMode === "exact_word",
      caseSensitive: els.caseSensitive.checked,
    };
  }

  function updateMatchingDecisionSummary() {
    const variantsAvailable = els.matchMode.value === "exact_word";
    els.includeVariants.disabled = !variantsAvailable;
    if (!variantsAvailable) els.includeVariants.checked = false;
    els.matchingDecisionSummary.textContent = graphUtils.matchingDecisionSummary(readMatchingOptions());
  }

  function closeInfoPopovers(exceptButton = null) {
    document.querySelectorAll(".info-btn").forEach((button) => {
      if (button === exceptButton) return;
      const panel = document.getElementById(button.dataset.infoTarget);
      button.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
    });
  }

  function setupAdvancedControls() {
    els.advancedToggle.addEventListener("click", () => {
      const willOpen = els.advancedPanel.hidden;
      els.advancedPanel.hidden = !willOpen;
      els.advancedToggle.setAttribute("aria-expanded", String(willOpen));
      if (!willOpen) closeInfoPopovers();
    });

    document.querySelectorAll(".info-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const panel = document.getElementById(button.dataset.infoTarget);
        if (!panel) return;
        const willOpen = panel.hidden;
        closeInfoPopovers(button);
        panel.hidden = !willOpen;
        button.setAttribute("aria-expanded", String(willOpen));
      });
    });

    document.querySelectorAll(".stepper-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.stepTarget);
        if (!input) return;
        const { min, max, fallback } = inputBounds(input);
        input.value = String(numberControls.stepNumberValue(
          input.value,
          Number(button.dataset.step),
          min,
          max,
          fallback
        ));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    [els.maxDepth, els.maxPages, els.maxConcurrency].forEach((input) => {
      input.addEventListener("input", updateAdvancedSummary);
      input.addEventListener("blur", updateAdvancedSummary);
    });

    [els.matchMode, els.searchScope, els.includeVariants, els.caseSensitive].forEach((input) => {
      input.addEventListener("input", updateMatchingDecisionSummary);
      input.addEventListener("change", updateMatchingDecisionSummary);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".number-field")) closeInfoPopovers();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeInfoPopovers();
    });

    updateAdvancedSummary();
    updateMatchingDecisionSummary();
  }

  function renderRoadmapDetails() {
    const rows = graphUtils.roadmapRowsPresentation(latestDepthStats);
    if (!rows.length) {
      els.roadmapList.innerHTML = '<div class="roadmap-empty">Start a scan to see how pages are distributed from the starting page.</div>';
      return;
    }
    els.roadmapList.innerHTML = rows.map(row => `
      <div class="roadmap-row">
        <span class="roadmap-step">
          <span>${escapeHtml(row.label)}</span>
          <span class="inline-info">
            <button type="button" class="inline-info-btn" aria-label="What does ${escapeHtml(row.label)} mean?">i</button>
            <span class="inline-info-popover" role="tooltip">${escapeHtml(graphUtils.roadmapInfoText(row.label))}</span>
          </span>
        </span>
        <span class="roadmap-progress">${escapeHtml(row.progress)}</span>
        <span class="roadmap-remaining">${escapeHtml(row.remaining)}</span>
      </div>
    `).join("");
  }

  function resetUI() {
    els.statPages.textContent = "0";
    els.statMatches.textContent = "0";
    els.statPagesWithMatch.textContent = "0";
    els.statSpeed.textContent = "0ms";
    els.progressFill.style.width = "0%";
    els.progressCaption.textContent = `0 / ${maxPagesConfigured} pages`;
    els.feed.innerHTML = '<div class="feed-empty">Results will appear here as the scan progresses…</div>';
    els.resultsPanel.style.display = "none";
    els.resultsList.innerHTML = "";
    els.exportCsvBtn.disabled = true;
    els.exportJsonBtn.disabled = true;
    graph.reset();
    els.graphPlaceholder.classList.remove("is-hidden");
    pagesWithMatch = 0;
    totalElapsed = 0;
    totalTimed = 0;
    latestDepthStats = [];
    resultRows = [];
    renderRoadmapDetails();
    updateGraphTextSummary();
  }

  function setRunningState(isRunning) {
    els.startBtn.disabled = isRunning;
    els.stopBtn.disabled = !isRunning;
    els.startBtn.querySelector(".btn-label").textContent = isRunning ? "Scanning…" : "Start scan";
  }

  function addFeedItem(payload) {
    const empty = els.feed.querySelector(".feed-empty");
    if (empty) empty.remove();

    const item = document.createElement("div");
    item.className = `feed-item status-${payload.status}`;

    const statusLabel = graphUtils.statusPresentation(payload.status).label;
    const feedHref = graphUtils.feedLinkHref(payload.url);
    const detailsRows = graphUtils.feedDetailsPresentation(payload);
    const detailsHtml = detailsRows.map(row => `
      <span class="feed-detail">
        <span class="feed-detail-label">${escapeHtml(row.label)}</span>
        <span class="feed-detail-value">${escapeHtml(row.value)}</span>
      </span>
    `).join("");
    const moreButton = detailsRows.length
      ? '<button type="button" class="feed-more-btn" aria-expanded="false">More</button>'
      : "";

    item.innerHTML = `
      <span class="feed-depth">d=${payload.depth}</span>
      <a class="feed-url" href="${escapeHtml(feedHref)}" title="${escapeHtml(payload.url)}" target="_blank" rel="noopener">${escapeHtml(shortenUrl(payload.url))}</a>
      <span class="feed-status">${statusLabel}${payload.match_count ? ` (${payload.match_count})` : ""}</span>
      ${moreButton}
      <div class="feed-details" hidden>${detailsHtml}</div>
    `;
    els.feed.appendChild(item);

    // cap the DOM so it doesn't grow unbounded on large crawls
    const items = els.feed.querySelectorAll(".feed-item");
    if (items.length > 200) items[0].remove();
  }

  function addResultCard(payload) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.dataset.resultUrl = payload.url;

    const snippetsHtml = (payload.snippets || [])
      .map(s => `<div class="snippet">${highlightKeyword(escapeHtml(s))}</div>`)
      .join("");

    card.innerHTML = `
      <div class="result-header">
        <div>
          <div class="result-title">${escapeHtml(payload.title || payload.url)}</div>
          <a class="result-link" href="${escapeHtml(payload.url)}" target="_blank" rel="noopener">${escapeHtml(payload.url)}</a>
        </div>
        <div class="result-count">${payload.match_count}×</div>
      </div>
      <div class="result-snippets">${snippetsHtml}</div>
    `;
    els.resultsList.appendChild(card);
    els.resultsPanel.style.display = "block";
  }

  function rememberResult(payload) {
    resultRows.push({
      url: payload.url,
      title: payload.title || "",
      depth: payload.depth,
      status: payload.status,
      match_count: payload.match_count || 0,
      links_found: payload.links_found || 0,
      elapsed_ms: payload.elapsed_ms || 0,
      snippets: payload.snippets || [],
    });
    els.exportCsvBtn.disabled = false;
    els.exportJsonBtn.disabled = false;
  }

  function updateGraphTextSummary() {
    const checked = Number(els.statPages.textContent) || 0;
    const matches = Number(els.statMatches.textContent) || 0;
    const resultCount = resultRows.length;
    const depthSummary = latestDepthStats
      .filter(row => row.found > 0 || row.checked > 0)
      .map(row => `depth ${row.depth}: ${row.checked} of ${row.found} checked`)
      .join("; ");
    const resultPreview = resultRows.slice(0, 5).map(row => row.url).join(", ");
    const previewText = resultPreview ? ` Result pages include: ${resultPreview}.` : "";
    const depthText = depthSummary ? ` Crawl depth summary: ${depthSummary}.` : "";
    els.graphTextSummary.textContent =
      `${checked} pages checked, ${matches} matches found, ${resultCount} pages with results.${depthText}${previewText}`;
  }

  function focusResultByUrl(url) {
    const cards = Array.from(els.resultsList.querySelectorAll(".result-card"));
    cards.forEach(card => card.classList.remove("is-focused"));
    const target = cards.find(card => card.dataset.resultUrl === url);
    if (!target) return;
    target.classList.add("is-focused");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function highlightKeyword(text) {
    const kw = els.keyword.value.trim();
    if (!kw) return text;
    const pattern = graphUtils.keywordHighlightPattern(kw, readMatchingOptions());
    if (!pattern) return text;
    return text.replace(new RegExp(pattern.source, pattern.flags), (m) => `<mark>${m}</mark>`);
  }

  function shortenUrl(url) {
    try {
      const u = new URL(url);
      let path = u.pathname;
      if (path.length > 42) path = path.slice(0, 20) + "…" + path.slice(-18);
      return u.hostname + path;
    } catch {
      return url;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function downloadTextFile(filename, mimeType, content) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }

  function exportResultsAsJson() {
    if (!resultRows.length) return;
    downloadTextFile(
      "wordfinder-results.json",
      "application/json",
      JSON.stringify(resultRows, null, 2)
    );
  }

  function exportResultsAsCsv() {
    if (!resultRows.length) return;
    const columns = ["url", "title", "depth", "match_count", "links_found", "elapsed_ms", "snippets"];
    const rows = [
      columns.join(","),
      ...resultRows.map(row => columns.map(column => csvCell(row[column])).join(",")),
    ];
    downloadTextFile("wordfinder-results.csv", "text/csv", rows.join("\n"));
  }

  function normalizeStartUrlInput() {
    let value = els.startUrl.value.trim();
    if (value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      value = `https://${value}`;
      els.startUrl.value = value;
    }
    els.startUrl.setCustomValidity("");
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        els.startUrl.setCustomValidity("Use an http:// or https:// website address.");
      }
    } catch {
      // Native URL input validation will handle malformed values below.
    }
    if (!els.startUrl.checkValidity()) {
      els.startUrl.reportValidity();
      els.statusHint.textContent = "Enter a valid URL, including a public website address.";
      els.statusHint.style.color = "var(--warn)";
      return null;
    }
    return value;
  }

  function handleEvent(msg) {
    const { type, payload } = msg;

    if (type === "page_done") {
      addFeedItem(payload);
      els.graphPlaceholder.classList.add("is-hidden");
      graph.addNode(payload.url, payload.depth, payload.parent_url, payload.status, payload);
      graph.setStatus(payload.url, payload.status);
      latestDepthStats = payload.depth_stats
        ?? graphUtils.updateDepthStatsFromPage(latestDepthStats, payload, maxDepthConfigured);
      renderRoadmapDetails();

      els.statPages.textContent = payload.pages_done;
      els.statMatches.textContent = payload.matches_total;

      if (payload.match_count > 0) {
        pagesWithMatch += 1;
        els.statPagesWithMatch.textContent = pagesWithMatch;
        rememberResult(payload);
        addResultCard(payload);
      }

      if (Number.isFinite(payload.elapsed_ms)) {
        totalElapsed += payload.elapsed_ms;
        totalTimed += 1;
        els.statSpeed.textContent = `${Math.round(totalElapsed / totalTimed)}ms`;
      }

      const pct = Math.min(100, (payload.pages_done / maxPagesConfigured) * 100);
      els.progressFill.style.width = pct + "%";
      els.progressCaption.textContent = `${payload.pages_done} / ${maxPagesConfigured} pages`;
      updateGraphTextSummary();

    } else if (type === "done") {
      setRunningState(false);
      const reasonLabel = {
        page_limit_reached: "page limit reached",
        queue_exhausted: "no more in-scope pages found",
        stopped: "stopped by user",
      }[payload.finish_reason] || "complete";
      const statusPrefix = payload.finish_reason === "stopped" ? "Scan stopped" : "Scan complete";
      els.statusHint.textContent =
        `${statusPrefix}: ${payload.pages_done} pages checked, ${payload.matches_total} matches found (${reasonLabel}).`;
      els.progressFill.style.width = "100%";
      const pageWord = payload.pages_done === 1 ? "page" : "pages";
      els.progressCaption.textContent = `Complete after ${payload.pages_done} ${pageWord}`;
      latestDepthStats = payload.depth_stats ?? latestDepthStats;
      renderRoadmapDetails();
      updateGraphTextSummary();

    } else if (type === "error") {
      setRunningState(false);
      els.statusHint.textContent = `Error: ${payload.message}`;
      els.statusHint.style.color = "var(--error)";
    }
  }

  function startCrawl() {
    let startUrl = els.startUrl.value.trim();
    const keyword = els.keyword.value.trim();

    if (!startUrl || !keyword) {
      els.statusHint.textContent = "Please fill in both the URL and the keyword.";
      els.statusHint.style.color = "var(--warn)";
      return;
    }
    startUrl = normalizeStartUrlInput();
    if (!startUrl) return;

    maxDepthConfigured = readBoundedNumber(els.maxDepth);
    maxPagesConfigured = readBoundedNumber(els.maxPages);
    maxConcurrencyConfigured = readBoundedNumber(els.maxConcurrency);
    updateAdvancedSummary();
    updateMatchingDecisionSummary();
    resetUI();
    els.statusHint.style.color = "var(--text-faint)";
    els.statusHint.textContent = "Connecting…";
    setRunningState(true);

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const accessToken = els.accessToken.value.trim();
    const crawlPath = accessToken
      ? `/ws/crawl?access_token=${encodeURIComponent(accessToken)}`
      : "/ws/crawl";
    ws = new WebSocket(`${protocol}://${location.host}${crawlPath}`);

    ws.onopen = () => {
      const matchingOptions = readMatchingOptions();
      els.statusHint.textContent = "Scanning…";
      ws.send(JSON.stringify({
        start_url: startUrl,
        keyword: keyword,
        max_depth: maxDepthConfigured,
        max_pages: maxPagesConfigured,
        max_concurrency: maxConcurrencyConfigured,
        whole_word: matchingOptions.matchMode === "exact_word",
        match_mode: matchingOptions.matchMode,
        include_variants: matchingOptions.includeVariants,
        search_scope: matchingOptions.searchScope,
        case_sensitive: matchingOptions.caseSensitive,
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleEvent(msg);
    };

    ws.onerror = () => {
      els.statusHint.textContent = "Connection to the server was interrupted.";
      els.statusHint.style.color = "var(--error)";
      setRunningState(false);
    };

    ws.onclose = (event) => {
      if (event.code === 1008 || event.code === 1013 || event.code === 1006) {
        els.statusHint.textContent = event.reason || "The scan request was rejected or interrupted before it could start.";
        els.statusHint.style.color = "var(--error)";
      }
      setRunningState(false);
    };
  }

  function stopCrawl() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send("stop");
      els.statusHint.textContent = "Stopping the scan…";
    }
  }

  els.startBtn.addEventListener("click", startCrawl);
  els.stopBtn.addEventListener("click", stopCrawl);
  els.exportCsvBtn.addEventListener("click", exportResultsAsCsv);
  els.exportJsonBtn.addEventListener("click", exportResultsAsJson);
  els.configureScanInfoText.textContent = graphUtils.configureScanInfoText();
  els.liveCrawlMapInfoText.textContent = graphUtils.liveCrawlMapInfoText();
  els.liveStatsInfoText.textContent = graphUtils.liveStatsInfoText();
  els.scanFeedInfoText.textContent = graphUtils.scanFeedInfoText();
  els.resultsInfoText.textContent = graphUtils.resultsInfoText();
  els.feed.addEventListener("click", (event) => {
    const button = event.target.closest(".feed-more-btn");
    if (!button) return;
    const item = button.closest(".feed-item");
    const details = item?.querySelector(".feed-details");
    if (!details) return;
    const willOpen = details.hidden;
    details.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    button.textContent = willOpen ? "Less" : "More";
  });
  els.statsDetailsToggle.addEventListener("click", () => {
    const willOpen = els.statsDetails.hidden;
    els.statsDetails.hidden = !willOpen;
    els.statsDetailsToggle.setAttribute("aria-expanded", String(willOpen));
  });
  setupAdvancedControls();
  updateGraphTextSummary();

  // Enter in the keyword field starts the scan
  els.keyword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startCrawl();
  });

})();
