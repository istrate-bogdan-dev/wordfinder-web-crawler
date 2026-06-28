(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.WordFinderNumberControls = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  function toFiniteNumber(value, fallback) {
    if (typeof value === "string" && value.trim() === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function stepNumberValue(currentValue, direction, min, max, fallback) {
    const current = toFiniteNumber(currentValue, fallback);
    return clampNumber(current + direction, min, max);
  }

  function stepperRepeatDelay(repeatIndex) {
    return Math.max(70, 350 - repeatIndex * 30);
  }

  return {
    clampNumber,
    stepNumberValue,
    stepperRepeatDelay,
    toFiniteNumber,
  };
});
