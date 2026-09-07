# Budget-io — deployment artifact

**This repository contains build output, not source code.** Everything here is generated
and overwritten on each deploy; commits are made by CI, not by hand.

- **Live app:** https://dyasser.github.io/Budget-io/
- **Source code, tests and CI:** https://github.com/DYasser/Budget-gh

## Why the split

GitHub Pages serves this repository. The source repository builds the app and publishes
the compiled bundle here, so the deployed site and the code that produced it stay
separate. If you are looking for the recurrence engine, the test suite, the commit
history or anything else worth reading, it is all in
[DYasser/Budget-gh](https://github.com/DYasser/Budget-gh).

## What budget.io is

A recurring-budget planner that runs entirely in the browser: define expenses and income
with a recurrence rule, and it works out what each month actually costs — on a calendar,
in a chart, and as a savings projection. Data stays in the browser's `localStorage`;
there is no account and no server.

---

*This file is generated from `deploy/README.deploy.md` in the source repository. Editing
it here will be overwritten by the next deployment.*
