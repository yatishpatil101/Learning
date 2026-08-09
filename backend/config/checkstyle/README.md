# Checkstyle config — provenance and status

**Status: stored for reference, NOT wired into the build.** See **D36** in
`docs/system/tech-debt.md` for the decision and the measured baseline before changing that.

> **The short version, so this file stands alone.** Enabling Checkstyle as supplied would hand a
> human ~494 mechanical edits and find zero bugs: of 717 violations measured on 333 main-source
> files, **only 12 (1.7%) actually need a linter**. 494 are layout a formatter fixes for free, and
> 211 come from rules that contradict the documentation standard in `api-standards.md` §10 and would
> have to be deleted. Hence formatter-first: Spotless owns layout, and only then is it worth asking
> whether the residual 12 justify keeping Checkstyle at all. The boundary rules that would otherwise
> have been its job already ship as `ArchitectureBoundaryTest`.

## Where this came from

`checkstyle.xml` is the Google Java Style config supplied by the project owner. Two files were
supplied (`checkstyle.xml`, `checkstyle-checker.xml`); they were **byte-identical** (SHA-256
`510E0BC6…7AC6`), so one copy is kept. It lives here rather than being referenced from its original
location because **a build must never depend on a path inside someone's personal OneDrive.**

## The one modification

The supplied file is an older revision that declares `LineLength` under `TreeWalker`. Checkstyle
moved that module to `Checker` in **8.24**, so as supplied it aborts with:

    TreeWalker is not allowed as a parent of LineLength

`LineLength` has been hoisted to `Checker` level. **Nothing else was altered** — the file is
otherwise as supplied, so it can still be diffed against the original.

## Known issues, do not "fix" without reading D36

- The engine available offline is **10.13.0 (Jan 2024)**; current is **13.9.0**. 13.x removed
  `JavadocStyle` and reworked the Javadoc AST, so this config needs work, not a version bump.
- 10.13.0 **predates Java 22–25 syntax**. This project is Java 25. It parses today only because
  nothing uses post-21 syntax yet.
- `CustomImportOrder` and `ImportOrder` are both enabled and disagree. Together they produce **357**
  of the 717 baseline violations.
- `SingleLineJavadoc` (208 violations) **contradicts D33**, which is deliberately moving toward terse
  one-line Javadoc. It must be dropped, not satisfied.

## Reproducing the baseline

    cd backend
    $env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'
    mvn -o org.apache.maven.plugins:maven-checkstyle-plugin:3.4.0:check `
      "-Dcheckstyle.config.location=config/checkstyle/checkstyle.xml" `
      "-Dcheckstyle.version=10.13.0" "-Dcheckstyle.failOnViolation=false" `
      "-Dcheckstyle.output.file=target-cli/checkstyle-result.xml" "-Dcheckstyle.output.format=xml"

Last run: **717 violations / 333 files** (main sources only).
