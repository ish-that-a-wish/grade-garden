// Grade Garden — dashboard logic. Everything here runs in the browser;
// the Canvas token stays on the server.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5;
  const COLORS = ["pink", "lav", "mint", "sky", "peach", "butter"];
  const LETTERS = [[92.5, "A"], [89.5, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [60, "D"], [0, "F"]];
  const TARGETS = [92.5, 89.5, 87, 83, 80, 77, 73, 70];
  const TYPE_LABEL = { online_text_entry: "Text", online_url: "Link", online_upload: "File" };

  let data = null;
  let filter = load("gg.filter", "all");
  let targets = load("gg.targets", {});
  for (const k in targets) targets[k] = { 93: 92.5, 90: 89.5 }[targets[k]] ?? targets[k]; // old cutoffs
  let policies = load("gg.policies", {});
  let popped = load("gg.popped", {});
  let showAllQueue = false, showAllDue = false;
  let lastAll = [];
  const DEFAULT_POLICY = { rate: 10, per: "day", cap: 50, accepts: true };
  const policyOf = (cid) => ({ ...DEFAULT_POLICY, ...(policies[cid] || {}) });

  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  const letter = (p) => (p == null ? "–" : LETTERS.find(([min]) => p >= min)[1]);
  const pct = (p, d = 1) => (p == null ? "–" : `${(+p).toFixed(d)}%`);
  const pts = (n) => (Math.round(n * 100) / 100).toString();

  /* ---------------- grade math ---------------- */

  function counts(a) { return a.points > 0 && !a.omit && !a.sub.excused; }

  // Group totals: E = earned, P = possible (graded), R = possible still ungraded.
  function groupTotals(course, tweak) {
    const gs = new Map(course.groups.map((g) => [g.id, { ...g, E: 0, P: 0, R: 0 }]));
    for (const a of course.assignments) {
      if (!counts(a)) continue;
      if (!gs.has(a.group)) gs.set(a.group, { id: a.group, name: "Other", weight: 0, E: 0, P: 0, R: 0 });
      const g = gs.get(a.group);
      const t = tweak?.get(a.id);
      const score = t !== undefined ? t : a.sub.score;
      if (score === "skip") continue;
      if (score != null) { g.E += score; g.P += a.points; } else g.R += a.points;
    }
    return [...gs.values()];
  }

  // x = fraction earned on remaining work (null = ignore remaining, like Canvas "current" grade)
  function gradeOf(course, gs, x = null) {
    const useR = x != null;
    if (course.weighted) {
      let num = 0, w = 0;
      for (const g of gs) {
        const P = g.P + (useR ? g.R : 0);
        if (!P || !g.weight) continue;
        num += (g.weight * (g.E + (useR ? x * g.R : 0))) / P;
        w += g.weight;
      }
      return w ? (num / w) * 100 : null;
    }
    let E = 0, P = 0;
    for (const g of gs) { E += g.E + (useR ? x * g.R : 0); P += g.P + (useR ? g.R : 0); }
    return P ? (E / P) * 100 : null;
  }

  function analyze(course, idx) {
    const now = Date.now();
    const gs = groupTotals(course);
    const computed = gradeOf(course, gs);
    const current = course.score ?? computed;
    const color = COLORS[idx % COLORS.length];
    const target = targets[course.id] ?? 89.5;

    const live = course.assignments.filter(counts);
    const isMissing = (a) =>
      a.sub.score == null && !a.sub.submittedAt &&
      (a.sub.missing || (a.due && new Date(a.due) < now && (a.types.length > 0 || a.inCanvas)));
    const missing = live.filter(isMissing);
    const remaining = live.filter((a) => a.sub.score == null && !isMissing(a));

    // What a single assignment can move the final grade: full credit vs zero,
    // assuming everything else still ungraded lands at your current average.
    const pace = computed != null ? computed / 100 : 0.85;
    const swing = (a) => {
      const full = gradeOf(course, groupTotals(course, new Map([[a.id, a.points]])), pace);
      const zero = gradeOf(course, groupTotals(course, new Map([[a.id, 0]])), pace);
      return full != null && zero != null ? full - zero : 0;
    };
    // Grade points already lost on a graded assignment.
    const lost = (a) => {
      const full = gradeOf(course, groupTotals(course, new Map([[a.id, a.points]])));
      return full != null && computed != null ? full - computed : 0;
    };

    const graded = live.filter((a) => a.sub.score != null).map((a) => ({ a, cost: lost(a) }));
    const missingInfo = missing.map((a) => ({ a, cost: swing(a) }));
    const upcoming = remaining.map((a) => ({ a, cost: swing(a) }));

    // Required average on everything not yet graded (missing counted as recoverable work).
    const g0 = gradeOf(course, gs, 0), g1 = gradeOf(course, gs, 1);
    let required = null;
    if (g0 != null && g1 != null && g1 - g0 > 0.01) required = ((target - g0) / (g1 - g0)) * 100;

    const weakGroup = course.weighted
      ? gs.filter((g) => g.weight > 0 && g.P > 0).map((g) => ({ ...g, avg: (g.E / g.P) * 100 })).sort((a, b) => a.avg - b.avg)[0]
      : null;

    return { course, color, current, letter: course.grade || letter(current), target, gs, graded, missingInfo, upcoming, required, best: g1, weakGroup };
  }

  /* ---------------- rendering ---------------- */

  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  function relDay(d) {
    const a = new Date(d); a.setHours(0, 0, 0, 0);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    const n = Math.round((a - b) / DAY);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    if (n > 1 && n < 7) return new Date(d).toLocaleDateString(undefined, { weekday: "long" });
    return fmtDay(d);
  }
  const cvars = (c) => `--c-bg:var(--${c});--c-ink:var(--${c}-ink)`;

  function render() {
    const all = data.courses.map(analyze);
    const shown = filter === "all" ? all : all.filter((x) => String(x.course.id) === String(filter));
    if (!shown.length && filter !== "all") { filter = "all"; return render(); }
    const byId = new Map(all.map((x) => [x.course.id, x]));

    // greeting + stats
    const first = (data.me.name || "").split(" ")[0];
    $("#hi").textContent = first ? `Hi, ${first}` : "Hi there";
    $("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const scores = all.map((x) => x.current).filter((v) => v != null);
    const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
    const weekEnd = Date.now() + 7 * DAY;
    const dueWeek = all.flatMap((x) => x.course.assignments).filter((a) => a.due && +new Date(a.due) >= Date.now() && +new Date(a.due) <= weekEnd && !a.sub.submittedAt && a.sub.score == null).length;
    const missingCount = all.reduce((s, x) => s + x.missingInfo.length, 0);
    const below = all.filter((x) => x.current != null && x.current < x.target).length;
    $("#stats").innerHTML = [
      `<span class="stat"><i style="background:var(--lav);color:var(--lav-ink)">∅</i><b class="num">${pct(avg)}</b> average</span>`,
      `<span class="stat"><i style="background:var(--sky);color:var(--sky-ink)">◷</i><b class="num">${dueWeek}</b> due this week</span>`,
      `<span class="stat"><i style="background:${missingCount ? "var(--bad-bg);color:var(--bad)" : "var(--good-bg);color:var(--good)"}">!</i><b class="num">${missingCount}</b> missing</span>`,
    ].join("");

    $("#demoNote").hidden = !data.demo;

    // course cards
    const C = 2 * Math.PI * 32;
    $("#courses").innerHTML = all.length
      ? all.map((x) => {
          const p = Math.max(0, Math.min(100, x.current ?? 0));
          const gap = x.current == null ? null : x.current - x.target;
          const status = gap == null ? `<span class="pill soft">No grades yet</span>`
            : gap >= 0 ? `<span class="pill good">On track for ${letter(x.target)}</span>`
            : gap > -3 ? `<span class="pill warn num">${Math.abs(gap).toFixed(1)}% below ${letter(x.target)}</span>`
            : `<span class="pill bad num">${Math.abs(gap).toFixed(1)}% below ${letter(x.target)}</span>`;
          return `<button class="course" style="${cvars(x.color)}" data-f="${x.course.id}" aria-pressed="${String(filter) === String(x.course.id)}">
            <div class="ring"><svg viewBox="0 0 76 76" aria-hidden="true">
              <circle cx="38" cy="38" r="32" fill="none" stroke="var(--c-bg)" stroke-width="8"/>
              <circle cx="38" cy="38" r="32" fill="none" stroke="var(--c-ink)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(C * p) / 100} ${C}"/>
            </svg><div class="letter"><div><b>${esc(x.letter)}</b><span class="num">${pct(x.current)}</span></div></div></div>
            <div style="min-width:0"><div class="code">${esc(x.course.code)}</div><div class="name">${esc(x.course.name)}</div>${status}</div>
          </button>`;
        }).join("")
      : `<div class="empty">No active courses found in Canvas.</div>`;

    lastAll = all;
    renderDue(shown);
    renderPolicies(all);
    renderQueue();
    renderPlans(shown);
    $("#synced").textContent = `Synced ${fmtTime(data.fetchedAt)}`;
  }

  function statusPill(a) {
    if (a.sub.score != null) return `<span class="pill good num">${pts(a.sub.score)}/${pts(a.points)}</span>`;
    if (a.sub.submittedAt) return `<span class="pill good">Turned in</span>`;
    if (a.sub.missing) return `<span class="pill bad">Missing</span>`;
    return "";
  }
  function submitBtn(a, x, label) {
    if (!a.canSubmit) return "";
    const again = a.sub.submittedAt || a.sub.score != null;
    return `<button class="btn ${again ? "" : "primary"} small" data-submit="${x.course.id}:${a.id}">${label || (again ? "Resubmit" : "Submit")}</button>`;
  }

  function renderDue(shown) {
    const now = Date.now(), end = now + (showAllDue ? 21 : 7) * DAY;
    const items = shown.flatMap((x) => x.course.assignments.filter((a) => a.due && +new Date(a.due) >= now - 3600e3 && +new Date(a.due) <= end).map((a) => ({ a, x })))
      .sort((p, q) => new Date(p.a.due) - new Date(q.a.due));
    const toggle = `<li class="qfoot"><button class="linkish" data-due-toggle>${showAllDue ? "Show just this week" : "Show the next 3 weeks"}</button></li>`;
    if (!items.length) { $("#due").innerHTML = `<li class="empty">Nothing due ${showAllDue ? "in the next three weeks" : "this week"}.</li>` + toggle; return; }
    let lastWeek = null;
    $("#due").innerHTML = items.map(({ a, x }) => {
      const d = new Date(a.due);
      const wk = +d - now < 7 * DAY ? "This week" : +d - now < 14 * DAY ? "Next week" : "Later";
      const head = showAllDue && wk !== lastWeek ? `<li class="group-label">${wk}</li>` : "";
      lastWeek = wk;
      return `${head}<li class="row" style="${cvars(x.color)}">
        <div class="when"><span>${d.toLocaleDateString(undefined, { month: "short" })}</span><b class="num">${d.getDate()}</b></div>
        <div class="what"><div class="t">${a.url && a.url !== "#" ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}</div>
          <div class="m"><span><span class="dot" style="background:var(--c-ink)"></span> ${esc(x.course.code)}</span><span>${relDay(a.due)}, ${fmtTime(a.due)}</span></div></div>
        <div class="act">${statusPill(a)}</div>
      </li>`;
    }).join("") + toggle;
  }

  /* ---------- late penalties + priority queue ---------- */

  function renderPolicies(all) {
    const box = $("#policies");
    if (box.contains(document.activeElement)) return; // don't disturb typing during auto-refresh
    box.innerHTML = all.map((x) => {
      const p = policyOf(x.course.id), id = x.course.id;
      return `<div class="pol" style="${cvars(x.color)}" data-pol="${id}">
        <div class="who"><span class="dot" style="background:var(--c-ink)"></span>${esc(x.course.code || x.course.name)}</div>
        <label><input type="checkbox" id="pol-acc-${id}" data-k="accepts" ${p.accepts ? "checked" : ""}> Takes late work</label>
        <span class="polctl ${p.accepts ? "" : "off"}" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">
          <label>−<input type="number" id="pol-rate-${id}" data-k="rate" min="0" max="100" step="1" value="${p.rate}" ${p.accepts ? "" : "disabled"}>%</label>
          <select id="pol-per-${id}" data-k="per" aria-label="Penalty period" ${p.accepts ? "" : "disabled"}>
            <option value="day" ${p.per === "day" ? "selected" : ""}>per day</option>
            <option value="week" ${p.per === "week" ? "selected" : ""}>per week</option>
            <option value="once" ${p.per === "once" ? "selected" : ""}>flat, once</option>
          </select>
          <label>max <input type="number" id="pol-cap-${id}" data-k="cap" min="0" max="100" step="1" value="${p.cap}" ${p.accepts ? "" : "disabled"}>%</label>
        </span>
      </div>`;
    }).join("") + `<div class="pol-note">Example: −10% per day, max 50% means 3 days late earns at most 70%. Turn off "Takes late work" for classes that give zeros. Canvas lock dates are respected automatically.</div>`;
  }

  // Penalty (0–1) after being `days` late under policy p.
  function penaltyAt(p, days) {
    if (days <= 0) return 0;
    if (!p.accepts) return 1;
    const raw = p.per === "once" ? p.rate : p.per === "week" ? p.rate * Math.ceil(days / 7) : p.rate * Math.ceil(days);
    return Math.min(p.cap, raw) / 100;
  }

  function buildQueue() {
    const now = Date.now(), items = [], lostCause = [];
    for (const x of lastAll) {
      const p = policyOf(x.course.id);
      const lateItems = x.missingInfo.map((m) => ({ ...m, late: true }));
      const soonItems = x.upcoming
        .filter((u) => u.a.due && !u.a.sub.submittedAt && +new Date(u.a.due) - now < 21 * DAY)
        .map((u) => ({ ...u, late: false }));
      for (const it of [...lateItems, ...soonItems]) {
        const a = it.a;
        if (popped[a.id]) continue;
        const due = new Date(a.due);
        const lock = a.lock ? new Date(a.lock) : null;
        let value, runway, why, perDayLoss;
        if (it.late) {
          const daysLate = (now - due) / DAY;
          const closed = !p.accepts || (lock && lock < now) || a.locked || (!a.canSubmit && !a.inCanvas);
          const penNow = closed ? 1 : penaltyAt(p, daysLate);
          const penTomorrow = closed ? 1 : penaltyAt(p, daysLate + 1);
          value = it.cost * (1 - penNow);
          perDayLoss = it.cost * (penTomorrow - penNow);
          if (value < 0.05) { lostCause.push({ a, x, cost: it.cost }); continue; }
          runway = perDayLoss > 0.001 ? 0.5 : lock ? Math.max((lock - now) / DAY, 0.5) : 7;
          const dl = Math.max(1, Math.ceil(daysLate));
          why = `${dl} day${dl === 1 ? "" : "s"} late · −${Math.round(penNow * 100)}% penalty · worth <b class="num">${value.toFixed(1)}%</b> now` +
            (perDayLoss > 0.01 ? `, losing <b class="num">${perDayLoss.toFixed(1)}%</b> a day` : ", no further penalty") +
            (lock ? ` · closes ${relDay(lock)}` : "");
        } else {
          const daysLeft = (due - now) / DAY;
          value = it.cost;
          runway = Math.max(daysLeft, 0.5);
          perDayLoss = it.cost * penaltyAt(p, 1);
          const lateNote = !p.accepts ? "no late work accepted" : `late costs ${perDayLoss.toFixed(1)}%${p.per === "day" ? " a day" : p.per === "week" ? " a week" : ""}`;
          why = `Due ${relDay(a.due)}, ${fmtTime(a.due)} · worth <b class="num">${value.toFixed(1)}%</b> · ${lateNote}`;
        }
        const short = it.late ? `${Math.max(1, Math.ceil((now - due) / DAY))}d late · ${value.toFixed(1)}%` : `${relDay(a.due)} · ${value.toFixed(1)}%`;
        items.push({ a, x, late: it.late, value, runway, why, short, priority: value / runway });
      }
    }
    items.sort((p, q) => q.priority - p.priority || p.runway - q.runway);
    return { items, lostCause };
  }

  function renderQueue() {
    const { items, lostCause } = buildQueue();
    const nPopped = Object.keys(popped).length;
    const actions = (it, big) => {
      const sub = it.a.canSubmit ? `<button class="btn ${big ? "go" : "primary"} small" data-submit="${it.x.course.id}:${it.a.id}">${it.late ? "Turn in" : "Submit"}</button>` : "";
      return `${sub}<button class="btn small" data-pop="${it.a.id}" aria-label="Mark ${esc(it.a.name)} done">Done</button>`;
    };
    let html = "";
    if (!items.length) {
      html = `<div class="empty">Queue's empty. Everything due soon is handled.</div>`;
    } else {
      const [top, ...rest] = items;
      html += `<div class="next" style="${cvars(top.x.color)}">
        <div class="eyebrow">Up next · ${esc(top.x.course.code)}</div>
        <div class="t">${esc(top.a.name)}</div>
        <div class="why">${top.why}</div>
        <div class="btns">${actions(top, true)}${top.a.url && top.a.url !== "#" ? `<a class="btn small" href="${esc(top.a.url)}" target="_blank" rel="noopener">Open in Canvas</a>` : ""}</div>
      </div>`;
      if (rest.length) {
        html += `<ol class="qlist">${rest.slice(0, showAllQueue ? 99 : 4).map((it) => `<li class="qrow" style="${cvars(it.x.color)}">
          <div class="what"><div class="t">${esc(it.a.name)}</div>
            <div class="m"><span><span class="dot" style="background:var(--c-ink)"></span> ${esc(it.x.course.code)}</span><span class="num">${it.short}</span></div></div>
          <div class="act">${actions(it, false)}</div>
        </li>`).join("")}</ol>`;
        if (rest.length > 4) html += `<div class="qfoot"><button class="linkish" data-q-toggle>${showAllQueue ? "Show less" : `Show all ${rest.length + 1}`}</button></div>`;
      }
    }
    if (lostCause.length) {
      html += `<div class="lost-box"><b>Can't be turned in for credit anymore:</b> ${lostCause.map((l) => `${esc(l.a.name)} (${esc(l.x.course.code)}, ${l.cost.toFixed(1)}%)`).join(", ")}. Worth an email to ask for an exception.</div>`;
    }
    if (nPopped) html += `<div class="qfoot"><span>${nPopped} popped off</span><button class="linkish" data-restore>Bring them back</button></div>`;
    $("#queue").innerHTML = html;
  }

  function pop(id) {
    popped[id] = Date.now(); save("gg.popped", popped);
    renderQueue();
    const next = buildQueue().items[0];
    return next;
  }

  // Forget pops for things that are no longer in Canvas or are long past, so storage stays small.
  function prunePopped() {
    const ids = new Set(data.courses.flatMap((c) => c.assignments.map((a) => String(a.id))));
    for (const k of Object.keys(popped)) if (!ids.has(String(k)) || Date.now() - popped[k] > 60 * DAY) delete popped[k];
    save("gg.popped", popped);
  }

  function planSteps(x) {
    const steps = [];
    const { course, current, target, required, best, missingInfo, upcoming, graded, weakGroup } = x;

    if (required != null) {
      const left = upcoming.length + missingInfo.length;
      if (required <= 0) steps.push(`${letter(target)} is locked in. Keep the cushion.`);
      else if (required <= 100) steps.push(`Average <b class="num">${Math.ceil(required)}%</b> on the ${left} assignment${left === 1 ? "" : "s"} left.`);
      else steps.push(`The most you can reach is <b class="num">${best.toFixed(1)}%</b> (${letter(best)}). Ask about extra credit, or aim for ${letter(best)}.`);
    } else if (current != null && current < target) {
      steps.push(`No more graded work is posted. Ask what's still coming.`);
    }
    const nextBig = upcoming.filter((u) => u.a.due && new Date(u.a.due) > Date.now()).sort((p, q) => q.cost - p.cost)[0];
    if (nextBig && nextBig.cost > 0.5) steps.push(`Focus on <b>${esc(nextBig.a.name)}</b> (${fmtDay(nextBig.a.due)}), worth <b class="num">${nextBig.cost.toFixed(1)}%</b>.`);
    if (weakGroup && weakGroup.avg < target - 2) steps.push(`${esc(weakGroup.name)} average is <b class="num">${weakGroup.avg.toFixed(0)}%</b> (${weakGroup.weight}% of the grade). Review feedback before the next one.`);
    const worst = graded.slice().sort((p, q) => q.cost - p.cost)[0];
    if (worst && worst.cost >= 2) steps.push(`Ask about a retake on <b>${esc(worst.a.name)}</b>, which cost <b class="num">${worst.cost.toFixed(1)}%</b>.`);
    if (!steps.length) steps.push(`Nothing urgent. Keep submitting on time.`);
    return steps.slice(0, 3);
  }

  // Every overdue item for a class, valued after its late penalty.
  function overdueList(x) {
    const p = policyOf(x.course.id), now = Date.now();
    const rows = x.missingInfo.map(({ a, cost }) => {
      const daysLate = a.due ? (now - new Date(a.due)) / DAY : 0;
      const closed = !p.accepts || (a.lock && new Date(a.lock) < now) || a.locked || (!a.canSubmit && !a.inCanvas);
      const value = closed ? 0 : cost * (1 - penaltyAt(p, daysLate));
      const dl = Math.max(1, Math.ceil(daysLate));
      const meta = closed
        ? `${dl}d late · closed, email your teacher`
        : `${dl}d late · worth <b class="num">${value.toFixed(1)}%</b>${a.lock ? ` · closes ${relDay(a.lock)}` : ""}`;
      const btn = closed ? ""
        : a.canSubmit ? `<button class="btn small go" data-submit="${x.course.id}:${a.id}">Turn in</button>`
        : a.url && a.url !== "#" ? `<a class="btn small" href="${esc(a.url)}" target="_blank" rel="noopener">Open in Canvas</a>`
        : `<span class="pill soft">Do in Canvas</span>`;
      return { value, closed, html: `<li><div class="what"><div class="t">${esc(a.name)}</div><div class="m">${meta}</div></div>${btn}</li>` };
    }).sort((p, q) => q.value - p.value || p.closed - q.closed);
    if (!rows.length) return "";
    return `<div class="todo"><div class="todo-h">To turn in · ${rows.length}</div><ul>${rows.map((r) => r.html).join("")}</ul></div>`;
  }

  function renderPlans(shown) {
    const ordered = shown.slice().sort((p, q) => ((p.current ?? 100) - p.target) - ((q.current ?? 100) - q.target));
    $("#plans").innerHTML = ordered.map((x) => {
      const cur = x.current;
      const lo = 50;
      const scale = (v) => Math.max(0, Math.min(100, ((v - lo) / (100 - lo)) * 100));
      return `<article class="plan" style="${cvars(x.color)}">
        <div class="plan-head">
          <div class="n"><span class="dot" style="background:var(--c-ink)"></span>${esc(x.course.code || x.course.name)}</div>
          <label class="target">Target
            <select data-target="${x.course.id}" aria-label="Target grade for ${esc(x.course.name)}">
              ${TARGETS.map((t) => `<option value="${t}" ${t === x.target ? "selected" : ""}>${letter(t)} (${t}%)</option>`).join("")}
            </select></label>
        </div>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${cur == null ? 0 : scale(cur)}%"></div><div class="goal" style="left:calc(${scale(x.target)}% - 1.5px)"></div></div>
        <div class="track-labels num"><span>Now ${pct(cur)}</span><span>Goal ${x.target}%</span></div>
        ${overdueList(x)}${cur != null && cur >= x.target ? `<p class="calm">On track. Keep turning work in on time.</p>` : `<ol class="steps">${planSteps(x).map((s) => `<li><div>${s}</div></li>`).join("")}</ol>`}
      </article>`;
    }).join("") || `<div class="empty">Add a class in Canvas to see a plan.</div>`;
  }

  /* ---------------- data loading ---------------- */

  async function api(path, opts) {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && json.error === "signin") { showSignin(); throw new Error("signin"); }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function refresh(fresh = false) {
    const btn = $("#refresh");
    btn.classList.add("spin"); btn.disabled = true;
    try {
      data = await api(`/api/dashboard${fresh ? "?fresh=1" : ""}`);
      $("#loadErr").hidden = true;
      prunePopped();
      render();
    } catch (e) {
      if (e.message !== "signin") { $("#loadErr").textContent = e.message; $("#loadErr").hidden = false; }
    } finally { btn.classList.remove("spin"); btn.disabled = false; }
  }

  function showSignin() { $("#app").hidden = true; $("#signin").hidden = false; $("#password").focus(); }

  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#password").value }) });
      $("#signin").hidden = true; $("#app").hidden = false; refresh(true);
    } catch (err) { $("#signinErr").textContent = err.message; $("#signinErr").hidden = false; }
  });

  /* ---------------- interactions ---------------- */

  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]");
    if (f) {
      filter = f.dataset.f === filter ? "all" : f.dataset.f;
      save("gg.filter", filter); render(); return;
    }
    const s = e.target.closest("[data-submit]");
    if (s) { const [cid, aid] = s.dataset.submit.split(":"); openSubmit(cid, aid); return; }
    const p = e.target.closest("[data-pop]");
    if (p) {
      const name = p.closest(".next, .qrow")?.querySelector(".t")?.textContent || "That one";
      const next = pop(p.dataset.pop);
      toast(next ? `Popped ${name}. Next up: ${next.a.name}` : `Popped ${name}. Queue's clear.`);
      return;
    }
    if (e.target.closest("[data-q-toggle]")) { showAllQueue = !showAllQueue; renderQueue(); return; }
    if (e.target.closest("[data-due-toggle]")) { showAllDue = !showAllDue; render(); return; }
    if (e.target.closest("[data-restore]")) { popped = {}; save("gg.popped", popped); renderQueue(); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target.closest("[data-target]");
    if (t) { targets[t.dataset.target] = +t.value; save("gg.targets", targets); render(); }
  });
  function onPolicy(e) {
    const row = e.target.closest("[data-pol]");
    const k = e.target.dataset.k;
    if (!row || !k) return;
    const id = row.dataset.pol;
    const p = policyOf(id);
    if (k === "accepts") {
      p.accepts = e.target.checked;
      row.querySelectorAll("input[type=number], select").forEach((el) => (el.disabled = !p.accepts));
      row.querySelector(".polctl")?.classList.toggle("off", !p.accepts);
    } else if (k === "per") p.per = e.target.value;
    else {
      const v = parseFloat(e.target.value);
      if (Number.isNaN(v)) return;
      p[k] = Math.max(0, Math.min(100, v));
    }
    policies[id] = p; save("gg.policies", policies);
    renderQueue();
  }
  $("#policies").addEventListener("input", onPolicy);
  $("#policies").addEventListener("change", onPolicy);
  $("#refresh").addEventListener("click", () => refresh(true));

  /* ---------------- submit dialog ---------------- */

  const dlg = $("#submitDlg");
  let cur = null, type = null, files = [], armed = false;

  function openSubmit(cid, aid) {
    const course = data.courses.find((c) => String(c.id) === String(cid));
    const a = course?.assignments.find((x) => String(x.id) === String(aid));
    if (!a) return;
    cur = { course, a }; files = []; armed = false;
    $("#dlgTitle").textContent = a.name;
    $("#dlgMeta").textContent = `${course.code || course.name} · ${a.due ? `Due ${fmtDay(a.due)}, ${fmtTime(a.due)}` : "No due date"} · ${pts(a.points)} pts`;
    $("#dlgTypes").innerHTML = a.types.map((t) => `<button type="button" data-type="${t}">${TYPE_LABEL[t]}</button>`).join("");
    $("#dlgTypes").hidden = a.types.length < 2;
    $("#dlgBody").value = load(`gg.draft.${a.id}`, "");
    $("#dlgUrl").value = ""; $("#dlgComment").value = "";
    $("#extNote").textContent = a.allowedExt.length ? `Allowed: ${a.allowedExt.map((x) => "." + x).join(" ")}` : "";
    $("#dlgFiles").accept = a.allowedExt.map((x) => "." + x).join(",");
    $("#dlgErr").hidden = true;
    setType(a.types[0]); renderFiles(); disarm();
    dlg.showModal();
  }
  function setType(t) {
    type = t;
    for (const b of $("#dlgTypes").children) b.setAttribute("aria-pressed", b.dataset.type === t);
    for (const p of dlg.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== t;
    disarm();
  }
  function disarm() { armed = false; $("#dlgSend").textContent = "Turn in"; $("#confirmLine").textContent = "This sends your work to Canvas."; }
  function renderFiles() {
    $("#fileList").innerHTML = files.map((f, i) => `<li><span>${esc(f.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join("");
  }

  $("#dlgTypes").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) setType(b.dataset.type); });
  $("#dlgCancel").addEventListener("click", () => dlg.close());
  $("#dlgBody").addEventListener("input", () => { if (cur) save(`gg.draft.${cur.a.id}`, $("#dlgBody").value); disarm(); });
  $("#dlgUrl").addEventListener("input", disarm);
  $("#dlgFiles").addEventListener("change", (e) => { files.push(...e.target.files); e.target.value = ""; renderFiles(); disarm(); });
  $("#fileList").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); renderFiles(); disarm(); } });
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { files.push(...e.dataTransfer.files); renderFiles(); disarm(); });

  const toHtml = (t) => t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

  $("#dlgSend").addEventListener("click", async () => {
    const err = $("#dlgErr"); err.hidden = true;
    const body = $("#dlgBody").value.trim(), url = $("#dlgUrl").value.trim();
    const problem =
      type === "online_text_entry" && !body ? "Write something before turning it in." :
      type === "online_url" && !/^https?:\/\//i.test(url) ? "Paste a full link starting with https://." :
      type === "online_upload" && !files.length ? "Attach at least one file." : null;
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    if (!armed) {
      armed = true;
      $("#dlgSend").textContent = "Yes, turn it in";
      $("#confirmLine").textContent = "Double-check, then confirm. Canvas records this as your submission.";
      return;
    }
    const fd = new FormData();
    fd.append("type", type);
    if (type === "online_text_entry") fd.append("body", toHtml(body));
    if (type === "online_url") fd.append("url", url);
    for (const f of files) fd.append("files", f, f.name);
    fd.append("comment", $("#dlgComment").value);
    const btn = $("#dlgSend"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await api(`/api/submit/${cur.course.id}/${cur.a.id}`, { method: "POST", body: fd });
      save(`gg.draft.${cur.a.id}`, "");
      if (r.demo) { cur.a.sub.submittedAt = r.submittedAt; cur.a.sub.missing = false; }
      dlg.close();
      const next = pop(cur.a.id);
      const after = next ? ` Next up: ${next.a.name}` : "";
      toast((r.demo ? "Turned in (demo, nothing sent)." : "Turned in to Canvas.") + after);
      if (r.demo) render(); else refresh(true);
    } catch (e) {
      err.textContent = e.message; err.hidden = false; disarm();
    } finally { btn.disabled = false; if (!armed) btn.textContent = "Turn in"; }
  });

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  /* ---------------- start ---------------- */

  (async () => {
    try {
      const s = await api("/api/session");
      if (!s.signedIn) return showSignin();
    } catch {}
    refresh();
    setInterval(() => { if (document.visibilityState === "visible" && !dlg.open) refresh(); }, 120e3);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && data && Date.now() - new Date(data.fetchedAt) > 60e3) refresh(); });
  })();
})();
