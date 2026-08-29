"use strict";

/* ============================================================================
   OneSemester
   A focus-first planner: finish the current semester before the next one
   even shows up as "active". Everything lives in localStorage — nothing
   ever leaves this device.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Constants
   -------------------------------------------------------------------------- */

const STORAGE_KEY = "onesemester:v1";
const COURSE_COLORS = ["#5b57ea", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#db2777", "#0d9488", "#7c3aed"];
const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["todo", "doing", "done"];

/* ----------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysUntil(iso) {
  const a = new Date(todayISO() + "T00:00:00");
  const b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/* ----------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

function defaultState() {
  return { version: 1, theme: "system", semesters: [] };
}

let state = loadState();
let ui = { view: "dashboard", selectedSemesterId: null, navOpen: false };
let pendingConfirm = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.semesters)) return defaultState();
    return Object.assign(defaultState(), parsed);
  } catch (e) {
    console.warn("OneSemester: could not read saved data, starting fresh.", e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("OneSemester: could not save data.", e);
    toast("⚠️ Could not save — your browser storage may be full or blocked.");
  }
}

/* ----------------------------------------------------------------------------
   Data helpers
   -------------------------------------------------------------------------- */

function getSemester(id) {
  return state.semesters.find((s) => s.id === id) || null;
}

function getCourse(semester, courseId) {
  return semester.courses.find((c) => c.id === courseId) || null;
}

function getTask(course, taskId) {
  return course.tasks.find((t) => t.id === taskId) || null;
}

function getCurrentSemester() {
  return state.semesters.find((s) => !s.completed) || null;
}

function allTasks(semester) {
  const out = [];
  for (const course of semester.courses) {
    for (const task of course.tasks) out.push({ task, course });
  }
  return out;
}

function semesterProgress(semester) {
  const tasks = allTasks(semester).map((x) => x.task);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function statusOf(semester) {
  if (semester.completed) return "completed";
  return getCurrentSemester()?.id === semester.id ? "current" : "upcoming";
}

/* ----------------------------------------------------------------------------
   Mutations
   -------------------------------------------------------------------------- */

function addSemester({ title, startDate, endDate }) {
  state.semesters.push({
    id: uid(), title: title.trim() || "Untitled semester", startDate, endDate,
    completed: false, goals: [], courses: [],
  });
  saveState();
  toast("Semester added");
}

function updateSemester(id, patch) {
  const s = getSemester(id);
  if (!s) return;
  Object.assign(s, patch);
  saveState();
}

function deleteSemester(id) {
  state.semesters = state.semesters.filter((s) => s.id !== id);
  if (ui.selectedSemesterId === id) ui.selectedSemesterId = null;
  saveState();
  toast("Semester deleted");
}

function moveSemester(id, dir) {
  const i = state.semesters.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.semesters.length) return;
  [state.semesters[i], state.semesters[j]] = [state.semesters[j], state.semesters[i]];
  saveState();
}

function setSemesterCompleted(id, completed) {
  updateSemester(id, { completed });
  toast(completed ? "🎉 Semester marked complete" : "Semester reopened");
}

function addGoal(semesterId, text) {
  const s = getSemester(semesterId);
  if (!s || !text.trim()) return;
  s.goals.push({ id: uid(), text: text.trim(), done: false });
  saveState();
}

function toggleGoal(semesterId, goalId) {
  const s = getSemester(semesterId);
  const g = s?.goals.find((g) => g.id === goalId);
  if (!g) return;
  g.done = !g.done;
  saveState();
}

function deleteGoal(semesterId, goalId) {
  const s = getSemester(semesterId);
  if (!s) return;
  s.goals = s.goals.filter((g) => g.id !== goalId);
  saveState();
}

function addCourse(semesterId, { name, credits, color }) {
  const s = getSemester(semesterId);
  if (!s || !name.trim()) return;
  s.courses.push({
    id: uid(), name: name.trim(), credits: Number(credits) || 0,
    color: color || COURSE_COLORS[s.courses.length % COURSE_COLORS.length],
    tasks: [],
  });
  saveState();
}

function updateCourse(semesterId, courseId, patch) {
  const s = getSemester(semesterId);
  const c = s && getCourse(s, courseId);
  if (!c) return;
  Object.assign(c, patch);
  saveState();
}

function deleteCourse(semesterId, courseId) {
  const s = getSemester(semesterId);
  if (!s) return;
  s.courses = s.courses.filter((c) => c.id !== courseId);
  saveState();
  toast("Course deleted");
}

function addTask(semesterId, courseId, { title, dueDate, priority }) {
  const s = getSemester(semesterId);
  const c = s && getCourse(s, courseId);
  if (!c || !title.trim()) return;
  c.tasks.push({ id: uid(), title: title.trim(), dueDate: dueDate || "", priority: priority || "medium", status: "todo" });
  saveState();
}

function updateTask(semesterId, courseId, taskId, patch) {
  const s = getSemester(semesterId);
  const c = s && getCourse(s, courseId);
  const t = c && getTask(c, taskId);
  if (!t) return;
  Object.assign(t, patch);
  saveState();
}

function deleteTask(semesterId, courseId, taskId) {
  const s = getSemester(semesterId);
  const c = s && getCourse(s, courseId);
  if (!c) return;
  c.tasks = c.tasks.filter((t) => t.id !== taskId);
  saveState();
}

/* ----------------------------------------------------------------------------
   Example / seed data
   -------------------------------------------------------------------------- */

function loadExampleData() {
  const past = {
    id: uid(), title: "Fall 2025", startDate: "2025-09-02", endDate: "2025-12-19", completed: true,
    goals: [{ id: uid(), text: "Finish with a 3.7 GPA", done: true }],
    courses: [
      { id: uid(), name: "Calculus II", credits: 4, color: COURSE_COLORS[0], tasks: [
        { id: uid(), title: "Problem set 6", dueDate: "2025-11-02", priority: "medium", status: "done" },
        { id: uid(), title: "Final exam", dueDate: "2025-12-15", priority: "high", status: "done" },
      ]},
      { id: uid(), name: "Intro to Economics", credits: 3, color: COURSE_COLORS[1], tasks: [
        { id: uid(), title: "Term paper", dueDate: "2025-12-01", priority: "high", status: "done" },
      ]},
    ],
  };
  const current = {
    id: uid(), title: "Spring 2026", startDate: "2026-01-20", endDate: "2026-05-15", completed: false,
    goals: [
      { id: uid(), text: "Land a summer internship", done: false },
      { id: uid(), text: "Keep GPA above 3.5", done: false },
    ],
    courses: [
      { id: uid(), name: "Data Structures", credits: 4, color: COURSE_COLORS[2], tasks: [
        { id: uid(), title: "Assignment 3: Trees", dueDate: addDaysISO(todayISO(), 2), priority: "high", status: "doing" },
        { id: uid(), title: "Reading: Ch. 7", dueDate: addDaysISO(todayISO(), 5), priority: "low", status: "todo" },
        { id: uid(), title: "Midterm exam", dueDate: addDaysISO(todayISO(), 20), priority: "high", status: "todo" },
      ]},
      { id: uid(), name: "Linear Algebra", credits: 3, color: COURSE_COLORS[3], tasks: [
        { id: uid(), title: "Problem set 2", dueDate: addDaysISO(todayISO(), -1), priority: "medium", status: "todo" },
        { id: uid(), title: "Quiz 3", dueDate: addDaysISO(todayISO(), 3), priority: "medium", status: "todo" },
      ]},
      { id: uid(), name: "Technical Writing", credits: 2, color: COURSE_COLORS[4], tasks: [
        { id: uid(), title: "Draft: proposal", dueDate: addDaysISO(todayISO(), 6), priority: "low", status: "todo" },
      ]},
    ],
  };
  const next = {
    id: uid(), title: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-18", completed: false,
    goals: [], courses: [],
  };
  state.semesters = [past, current, next];
  saveState();
  toast("Example data loaded");
}

/* ----------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

let toastTimer = null;
function toast(msg) {
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ""; }, 2600);
}

/* ----------------------------------------------------------------------------
   Modal
   -------------------------------------------------------------------------- */

function openModal(html, { wide = false } = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-box ${wide ? "wide" : ""}">${html}</div>`;
  root.hidden = false;
  const firstInput = root.querySelector("input, select, textarea, button");
  if (firstInput) firstInput.focus();
}

function closeModal() {
  const root = document.getElementById("modal-root");
  root.hidden = true;
  root.innerHTML = "";
  pendingConfirm = null;
}

function openConfirm(title, message, confirmLabel, onConfirm, danger = true) {
  pendingConfirm = onConfirm;
  openModal(`
    <h2>${esc(title)}</h2>
    <p>${esc(message)}</p>
    <div class="form-actions">
      <button type="button" class="btn" data-action="close-modal">Cancel</button>
      <button type="button" class="btn ${danger ? "danger" : "primary"}" data-action="confirm-yes">${esc(confirmLabel)}</button>
    </div>
  `);
}

/* ----------------------------------------------------------------------------
   Modal content builders
   -------------------------------------------------------------------------- */

function semesterFormModal(editId) {
  const s = editId ? getSemester(editId) : null;
  openModal(`
    <h2>${s ? "Edit semester" : "Add a semester"}</h2>
    <form data-form="semester" data-id="${editId || ""}">
      <div class="field">
        <label for="f-title">Name</label>
        <input id="f-title" name="title" type="text" placeholder="e.g. Spring 2026" required value="${esc(s?.title || "")}" />
      </div>
      <div class="form-row">
        <div class="field">
          <label for="f-start">Start date</label>
          <input id="f-start" name="startDate" type="date" value="${esc(s?.startDate || "")}" />
        </div>
        <div class="field">
          <label for="f-end">End date</label>
          <input id="f-end" name="endDate" type="date" value="${esc(s?.endDate || "")}" />
        </div>
      </div>
      <p class="hint">New semesters join the end of the queue and stay "upcoming" until every semester before them is complete.</p>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${s ? "Save changes" : "Add semester"}</button>
      </div>
    </form>
  `);
}

function importModal() {
  openModal(`
    <h2>Import data</h2>
    <p>Choose a OneSemester export file (<code>.json</code>). This will <strong>replace</strong> everything currently stored on this device.</p>
    <div class="field">
      <input id="import-file" type="file" accept="application/json" />
    </div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="close-modal">Cancel</button>
    </div>
  `);
  document.getElementById("import-file").addEventListener("change", onImportFileChosen);
}

function onImportFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.semesters)) throw new Error("missing semesters[]");
      openConfirm(
        "Replace all data?",
        `This file has ${parsed.semesters.length} semester(s). Importing will overwrite everything currently saved on this device. This can't be undone.`,
        "Import & replace",
        () => {
          state = Object.assign(defaultState(), parsed);
          saveState();
          applyTheme();
          closeModal();
          ui.view = "dashboard";
          render();
          toast("Data imported");
        }
      );
    } catch (err) {
      closeModal();
      toast("⚠️ That file doesn't look like a valid OneSemester export.");
    }
  };
  reader.readAsText(file);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `onesemester-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}

/* ----------------------------------------------------------------------------
   Rendering — shared bits
   -------------------------------------------------------------------------- */

function statusBadge(status) {
  const label = { current: "Current", completed: "Completed", upcoming: "Upcoming" }[status];
  const icon = { current: "🎯", completed: "✓", upcoming: "🔒" }[status];
  return `<span class="badge ${status}">${icon} ${label}</span>`;
}

function progressBar(percent, done, total, extraLabel) {
  return `
    <div class="progress-row">
      <div class="progress-track"><div class="progress-fill ${percent >= 100 ? "complete" : ""}" style="width:${percent}%"></div></div>
      <span class="progress-label">${extraLabel || `${done}/${total} tasks`}</span>
    </div>`;
}

function priorityBadge(p) {
  return `<span class="badge priority-${p}">${p}</span>`;
}

/* ----------------------------------------------------------------------------
   Dashboard view
   -------------------------------------------------------------------------- */

function renderTimeline() {
  if (!state.semesters.length) return "";
  const chips = state.semesters.map((s, i) => {
    const st = statusOf(s);
    const prog = semesterProgress(s);
    const label = st === "completed" ? "Done" : st === "current" ? `${prog.percent}% done` : "Not started";
    let html = `
      <button class="timeline-chip is-${st}" data-action="open-semester" data-id="${s.id}" title="${esc(s.title)}">
        <div class="chip-title">${st === "completed" ? "✓" : st === "upcoming" ? "🔒" : "🎯"} ${esc(s.title)}</div>
        <div class="chip-meta">${label}</div>
        <div class="progress-track"><div class="progress-fill ${prog.percent >= 100 ? "complete" : ""}" style="width:${prog.percent}%"></div></div>
      </button>`;
    if (i < state.semesters.length - 1) html += `<div class="timeline-connector"></div>`;
    return html;
  }).join("");
  return `<div class="timeline">${chips}</div>`;
}

function renderSpotlight(semester) {
  const prog = semesterProgress(semester);
  const goals = semester.goals || [];
  const doneGoals = goals.filter((g) => g.done).length;
  return `
    <div class="card">
      <div class="spotlight-head">
        <div>
          <h2>🎯 ${esc(semester.title)}</h2>
          <div class="spotlight-dates">${fmtDate(semester.startDate)} – ${fmtDate(semester.endDate)}</div>
        </div>
        <div class="spotlight-actions">
          <button class="btn primary sm" data-action="open-semester" data-id="${semester.id}">Open workspace</button>
        </div>
      </div>
      ${progressBar(prog.percent, prog.done, prog.total)}
      ${goals.length ? `<p class="hint" style="margin-top:10px">🎯 Goals: ${doneGoals}/${goals.length} done</p>` : ""}
      <p class="hint">${semester.courses.length} course${semester.courses.length === 1 ? "" : "s"}</p>
    </div>`;
}

function renderAgenda(semester) {
  const weekAhead = addDaysISO(todayISO(), 7);
  const items = allTasks(semester)
    .filter((x) => x.task.status !== "done" && x.task.dueDate)
    .filter((x) => x.task.dueDate <= weekAhead)
    .sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate));

  if (!items.length) {
    return `<div class="card"><h3>📅 This week</h3><div class="empty-state"><span class="empty-icon">🌤️</span>Nothing due in the next 7 days. Enjoy the breathing room.</div></div>`;
  }

  const rows = items.map(({ task, course }) => {
    const overdue = task.dueDate < todayISO();
    const dueLabel = overdue ? `Overdue · ${fmtDateShort(task.dueDate)}` : daysUntil(task.dueDate) === 0 ? "Today" : daysUntil(task.dueDate) === 1 ? "Tomorrow" : fmtDateShort(task.dueDate);
    return `
      <div class="agenda-item">
        <button class="checkbox ${task.status === "done" ? "checked" : ""}" data-action="quick-toggle-task" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}" aria-label="Mark done">✓</button>
        <div style="flex:1;min-width:0">
          <div class="task-title">${esc(task.title)}</div>
          <div class="agenda-course">${esc(course.name)}</div>
        </div>
        <span class="badge ${overdue ? "overdue" : "priority-" + task.priority}">${dueLabel}</span>
      </div>`;
  }).join("");

  return `<div class="card"><h3>📅 This week</h3>${rows}</div>`;
}

function renderDashboard() {
  const total = state.semesters.length;
  const completedCount = state.semesters.filter((s) => s.completed).length;
  const current = getCurrentSemester();

  let body = "";

  if (!total) {
    body = `
      <div class="card empty-state">
        <span class="empty-icon">🎯</span>
        <h2>One semester at a time.</h2>
        <p>Add your first semester and OneSemester will keep everything after it out of the way until you're ready.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px">
          <button class="btn primary" data-action="open-add-semester">+ Add your first semester</button>
          <button class="btn" data-action="load-example">See it with example data</button>
        </div>
      </div>`;
  } else {
    body += renderTimeline();

    if (current) {
      body += `<div class="grid cols-2">${renderSpotlight(current)}${renderAgenda(current)}</div>`;
    } else {
      body += `
        <div class="card empty-state">
          <span class="empty-icon">🎉</span>
          <h2>Every semester is complete!</h2>
          <p>You've finished everything you've planned so far. Add the next one whenever you're ready.</p>
          <button class="btn primary" data-action="open-add-semester">+ Add next semester</button>
        </div>`;
    }

    const dueSoon = current ? allTasks(current).filter((x) => x.task.status !== "done" && x.task.dueDate && x.task.dueDate <= addDaysISO(todayISO(), 7)).length : 0;
    body += `
      <div class="grid cols-3" style="margin-top:16px">
        <div class="card" style="text-align:center"><div style="font-size:26px;font-weight:800">${total}</div><div class="hint">Semester${total === 1 ? "" : "s"} total</div></div>
        <div class="card" style="text-align:center"><div style="font-size:26px;font-weight:800">${completedCount}</div><div class="hint">Completed</div></div>
        <div class="card" style="text-align:center"><div style="font-size:26px;font-weight:800">${dueSoon}</div><div class="hint">Due in 7 days</div></div>
      </div>`;
  }

  return `
    <div class="view-header">
      <div>
        <h1>Dashboard</h1>
        <p class="subtitle">Focus on what's in front of you — everything else can wait its turn.</p>
      </div>
    </div>
    ${body}
  `;
}

/* ----------------------------------------------------------------------------
   Workspace view (a single semester, in depth)
   -------------------------------------------------------------------------- */

function renderGoals(semester) {
  const rows = (semester.goals || []).map((g) => `
    <li class="goal-row ${g.done ? "done" : ""}">
      <button class="checkbox ${g.done ? "checked" : ""}" data-action="toggle-goal" data-semester="${semester.id}" data-goal="${g.id}" aria-label="Toggle goal">✓</button>
      <span class="goal-text">${esc(g.text)}</span>
      <button class="icon-btn icon-only" data-action="delete-goal" data-semester="${semester.id}" data-goal="${g.id}" aria-label="Delete goal">🗑</button>
    </li>`).join("");

  return `
    <div class="card">
      <h3>🎯 Goals for this semester</h3>
      ${semester.goals.length ? `<ul class="goal-list">${rows}</ul>` : `<p class="hint">No goals yet — what does "done well" look like for this semester?</p>`}
      <form class="inline-form" data-form="add-goal" data-semester="${semester.id}">
        <input type="text" name="text" placeholder="Add a goal…" maxlength="140" required />
        <button type="submit" class="btn sm">+ Add</button>
      </form>
    </div>`;
}

function renderTaskRow(semester, course, task) {
  const overdue = task.status !== "done" && task.dueDate && task.dueDate < todayISO();
  return `
    <li class="task-row status-${task.status}">
      <button class="checkbox ${task.status === "done" ? "checked" : ""}" data-action="quick-toggle-task" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}" aria-label="Mark done">✓</button>
      <div class="task-main">
        <input type="text" value="${esc(task.title)}" data-action="update-task-field" data-field="title" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}"
          style="border:none;background:none;padding:0;font-weight:600;width:100%" />
        <div class="task-meta">
          <input type="date" value="${esc(task.dueDate)}" data-action="update-task-field" data-field="dueDate" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}" style="padding:2px 6px;font-size:12px;width:auto" />
          ${overdue ? `<span class="badge overdue">Overdue</span>` : ""}
          ${priorityBadge(task.priority)}
        </div>
      </div>
      <div class="task-controls">
        <select class="status-select" data-action="update-task-field" data-field="priority" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}">
          ${PRIORITIES.map((p) => `<option value="${p}" ${task.priority === p ? "selected" : ""}>${p}</option>`).join("")}
        </select>
        <select class="status-select" data-action="update-task-field" data-field="status" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}">
          ${STATUSES.map((s) => `<option value="${s}" ${task.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <button class="icon-btn icon-only" data-action="delete-task" data-semester="${semester.id}" data-course="${course.id}" data-task="${task.id}" aria-label="Delete task">🗑</button>
      </div>
    </li>`;
}

function renderCourse(semester, course) {
  const prog = (() => {
    const total = course.tasks.length;
    const done = course.tasks.filter((t) => t.status === "done").length;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  })();

  const taskRows = course.tasks
    .slice()
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
    .map((t) => renderTaskRow(semester, course, t)).join("");

  return `
    <div class="card course-card" style="--course-color:${esc(course.color)}">
      <div class="course-head">
        <div class="course-name"><span class="course-dot"></span>
          <input type="text" value="${esc(course.name)}" data-action="update-course-field" data-field="name" data-semester="${semester.id}" data-course="${course.id}"
            style="border:none;background:none;padding:0;font-weight:700;font-size:15px;width:auto;min-width:80px" />
        </div>
        <div class="course-actions">
          <span class="course-credits">
            <input type="number" min="0" max="20" value="${course.credits}" data-action="update-course-field" data-field="credits" data-semester="${semester.id}" data-course="${course.id}"
              style="width:46px;padding:2px 4px;font-size:12px;border:none;background:var(--bg-sunken);border-radius:6px" /> cr
          </span>
          <button class="icon-btn icon-only" data-action="delete-course" data-semester="${semester.id}" data-course="${course.id}" aria-label="Delete course">🗑</button>
        </div>
      </div>
      ${course.tasks.length ? progressBar(prog.percent, prog.done, prog.total) : `<p class="hint">No tasks yet.</p>`}
      <ul class="task-list">${taskRows}</ul>
      <form class="inline-form" data-form="add-task" data-semester="${semester.id}" data-course="${course.id}">
        <input type="text" name="title" placeholder="Add a task or assignment…" maxlength="140" required />
        <input type="date" name="dueDate" />
        <select name="priority">
          ${PRIORITIES.map((p) => `<option value="${p}" ${p === "medium" ? "selected" : ""}>${p}</option>`).join("")}
        </select>
        <button type="submit" class="btn sm">+ Add</button>
      </form>
    </div>`;
}

function renderWorkspace() {
  if (!state.semesters.length) {
    return `
      <div class="view-header"><div><h1>Current semester</h1></div></div>
      <div class="card empty-state">
        <span class="empty-icon">🎯</span>
        <h2>No semesters yet</h2>
        <p>Add one to start building your workspace.</p>
        <button class="btn primary" data-action="open-add-semester">+ Add a semester</button>
      </div>`;
  }

  const current = getCurrentSemester();
  let semesterId = ui.selectedSemesterId && getSemester(ui.selectedSemesterId) ? ui.selectedSemesterId : (current ? current.id : state.semesters[0].id);
  const semester = getSemester(semesterId);
  const st = statusOf(semester);
  const prog = semesterProgress(semester);

  const switcher = `
    <select id="workspace-switcher" data-action="switch-workspace">
      ${state.semesters.map((s) => `<option value="${s.id}" ${s.id === semester.id ? "selected" : ""}>${esc(s.title)} — ${statusOf(s) === "completed" ? "completed" : statusOf(s) === "current" ? "current" : "upcoming"}</option>`).join("")}
    </select>`;

  const isUpcomingPreview = st === "upcoming";

  const completeAction = semester.completed
    ? `<button class="btn sm" data-action="reopen-semester" data-id="${semester.id}">Reopen semester</button>`
    : `<button class="btn primary sm" data-action="mark-semester-complete" data-id="${semester.id}">✓ Mark semester complete</button>`;

  const coursesHtml = semester.courses.map((c) => renderCourse(semester, c)).join("") || `<div class="card empty-state"><span class="empty-icon">📚</span>No courses added yet.</div>`;

  return `
    <div class="view-header">
      <div>
        <h1>Workspace</h1>
        <p class="subtitle">${isUpcomingPreview ? "Previewing an upcoming semester — plan ahead, finish the current one first." : "Everything for this semester, in one place."}</p>
      </div>
      <div style="min-width:220px">${switcher}</div>
    </div>

    <div class="card">
      <div class="spotlight-head">
        <div>
          <h2>${esc(semester.title)} ${statusBadge(st)}</h2>
          <div class="spotlight-dates">${fmtDate(semester.startDate)} – ${fmtDate(semester.endDate)}</div>
        </div>
        <div class="spotlight-actions">
          ${completeAction}
          <button class="btn sm" data-action="open-edit-semester" data-id="${semester.id}">Edit</button>
        </div>
      </div>
      ${progressBar(prog.percent, prog.done, prog.total)}
    </div>

    <div class="section-title">Goals</div>
    ${renderGoals(semester)}

    <div class="section-title">Courses</div>
    ${coursesHtml}
    <div class="card" style="margin-top:12px">
      <form class="inline-form" data-form="add-course" data-semester="${semester.id}">
        <input type="text" name="name" placeholder="Add a course…" maxlength="80" required />
        <input type="number" name="credits" placeholder="Credits" min="0" max="20" style="max-width:90px" />
        <button type="submit" class="btn sm primary">+ Add course</button>
      </form>
    </div>
  `;
}

/* ----------------------------------------------------------------------------
   All semesters (management) view
   -------------------------------------------------------------------------- */

function renderSemesters() {
  if (!state.semesters.length) {
    return `
      <div class="view-header"><div><h1>All semesters</h1></div><button class="btn primary" data-action="open-add-semester">+ Add semester</button></div>
      <div class="card empty-state"><span class="empty-icon">🗂️</span>Nothing here yet.</div>`;
  }

  const rows = state.semesters.map((s, i) => {
    const st = statusOf(s);
    const prog = semesterProgress(s);
    return `
      <div class="semester-row">
        <div class="order-controls">
          <button data-action="move-semester-up" data-id="${s.id}" ${i === 0 ? "disabled" : ""} aria-label="Move earlier">▲</button>
          <button data-action="move-semester-down" data-id="${s.id}" ${i === state.semesters.length - 1 ? "disabled" : ""} aria-label="Move later">▼</button>
        </div>
        <div class="row-main">
          <div class="row-title">${esc(s.title)} ${statusBadge(st)}</div>
          <div class="row-meta">${fmtDate(s.startDate)} – ${fmtDate(s.endDate)} · ${s.courses.length} course(s) · ${prog.done}/${prog.total} tasks done</div>
        </div>
        <div class="row-actions">
          <button class="btn sm" data-action="open-semester" data-id="${s.id}">Open</button>
          <button class="btn sm" data-action="open-edit-semester" data-id="${s.id}">Edit</button>
          <button class="btn sm danger" data-action="delete-semester" data-id="${s.id}">Delete</button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="view-header">
      <div>
        <h1>All semesters</h1>
        <p class="subtitle">Order here is the order you'll tackle them. Reorder with the arrows.</p>
      </div>
      <button class="btn primary" data-action="open-add-semester">+ Add semester</button>
    </div>
    ${rows}
  `;
}

/* ----------------------------------------------------------------------------
   Settings view
   -------------------------------------------------------------------------- */

function renderSettings() {
  return `
    <div class="view-header"><div><h1>Settings</h1></div></div>

    <div class="section-title">Appearance</div>
    <div class="card settings-group">
      <label for="theme-select" style="font-weight:600">Theme</label>
      <select id="theme-select" data-action="set-theme">
        <option value="system" ${state.theme === "system" ? "selected" : ""}>Match system</option>
        <option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option>
        <option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option>
      </select>
    </div>

    <div class="section-title">Your data</div>
    <div class="card">
      <p>Everything you enter is stored only in this browser's local storage — nothing is sent to a server. Back up regularly, especially before clearing browser data.</p>
      <div class="settings-group">
        <button class="btn" data-action="export-data">⬇️ Export backup (.json)</button>
        <button class="btn" data-action="open-import">⬆️ Import backup</button>
        ${state.semesters.length ? "" : `<button class="btn" data-action="load-example">Load example data</button>`}
      </div>
    </div>

    <div class="section-title">Danger zone</div>
    <div class="card danger-zone">
      <p>This permanently deletes every semester, course, and task stored on this device.</p>
      <button class="btn danger" data-action="confirm-reset">Erase all data</button>
    </div>
  `;
}

/* ----------------------------------------------------------------------------
   Top-level render
   -------------------------------------------------------------------------- */

function render() {
  const main = document.getElementById("app-main");
  const fn = { dashboard: renderDashboard, workspace: renderWorkspace, semesters: renderSemesters, settings: renderSettings }[ui.view] || renderDashboard;
  main.innerHTML = fn();

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === ui.view);
  });
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "light" || state.theme === "dark") root.setAttribute("data-theme", state.theme);
  else root.removeAttribute("data-theme");
}

/* ----------------------------------------------------------------------------
   Event delegation
   -------------------------------------------------------------------------- */

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case "go-view":
      ui.view = el.dataset.view;
      ui.navOpen = false;
      document.getElementById("main-nav").classList.remove("open");
      document.getElementById("nav-toggle").setAttribute("aria-expanded", "false");
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;

    case "toggle-nav":
      ui.navOpen = !ui.navOpen;
      document.getElementById("main-nav").classList.toggle("open", ui.navOpen);
      document.getElementById("nav-toggle").setAttribute("aria-expanded", String(ui.navOpen));
      break;

    case "cycle-theme": {
      const order = ["system", "light", "dark"];
      state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
      saveState();
      applyTheme();
      toast(`Theme: ${state.theme}`);
      break;
    }

    case "open-add-semester":
      semesterFormModal(null);
      break;

    case "open-edit-semester":
      semesterFormModal(el.dataset.id);
      break;

    case "delete-semester":
      openConfirm("Delete this semester?", "This removes the semester and everything inside it — courses, tasks, and goals. This can't be undone.", "Delete", () => {
        deleteSemester(el.dataset.id);
        closeModal();
        render();
      });
      break;

    case "move-semester-up":
      moveSemester(el.dataset.id, -1);
      render();
      break;

    case "move-semester-down":
      moveSemester(el.dataset.id, 1);
      render();
      break;

    case "open-semester":
      ui.selectedSemesterId = el.dataset.id;
      ui.view = "workspace";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;

    case "mark-semester-complete": {
      const s = getSemester(el.dataset.id);
      const prog = semesterProgress(s);
      if (prog.total > prog.done) {
        openConfirm("Mark complete anyway?", `${prog.total - prog.done} task(s) are still open in "${s.title}". You can still mark it complete.`, "Mark complete", () => {
          setSemesterCompleted(el.dataset.id, true);
          closeModal();
          render();
        }, false);
      } else {
        setSemesterCompleted(el.dataset.id, true);
        render();
      }
      break;
    }

    case "reopen-semester":
      setSemesterCompleted(el.dataset.id, false);
      render();
      break;

    case "toggle-goal":
      toggleGoal(el.dataset.semester, el.dataset.goal);
      render();
      break;

    case "delete-goal":
      deleteGoal(el.dataset.semester, el.dataset.goal);
      render();
      break;

    case "delete-course":
      openConfirm("Delete this course?", "This removes the course and all of its tasks. This can't be undone.", "Delete", () => {
        deleteCourse(el.dataset.semester, el.dataset.course);
        closeModal();
        render();
      });
      break;

    case "delete-task":
      deleteTask(el.dataset.semester, el.dataset.course, el.dataset.task);
      render();
      break;

    case "quick-toggle-task": {
      const s = getSemester(el.dataset.semester);
      const c = getCourse(s, el.dataset.course);
      const t = getTask(c, el.dataset.task);
      updateTask(el.dataset.semester, el.dataset.course, el.dataset.task, { status: t.status === "done" ? "todo" : "done" });
      render();
      break;
    }

    case "close-modal":
      closeModal();
      break;

    case "confirm-yes":
      if (pendingConfirm) pendingConfirm();
      break;

    case "export-data":
      exportData();
      break;

    case "open-import":
      importModal();
      break;

    case "load-example":
      loadExampleData();
      render();
      break;

    case "confirm-reset":
      openConfirm("Erase everything?", "This deletes all semesters, courses, tasks, and goals stored on this device. This can't be undone.", "Erase everything", () => {
        state = defaultState();
        saveState();
        applyTheme();
        closeModal();
        ui = { view: "dashboard", selectedSemesterId: null, navOpen: false };
        render();
        toast("All data erased");
      });
      break;
  }

  // Close modal when clicking the dimmed backdrop itself.
  if (e.target.id === "modal-root") closeModal();
});

document.addEventListener("change", (e) => {
  const el = e.target;

  if (el.dataset.action === "update-task-field") {
    const field = el.dataset.field;
    const value = field === "title" ? el.value : el.value;
    updateTask(el.dataset.semester, el.dataset.course, el.dataset.task, { [field]: value });
    if (field !== "title") render(); // re-render to refresh badges/overdue state; title stays inline
    return;
  }

  if (el.dataset.action === "update-course-field") {
    const field = el.dataset.field;
    updateCourse(el.dataset.semester, el.dataset.course, { [field]: field === "credits" ? Number(el.value) || 0 : el.value });
    if (field !== "name") render();
    return;
  }

  if (el.dataset.action === "set-theme") {
    state.theme = el.value;
    saveState();
    applyTheme();
    return;
  }

  if (el.dataset.action === "switch-workspace") {
    ui.selectedSemesterId = el.value;
    render();
    return;
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!form.dataset.form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  switch (form.dataset.form) {
    case "semester": {
      const id = form.dataset.id;
      if (id) updateSemester(id, data);
      else addSemester(data);
      closeModal();
      render();
      break;
    }
    case "add-goal":
      addGoal(form.dataset.semester, data.text);
      form.reset();
      render();
      break;
    case "add-course":
      addCourse(form.dataset.semester, data);
      render();
      break;
    case "add-task":
      addTask(form.dataset.semester, form.dataset.course, data);
      render();
      break;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ----------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

applyTheme();
render();
