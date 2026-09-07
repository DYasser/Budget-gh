# budget.io

A recurring-budget planner that runs entirely in your browser. Define what you earn and
what you owe, along with how often, and it works out what each month actually costs —
on a calendar, in a chart, and as a savings projection.

**[Open the live app →](https://dyasser.github.io/Budget-io/)**

[![CI](https://github.com/DYasser/Budget-gh/actions/workflows/ci.yml/badge.svg)](https://github.com/DYasser/Budget-gh/actions/workflows/ci.yml)

Angular 19 · TypeScript · Chart.js · date-fns · installable PWA · no backend

---

## What it does

Add an expense or an income source with a recurrence rule — monthly, weekly, bi-weekly,
quarterly, annually or one-time — and the app expands it into real dates:

- **Dashboard** — a doughnut chart of where the month's money goes, with month-to-month
  navigation.
- **Calendar** — every due date and payday for the month, colour-coded, with a receipt-style
  summary and a savings projection to a target date.
- **Expenses / Incomes** — full editing, with each category's share of the month shown as a
  proportion bar.
- **Settings** — currency selection and JSON import/export of everything.

Data lives in your browser's `localStorage`. There is no account and no server.

---

## Why there is no backend

This is a deliberate choice rather than an unfinished one.

A personal budget is about as sensitive as a document gets, and this app has no
multi-user or multi-device requirement — so the data never leaves the machine it was
entered on. That buys three things: nothing to breach, no latency, and no
infrastructure to keep alive for a demo to work two years from now.

The trade-off is real and worth stating: **your data is per-browser**. Clear your site
data and it is gone. The escape hatch is JSON export in Settings, and the app is
installable and fully offline-capable, so it behaves like a local app rather than a
website that happens to remember things.

If this needed sync across devices, the honest answer would be a real backend — not
`localStorage` plus wishful thinking.

---

## The interesting problem: recurrence

Most of this app is unremarkable CRUD. The part that isn't is turning a rule like
*"$1,500, monthly, from the 31st"* into the dates it actually falls on.

Calendars are hostile to that:

**A day-31 rule has to survive February.** Clamping to Feb 28 is easy. The trap is what
happens next: if each occurrence steps forward from the *previous* one, the series is
permanently shortened to the 28th. Every occurrence here is derived from the original
start date plus N periods, so Jan 31 yields Feb 28 and then **snaps back to Mar 31**.

**"Last day of the month" is not a fixed day.** An `isDueEndOfMonth` rule resolves
against each target month in turn — Feb 29 in a leap year, Feb 28 otherwise, the 30th
or 31st elsewhere.

**Two different questions look like one.** "What does this budget cost per month?" and
"What is charged this month?" are not the same, and the app answers both separately:

| | Weekly $10 expense, January 2025 |
|---|---|
| Monthly equivalent | **$43.33** — averaged over 52/12 weeks |
| Charged in January | **$50.00** — January contains five Wednesdays |

Both are correct. Conflating them is how a budget app quietly lies to you, so the
distinction is asserted in the test suite rather than left to be rediscovered.

All of it runs through one function — `getOccurrences(rule, interval)` in
[`budget.service.ts`](src/app/budget.service.ts) — which returns the dates a rule falls
on inside a window. The calendar, the monthly totals and the projection all consume it.

---

## What testing turned up

The recurrence logic previously had **no test coverage**, and the specs written for it
immediately surfaced a bug that had been live: quarterly and annual expenses were treated
as relevant only in their exact start month.

A $1,200 annual insurance premium costs $100 every month. The dashboard reported **$0**
and dropped it from the chart entirely in 11 months out of 12. Two smaller variants of
the same fault counted future-dated expenses against the current month.

The fix replaced three divergent per-frequency branches with one rule — *has this
category started yet?* — plus a deliberate exception for one-time charges. The specs that
now assert the corrected behaviour were written first and confirmed failing against the
old implementation.

Three duplicated occurrence loops were then collapsed into the single generator above.
**All 60 existing specs passed unchanged through that rewrite**, which is the only real
evidence a refactor preserved behaviour.

---

## Running it

```bash
npm ci
npm start          # http://localhost:4200
```

```bash
npm run lint       # ESLint + angular-eslint
npm run test:ci    # 61 specs, headless
npm run build      # production bundle
```

CI runs all three on every pull request. Deployment is gated behind them, so a failing
build is never published.

---

## How it is put together

```
src/app/
  budget.service.ts     recurrence engine + persistence; the only stateful thing here
  dashboard/            doughnut chart, month navigation
  calendar/             month view (angular-calendar), savings projection
  expenses/  incomes/   CRUD + proportion bars
  settings/             currency, JSON import/export
  confirmation-dialog/  shared destructive-action guard
  footer/
```

Standalone components throughout — no NgModules. State is a single service exposing three
`BehaviorSubject`-backed observables (`categories$`, `incomeSources$`, `currency$`), each
write persisting to `localStorage` and pushing to subscribers.

`Chart.js` is registered controller-by-controller in
[`app.config.ts`](src/app/app.config.ts) rather than via `Chart.register(...registerables)`,
so unused chart types are tree-shaken out.

---

## Known gaps

Stated rather than hidden:

- **No component tests.** Coverage is concentrated on the recurrence engine, where the
  logic and the risk are. The components are largely presentational, but that is a
  choice about where to spend effort, not a claim they cannot fail.
- **State is `BehaviorSubject` + manual change detection.** Angular Signals would suit
  this better and remove the `cdr.detectChanges()` calls; a migration is worthwhile but
  has not happened.
- **Accessibility debt on the dashboard's mobile nav** — a click handler without a
  keyboard equivalent. Tracked as lint warnings rather than silenced.
- **Eight `npm audit` advisories in shipped packages**, all with an affected range of
  `<=19.2.25` — Angular 19 has no patched release, so an upgrade to v21+ is the only
  fix. None are reachable here: they require i18n attribute bindings, `HttpTransferCache`,
  or SSR hydration, and this app uses none of the three.

---

## Repositories

- **[DYasser/Budget-gh](https://github.com/DYasser/Budget-gh)** — source (this repo)
- **[DYasser/Budget-io](https://github.com/DYasser/Budget-io)** — built output, served by
  GitHub Pages
