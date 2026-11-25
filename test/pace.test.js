import { test } from "node:test";
import assert from "node:assert/strict";
import {
  watts, splitFromWatts, splitOf, paul2kSplit, parseTime, parseDist, fmt, ZONES, zoneAt, latest2k, ref2k,
  targetSplit, valueForSplit, parseShareParams, buildShareQuery, presetFor,
} from "../public/pace.js";

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const twenty = { kind: "time", time: 1200, dist: 4500, createdAt: 1 };

test("watts match the Concept2 formula and invert", () => {
  near(watts(120), 202.5, 0.05); // 2:00 /500m is 202.5 W on the PM5
  near(watts(105), 302.3, 0.05);
  near(splitFromWatts(watts(117.3)), 117.3, 1e-9);
});

test("split of distance and time tests", () => {
  near(splitOf({ kind: "dist", dist: 2000, time: 420 }), 105);
  near(splitOf(twenty), 133.33, 0.01); // 20 min at 4,500 m is 2:13.3
});

test("Paul's Law estimates a 2k from longer and shorter tests", () => {
  near(paul2kSplit(twenty), 127.48, 0.01);
  near(paul2kSplit({ kind: "dist", dist: 1000, time: 200 }), 105, 0.01); // 1k at 1:40 -> 2k at 1:45
  near(paul2kSplit({ kind: "dist", dist: 2000, time: 420 }), 105, 1e-9);
});

test("parseTime accepts m:ss, m:ss.t, h:mm:ss and seconds; rejects junk", () => {
  assert.equal(parseTime("7:00"), 420);
  near(parseTime("7:02.5"), 422.5, 1e-9);
  assert.equal(parseTime("1:05:00"), 3900);
  assert.equal(parseTime("105"), 105);
  for (const bad of ["", "abc", "7::00", "-1:00", "0", "1:2:3:4", "7:00a"]) assert.ok(Number.isNaN(parseTime(bad)), bad);
});

test("parseDist accepts commas and spaces; rejects junk", () => {
  assert.equal(parseDist("4,520"), 4520);
  assert.equal(parseDist(" 5 000 "), 5000);
  for (const bad of ["", "0", "-500", "4.5k", "abc"]) assert.ok(Number.isNaN(parseDist(bad)), bad);
});

test("fmt rounds to tenths before carrying into minutes", () => {
  assert.equal(fmt(105), "1:45.0");
  assert.equal(fmt(59.96), "1:00.0");
  assert.equal(fmt(133.333), "2:13.3");
  assert.equal(fmt(3900), "1:05:00.0");
  assert.equal(fmt(NaN), "–");
});

test("zone edges meet halfway across the guide's gaps", () => {
  assert.deepEqual(ZONES.map((z) => [z.id, z.edge]), [
    ["UT2", [19, 30]], ["UT1", [11, 19]], ["AT", [3.5, 11]], ["TR", [-3.5, 3.5]], ["AN", [null, -3.5]],
  ]);
  for (let i = 1; i < ZONES.length; i++) assert.equal(ZONES[i].edge[1], ZONES[i - 1].edge[0], "zones must touch");
});

test("zoneAt names a zone for every offset up to UT2's slow end", () => {
  assert.equal(zoneAt(25).zone.id, "UT2");
  assert.equal(zoneAt(30).zone.id, "UT2");
  assert.equal(zoneAt(19).zone.id, "UT2"); // a shared edge goes to the slower zone
  assert.equal(zoneAt(18.9).zone.id, "UT1");
  assert.equal(zoneAt(11.5).zone.id, "UT1");
  assert.equal(zoneAt(4).zone.id, "AT");
  assert.equal(zoneAt(0).zone.id, "TR");
  assert.equal(zoneAt(-3.4).zone.id, "TR");
  assert.equal(zoneAt(-4).zone.id, "AN");
  assert.equal(zoneAt(-12).zone.id, "AN");
  for (let off = -15; off <= 30; off += 0.1) assert.ok(zoneAt(off).zone, `no zone at ${off.toFixed(1)}`);
  assert.equal(zoneAt(30.2).easier, true);
});

test("zoneAt names the nearby zone when a split sits in a gap", () => {
  const near = (off) => { const r = zoneAt(off); return r.near ? `${r.zone.id}>${r.near.id}` : r.zone.id; };
  assert.equal(near(15), "UT1"); // inside the guide's range: no neighbour
  assert.equal(near(12), "UT1");
  assert.equal(near(18), "UT1");
  assert.equal(near(18.5), "UT1>UT2");
  assert.equal(near(19.5), "UT2>UT1");
  assert.equal(near(11.5), "UT1>AT");
  assert.equal(near(-3), "TR>AN");
  assert.equal(near(-4), "AN>TR");
  assert.equal(near(-12), "AN");
  assert.equal(near(30), "UT2");
});

test("latest2k picks the most recent 2k by date, then by entry time", () => {
  const old = { kind: "dist", dist: 2000, time: 410, date: "2026-03-01", createdAt: 300 };
  const recent = { kind: "dist", dist: 2000, time: 425, date: "2026-11-20", createdAt: 100 };
  assert.equal(latest2k([old, recent, twenty]), recent); // slower but newer wins
  const a = { kind: "dist", dist: 2000, time: 410, createdAt: 1 };
  const b = { kind: "dist", dist: 2000, time: 420, createdAt: 2 };
  assert.equal(latest2k([b, a]), b);
  assert.equal(latest2k([twenty]), null);
  assert.equal(latest2k([{ kind: "custom", dist: 2000, time: 420 }]), null); // only the 2k preset counts
});

test("ref2k uses a saved 2k over an estimate", () => {
  const two = { kind: "dist", dist: 2000, time: 420, createdAt: 2 };
  assert.deepEqual(ref2k([twenty, two], twenty), { split: 105, est: false, test: two });
  const r = ref2k([twenty], twenty);
  assert.equal(r.est, true);
  near(r.split, 127.48, 0.01);
});

test("targetSplit: 65% of power and 2k + seconds", () => {
  const ref = ref2k([twenty], twenty);
  near(targetSplit({ mode: "pct", pct: 65 }, twenty, ref), 153.92, 0.01); // 2:33.9
  near(targetSplit({ mode: "pct", pct: 100 }, twenty, ref), splitOf(twenty), 1e-9);
  near(targetSplit({ mode: "sec", sec: 18 }, twenty, ref), ref.split + 18, 1e-9);
});

test("valueForSplit inverts targetSplit and clamps", () => {
  const ref = ref2k([twenty], twenty);
  const s = targetSplit({ mode: "pct", pct: 65 }, twenty, ref);
  assert.equal(valueForSplit("pct", s, twenty, ref), 65);
  assert.equal(valueForSplit("sec", ref.split + 18.4, twenty, ref), 18);
  assert.equal(valueForSplit("sec", ref.split + 90, twenty, ref), 45);
  assert.equal(valueForSplit("pct", 60, twenty, ref), 130);
});

test("share links round-trip and reject bad values", () => {
  assert.deepEqual(parseShareParams(buildShareQuery({ mode: "pct", pct: 65 }, "20min")), { errors: [], mode: "pct", value: 65, test: "20min" });
  assert.deepEqual(parseShareParams(buildShareQuery({ mode: "sec", sec: -2 })), { errors: [], mode: "sec", value: -2 });
  assert.deepEqual(parseShareParams("?sec=+18"), { errors: [], mode: "sec", value: 18 }); // "+" arrives as a space
  assert.equal(buildShareQuery({ mode: "sec", sec: 18 }, "2k"), "?sec=18"); // seconds always use the 2k
  assert.equal(parseShareParams("?pct=500").errors.length, 1);
  assert.equal(parseShareParams("?pct=65.5").errors.length, 1);
  assert.equal(parseShareParams("?test=marathon").errors.length, 1);
  assert.deepEqual(parseShareParams(""), { errors: [] });
});

test("presetFor maps tests back to their preset", () => {
  assert.equal(presetFor(twenty).key, "20min");
  assert.equal(presetFor({ kind: "dist", dist: 2000, time: 420 }).key, "2k");
  assert.equal(presetFor({ kind: "custom", dist: 2500, time: 500 }).key, "custom");
});
