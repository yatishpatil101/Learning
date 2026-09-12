# 06 — Code quality: ponytail, comment hygiene, Sonar & Checkmarx

Three owner-requested workstreams that run **across** the migration rather than after it:
minimise the code written, clean up comments, and close static-analysis findings.

---

## 1. Ponytail — write less code

**Owner requirement:** *"we need to use ponytail skills to reduce the code and only keep necessary
processing / do not over code the feature."*

The ponytail ladder is **binding on every change in this migration**. Stop at the first rung that
holds:

1. **Does this need to exist at all?** Speculative → skip it, say so in one line.
2. **Already in this codebase?** Reuse it. (This repo is large — re-implementing what lives a few
   files over is the most common failure here.)
3. **Stdlib / framework does it?** Use it.
4. **Native platform feature covers it?** CSS over JS; a DB constraint over app code; a Spring
   feature over a hand-rolled one.
5. **Already-installed dependency solves it?** Use it. **Never add a new dependency** for what a few
   lines do.
6. **Can it be one line?** One line.
7. Only then: the minimum code that works.

### What this specifically forbids during the migration

- No "rules engine", strategy interface, or shared calculation framework when moving logic to the
  backend ([05](05-logic-to-backend.md)). One implementation, in the service that owns the entity.
- No new endpoint where a field on an existing DTO does the job.
- No abstraction with a single implementation. No factory for one product. No config for a value
  that never changes.
- No new npm or Maven dependency without naming what it replaces.
- **Deletion over addition.** The best outcome for most `lib/*` files is `git rm`, not a Java port.

### What ponytail must NOT simplify away

Input validation at trust boundaries · error handling that prevents data loss · security controls ·
accessibility basics · anything explicitly requested. Laziness applies to *solutions*, never to
*understanding* — trace the whole flow before choosing a rung.

### Deliberate corner-cuts get a marker

Where a simplification has a known ceiling, leave a one-line `ponytail:` comment naming the ceiling
and the upgrade path — e.g. `// ponytail: in-memory, swap for Redis if the profiler says so`. This
is the *one* comment category this migration **adds**.

---

## 2. Comment hygiene

**Owner requirement:** *"we need to do review the comments in codebase. remove unnecessary comments."*

### ⚠️ Read this before deleting anything

This codebase has a **deliberate, load-bearing comment style**. Class javadoc frequently explains
*why a decision was taken*, what was broken before, and what must not be changed —
`FileStorage.java`, `DevObjectStore.java`, `TestDatabaseIsolationTest.java` and `AbstractApiTest.java`
are all examples where the comment is the only record of the reasoning. Repo convention
(`AGENTS.md`, `tasks/todo.md`) is explicit that *"the reasoning that is worth keeping goes into the
docs or into a comment next to the code it explains."*

A naive "strip the comments" pass would destroy the most valuable documentation in the repo.
So the rule is **remove comments that are wrong or worthless — keep comments that carry reasoning.**

### Delete these

| Category | Example |
|----------|---------|
| **Stale / factually wrong** | The highest-value target. Precedent: `http/serviceRequestMapper.js` carried prose claiming *"the server lacks this status"* — false since V75, and it shipped a real defect. |
| **Restates the code** | `// increment the counter` above `counter++`. |
| **Commented-out code** | Delete it; git has it. |
| **Dead TODO/FIXME** | Either fix it, or file it in `docs/system/tech-debt.md` with an owner and trigger, then delete the comment. |
| **Redundant javadoc** | `@param id the id` — adds nothing over the signature. Note: ~195 residual `@param` lines are already tracked as **D33**; fold this work into that row rather than opening a second effort. |
| **Mock-era narration** | Comments describing mock behaviour that no longer exists after the migration. Delete alongside the mock. |

### Keep these

- Rationale: *why* this approach, what was rejected, what breaks if changed.
- Warnings about load-bearing details — e.g. the `zz_` prefix on the seed file, the
  `spring.flyway.locations` line, the `@Transactional` rollback contract.
- Security reasoning on auth, gating, and storage boundaries.
- `ponytail:` ceiling markers (above).

### Method (lazy)

Do it **per file, as part of that file's migration** — not as a separate sweep. A comment is easiest
to judge as wrong exactly when you are changing the code it describes. The `comment-analyzer` agent
can review a diff for accuracy, comment rot, and redundancy.

**The single highest-value rule:** every comment in a file you touch must still be *true* after your
change. Stale comments in migrated files are the defect this workstream exists to prevent.

---

## 3. Sonar & Checkmarx

**Owner requirement:** *"we need to do sonar and checkmarx review fixes."*

### Current reality (verified 2026-08-30)

- **Sonar is wired.** `sonar-project.properties` at the repo root defines **one** project spanning
  both languages, and `.github/workflows/ci.yml` has a `sonar` job using
  `SonarSource/sonarqube-scan-action`. Host is **SonarQube Cloud**, free tier — the repo is public,
  so there is **no lines-of-code cap** (the 50k limit applies to *private* repos, and this project
  measures ~185k raw lines in `sonar.sources` alone).
- **The backend job now exists.** `ci.yml` gained a `backend` job running `./mvnw test` against a
  PostgreSQL service container. Until it landed, the ~2,266-test Java suite gated nothing.
  Baseline on `feature/backend-integration`: **2266 run, 3 failures, 0 errors, 4 skipped** — all
  three pre-existing architecture guards (`ServiceSizeGuardTest`, `SpecCoverageTest`,
  `ErasureCoverageTest`), not regressions from adding CI.
- **Coverage is deliberately unconfigured** in both languages. `backend/pom.xml` declares no
  `jacoco-maven-plugin`, and `frontend/package.json` has no test runner (no vitest/jest/c8/nyc), so
  neither a `jacoco.xml` nor an `lcov.info` is ever produced. Wiring a report path to a file that
  never appears makes Sonar show **0.0% coverage**, which reads as *untested* rather than
  *unmeasured*. Wire the paths in the same change that starts producing the reports.
- **No Checkmarx and no CodeQL.** Deferred past functional close (decision 41).
- Backend static analysis: Checkstyle was replaced by Spotless (D36), and **Spotless is currently
  excluded** (D68). So there is still no active backend *formatting* gate.
- Frontend lint is green on errors but carries **~395 warnings**.

So this is no longer "nothing scans". It is "scanning is standing up; the findings have not been
triaged yet", and the remaining work below is the triage.

### Ponytail-ordered plan

**Step 1 — spend nothing, fix what you already have.** Before adding any scanner:

- Drive the **~395 ESLint warnings** toward zero (or ratchet the config so the count cannot grow).
  This is the highest finding-per-effort ratio available and needs no new tooling.
- **Add the backend test suite to CI.** A test suite that only runs locally is the biggest quality
  gap in the repo, and it is a few lines of YAML.
- Re-enable a backend formatter/linter (revisit D68/Spotless) — a formatter removes a whole class of
  Sonar "code smell" findings before Sonar ever runs.

**Step 2 — add scanning, cheapest first.**

| Need | Lazy option | Notes |
|------|-------------|-------|
| Code quality / smells / coverage | **SonarCloud** GitHub Action + `sonar-project.properties` | Free for public repos; needs a token as a repo secret. Covers JS/TS **and** Java in one scan. |
| SAST (security) | **GitHub CodeQL** | Native, free, zero-credential, one workflow file. Covers JS + Java. |
| Dependency CVEs | `npm audit` + OWASP Dependency-Check (Maven) | Already free; `npm audit` needs no setup. |
| SAST (enterprise mandate) | **Checkmarx One CLI** in CI | Only if the organisation licenses it — it is commercial and needs credentials + a project in the CX tenant. |

**Decision required from the owner:** Checkmarx is an enterprise product. If your organisation
already licenses it and mandates it, wire the Checkmarx One CLI/GitHub Action with tenant
credentials as repo secrets. If not, **CodeQL is the free, native equivalent** and should be used
instead — adding a commercial scanner nobody licenses is exactly the over-build ponytail forbids.
See [`docs/system/open-questions.md`](../system/open-questions.md) for where to record the answer.

**Step 3 — triage, do not chase a score.** Fix by severity, not by count:

1. **Security hotspots / vulnerabilities** — fix now, especially anything on the contact gate, auth,
   document storage, or user data.
2. **Bugs** — fix now.
3. **Code smells** — fix only in files the migration already touches. A repo-wide smell sweep is a
   separate, low-value effort; ratchet the gate on **new** code instead ("clean as you code").
4. **Duplication / coverage targets** — informational; do not block the migration on them.

Suppressions must carry a reason, and false positives get a one-line justification, never a blanket
exclusion.

### Where these fixes land

Static-analysis fixes ride **in the same commit as the file's migration** wherever possible. A
separate "Sonar fixes" mega-commit is unreviewable and conflicts with everything else in flight.

---

## Combined checklist

- [ ] Ponytail ladder applied to every change; deliberate corner-cuts marked `ponytail:`.
- [ ] No new dependency added without naming what it replaces.
- [ ] Comment review done **per file, during** its migration — not as a sweep.
- [ ] Stale/wrong comments treated as defects (the `serviceRequestMapper` precedent).
- [ ] Load-bearing rationale comments preserved; D33 absorbs the `@param` cleanup.
- [ ] ESLint warnings driven down / ratcheted before any scanner is added.
- [x] **Backend `mvnw test` added to CI.** Baseline 2266 run / 3 failures — the job is a real gate,
      so it is red until those three guards are resolved.
- [x] Sonar (SonarQube Cloud) wired; **findings not yet triaged by severity**.
- [ ] Quality gate set to Clean as You Code in the UI, and **not** marked a required check.
- [ ] Checkmarx-vs-CodeQL decision recorded in `open-questions.md`; the chosen SAST wired.
- [ ] Security findings on auth / contact gate / storage fixed before anything cosmetic.
