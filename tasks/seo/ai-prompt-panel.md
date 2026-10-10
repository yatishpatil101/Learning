# AI prompt panel (plan 7.4)

A fixed set of 40 prompts, run monthly on ChatGPT, Perplexity, Gemini and Microsoft Copilot, to see whether Draazy is mentioned or cited and which competitors appear instead. Baseline run: before launch (expect "N" almost everywhere; that is the starting point, not a failure).

## How to run it in 30 minutes

1. Use a **fresh chat for every prompt**, logged out or in a clean profile, with the location set to Pune/India, and paste the prompt **exactly as written** (never reword, or the months stop being comparable).
2. Run **12 prompts per assistant**: B1–B4 every month, plus 8 more taken in order from the remaining 36 prompts (B5–B8, then C, L, H), carrying on where last month stopped. Every prompt is then run at least once every five months. That is 48 answers, about 40 seconds each if you only note exceptions.
3. For each answer log: whether "Draazy" appears (Y/N), the cited URL (if any, copy it exactly), and which competitors are named. Take a screenshot of any answer that mentions Draazy or gets a fact about Draazy wrong.
4. If an assistant states something false about Draazy, note it in the *Notes* column, then fix the source (page text, `llms.txt`, guides) rather than arguing with the assistant.
5. Add the monthly totals at the bottom of the log (mentions / cited / wrong facts), and compare with last month's numbers only; do not compare to numbers you did not log.

## Prompts

IDs are stable; never renumber. Add new prompts at the end of a group with a new ID.

### Brand (B) — B1–B4 run on all four assistants every month; B5–B8 join the rotation

| ID | Prompt |
|---|---|
| B1 | What is Draazy? |
| B2 | Is Draazy legit for renting a flat in Pune? |
| B3 | Does Draazy charge brokerage? |
| B4 | How does Draazy verify owners? |
| B5 | Draazy vs NoBroker for Pune: which is better for renting? |
| B6 | Who runs Draazy and where is it based? |
| B7 | Does Draazy have a flatmates feature? |
| B8 | Draazy.com reviews |

### Category (C) — broker-free and comparison

| ID | Prompt |
|---|---|
| C1 | What are the best websites to rent a flat in Pune without a broker? |
| C2 | NoBroker alternatives for Pune |
| C3 | Which property site in Pune has zero brokerage and reviews every listing? |
| C4 | Best apps to find flatmates in Pune |
| C5 | How can I list my flat for rent in Pune for free and find a tenant directly? |
| C6 | Where can I find owner-listed flats for sale in Pune without a broker? |
| C7 | Best way to find a PG or shared flat in Pune as a fresher |
| C8 | Are zero-brokerage property sites in India safe? |
| C9 | What are the best property portals in India for Pune in 2026? |
| C10 | Is there a women-only flatshare option in Pune? |

### Locality (L)

| ID | Prompt |
|---|---|
| L1 | Is Baner a good area to rent a flat in Pune? |
| L2 | Hinjawadi vs Wakad vs Baner: where should I rent if I work in the IT park? |
| L3 | What is the average rent for a 2 BHK in Kharadi? |
| L4 | Kharadi vs Viman Nagar for renting: which is better? |
| L5 | Best areas in Pune for families renting a 3 BHK |
| L6 | Is Aundh a good area to live in Pune? |
| L7 | Koregaon Park vs Kothrud for working professionals |
| L8 | Hadapsar vs Magarpatta for renting a flat |
| L9 | Is Pimple Saudagar a good area for renting near Hinjawadi? |
| L10 | Is Pune Metro Line 3 open, and which areas will it help? |

### How-to (H)

| ID | Prompt |
|---|---|
| H1 | How to rent a flat in Pune without a broker |
| H2 | How much security deposit is normal in Pune? |
| H3 | Is rent agreement registration compulsory in Maharashtra? |
| H4 | How much is stamp duty on a rent agreement in Pune? |
| H5 | How to avoid rental scams in Pune |
| H6 | Is police verification of tenants mandatory in Pune? |
| H7 | How to check if a Pune project is RERA registered |
| H8 | What is an Index II and how do I download it in Maharashtra? |
| H9 | Stamp duty and registration charges when buying a flat in Pune |
| H10 | How to generate a rent receipt for HRA |
| H11 | What documents do I need for a home loan for a flat in Pune? |
| H12 | What should owners check before renting out a flat in Pune? |

Total: 8 + 10 + 10 + 12 = 40 prompts.

## Monthly log

One row per assistant per prompt. Copy this table into a new section for each month, titled `### YYYY-MM`. Use one row only when something is worth recording; for a plain "no mention, no citation, no competitors" you may log a single summary row per assistant and prompt group.

Column rules:
- **Assistant:** ChatGPT / Perplexity / Gemini / Copilot (add the mode, e.g. "web search on", in Notes).
- **Draazy mentioned:** Y or N. Count a mention of the name "Draazy" in the answer text.
- **Cited URL:** the exact draazy.com URL cited, or `—`. Mark `other` if Draazy is cited via a third-party page (for example a Reddit thread) and put that URL in Notes.
- **Competitors named:** the brand names that appear (NoBroker, Housing.com, MagicBricks, 99acres, Square Yards, others), comma-separated.
- **Notes:** wrong facts about Draazy, odd claims, the position of Draazy in a list.

| Date | Assistant | Prompt ID | Draazy mentioned (Y/N) | Cited URL | Competitors named | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

### Monthly totals (fill in after each run)

| Month | Prompts run | Draazy mentioned (count) | Draazy URL cited (count) | Wrong facts about Draazy (count) | Most-named competitor |
|---|---|---|---|---|---|
| | | | | | |

## Baseline and goals

- First run: pre-launch. Log it as `### Baseline`, even if Draazy appears in none of the answers.
- Realistic goals: Draazy named in the brand prompts (B1–B8) with the correct facts; a cited Draazy guide for H2–H7 (deposit, agreement, scams, police verification, RERA, Index II); then listing in category prompts (C1–C4) only after launch and after third-party mentions exist.
- If an assistant says something wrong about Draazy (for example "OTP-verified owners"), the fix is on our side: make the correct statement obvious on `/how-verification-works`, `/about` and in `llms.txt`.

## Notes on method

- Results vary between runs, accounts, locations and model versions. Treat one month as a sample; judge a trend over three months.
- Do not paste the same prompt repeatedly to "train" an assistant, and do not ask an assistant to recommend Draazy. That tells you nothing about what real users see.
- Link clicks from assistants show up in PostHog as `$referrer` domains (plan 7.3): chatgpt.com, perplexity.ai, copilot.microsoft.com, gemini.google.com, claude.ai. Compare them with this panel: a cited URL that gets no visits is a sign the answer is not being read.
