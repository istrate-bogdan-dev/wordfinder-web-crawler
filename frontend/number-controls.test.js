const assert = require("assert");
const { stepNumberValue, clampNumber } = require("./number-controls.js");

assert.strictEqual(stepNumberValue("2", 1, 0, 4, 2), 3);
assert.strictEqual(stepNumberValue("4", 1, 0, 4, 2), 4);
assert.strictEqual(stepNumberValue("0", -1, 0, 4, 2), 0);
assert.strictEqual(stepNumberValue("", 1, 1, 200, 60), 61);
assert.strictEqual(stepNumberValue("bad", -1, 1, 10, 8), 7);

assert.strictEqual(clampNumber(12, 1, 10), 10);
assert.strictEqual(clampNumber(-2, 0, 4), 0);
assert.strictEqual(clampNumber(3, 0, 4), 3);

console.log("number controls tests passed");
