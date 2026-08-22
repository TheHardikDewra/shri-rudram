/**
 * Tests for the cloud-sync merge rules.
 *
 * Loads the real, shipped sync.js in a minimal DOM shim - not a copy of the
 * logic - so a change to sync.js is actually covered. The Firebase SDK is
 * never touched: with a REPLACE_ME config, sync.js stays dormant by design.
 *
 *   node test/sync.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(`${name}\n    ${e.message.split('\n')[0]}`); }
}

/* ---- Load sync.js in a shim ------------------------------------------- */

function loadSync(config) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const noop = () => {};
  const sandbox = {
    console: { warn: noop, log: noop, error: noop },
    localStorage,
    navigator: { onLine: true },
    setTimeout, clearTimeout,
    document: {
      addEventListener: noop,
      dispatchEvent: noop,
      getElementById: () => null,
      body: { classList: { add: noop, remove: noop } },
    },
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.SADHANA_SYNC_CONFIG = config;

  const src = readFileSync(join(ROOT, 'sync.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sync.js' });
  assert.ok(sandbox.__sync, 'sync.js did not expose its internals');
  return { ...sandbox.__sync, store, localStorage };
}

const APP_CONFIG = JSON.parse(JSON.stringify(
  // read the real per-app field spec out of firebase-config.js
  (() => {
    const src = readFileSync(join(ROOT, 'firebase-config.js'), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'firebase-config.js' });
    return sandbox.window.SADHANA_SYNC_CONFIG;
  })()
));

const S = loadSync(APP_CONFIG);
const FIELDS = APP_CONFIG.fields;
const byMerge = (m) => FIELDS.filter((f) => f.merge === m).map((f) => f.name);

/* ---- Generic laws, run against every field this app actually has ------- */

const SAMPLES = {
  idset: [[], [1], [1, 2, 3], [3, 9], ['a'], ['a', 'b'], [2, 5, 7, 11]],
  srs: [{}, { 1: { nextReview: '2026-01-01', repetitions: 1 } },
    { 1: { nextReview: '2026-06-01', repetitions: 4 }, 7: { nextReview: '2026-02-02', repetitions: 2 } },
    { 7: { nextReview: '2026-02-02', repetitions: 9 } }],
  notes: [{}, { 3: 'om' }, { 3: 'om namo narayanaya', 5: 'x' }, { 5: 'longer note here' }],
  sadhana: [{ total: 0, log: [] },
    { total: 3, log: [{ date: '2026-08-01', count: 3 }] },
    { total: 5, log: [{ date: '2026-08-01', count: 1 }, { date: '2026-08-02', count: 4 }] },
    { total: 90, log: [{ date: '2026-07-30', count: 90 }] }],
  bookmark: [1, 5, 108, 42],
  japa: [{ date: '', secs: [0, 0, 0] },
    { date: '2026-8-22', secs: [120, 0, 0] },
    { date: '2026-8-22', secs: [60, 900, 0] },
    { date: '2026-8-9', secs: [7200, 7200, 7200] }],
};

function pack(name, value) {
  const o = {};
  FIELDS.forEach((f) => { o[f.name] = SAMPLES[f.merge][0]; });
  o[name] = value;
  return o;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Values built inside the vm sandbox carry that realm's prototypes, so
// assert.deepEqual (strict) rejects them on identity alone. Compare shape.
const deep = (actual, expected, msg) => assert.ok(eq(actual, expected),
  `${msg || ''} got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

for (const f of FIELDS) {
  const samples = SAMPLES[f.merge];
  assert.ok(samples, `no samples defined for merge type ${f.merge}`);

  test(`${f.name}: idempotent - merge(a, a) === a`, () => {
    for (const a of samples) {
      const got = S.mergeData(pack(f.name, a), pack(f.name, a))[f.name];
      assert.ok(eq(got, S.fromDoc(pack(f.name, a))[f.name]),
        `${f.merge}: ${JSON.stringify(a)} -> ${JSON.stringify(got)}`);
    }
  });

  test(`${f.name}: commutative - merge(a, b) === merge(b, a)`, () => {
    // bookmark is deliberately last-writer-wins, so it is not commutative
    if (f.merge === 'bookmark') return;
    for (const a of samples) {
      for (const b of samples) {
        const ab = S.mergeData(pack(f.name, a), pack(f.name, b))[f.name];
        const ba = S.mergeData(pack(f.name, b), pack(f.name, a))[f.name];
        assert.ok(eq(ab, ba),
          `${f.merge}: ${JSON.stringify(a)} + ${JSON.stringify(b)} -> ${JSON.stringify(ab)} vs ${JSON.stringify(ba)}`);
      }
    }
  });

  test(`${f.name}: associative-ish - converges regardless of order`, () => {
    if (f.merge === 'bookmark') return;
    const [a, b, c] = [samples[1], samples[2], samples[3] ?? samples[0]];
    const left = S.mergeData(pack(f.name, S.mergeData(pack(f.name, a), pack(f.name, b))[f.name]), pack(f.name, c))[f.name];
    const right = S.mergeData(pack(f.name, a), pack(f.name, S.mergeData(pack(f.name, b), pack(f.name, c))[f.name]))[f.name];
    assert.ok(eq(left, right), `${f.merge}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  });

  test(`${f.name}: garbage in localStorage does not throw`, () => {
    S.store.set(f.key, '}{not json');
    S.readLocal();
    S.store.set(f.key, 'null');
    S.readLocal();
    S.store.delete(f.key);
  });
}

/* ---- The promise that matters: progress is never lost ----------------- */

for (const name of byMerge('idset')) {
  test(`${name}: union never drops an id`, () => {
    const a = [1, 2, 3];
    const b = [3, 4, 5];
    const m = S.mergeData(pack(name, a), pack(name, b))[name];
    for (const n of [...a, ...b]) assert.ok(m.includes(n), `lost ${n}`);
    deep(m, [1, 2, 3, 4, 5]);
  });
}

for (const name of byMerge('sadhana')) {
  test(`${name}: per-date max, total never decreases`, () => {
    const a = { total: 10, log: [{ date: '2026-08-01', count: 10 }] };
    const b = { total: 4, log: [{ date: '2026-08-01', count: 4 }, { date: '2026-08-02', count: 4 }] };
    const m = S.mergeData(pack(name, a), pack(name, b))[name];
    deep(m.log, [{ date: '2026-08-01', count: 10 }, { date: '2026-08-02', count: 4 }]);
    assert.equal(m.total, 14, 'total must cover the merged log');
    assert.ok(m.total >= a.total && m.total >= b.total);
  });
}

for (const name of byMerge('srs')) {
  test(`${name}: keeps the card that is further along`, () => {
    const a = { 1: { nextReview: '2026-09-01', repetitions: 5 } };
    const b = { 1: { nextReview: '2026-08-01', repetitions: 2 } };
    assert.equal(S.mergeData(pack(name, a), pack(name, b))[name][1].repetitions, 5);
    assert.equal(S.mergeData(pack(name, b), pack(name, a))[name][1].repetitions, 5);
  });
}

for (const name of byMerge('notes')) {
  test(`${name}: longer text wins, neither key is dropped`, () => {
    const a = { 1: 'short', 2: 'only on a' };
    const b = { 1: 'a much longer note', 3: 'only on b' };
    const m = S.mergeData(pack(name, a), pack(name, b))[name];
    assert.equal(m[1], 'a much longer note');
    assert.equal(m[2], 'only on a');
    assert.equal(m[3], 'only on b');
  });
}

for (const name of byMerge('bookmark')) {
  test(`${name}: remote (most recent writer) wins, never 0`, () => {
    assert.equal(S.mergeData(pack(name, 50), pack(name, 3))[name], 3);
    assert.equal(S.mergeData(pack(name, 7), pack(name, 1))[name], 1);
    assert.ok(S.mergeData(pack(name, 1), pack(name, 1))[name] >= 1);
  });
}

for (const name of byMerge('japa')) {
  test(`${name}: same day takes the per-segment max`, () => {
    const a = { date: '2026-8-22', secs: [3600, 0, 0] };
    const b = { date: '2026-8-22', secs: [100, 7200, 0] };
    deep(S.mergeData(pack(name, a), pack(name, b))[name],
      { date: '2026-8-22', secs: [3600, 7200, 0] });
  });
  test(`${name}: unpadded dates order numerically, not as strings`, () => {
    const older = { date: '2026-8-9', secs: [1, 1, 1] };
    const newer = { date: '2026-8-22', secs: [2, 2, 2] };
    // naive string compare would call '2026-8-9' the later date
    deep(S.mergeData(pack(name, older), pack(name, newer))[name], newer);
    deep(S.mergeData(pack(name, newer), pack(name, older))[name], newer);
  });
}

/* ---- Round trips through localStorage and Firestore ------------------- */

test('readLocal on a virgin device yields empty, not undefined', () => {
  FIELDS.forEach((f) => S.store.delete(f.key));
  const d = S.readLocal();
  FIELDS.forEach((f) => assert.notEqual(d[f.name], undefined, `${f.name} undefined`));
});

test('writeLocal -> readLocal round trips every field', () => {
  const data = {};
  FIELDS.forEach((f) => { data[f.name] = SAMPLES[f.merge][1]; });
  S.writeLocal(data);
  const back = S.readLocal();
  FIELDS.forEach((f) => assert.ok(eq(back[f.name], data[f.name]),
    `${f.name}: wrote ${JSON.stringify(data[f.name])}, read ${JSON.stringify(back[f.name])}`));
});

test('fromDoc tolerates a missing / half-written cloud document', () => {
  for (const doc of [undefined, {}, { junk: 1 }, { learned: 'not an array' }]) {
    const d = S.fromDoc(doc);
    FIELDS.forEach((f) => assert.notEqual(d[f.name], undefined));
  }
});

test('first sign-in merges local into an empty cloud, losing nothing', () => {
  const local = {};
  FIELDS.forEach((f) => { local[f.name] = SAMPLES[f.merge][2] ?? SAMPLES[f.merge][1]; });
  S.writeLocal(local);
  const merged = S.mergeData(S.readLocal(), S.fromDoc(undefined));
  FIELDS.forEach((f) => {
    if (f.merge === 'idset') {
      local[f.name].forEach((n) => assert.ok(merged[f.name].includes(n), `${f.name} lost ${n}`));
    } else if (f.merge === 'notes' || f.merge === 'srs') {
      Object.keys(local[f.name]).forEach((k) => assert.ok(k in merged[f.name], `${f.name} lost ${k}`));
    } else if (f.merge === 'sadhana') {
      assert.ok(merged[f.name].total >= local[f.name].total);
      assert.equal(merged[f.name].log.length, local[f.name].log.length);
    }
  });
});

const preserved = FIELDS.filter((f) => f.preserve && f.preserve.length);
for (const f of preserved) {
  test(`${f.name}: preserve keeps ${f.preserve.join('/')} through a remote merge`, () => {
    S.store.set(f.key, JSON.stringify({ date: '2026-8-22', secs: [10, 0, 0], running: 1, since: 1755900000000 }));
    S.writeLocal({ [f.name]: { date: '2026-8-22', secs: [10, 7200, 0] } });
    const raw = JSON.parse(S.store.get(f.key));
    f.preserve.forEach((k) => assert.notEqual(raw[k], undefined, `${k} was dropped`));
    assert.equal(raw.running, 1);
    deep(raw.secs, [10, 7200, 0], 'merged value should still land');
  });
}

/* ---- Result ----------------------------------------------------------- */

const appId = APP_CONFIG.appId;
if (failures.length) {
  console.error(`\n${appId}: ${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.error('  x ' + f));
  process.exit(1);
}
console.log(`${appId}: ${pass}/${pass} passed (${FIELDS.length} fields)`);
