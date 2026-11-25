// Pure pace math for Pace Card. No DOM access, so it can be unit tested with node --test.

// Concept2 formula: watts = 2.80 / (seconds per metre)^3.
export const watts = (split) => 2.8 / Math.pow(split / 500, 3);
export const splitFromWatts = (w) => 500 * Math.cbrt(2.8 / w);

// A test is { kind: "dist" | "time" | "custom", dist (m), time (s), date?: "YYYY-MM-DD", createdAt: ms }.
export const splitOf = (test) => (test.time / test.dist) * 500;

// Paul's Law: about +5 s/500m each time the distance doubles.
export const paul2kSplit = (test) => splitOf(test) - 5 * Math.log2(test.dist / 2000);

export function parseTime(str) {
  str = String(str ?? "").trim();
  if (!str) return NaN;
  const parts = str.split(":");
  if (parts.length > 3) return NaN;
  let total = 0;
  for (const p of parts) {
    if (p === "" || !/^\d+(\.\d+)?$/.test(p)) return NaN;
    total = total * 60 + Number(p);
  }
  return total > 0 ? total : NaN;
}

export function parseDist(str) {
  const s = String(str ?? "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return n > 0 ? n : NaN;
}

// m:ss.t, or h:mm:ss.t for an hour or more. Rounds to tenths before splitting into units.
export function fmt(sec) {
  if (!Number.isFinite(sec)) return "–";
  const tenths = Math.round(sec * 10);
  const h = Math.floor(tenths / 36000);
  const rem = tenths - h * 36000;
  const m = Math.floor(rem / 600);
  const s = (rem - m * 600) / 10;
  const ss = (s < 10 ? "0" : "") + s.toFixed(1);
  return h ? `${h}:${m < 10 ? "0" : ""}${m}:${ss}` : `${m}:${ss}`;
}

export const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);

// Zones as offsets in seconds from the 2k split: [fast, slow]; null = open-ended.
// Source: ErgManiac training zones guide (2k + seconds method).
export const ZONES = [
  { id: "UT2", name: "Easy steady state", off: [20, 30], hr: [55, 70], rate: "18–20",
    goal: "Aerobic base. You can talk in full sentences.", sessions: "40–60 min steady, or 3 × 20 min with 2 min rest" },
  { id: "UT1", name: "Moderate steady state", off: [12, 18], hr: [70, 80], rate: "20–24",
    goal: "Aerobic capacity and lactate clearance. Short phrases only.", sessions: "30–45 min steady, or 4 × 10 min with 3 min rest" },
  { id: "AT", name: "Anaerobic threshold", off: [5, 10], hr: [80, 85], rate: "24–28",
    goal: "Raises lactate threshold. Comfortably hard.", sessions: "5 × 5 min with 3 min rest, or 3 × 10 min with 4 min rest" },
  { id: "TR", name: "Transport / VO2max", off: [-2, 2], hr: [85, 95], rate: "28–32",
    goal: "Raises VO2max. Hard, no talking. Allow 48+ hours before the next hard session.", sessions: "8 × 500m with 3 min rest, or 5 × 3 min with 4 min rest" },
  { id: "AN", name: "Anaerobic", off: [null, -5], hr: null, rate: "32–38",
    goal: "Peak power. All-out. Use sparingly.", sessions: "8 × 200m with full recovery, or 6 × 30 s max with 4 min rest" },
];

// The guide leaves gaps between zones (UT1 ends at +18 s, UT2 starts at +20 s). Each zone's `edge`
// closes them by meeting its neighbour halfway, so every split up to UT2's slow end has a zone.
// `off` keeps the guide's own range; the middle of it is where a tap on the zone lands.
ZONES.forEach((z, i) => {
  const slower = ZONES[i - 1], faster = ZONES[i + 1];
  z.edge = [
    faster ? (z.off[0] + faster.off[1]) / 2 : null,
    slower ? (slower.off[0] + z.off[1]) / 2 : z.off[1],
  ];
});

export const zoneMid = (z) => (z.off[0] === null ? z.off[1] - 3 : (z.off[0] + z.off[1]) / 2);

// Where an offset from the 2k split falls: { zone } | { easier: true } (slower than UT2).
// Slower zones are checked first, so a shared edge belongs to the slower zone.
export function zoneAt(off) {
  const EPS = 0.05;
  if (off > ZONES[0].edge[1] + EPS) return { easier: true };
  for (const z of ZONES) {
    const fast = z.edge[0] === null ? -Infinity : z.edge[0];
    if (off >= fast - EPS) return { zone: z };
  }
  return { zone: ZONES[ZONES.length - 1] };
}

const recency = (t) => (t.date ? Date.parse(t.date + "T12:00:00Z") : t.createdAt ?? 0);
export const is2k = (t) => t.kind === "dist" && t.dist === 2000;

// Most recent 2k by test date (entry time when there is no date).
export function latest2k(tests) {
  let best = null;
  for (const t of tests) if (is2k(t) && (!best || recency(t) >= recency(best))) best = t;
  return best;
}

// The 2k split zones are measured from: the most recent saved 2k, else an estimate from the selected test.
export function ref2k(tests, selected) {
  const t = latest2k(tests);
  if (t) return { split: splitOf(t), est: false, test: t };
  return selected ? { split: paul2kSplit(selected), est: true, test: selected } : null;
}

// mode "pct": percent of the base test's watts. mode "sec": seconds added to the reference 2k split.
export function targetSplit({ mode, pct, sec }, base, ref) {
  if (mode === "pct") return splitFromWatts(watts(splitOf(base)) * pct / 100);
  return ref.split + sec;
}

export const PCT_RANGE = [30, 130];
export const SEC_RANGE = [-15, 45];
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));

// Inverse of targetSplit: the whole-number value in the current mode that gives this split.
export function valueForSplit(mode, split, base, ref) {
  if (mode === "pct") return clamp(Math.round(watts(split) / watts(splitOf(base)) * 100), PCT_RANGE);
  return clamp(Math.round(split - ref.split), SEC_RANGE);
}

// Test presets. The share-link key is the URL-safe name for a preset.
export const PRESETS = [
  { key: "1k", label: "1k", kind: "dist", dist: 1000 },
  { key: "2k", label: "2k", kind: "dist", dist: 2000 },
  { key: "6k", label: "6k", kind: "dist", dist: 6000 },
  { key: "20min", label: "20 min", kind: "time", time: 1200 },
  { key: "30min", label: "30 min", kind: "time", time: 1800 },
  { key: "custom", label: "Custom", kind: "custom" },
];

export function presetFor(test) {
  return PRESETS.find((p) =>
    (p.kind === "dist" && test.kind === "dist" && p.dist === test.dist) ||
    (p.kind === "time" && test.kind === "time" && p.time === test.time)) || PRESETS[PRESETS.length - 1];
}

// Coach links: ?pct=65 or ?sec=18, optionally &test=2k. Invalid values are reported, not guessed.
export function parseShareParams(search) {
  const q = new URLSearchParams(search);
  const out = { errors: [] };
  if (q.has("pct")) {
    const n = Number(q.get("pct"));
    if (Number.isInteger(n) && n >= PCT_RANGE[0] && n <= PCT_RANGE[1]) { out.mode = "pct"; out.value = n; }
    else out.errors.push(`pct must be a whole number from ${PCT_RANGE[0]} to ${PCT_RANGE[1]}`);
  } else if (q.has("sec")) {
    const n = Number(String(q.get("sec")).replace(/^\s+|\s+$/g, ""));
    if (Number.isInteger(n) && n >= SEC_RANGE[0] && n <= SEC_RANGE[1]) { out.mode = "sec"; out.value = n; }
    else out.errors.push(`sec must be a whole number from ${SEC_RANGE[0]} to ${SEC_RANGE[1]}`);
  }
  if (q.has("test")) {
    const p = PRESETS.find((x) => x.key === q.get("test") && x.kind !== "custom");
    if (p) out.test = p.key; else out.errors.push("test must be one of 1k, 2k, 6k, 20min, 30min");
  }
  return out;
}

export function buildShareQuery({ mode, pct, sec }, testKey) {
  const q = new URLSearchParams();
  if (mode === "pct") q.set("pct", String(pct)); else q.set("sec", String(sec));
  if (mode === "pct" && testKey && testKey !== "custom") q.set("test", testKey);
  return "?" + q.toString();
}
