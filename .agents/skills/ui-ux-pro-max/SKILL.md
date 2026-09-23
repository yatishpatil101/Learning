---
name: ui-ux-pro-max
description: >-
    Generate professional UI/UX design systems before writing UI code. Wraps the local ui-ux-pro-max
    toolkit v2.15.0 (a searchable database of 79 UI styles, 192 color palettes + industry reasoning
    profiles, 74 font pairings, 119 UX guidelines, 105 icon rules, 17 GSAP motion presets, 25 chart
    types, across 22 stacks). Use whenever the user asks to design, build, create, implement, review,
    improve, or fix any UI / page / screen / component / landing page / dashboard — especially for
    PuneNest. Run the toolkit's search.py to get a recommended design system (pattern, style, colors,
    typography, effects, anti-patterns) and stack guidelines, then synthesize that into the actual code.
user-invocable: true
---

# ui-ux-pro-max

A local, prompt-driven design toolkit. It does **not** generate code itself — it returns curated design
guidance (design system + stack best-practices + anti-patterns) from CSV datasets via a Python BM25 search.
You then **synthesize** that guidance into real UI code.

## Toolkit location

This skill is versioned in the repo, but the toolkit it drives is installed **per machine** under the
user profile (it is ~3.7 MB of CSV data and is deliberately not committed). Resolve it as
`$env:USERPROFILE\.github\prompts\ui-ux-pro-max`:

```
<user profile>\.github\prompts\
  ui-ux-pro-max.prompt.md       full workflow, rules & pre-delivery checklist
  ui-ux-pro-max\
    scripts\search.py           the entry-point CLI (stdlib only, no pip deps, no network)
    scripts\core.py             BM25 search engine
    scripts\design_system.py    design-system generator + persistence
    scripts\reasoning_contract.py  reasoning-rule contract
    scripts\validate_data.py    dataset integrity checker
    data\*.csv                  styles, colors, typography, google-fonts, ux-guidelines, charts,
                                landing, products, ui-reasoning (192 industry rules), app-interface,
                                motion, icons, react-performance
    data\stacks\*.csv           per-stack guides (22)
```

Run scripts with the working directory at the toolkit root so relative `data\` paths resolve:

```powershell
cd "$env:USERPROFILE\.github\prompts\ui-ux-pro-max"
python scripts\search.py "<query>" [flags]
```

If that directory does not exist, the toolkit is not installed on this machine. Install or update it
with the official CLI (rewrites the whole `.github\prompts` tree):

```powershell
cd $env:USERPROFILE; npx --yes ui-ux-pro-max-cli@latest init --ai copilot --global --force
```

## Prerequisite: Python

The scripts need Python 3 (standard library only). Verify first:

```powershell
python --version    # if this is the Microsoft Store stub / missing, Python is NOT installed
```

If Python is missing, **ask the user to install it** — never run `winget`/`choco` on their machine.

Gotcha: if a stale `scripts\__pycache__` exists with `.pyc` from a different Python version (or from a
previous toolkit version), delete it before first run (`Remove-Item -Recurse -Force scripts\__pycache__`).

## Query contract (v2.15)

- Pick the **smallest** mode that fits: `--design-system` for a whole page/product direction, a single
  `--domain` for one focused concern, `--stack` for implementation detail.
- One dominant intent per query, **2–5 meaningful terms** plus one constraint (product / platform /
  interaction). Never bundle unrelated checklist topics into one query.
- For accessibility or text-layout bugs, query the **observable outcome first** (`"error summary
  validation" --domain ux`, `"badge chip label wraps" --domain ux`), then the stack for implementation.
- Verify the returned domain and top result actually fit the product. If empty or off-topic, **retry
  once** with a narrower rewrite; if it still fails, say no verified match was found and use clearly
  labelled general guidance. **Never persist unverified output.**

## Workflow (follow in order)

### 1. Analyze the request
Extract: **product type** (saas, e-commerce, dashboard, landing, real-estate, service…), **style keywords**
(minimal, professional, elegant, dark…), **industry**, and **stack** (infer from the project; PuneNest = `react`).

### 2. Generate the design system (REQUIRED for a new page/surface)
```powershell
python scripts\search.py "<product_type> <industry> <keywords>" --design-system -p "Project Name" -f markdown
```
Returns: recommended pattern, style, a full semantic color token set, typography, effects, and
anti-patterns to avoid. Use `-f markdown` for clean docs output (default is an ASCII box for terminals).
`--stack` is **ignored** in `--design-system` mode — run a separate `--stack` search for stack rules.

Optional dials (only with `--design-system`) tune the output without changing the query:
`--variance 1-10` (1 = centered/minimal → 10 = bold/asymmetric), `--motion 1-10` (subtle → complex;
pulls a matching GSAP snippet from `motion.csv`), `--density 1-10` (spacious → dense/dashboard).

Optional — persist for reuse across pages/sessions (Master + Overrides):
```powershell
python scripts\search.py "<query>" --design-system --persist -p "Project Name" [--page "dashboard"] -o "<project-root>"
```
Creates `design-system/<project-slug>/MASTER.md` (+ `pages/<page>.md`). Pass `-o` explicitly, pointed at
the project root — it defaults to the *current* directory, which here is the toolkit folder. Existing
files are **skipped**, not overwritten; read `MASTER.md` before deciding `--force` is justified, and
don't overwrite without the user's say-so. When building a page, check its page file first; if present
it overrides MASTER, else use MASTER.

### 3. Supplement with domain searches (as needed)
```powershell
python scripts\search.py "<keywords>" --domain <domain> -n 5
```
Domains: `style`, `color`, `chart`, `landing`, `product`, `ux`, `typography`, `icons`, `gsap`, `react`,
`web`, `google-fonts`.
Examples: `--domain ux "focus not obscured"`, `--domain chart "real-time dashboard funnel"`,
`--domain icons "icon button accessible label"`, `--domain style "glassmorphism dark"`.

### 4. Get stack guidelines
```powershell
python scripts\search.py "<keywords>" --stack react
```
Stacks (22): `html-tailwind` (web default), `react`, `nextjs`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`,
`astro`, `shadcn`, `angular`, `laravel`, `threejs`, `swiftui`, `react-native`, `flutter`,
`jetpack-compose`, `javafx`, `wpf`, `winui`, `avalonia`, `uno`, `uwp`.
Web-stack search is version-aware: plain queries return current guidance; naming an older major
(`Svelte 4`, `Next.js 15`) returns only curated legacy rows, or nothing rather than mixing generations.

### 5. Synthesize & implement
Combine design system + domain + stack results into the actual UI code. Then run the project's normal
verification (for PuneNest: the relevant Playwright specs).

Add `--json` to any non-design-system search for machine-readable output (or `--full` to keep long
text fields untruncated — human-readable output truncates them at 300 chars).

## Non-negotiable quality rules (from the toolkit)

- **No emojis as UI icons** — use SVG (Phosphor is the toolkit default, Heroicons/Lucide as fallback),
  one consistent family, consistent stroke width, sizes as tokens.
- **Stable hover/press** — animate color/opacity/elevation, never transforms that shift layout bounds.
- **All clickable elements get `cursor-pointer`** and clear hover/focus feedback. Timing comes from
  shared tokens chosen for distance/complexity/platform — not one duration copied everywhere.
- **Contrast**: body text ≥ 4.5:1 in *both* light and dark (3:1 only for large text and non-text UI);
  meaningful icons and control boundaries ≥ 3:1; glass cards need real opacity and visible borders.
- **Layout**: respect safe areas and fixed bars (add content insets); one consistent `max-w`; 4/8px
  spacing rhythm; responsive at 375 / 768 / 1024 / 1440; no horizontal scroll on mobile.
- **Resilient text**: headings, chips, badges and long tokens must reflow at narrow widths, zoom and
  text scaling without clipping; badge meaning never by color alone; `+n` disclosures stay operable.
- **Accessibility**: alt text, labeled inputs, decorative icons `aria-hidden`, focus order matches
  visual order, color never the only signal, visible keyboard focus, respect `prefers-reduced-motion`.

## PuneNest defaults

- Stack = `react` (the frontend is React + Vite + Tailwind) — pass `--stack react`; `html-tailwind`
  guidance also applies since styling is Tailwind.
- Keep results consistent with the existing Draazy theme — see the `draazy-frontend` skill.
- Good starting query: `"real estate marketplace property listings trust professional"`.

## Sibling skills bundled by the same installer

`$env:USERPROFILE\.github\prompts\` also holds `brand`, `design`, `design-system`, `slides`,
`ui-styling`, and `banner-design` (each with its own `SKILL.md`, references and scripts). Reach for
`design-system` for design-token architecture and `ui-styling` for Tailwind/shadcn specifics.

For full details, examples and the app-UI pre-delivery checklist, read
`$env:USERPROFILE\.github\prompts\ui-ux-pro-max.prompt.md`.
