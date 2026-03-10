/**
 * Benchmark: RegExp.test vs safeCharCodeAt loop for binary detection
 *
 * Context: decodeResource() in src/injected/content/util.js uses
 *   /[\x80-\xFF]/.test(str)
 * to detect non-ASCII bytes in base64-decoded strings.
 * The proposed fix replaces this with a charCodeAt loop.
 *
 * Run: node test/injected/regexp-vs-loop-benchmark.js
 */

// --- Test data generators ---

function makeAsciiString(len) {
  // All ASCII (0x00-0x7F) — the "no binary" path, worst case for loop (must scan entire string)
  const chars = [];
  for (let i = 0; i < len; i++) chars.push(String.fromCharCode(i % 128));
  return chars.join('');
}

function makeBinaryStringEarly(len) {
  // Non-ASCII byte at position 0 — best case for both (early exit)
  const chars = [String.fromCharCode(0x80)];
  for (let i = 1; i < len; i++) chars.push(String.fromCharCode(i % 128));
  return chars.join('');
}

function makeBinaryStringLate(len) {
  // Non-ASCII byte at the very end — worst case for loop when binary IS present
  const chars = [];
  for (let i = 0; i < len - 1; i++) chars.push(String.fromCharCode(i % 128));
  chars.push(String.fromCharCode(0xFF));
  return chars.join('');
}

// --- Implementations ---

function regexpTest(str) {
  return /[\x80-\xFF]/.test(str);
}

function charCodeAtLoop(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) >= 0x80) return true;
  }
  return false;
}

// Simulate the actual safe version from content/safe-globals.js:
//   export const safeCharCodeAt = safeApply.call.bind(''.charCodeAt);
// which is equivalent to Function.prototype.call.bind(String.prototype.charCodeAt)
const safeCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
function safeCharCodeAtLoop(str) {
  for (let i = 0; i < str.length; i++) {
    if (safeCharCodeAt(str, i) >= 0x80) return true;
  }
  return false;
}

// --- Benchmark harness ---

function bench(name, fn, input, iterations) {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 1000); i++) fn(input);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(input);
  const elapsed = performance.now() - start;

  return { name, elapsed, opsPerSec: Math.round(iterations / (elapsed / 1000)) };
}

function runSuite(label, input, iterations) {
  console.log(`\n--- ${label} (len=${input.length.toLocaleString()}, iters=${iterations.toLocaleString()}) ---`);

  const results = [
    bench('RegExp.test        ', regexpTest, input, iterations),
    bench('charCodeAt loop    ', charCodeAtLoop, input, iterations),
    bench('safeCharCodeAt loop', safeCharCodeAtLoop, input, iterations),
  ];

  // Verify correctness
  const expected = regexpTest(input);
  if (charCodeAtLoop(input) !== expected || safeCharCodeAtLoop(input) !== expected) {
    console.error('  ERROR: results disagree!');
  }

  for (const r of results) {
    console.log(`  ${r.name}: ${r.elapsed.toFixed(2)}ms  (${r.opsPerSec.toLocaleString()} ops/sec)`);
  }

  const regexpTime = results[0].elapsed;
  const safeLoopTime = results[2].elapsed;
  const ratio = safeLoopTime / regexpTime;
  console.log(`  Ratio (safeLoop / regexp): ${ratio.toFixed(2)}x`);
}

// --- Resource size categories ---
// Based on codebase analysis:
// - Small icon/image: 1-10 KB decoded
// - Typical CSS/JSON resource: 10-100 KB decoded
// - Large resource (font/image): 100 KB - 1 MB
// - Maximum practical: ~5 MB (browser storage limit)

const SIZES = [
  100,        // tiny (favicon)
  1_000,      // 1 KB
  10_000,     // 10 KB (typical small resource)
  100_000,    // 100 KB (typical image)
  1_000_000,  // 1 MB (large resource)
  5_000_000,  // 5 MB (near storage limit)
];

console.log('=== RegExp.test vs charCodeAt loop benchmark ===');
console.log('Testing binary detection for decodeResource()');

for (const size of SIZES) {
  // Adjust iterations inversely with size to keep runtime reasonable
  const iters = Math.max(10, Math.round(50_000_000 / size));

  // Case 1: All ASCII (no binary) — worst case for loop, must scan entire string
  runSuite(`ALL ASCII`, makeAsciiString(size), iters);

  // Case 2: Binary byte at start — best case for both
  runSuite(`BINARY AT START`, makeBinaryStringEarly(size), iters);

  // Case 3: Binary byte at end — worst case for loop with binary present
  runSuite(`BINARY AT END`, makeBinaryStringLate(size), iters);
}

console.log('\n=== Summary ===');
console.log('Key question: Is the safeCharCodeAt loop acceptably fast for realistic resource sizes?');
console.log('Typical @resource usage: icons (1-10KB), CSS (10-50KB), fonts (50-500KB)');
console.log('The check runs once per GM_getResourceText/URL call, not in a hot loop.');
