# SimEHR: a high-fidelity EHR environment for computer-use agents

> **About this fork.** I extended SimEHR, an open-source simulated EHR, with three health information management workflows and wired up its dead Patient Care menu items. Release of Information enforces the HIPAA right-of-access 30-day clock and the required elements of a valid authorization. Referral Tracking follows a referral from order to received specialist report, using the CMS50 closing-the-referral-loop rule. Duplicate Chart Review requires at least two matching identifiers before it accepts a merge decision and picks the surviving chart by appointment activity, using logic from my own him-workbench project. Every workflow is documented against public sources in [`SOURCES.md`](SOURCES.md), is covered by the repo's automated browser smoke test, and uses synthetic data only. Based on [HealthRex/SimEHR](https://github.com/HealthRex/SimEHR); see [Modifications in this fork](#modifications-in-this-fork).

SimEHR is a high-fidelity, interactive simulation of the electronic health record (EHR) interface that
physicians use every day. It exists so that computer-use agents can be evaluated under the conditions
clinicians actually work in: familiar screens, mouse and keyboard input, and full patient charts. 

[![Website](https://img.shields.io/badge/Website-healthrex.github.io/SimEHR-0e6ba8?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTggMGE4IDggMCAxIDEgMCAxNkE4IDggMCAwIDEgOCAwWk01Ljc4IDguNzVhOS42NCA5LjY0IDAgMCAwIDEuMzYzIDQuMTc3Yy4yNTUuNDI2LjU0Mi44MzIuODU3IDEuMjE1LjI0NS0uMjk2LjU1MS0uNzA1Ljg1Ny0xLjIxNUE5LjY0IDkuNjQgMCAwIDAgMTAuMjIgOC43NVptNC40NC0xLjVhOS42NCA5LjY0IDAgMCAwLTEuMzYzLTQuMTc3Yy0uMzA3LS41MS0uNjEyLS45MTktLjg1Ny0xLjIxNWE5LjkyNyA5LjkyNyAwIDAgMC0uODU3IDEuMjE1QTkuNjQgOS42NCAwIDAgMCA1Ljc4IDcuMjVabS01Ljk0NCAxLjVIMS41NDNhNi41MDcgNi41MDcgMCAwIDAgNC42NjYgNS41Yy0uMTIzLS4xODEtLjI0LS4zNjUtLjM1Mi0uNTUyLS43MTUtMS4xOTItMS40MzctMi44NzQtMS41ODEtNC45NDhabS0yLjczMy0xLjVoMi43MzNjLjE0NC0yLjA3NC44NjYtMy43NTYgMS41OC00Ljk0OC4xMi0uMTk3LjIzNy0uMzgxLjM1My0uNTUyYTYuNTA3IDYuNTA3IDAgMCAwLTQuNjY2IDUuNVptMTAuMTgxIDEuNWMtLjE0NCAyLjA3NC0uODY2IDMuNzU2LTEuNTggNC45NDgtLjEyLjE5Ny0uMjM3LjM4MS0uMzUzLjU1MmE2LjUwNyA2LjUwNyAwIDAgMCA0LjY2Ni01LjVabTIuNzMzLTEuNWE2LjUwNyA2LjUwNyAwIDAgMC00LjY2Ni01LjVjLjEyMy4xODEuMjQuMzY1LjM1My41NTIuNzE0IDEuMTkyIDEuNDM2IDIuODc0IDEuNTggNC45NDhaIi8%2BPC9zdmc%2B)](https://healthrex.github.io/SimEHR/)

![Claude Opus 5.5 working through the demo task in SimEHR](docs/assets/hero_trajectory.gif)

*Claude Opus 5.5 working through the demo task: the recorded actions replayed in the current build. Each action is marked in red.*

## Updates

- 2026-11-02: We released the SimEHR preview: the environment, a demo task and
  two recorded agent sessions on it.

## Quick start

```bash
npm install
npm run dev            # http://localhost:8766
```

The app opens on the demo chart, `vte-prophylaxis-travel`. Charts you add are reachable from Patient
Lists or by URL: `http://localhost:8766/?case=<id>`.

## What is implemented

**Activities**: Patient Summary, Chart Review (encounters, notes, letters, labs, imaging, cardiac studies,
medications, referrals, procedures and more, each with filter chips and a report preview), 
Flowsheets, Results Review with trend graphs, Problem List with diagnosis search, Medications, Orders with
dose, route, frequency and duration for medications, Clinical Notes, Demographics.

**Workbenches**: Patient Lists, Schedule.

**Chrome**: title bar with an alerts bell, toolbar, main menu, patient tab strip, patient sidebar (vitals,
allergies, problems, recent activity), activity tabs, global search, right rail,
action bar with visit sign-off and a pre-sign check, and an audit bar.

**Patient messages** are answered from the message itself, in Chart Review.

Beneath the interface is one canonical patient model. Every screen is a projection of it, so no two views
can disagree. The historical record is immutable; everything an episode produces (orders, notes, replies,
acknowledgements) is held in a separate episode state, and every navigation step and clinical action is
appended to an audit log.

## Layout

```
app/                 Next.js routes and stylesheets
components/          chrome and the activities / workbenches
lib/
  types.ts           the case schema (FHIR-aligned resources), see public/cases/SCHEMA.md
  store.ts           canonical state and actions; every UI action is appended to the audit log
  projections.ts     pure selectors the surfaces render from
  agentApi.ts        window.SimEHR (loadCase, getState, getAuditLog, resetState, ...)
public/cases/        case JSON files and the index.json manifest
demo_task/           the demo task
trajectories/        the recorded sessions
docs/                the project page
```

## Patient data

Every chart is one JSON file in `public/cases/`; adding a patient is a matter of dropping in `<id>.json`
and listing it in `index.json`. The schema is documented in `public/cases/SCHEMA.md`. The chart shipped
here, `vte-prophylaxis-travel.json`, is synthetic: names, identifiers, dates, addresses and contacts are
generated. Use the same schema to bring your own synthetic or de-identified charts.

## The demo task

`demo_task/` holds a single task written with a clinician collaborator: a patient message about
prophylaxis before long flights, on the chart `vte-prophylaxis-travel`. It begins the way real work
begins, with a message, and is graded on what the agent saved: the reply sent to the patient, the
assessment note, the signed orders and the final medication and problem lists. See
[`demo_task/README.md`](demo_task/README.md).

## Recorded sessions

`trajectories/` holds one session each for Claude Opus 5.5 and GPT-6 Astra on the demo task. Open
`trajectory_view.html` in either folder to step through the session: the screenshot the agent saw, the
action it took, and its reasoning at each turn. See [`trajectories/README.md`](trajectories/README.md).

Agents observe screenshots of a 1280×800 viewport and act through clicks, typing, key presses and
scrolling; they never see the DOM, the data files or the rubrics. The harness that drove the recorded
sessions, with one adapter per model provider and the LLM judge, will be released with the benchmark.

## What is next

PhysicianBench-UI, a benchmark of realistic, long-horizon, physician-authored clinical workflows in this
environment, will be released with the paper, together with the harness and the task set. In parallel,
an [ARISEKit](https://arisekit.com/) module will turn a clinical case of your own into an executable
computer-use task.

## License

The source code in this repository is licensed under the Apache License 2.0 (see [`LICENSE`](LICENSE)).

The synthetic patient charts (`public/cases/`), the demo task (`demo_task/`), the recorded sessions
(`trajectories/`) and the project page (`docs/`) are licensed under Creative Commons Attribution 4.0
International (CC BY 4.0, see [`LICENSE-DATA`](LICENSE-DATA)). All patient data is synthetic; no real
patient information is included.

## Citation

If you use SimEHR in your work, please cite the preview release.

```bibtex
@misc{simehr2026,
  title        = {SimEHR: A High-Fidelity EHR Environment for Computer-Use Agents},
  author       = {{SimEHR Team}},
  year         = {2026},
  howpublished = {\url{https://github.com/HealthRex/SimEHR}},
  note         = {Preview release}
}
```

## Modifications in this fork

This fork is based on [HealthRex/SimEHR](https://github.com/HealthRex/SimEHR) (Apache-2.0) and was changed as follows. The original authors' license, citation and data license are unchanged.

- Patient Care menu items now work: Telephone Call, Send Letter, Addendum.
- New screens: Release of Information request, Referral Tracking (closed loop), Duplicate Chart Review, Accounting of Disclosures.
- New files: `lib/duplicates.ts`, `lib/disclosures.ts`, `SOURCES.md` (public sources for each modeled workflow).
- Edited files: `lib/store.ts`, `lib/mainMenu.ts`, `lib/agentApi.ts`, `components/MainMenu.tsx`, `components/ModalHost.tsx`, `smoke.mjs`.
- All data is synthetic. No real patient data or employer-specific workflow is included.
