# OneSemester 🎯

A focus-first planner built around one idea: **you can only actually work on
one semester at a time, so the app should behave that way too.**

Instead of dumping every course, assignment, and goal from every future term
in front of you at once, OneSemester keeps a queue of semesters. The first
one that isn't finished yet is your **Current** semester and gets the
spotlight everywhere in the app. Everything after it is **Upcoming** —
visible so you can plan ahead, but visually out of the way until its turn
comes. Anything you've marked done becomes **Completed** and drops into the
timeline as a record of progress.

No sign-up, no server, no build step. It's a static site — open `index.html`
and go.

## Why this structure

- **One active semester at a time.** The app automatically figures out which
  semester is "current" — it's the first one in your list that isn't marked
  complete. You don't pick it manually; you finish things in order.
- **Upcoming semesters aren't locked, just de-emphasized.** You can still
  open one to sketch out courses or goals in advance — but the dashboard,
  the agenda, and the big "open workspace" buttons all default to the
  semester you should actually be doing right now.
- **Progress is structural, not just a checklist.** Semester → Courses →
  Tasks. Marking tasks done rolls up into a course progress bar, which rolls
  up into the semester's overall progress, which shows on the timeline.
- **Finishing a semester is a deliberate action.** You mark it complete
  yourself (the app warns you if tasks are still open, but never blocks
  you) — at which point the next semester in line automatically becomes
  current.

## Features

- **Dashboard** — a horizontal timeline of every semester (completed /
  current / upcoming), a spotlight card for the current semester, a
  "This week" agenda pulling together everything due soon or overdue across
  all your courses, and quick stats.
- **Workspace** — the full view of one semester: editable goals checklist,
  courses with credit counts and color tags, and tasks with due dates,
  priority, and status — all edited inline, no dialogs to fight with. A
  switcher lets you peek at any semester, current or not.
- **All Semesters** — reorder your queue, edit dates, or delete a semester.
  The order here is the order you'll tackle them.
- **Settings** — light/dark/system theme, JSON export/import for backups,
  and a full reset if you want a clean slate.
- Works fully offline. Responsive down to phone widths. Keyboard-friendly
  (Escape closes dialogs, forms submit on Enter).

## Running it

There's no build step and no dependencies. Either:

- Double-click `index.html` to open it directly in a browser, or
- Serve the folder locally for a nicer experience with some browsers'
  security settings, e.g.:

  ```bash
  npx serve .
  # or
  python3 -m http.server 8000
  ```

## Your data

Everything — semesters, courses, tasks, goals, theme choice — is stored in
your browser's `localStorage`, under the key `onesemester:v1`. Nothing is
ever sent anywhere.

That also means:

- Data is per-browser, per-device. It won't follow you to another computer
  automatically.
- Clearing your browser's site data for this page deletes it.
- **Back up from Settings → Export backup** before clearing browser data,
  switching browsers, or migrating machines. **Import backup** restores from
  that file (it fully replaces what's currently stored, after a
  confirmation).

## Deploying it somewhere

Since it's a static site, any static host works. The easiest option with
this repo is GitHub Pages:

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the repo's **Settings → Pages**, set the source to the `main` branch,
   root folder.
3. GitHub gives you a URL — that's your app, live, for free.

## Project structure

```
index.html    — page shell, header/nav, containers the app renders into
styles.css    — design tokens (light/dark themes) + component styles
app.js        — state, persistence, rendering, and all event handling
```

No framework, no bundler — just DOM APIs and template strings. `app.js` is
organized top-to-bottom as: utilities → state & persistence → data
mutations → example data → modal/toast helpers → view renderers → a single
top-level `render()` → delegated event listeners for clicks, form
submissions, and field changes.
