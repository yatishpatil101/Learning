# Draazy — Project Packing Plan (Text Bundle Approach)

Goal: Move this React project into a OneDrive folder where only **text** can be
pasted (no direct file paste), then rebuild the exact folder structure later.

Approach: **Bundle → transport as text → unbundle.**
A packer script walks the project and writes files into a few `bundle-*.txt`
text files. Each file's content is wrapped with a header that records its
relative path, so the structure restores perfectly no matter how bundles are
split. An unpacker script reads the bundles and recreates the tree.

---

## 0. Current Repository Layout (as of this update)

The project is no longer a flat React app at the repo root. The app now lives
under `frontend/`, tests are a self-contained `e2e/` project, and docs/notes are
split into their own trees:

```
real E project/
├── frontend/            ← the actual React (Vite) app  ✅ MAIN PAYLOAD
│   ├── src/             ← components, pages, lib, services, i18n, data (seed)
│   ├── public/          ← 20 SVG + 1 XML (all text now — no binaries)
│   ├── scripts/         ← seed/import generators (.mjs / .cjs)
│   ├── data/persist/    ← runtime DB snapshots + userdata.json  ❌ EXCLUDE (PII/state)
│   ├── graphify-out/    ← generated  ❌ EXCLUDE
│   ├── node_modules/    ← ❌ EXCLUDE (npm install)
│   ├── package.json, vite.config.js, tailwind.config.js, postcss.config.js,
│   │   .eslintrc.json, brand.config.json, index.html, .env, .env.example
│   └── package-lock.json
├── backend/             ← Spring Boot API (Java/Maven)  ✅ INCLUDE (code)
│   ├── src/main/java, src/main/resources, src/test/java
│   ├── pom.xml, mvnw, mvnw.cmd, .mvn/
│   └── target/          ← ❌ EXCLUDE (Maven build output)
├── e2e/                 ← self-contained Playwright project (own package.json)
├── docs/                ← flows / misc / roadmap / system  (markdown)
├── tasks/               ← local working notes  (skip)
├── draazy-react/      ← 23 EMPTY (0-byte) stub files — nothing to pack (skip)
└── AGENTS.md, README.md, BUSINESS_PLAN.md, VERIFICATION_*.md, robots.txt, .gitignore
```

**Rule of thumb: include exactly what is committable to git.** The root
`.gitignore` already defines the exclude set (`node_modules`, `dist`, `.env`,
`.env.*`, `data/persist/`, `test-results/`, `target/`, `playwright-report/`,
logs). Pack everything git would track; skip everything git ignores.

Notes vs. the previous version of this plan:
- Everything that used to be at root (`src/`, `public/`, `scripts/`, `data/`, config)
  is now under `frontend/` — prefix all include paths with `frontend/`.
- **`backend/` now holds a real Spring Boot API** (Java/Maven, ~14 committable
  files) — INCLUDE it. (It used to be an empty placeholder.)
- `draazy-react/` is now 23 empty (0-byte) stub files — **nothing to pack**.
- Playwright tests moved from `tests/` to a standalone `e2e/` project.
- `public/` is now 100% text (SVG/XML), so it bundles cleanly as text.
- `frontend/data/persist/` (DB snapshots + `userdata.json`) is runtime state and
  contains user data — **exclude it** and regenerate with the seed scripts.
- The old root docs `API_CONTRACT.md`, `DESIGN_SYSTEM.md`, `AI_ML_LIBRARIES_GUIDE.md`,
  `MOBILE_APP_PLAN.md` no longer exist at root; project docs now live under `docs/`.

---

## 1. Bundle Format (self-describing)

Each file is embedded with a path header so nesting is preserved:

```