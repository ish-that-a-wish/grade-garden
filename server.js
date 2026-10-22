// Grade Garden — a tiny server that talks to Canvas for you.
// It keeps your Canvas token on the server (never in the browser),
// serves the dashboard page, and forwards submissions to Canvas.

import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoCourses } from "./demo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANVAS_URL = (process.env.CANVAS_URL || "").trim().replace(/\/+$/, "");
const CANVAS_TOKEN = (process.env.CANVAS_TOKEN || "").trim();
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PORT = process.env.PORT || 3000;
const DEMO = !CANVAS_URL || !CANVAS_TOKEN;
const SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(`gg:${APP_PASSWORD}:${CANVAS_TOKEN}`).digest("hex");
const SESSION_VALUE = crypto.createHmac("sha256", SECRET).update("signed-in").digest("hex");
const CACHE_MS = 30_000;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 10 } });
app.use(express.json({ limit: "2mb" }));

/* ---------- password gate (only when APP_PASSWORD is set) ---------- */

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").filter(Boolean).map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    })
  );
}
function signedIn(req) {
  if (!APP_PASSWORD) return true;
  const v = cookies(req).gg_session || "";
  return v.length === SESSION_VALUE.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(SESSION_VALUE));
}

app.get("/api/session", (req, res) => res.json({ signedIn: signedIn(req), needsPassword: !!APP_PASSWORD, demo: DEMO }));

app.post("/api/login", (req, res) => {
  const given = String(req.body?.password || "");
  const ok =
    APP_PASSWORD &&
    given.length === APP_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(APP_PASSWORD));
  if (!ok) return res.status(401).json({ error: "That password doesn't match. Try again." });
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `gg_session=${SESSION_VALUE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "gg_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => (signedIn(req) ? next() : res.status(401).json({ error: "signin" })));

/* ---------- Canvas helpers ---------- */

async function canvas(urlOrPath, opts = {}) {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${CANVAS_URL}/api/v1${urlOrPath}`;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${CANVAS_TOKEN}`, Accept: "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Canvas said ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function nextLink(header) {
  if (!header) return null;
  const part = header.split(",").find((p) => p.includes('rel="next"'));
  return part ? part.match(/<([^>]+)>/)[1] : null;
}

async function getAll(p) {
  let url = `${CANVAS_URL}/api/v1${p}`;
  const out = [];
  while (url) {
    const res = await canvas(url);
    const data = await res.json();
    out.push(...(Array.isArray(data) ? data : [data]));
    url = nextLink(res.headers.get("link"));
  }
  return out;
}

const SUBMITTABLE = ["online_text_entry", "online_url", "online_upload"];

function slimAssignment(a) {
  const s = a.submission || {};
  const types = (a.submission_types || []).filter((t) => SUBMITTABLE.includes(t));
  return {
    id: a.id,
    name: a.name,
    due: a.due_at,
    lock: a.lock_at,
    points: a.points_possible || 0,
    group: a.assignment_group_id,
    url: a.html_url,
    omit: !!a.omit_from_final_grade,
    types,
    canSubmit: types.length > 0 && !a.locked_for_user,
    allowedExt: a.allowed_extensions || [],
    sub: {
      score: s.score ?? null,
      state: s.workflow_state || "unsubmitted",
      submittedAt: s.submitted_at || null,
      missing: !!s.missing,
      late: !!s.late,
      excused: !!s.excused,
    },
  };
}

let cache = null;

async function loadDashboard() {
  if (DEMO) {
    return {
      demo: true,
      me: { name: "Demo Student" },
      canvasUrl: null,
      fetchedAt: new Date().toISOString(),
      courses: demoCourses().map((c) => ({ ...c, assignments: c.assignments.map(slimAssignment) })),
    };
  }
  const [meRes, courses] = await Promise.all([
    canvas("/users/self").then((r) => r.json()),
    getAll("/courses?enrollment_state=active&enrollment_type=student&include[]=total_scores&include[]=term&per_page=100"),
  ]);
  const usable = courses.filter((c) => c.name && !c.access_restricted_by_date);
  const full = await Promise.all(
    usable.map(async (c) => {
      const [groups, assignments] = await Promise.all([
        getAll(`/courses/${c.id}/assignment_groups?per_page=100`).catch(() => []),
        getAll(`/courses/${c.id}/assignments?include[]=submission&order_by=due_at&per_page=100`).catch(() => []),
      ]);
      const enr = (c.enrollments || []).find((e) => e.type === "student") || {};
      return {
        id: c.id,
        name: c.name,
        code: c.course_code,
        url: `${CANVAS_URL}/courses/${c.id}`,
        weighted: !!c.apply_assignment_group_weights,
        score: enr.computed_current_score ?? null,
        grade: enr.computed_current_grade ?? null,
        groups: groups.map((g) => ({ id: g.id, name: g.name, weight: g.group_weight || 0 })),
        assignments: assignments.filter((a) => a.published !== false).map(slimAssignment),
      };
    })
  );
  return {
    demo: false,
    me: { name: meRes.short_name || meRes.name },
    canvasUrl: CANVAS_URL,
    fetchedAt: new Date().toISOString(),
    courses: full,
  };
}

app.get("/api/dashboard", async (req, res) => {
  try {
    const force = req.query.fresh === "1";
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return res.json(cache.data);
    const data = await loadDashboard();
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    const msg =
      e.status === 401
        ? "Canvas didn't accept the access token. Make a new token in Canvas → Account → Settings and update CANVAS_TOKEN."
        : e.message;
    res.status(502).json({ error: msg });
  }
});

/* ---------- submissions ---------- */

async function uploadFile(courseId, assignmentId, f) {
  const init = await canvas(`/courses/${courseId}/assignments/${assignmentId}/submissions/self/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: f.originalname, size: f.size, content_type: f.mimetype || "application/octet-stream" }),
  }).then((r) => r.json());

  const fd = new FormData();
  for (const [k, v] of Object.entries(init.upload_params || {})) fd.append(k, v);
  fd.append("file", new Blob([f.buffer], { type: f.mimetype || "application/octet-stream" }), f.originalname);

  // The upload URL is often on a separate storage host, so no Canvas token here.
  const up = await fetch(init.upload_url, { method: "POST", body: fd, redirect: "manual" });
  if (up.status >= 300 && up.status < 400) {
    const loc = up.headers.get("location");
    return (await canvas(loc).then((r) => r.json())).id;
  }
  if (!up.ok) throw new Error(`File upload for "${f.originalname}" failed (${up.status}).`);
  const json = await up.json();
  if (json.id) return json.id;
  if (json.location) return (await canvas(json.location).then((r) => r.json())).id;
  throw new Error(`Canvas didn't confirm the upload of "${f.originalname}".`);
}

app.post("/api/submit/:courseId/:assignmentId", upload.array("files"), async (req, res) => {
  const { courseId, assignmentId } = req.params;
  const { type, body, url, comment } = req.body || {};
  try {
    if (!SUBMITTABLE.includes(type)) throw new Error("Choose how to submit: text, link, or file.");
    if (type === "online_text_entry" && !String(body || "").trim()) throw new Error("Write something before turning it in.");
    if (type === "online_url" && !/^https?:\/\//i.test(String(url || ""))) throw new Error("Links need to start with http:// or https://.");
    if (type === "online_upload" && !(req.files || []).length) throw new Error("Attach at least one file.");

    if (DEMO) {
      await new Promise((r) => setTimeout(r, 700));
      return res.json({ ok: true, demo: true, submittedAt: new Date().toISOString() });
    }

    const submission = { submission_type: type };
    if (type === "online_text_entry") submission.body = body;
    if (type === "online_url") submission.url = url;
    if (type === "online_upload") {
      submission.file_ids = [];
      for (const f of req.files) submission.file_ids.push(await uploadFile(courseId, assignmentId, f));
    }
    const payload = { submission };
    if (String(comment || "").trim()) payload.comment = { text_comment: comment };

    const result = await canvas(`/courses/${courseId}/assignments/${assignmentId}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    cache = null;
    res.json({ ok: true, submittedAt: result.submitted_at, attempt: result.attempt });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- page ---------- */

app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => {
  console.log(`Grade Garden is running at http://localhost:${PORT}`);
  if (DEMO) console.log("No CANVAS_URL / CANVAS_TOKEN set, so it's showing demo data.");
});
