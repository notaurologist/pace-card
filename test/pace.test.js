import { test } from "node:test";
import assert from "node:assert/strict";
import {
  watts, splitFromWatts, splitOf, paul2kSplit, parseTime, parseDist, fmt, zoneAt, latest2k, ref2k,
  targetSplit, valueForSplit, parseShareParams, buildShareQuery, presetFor, PCT_RANGE, parsePiece, pieceAt,
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

test("zoneAt finds zones, boundaries and the gaps between them", () => {
  assert.equal(zoneAt(25).zone.id, "UT2");
  assert.equal(zoneAt(20).zone.id, "UT2");
  assert.equal(zoneAt(18).zone.id, "UT1");
  assert.equal(zoneAt(0).zone.id, "TR");
  assert.equal(zoneAt(-5).zone.id, "AN");
  assert.equal(zoneAt(-12).zone.id, "AN");
  assert.deepEqual(zoneAt(19).between.map((z) => z.id), ["UT2", "UT1"]);
  assert.deepEqual(zoneAt(-3.5).between.map((z) => z.id), ["TR", "AN"]);
  assert.equal(zoneAt(31).easier, true);
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
  assert.equal(valueForSplit("pct", 60, twenty, ref), PCT_RANGE[1]);
});

test("percent mode can reach every zone from a long, slow test", () => {
  // A 7:00 2k and a 30-minute test rowed at 2k + 30 s. The old 130% cap stopped at the slow edge of AT.
  const twoK = { id: "a", kind: "dist", dist: 2000, time: 420, createdAt: 1 };
  const slow30 = { id: "b", kind: "time", time: 1800, dist: 1800 / 135 * 500, createdAt: 2 };
  const ref = ref2k([twoK, slow30], slow30);
  for (const off of [7.5, 0, -8, -10]) {
    const pct = valueForSplit("pct", ref.split + off, slow30, ref);
    near(targetSplit({ mode: "pct", pct }, slow30, ref) - ref.split, off, 0.6);
  }
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

test("parsePiece reads times and distances the way rowers write them", () => {
  assert.equal(parsePiece(""), null);
  assert.equal(parsePiece("  "), null);
  assert.deepEqual(parsePiece("60:00"), { kind: "time", time: 3600 });
  assert.deepEqual(parsePiece("1:00:00"), { kind: "time", time: 3600 });
  assert.deepEqual(parsePiece("60 min"), { kind: "time", time: 3600 });
  assert.deepEqual(parsePiece("30min"), { kind: "time", time: 1800 });
  assert.deepEqual(parsePiece("5000"), { kind: "dist", dist: 5000 });
  assert.deepEqual(parsePiece("5,000 m"), { kind: "dist", dist: 5000 });
  assert.deepEqual(parsePiece("5k"), { kind: "dist", dist: 5000 });
  assert.deepEqual(parsePiece("2.5K"), { kind: "dist", dist: 2500 });
  assert.match(parsePiece("60").error, /60:00/);
  for (const bad of ["abc", "7::00", "0 min", "0k", "5 km"]) assert.ok(parsePiece(bad).error, bad);
});

test("pieceAt gives distance for a timed piece and time for a distance", () => {
  near(pieceAt(120, { kind: "time", time: 3600 }).dist, 15000, 1e-9); // 60 min at 2:00 is 15,000 m
  near(pieceAt(105, { kind: "dist", dist: 2000 }).time, 420, 1e-9); // 2k at 1:45 is 7:00
});
