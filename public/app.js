import {
  watts, splitOf, parseTime, parseDist, fmt, signed, ZONES, zoneMid, zoneAt, ref2k, targetSplit, valueForSplit,
  PCT_RANGE, SEC_RANGE, PRESETS, presetFor, parseShareParams, buildShareQuery,
} from "./pace.js";

const $ = (id) => document.getElementById(id);
const KEY = "pacecard.v1";
const fmtShort = (sec) => fmt(sec).replace(/\.0$/, "");
const fmtDist = (m) => Math.round(m).toLocaleString("en-US");
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const zvar = (z, part) => `var(--z-${z.id.toLowerCase()}-${part})`;

function testName(t) {
  const p = presetFor(t);
  if (p.key !== "custom") return p.label;
  return `${fmtDist(t.dist)} m`;
}
function testLabel(t) {
  if (t.kind === "time") return `${testName(t)} · ${fmtDist(t.dist)} m`;
  if (t.kind === "dist") return `${testName(t)} · ${fmtShort(t.time)}`;
  return `${fmtDist(t.dist)} m · ${fmtShort(t.time)}`;
}

// ---- state (saved on this device only) ----
const EXAMPLE = { id: "example", kind: "time", time: 1200, dist: 4500, createdAt: 0, example: true };
let state = { tests: [EXAMPLE], sel: "example", mode: "pct", pct: 65, sec: 18, maxhr: "" };
let storageOk = true;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved && Array.isArray(saved.tests)) state = { ...state, ...saved };
} catch (e) {
  storageOk = false; // Private mode or blocked storage: the page still works, tests just aren't kept.
}
function save() {
  if (!storageOk) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { storageOk = false; showNotice("Your browser isn't saving data for this page, so your tests will be lost when you close it.", "warn"); }
}
const selTest = () => state.tests.find((t) => t.id === state.sel) || state.tests[0] || null;

function showNotice(html, kind, action) {
  const n = $("linkNotice");
  n.className = "notice" + (kind === "warn" ? " warn" : "");
  n.innerHTML = `<div>${html}</div>` + (action ? `<button type="button" id="noticeAction">${action.label}</button>` : "");
  n.hidden = false;
  if (action) $("noticeAction").addEventListener("click", () => { n.hidden = true; action.run(); });
}

// ---- render ----
function render() {
  const t = selTest();
  $("chips").innerHTML = state.tests.map((x) =>
    `<button type="button" class="chip" data-id="${x.id}" aria-pressed="${x.id === t?.id}">${testLabel(x)}${x.example ? '<span class="ex">example</span>' : x.date ? `<span class="when">${fmtDate(x.date)}</span>` : ""}</button>`
  ).join("") + `<button type="button" class="chip add" id="addTest">+ Add test</button>`;
  $("exBanner").hidden = !t?.example;

  if (!t) {
    $("basis").textContent = "Add a test to get started.";
    $("outSplit").innerHTML = "–<small>/500m</small>";
    $("facts").innerHTML = ""; $("strip").innerHTML = ""; $("axis").innerHTML = ""; $("tbody").innerHTML = "";
    $("zKv").innerHTML = ""; $("zTitle").textContent = "Zone";
    save(); return;
  }

  const r = ref2k(state.tests, t);
  const bs = splitOf(t), bw = watts(bs);
  const edit = `<button type="button" data-edit="${t.id}">Edit</button>`;
  if (state.mode === "sec") {
    $("basis").innerHTML = r.est
      ? `Using a 2k estimated from your ${testName(r.test)} test: <b>${fmt(r.split)}</b> /500m · ${edit}`
      : `Using your most recent 2k: <b>${fmt(r.test.time)}</b> (${fmt(r.split)} /500m)${r.test.date ? ", " + fmtDate(r.test.date) : ""} · <button type="button" data-edit="${r.test.id}">Edit</button>`;
  } else {
    $("basis").innerHTML = `Test split <b>${fmt(bs)}</b> /500m · ${Math.round(bw)} W · ${edit}`;
  }

  // Answer
  const s = targetSplit(state, t, r), w = watts(s), off = s - r.split, zr = zoneAt(off);
  $("outSplit").innerHTML = `${fmt(s)}<small>/500m</small>`;
  const zoneHtml = zr.zone
    ? `<span class="zpill" style="--zbg:${zvar(zr.zone, "bg")};--zfg:${zvar(zr.zone, "fg")}">${zr.zone.id}${zr.near ? `, near ${zr.near.id}` : ""}${r.est ? " (est.)" : ""}</span>`
    : `<span class="zpill">Easier than UT2</span>`;
  const other = state.mode === "pct"
    ? `<span><b>2k ${signed(Math.round(off))} s</b>${r.est ? " est." : ""}</span>`
    : `<span><b>${Math.round((w / bw) * 100)}%</b> of ${testName(t)} power</span>`;
  $("facts").innerHTML = `<span><b>${Math.round(w)}</b> W</span>${other}${zoneHtml}`;

  // Target control
  $("mPct").setAttribute("aria-pressed", String(state.mode === "pct"));
  $("mSec").setAttribute("aria-pressed", String(state.mode === "sec"));
  if (document.activeElement !== $("tval")) $("tval").value = state.mode === "pct" ? state.pct : (state.sec > 0 ? "+" : "") + state.sec;
  $("tunit").textContent = state.mode === "pct" ? "%" : "s";

  // Zone strip: slow on the left, fast on the right, in seconds from the 2k split.
  // Each zone is solid across the guide's own range; colours blend across the gaps between zones.
  $("strip").style.background = stripGradient();
  $("strip").innerHTML = ZONES.map((z) =>
    `<span class="zlabel" style="left:${xOf(zoneMid(z)) * 100}%;color:${zvar(z, "fg")}">${z.id}</span>`
  ).join("") + `<div class="marker" style="left:${xOf(off) * 100}%"></div>`;
  $("strip").setAttribute("aria-valuenow", String(Math.round(off)));
  $("strip").setAttribute("aria-valuetext", `${fmt(s)} per 500 metres, 2k ${signed(Math.round(off))} seconds`);
  $("axis").innerHTML = `<span>Slower · ${fmtShort(r.split + AX_SLOW)}</span><span>${r.est ? "Est. 2k" : "2k"} ${fmt(r.split)}</span><span>${fmtShort(r.split + AX_FAST)} · Faster</span>`;

  // Zone details
  const z = zr.zone || ZONES[0];
  $("zTitle").textContent = `${z.id} · ${z.name}`;
  const hrN = Number(state.maxhr), hasHr = hrN >= 100 && hrN <= 230;
  const hr = !z.hr ? (hasHr ? `Max (${hrN} bpm)` : "Max")
    : hasHr ? `${Math.round((hrN * z.hr[0]) / 100)}–${Math.round((hrN * z.hr[1]) / 100)} bpm` : `${z.hr[0]}–${z.hr[1]}% of max`;
  const fast = z.edge[0] === null ? null : r.split + z.edge[0], slow = r.split + z.edge[1];
  const pace = fast === null ? `${fmt(slow)} or faster` : `${fmt(slow)} – ${fmt(fast)}`;
  const range = (a, b) => (a === null ? `${signed(b)} s or faster` : `${signed(a)} to ${signed(b)} s`);
  const offTxt = `${range(z.edge[0], z.edge[1])} <span class="fine">(guide: ${range(z.off[0], z.off[1])})</span>`;
  $("zKv").innerHTML = `<dt>Pace</dt><dd>${pace} /500m</dd><dt>vs 2k</dt><dd>${offTxt}</dd>
    <dt>Stroke rate</dt><dd>${z.rate} spm</dd><dt>Heart rate</dt><dd>${hr}</dd>
    <dt>Purpose</dt><dd>${z.goal}</dd><dt>Sessions</dt><dd>${z.sessions}</dd>`;
  if (document.activeElement !== $("maxhr")) $("maxhr").value = state.maxhr;

  // Percentage table for the selected test
  const rows = [];
  for (let p = 100; p >= 50; p -= 5) rows.push(p);
  $("tbody").innerHTML = rows.map((p) => {
    const ps = targetSplit({ mode: "pct", pct: p }, t, r);
    return `<tr data-p="${p}" class="${state.mode === "pct" && p === state.pct ? "hit" : ""}"><td>${p}%</td><td>${fmt(ps)}</td><td>${Math.round((bw * p) / 100)}</td><td>${signed(Math.round(ps - r.split))} s</td></tr>`;
  }).join("");

  $("shareUrl").hidden = true; $("shareMsg").textContent = "";
  save();
}

const AX_SLOW = 36, AX_FAST = -10;
const xOf = (off) => Math.min(1, Math.max(0, (AX_SLOW - off) / (AX_SLOW - AX_FAST)));
const offAt = (x) => AX_SLOW - x * (AX_SLOW - AX_FAST);
const pc = (off) => `${(xOf(off) * 100).toFixed(2)}%`;
function stripGradient() {
  // Gray (easier than UT2) up to UT2's slow end, then a hard start to UT2.
  const stops = ["var(--gap-bg) 0%", `var(--gap-bg) ${pc(ZONES[0].off[1])}`];
  for (const z of ZONES) {
    const c = zvar(z, "bg");
    stops.push(`${c} ${pc(z.off[1])}`, `${c} ${z.off[0] === null ? "100%" : pc(z.off[0])}`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function setFromSplit(split) {
  const t = selTest(); if (!t || !Number.isFinite(split)) return;
  const v = valueForSplit(state.mode, split, t, ref2k(state.tests, t));
  if (state.mode === "pct") state.pct = v; else state.sec = v;
}
const currentSplit = () => { const t = selTest(); return t ? targetSplit(state, t, ref2k(state.tests, t)) : NaN; };

// ---- test editor ----
let edId = null, edPreset = "2k";
function openEditor(id, presetKey) {
  edId = id;
  const t = id ? state.tests.find((x) => x.id === id) : null;
  edPreset = t ? presetFor(t).key : presetKey || "2k";
  $("edTitle").textContent = t ? "Edit test" : "Add a test";
  $("edDelete").hidden = !t;
  $("edDist").value = t ? fmtDist(t.dist) : "";
  $("edTime").value = t ? fmt(t.time) : "";
  $("edDate").value = t ? t.date || "" : today();
  $("edErr").textContent = "";
  $("edDist").classList.remove("bad"); $("edTime").classList.remove("bad");
  $("editor").hidden = false;
  renderPresets(); applyPreset();
  const p = PRESETS.find((x) => x.key === edPreset);
  (p.kind === "time" ? $("edDist") : $("edTime")).focus();
}
function renderPresets() {
  $("presets").innerHTML = PRESETS.map((p) => `<button type="button" class="chip" data-p="${p.key}" aria-pressed="${p.key === edPreset}">${p.label}</button>`).join("");
}
function applyPreset() {
  const p = PRESETS.find((x) => x.key === edPreset);
  $("edDist").disabled = p.kind === "dist";
  $("edTime").disabled = p.kind === "time";
  if (p.kind === "dist") $("edDist").value = fmtDist(p.dist);
  if (p.kind === "time") $("edTime").value = fmt(p.time);
}
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]"); if (!b) return;
  const prev = PRESETS.find((x) => x.key === edPreset), next = PRESETS.find((x) => x.key === b.dataset.p);
  if (prev.kind !== next.kind) {
    if (next.kind !== "dist") $("edDist").value = "";
    if (next.kind !== "time") $("edTime").value = "";
  }
  edPreset = next.key; renderPresets(); applyPreset();
  (next.kind === "time" ? $("edDist") : $("edTime")).focus();
});
$("editor").addEventListener("submit", (e) => {
  e.preventDefault();
  const dist = parseDist($("edDist").value), time = parseTime($("edTime").value);
  $("edDist").classList.toggle("bad", !Number.isFinite(dist));
  $("edTime").classList.toggle("bad", !Number.isFinite(time));
  if (!Number.isFinite(dist)) { $("edErr").textContent = "Enter the distance in metres, like 4520."; return; }
  if (!Number.isFinite(time)) { $("edErr").textContent = "Enter the time as minutes:seconds, like 7:02.5."; return; }
  const split = (time / dist) * 500;
  if (split < 60 || split > 300) { $("edErr").textContent = `That works out to ${fmt(split)} /500m. Check the distance and time.`; return; }
  const p = PRESETS.find((x) => x.key === edPreset);
  const old = edId ? state.tests.find((x) => x.id === edId) : null;
  const t = { id: old && !old.example ? old.id : "t" + Date.now(), kind: p.kind, dist, time, date: $("edDate").value || undefined, createdAt: old && !old.example ? old.createdAt : Date.now() };
  state.tests = old ? state.tests.map((x) => (x.id === edId ? t : x)) : [...state.tests, t];
  state.tests = state.tests.filter((x) => !x.example); // the example goes once a real test exists
  state.sel = t.id;
  $("editor").hidden = true;
  render();
});
$("edCancel").addEventListener("click", () => { $("editor").hidden = true; });
$("edDelete").addEventListener("click", () => {
  state.tests = state.tests.filter((x) => x.id !== edId);
  if (state.sel === edId) state.sel = state.tests[0]?.id;
  $("editor").hidden = true;
  render();
});
for (const id of ["edDist", "edTime"]) $(id).addEventListener("input", () => { $(id).classList.remove("bad"); $("edErr").textContent = ""; });

$("chips").addEventListener("click", (e) => {
  if (e.target.closest("#addTest")) return openEditor(null);
  const b = e.target.closest("[data-id]"); if (!b) return;
  state.sel = b.dataset.id; $("editor").hidden = true; render();
});
$("basis").addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) openEditor(b.dataset.edit); });

// ---- target controls ----
function switchMode(mode) { const s = currentSplit(); state.mode = mode; setFromSplit(s); render(); }
$("mPct").addEventListener("click", () => switchMode("pct"));
$("mSec").addEventListener("click", () => switchMode("sec"));
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
function step(d) {
  if (state.mode === "pct") state.pct = clamp(state.pct + d, PCT_RANGE); else state.sec = clamp(state.sec + d, SEC_RANGE);
  render();
}
$("dec").addEventListener("click", () => step(-1));
$("inc").addEventListener("click", () => step(1));
$("tval").addEventListener("input", () => {
  const raw = $("tval").value.replace(/[+\s%s]/g, "").replace("−", "-");
  if (raw === "" || raw === "-") return;
  const n = Number(raw); if (!Number.isFinite(n)) return;
  const range = state.mode === "pct" ? PCT_RANGE : SEC_RANGE;
  if (n < range[0] || n > range[1]) return;
  if (state.mode === "pct") state.pct = Math.round(n); else state.sec = Math.round(n);
  render();
});
$("tval").addEventListener("blur", render);
$("maxhr").addEventListener("input", () => { state.maxhr = $("maxhr").value.replace(/\D/g, ""); render(); });

// ---- zone strip: drag, or tap a zone ----
const strip = $("strip");
let drag = null;
const xFromEvent = (e) => { const b = strip.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)); };
const ref = () => ref2k(state.tests, selTest());
strip.addEventListener("pointerdown", (e) => { if (!selTest()) return; drag = { x0: e.clientX, moved: false }; strip.setPointerCapture(e.pointerId); });
strip.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
  if (!drag.moved) return;
  strip.classList.add("dragging");
  setFromSplit(ref().split + offAt(xFromEvent(e))); render();
});
strip.addEventListener("pointerup", (e) => {
  if (!drag) return;
  strip.classList.remove("dragging");
  if (!drag.moved) {
    const off = offAt(xFromEvent(e)), hit = zoneAt(off);
    setFromSplit(ref().split + (hit.zone ? zoneMid(hit.zone) : off)); render();
    $("zDetails").open = true;
  }
  drag = null;
});
strip.addEventListener("pointercancel", () => { drag = null; strip.classList.remove("dragging"); });
strip.addEventListener("keydown", (e) => {
  // Left is slower, right is faster, in both modes.
  if (e.key === "ArrowLeft") { e.preventDefault(); step(state.mode === "pct" ? -1 : 1); }
  if (e.key === "ArrowRight") { e.preventDefault(); step(state.mode === "pct" ? 1 : -1); }
});

$("tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr"); if (!tr) return;
  state.mode = "pct"; state.pct = Number(tr.dataset.p); render();
});

// ---- share a target ----
$("shareBtn").addEventListener("click", async () => {
  const t = selTest();
  const key = t ? presetFor(t).key : null;
  const url = location.origin + location.pathname + buildShareQuery(state, key);
  const what = state.mode === "pct" ? `${state.pct}% of ${t && key !== "custom" ? testName(t) : "your test"} power` : `2k ${signed(state.sec)} s`;
  try {
    await navigator.clipboard.writeText(url);
    $("shareMsg").textContent = `Link copied: ${what}. Each rower sees their own split.`;
  } catch (err) {
    $("shareUrl").value = url; $("shareUrl").hidden = false; $("shareUrl").select();
    $("shareMsg").textContent = "Copy this link to share it.";
  }
});

// ---- coach links: ?pct=65&test=2k or ?sec=18 ----
function applyLink() {
  if (!location.search) return;
  const p = parseShareParams(location.search);
  if (p.mode) { state.mode = p.mode; if (p.mode === "pct") state.pct = p.value; else state.sec = p.value; }
  const what = p.mode === "pct" ? `${p.value}%` : p.mode === "sec" ? `2k ${signed(p.value)} s` : null;
  if (p.test) {
    const preset = PRESETS.find((x) => x.key === p.test);
    const matches = state.tests.filter((t) => !t.example && presetFor(t).key === p.test);
    if (matches.length) {
      const when = (t) => (t.date ? Date.parse(t.date + "T12:00:00Z") : t.createdAt ?? 0);
      const latest = matches.reduce((a, b) => (when(b) >= when(a) ? b : a));
      state.sel = latest.id;
      if (what) showNotice(`Target from your link: <b>${what} of your ${preset.label} power</b>.`);
    } else {
      showNotice(`This link uses your <b>${preset.label}</b> result, which isn't saved here yet. Add it to see your split.`, "warn",
        { label: `Add ${preset.label} test`, run: () => openEditor(null, preset.key) });
    }
  } else if (what) {
    showNotice(`Target from your link: <b>${what}</b>.`);
  }
  if (p.errors.length) showNotice(`Part of this link didn't work: ${p.errors.join("; ")}.`, "warn");
  history.replaceState(null, "", location.pathname);
}

applyLink();
render();
