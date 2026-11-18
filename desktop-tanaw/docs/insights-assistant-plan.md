# TANAW Insights Assistant: Implementation Plan

Status: implemented on branch `chat-bot`.

This plan replaces the dashboard's keyword chatbot ("TANAW AI Assistant") with a
rule-based, bilingual (English and Tagalog) insights assistant. Every number it
says comes from the desktop application's own local counts. It works offline,
answers instantly, sends nothing off the computer and does not compete with
camera counting for processor time.

It gives insights only. It never makes decisions, changes settings or submits
reports.

## 1. Goals and non-goals

Goals

- Answer common questions about visitor activity in plain English or Tagalog,
  including Taglish and common misspellings, for example:
  - "Pinakang busy ng establishment today?"
  - "Pinakamaraming bisita ngayong linggo?"
  - "How many visitors did we have yesterday?"
  - "Compare today with yesterday"
- Answer which hour was busiest, which the dashboard cannot show today.
- Reply in the language of the question, or in a language the user selects.
- Never state a number that is not in TANAW's data, and say when figures are
  partial, low-coverage or unavailable.
- Keep the question-understanding and answer logic in pure functions covered by
  Vitest, as the project testing policy requires.

Non-goals

- No large language model, local or cloud. A model can be added later only to
  reword answers computed here (see section 10).
- No free-form conversation, memory across sessions, or decisions on the
  user's behalf.

## 2. Current state (before this change)

- `src/features/dashboard/components/TanawAssistant.tsx` held all logic inline:
  four regular expressions, English-only templates, no unit tests.
- Known defects:
  1. While the dashboard reloaded counts, `summary` was `null`, so the assistant
     answered "counting setup is incomplete" even when setup was fine.
  2. Substring matching misfired: `count` matched "account", `entr` matched
     "central", and `visitor` swallowed most questions.
  3. Coverage below 1% was shown as "0%", unlike the dashboard ("<1%").
  4. Old answers kept stale numbers with no time stamp.
  5. "Busiest hours" could not be answered: no hourly data was exposed.
  6. The name "AI Assistant" overstated what it does.

## 3. Architecture

```
Question ─► understand()  ─► Plan {intent, period, granularity, language}
                               │
                               ▼
            dataNeeds(plan) ─► loadAssistantData()  (local ML service only)
                               │   summary(period), summary(previous period),
                               │   hourly(period), live occupancy
                               ▼
            compose(plan, data, now) ─► Reply {language, text, details, notes, basis}
```

- `understand` and `compose` are pure and deterministic, so the same question
  and data always give the same answer.
- `loadAssistantData` fetches fresh data for the period the question names, so
  answers never depend on the dashboard's loading state (defect 1).
- Every reply records the period and the time it was computed ("Based on: Today
  · as of 3:42 PM"), so older replies are clearly dated (defect 4).

### Files

ML service (`desktop-tanaw/ml-service`)

| File                                                   | Purpose                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `app/analytics/establishment_hourly.py`                | Pure hour-of-day aggregation of observations and occupancy intervals.                      |
| `app/storage/repositories/establishment_repository.py` | `hourly(start, end, now)`: validates the range, reads retained rows, calls the aggregator. |
| `app/camera/pipeline_manager.py`                       | `establishment_hourly()` wrapper under the lifecycle lock.                                 |
| `app/api/establishment.py`                             | `GET /metrics/establishment/hourly`.                                                       |
| `tests/test_establishment_hourly.py`                   | Aggregator and API tests.                                                                  |

Desktop renderer (`desktop-tanaw/src/features/dashboard/assistant/`)

| File             | Purpose                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`       | `Intent`, `PeriodKey`, `Language`, `Plan`, `AssistantData`, `Reply`.                                                             |
| `normalize.ts`   | Lower-casing, accent and punctuation removal, Tagalog prefix splitting, spelling variants, tokenisation, edit-distance matching. |
| `lexicon.ts`     | English and Tagalog keyword lists with weights for intents, periods and language markers.                                        |
| `understand.ts`  | Question to `Plan`: intent scoring, period and granularity detection, language detection.                                        |
| `periods.ts`     | Period ranges in Asia/Manila business days and the previous equal-length period.                                                 |
| `facts.ts`       | Derived facts: visitor totals, busiest day, busiest hour, change versus previous period, sex split, caveats.                     |
| `phrases.ts`     | English and Tagalog wording, number, hour and date formatting.                                                                   |
| `compose.ts`     | `Plan` + data to `Reply`, one composer per intent.                                                                               |
| `data.ts`        | `dataNeeds(plan)` and `loadAssistantData()` against the ML service client.                                                       |
| `suggestions.ts` | Suggested questions per language.                                                                                                |

UI

- `TanawAssistant.tsx` keeps its panel, focus and scroll behaviour, and now:
  - is named **TANAW Insights** ("Answers from your establishment's counts");
  - adds a language switch: Auto, English, Tagalog (remembered per computer in
    `localStorage`, wrapped in `try/catch`);
  - shows a "Checking your counts…" placeholder while data loads;
  - renders replies as a main sentence, optional detail bullets, caveat notes and
    a "Based on" line;
  - offers suggestions again after a reply it could not understand.
- `DashboardView.tsx` passes only `filter` (the default period) and the latest
  report.
- `src/features/camera/services/ml-service.ts` gains `getEstablishmentHourly()`
  and `establishment.types.ts` gains `EstablishmentHourly`.

## 4. Hourly activity endpoint

`GET /metrics/establishment/hourly?start=<iso>&end=<iso>`

- `start` and `end` must be Asia/Manila midnights, increasing, at most 31 days
  apart (observations are retained for 30 days).
- Response:

```json
{
  "enterprise_id": "park",
  "from_at": "2026-11-17T16:00:00+00:00",
  "to_at": "2026-11-18T16:00:00+00:00",
  "timezone": "Asia/Manila",
  "days_requested": 1,
  "days_retained": 1,
  "state": "available",
  "hours": [{ "hour": 0, "entries": 0, "area_visits": 0, "peak_occupancy": null, "covered_ms": 0 }]
}
```

- `hours` always has 24 items, aggregated by local hour of day across the
  requested days.
  - `entries`: Entry / Exit observations that count as an entry (the same rule as
    `daily_movements`), by local hour of `first_at`.
  - `area_visits`: Open Space visits, by local hour of `first_at`.
  - `peak_occupancy`: the highest recorded establishment occupancy among
    occupancy intervals overlapping that hour, or `null` when none overlaps.
  - `covered_ms`: how long occupancy was observed within that hour, summed
    across days.
- `state`: `unavailable` when nothing was observed, `partial` when some
  requested days fall outside the 30-day retention window, otherwise
  `available`.
- Only anonymous aggregate counts are returned: no visitor identifiers, images
  or appearance data.
- The endpoint is additive, so the API contract version stays the same. An older
  ML service answers 404; the assistant then falls back to daily figures.

## 5. Question understanding

### 5.1 Normalisation

1. Lower-case and remove accents (`ñ` becomes `n`).
2. Replace hyphens and punctuation with spaces (`pinaka-busy` becomes
   `pinaka busy`).
3. Split the Tagalog superlative prefix: `pinakang`, `pinakamarami`,
   `pinakabusy` become `pinaka` + the rest.
4. Map spelling variants: `bc` to `busy`, `ngayong` to `ngayon`, `ilang` to
   `ilan`, `marami`/`maraming` to `marami`, `bumisita` to `bisita`, and so on.
5. Tokenise on whitespace.
6. Match words exactly, or within one edit for words of five or more letters, so
   "visotors" still matches "visitors". Phrases match whole token sequences, so
   "account" no longer matches "count" (defect 2).

### 5.2 Intents

| Intent          | Example English cues                                            | Example Tagalog cues                                         | Answer                                                                           |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `busiest`       | busiest, busy, peak, crowded, most people, what time, which day | pinaka, pinaka busy, siksikan, dagsa, anong oras, anong araw | Busiest hour (one day) or busiest day plus busiest hour (several days).          |
| `visitors`      | visitors, how many, total, people                               | bisita, ilan, tao, dumating                                  | Estimated unique visitors and entries.                                           |
| `occupancy_now` | right now, inside, currently, occupancy                         | sa loob, kasalukuyan, sa ngayon                              | Live occupancy and cameras offline.                                              |
| `movement`      | entries, exits, came in, went out                               | pumasok, lumabas                                             | Entries, exits and returns.                                                      |
| `sex`           | male, female, men, women, gender                                | lalaki, babae, kasarian                                      | Male/female split when estimated.                                                |
| `compare`       | compare, versus, increase, decrease, than                       | kumpara, ikumpara, tumaas, bumaba, mas                       | Change against the previous equal-length period.                                 |
| `report`        | report, submission, submitted, DOT                              | ulat, report, isinumite                                      | Latest saved report.                                                             |
| `coverage`      | accurate, reliable, coverage, how sure                          | tumpak, sigurado, tama ba                                    | Observation coverage and estimate caveats.                                       |
| `summary`       | insights, summary, overview, trend, analyze                     | buod, kalagayan, lagay                                       | Several facts: visitors, change, busiest day or hour, live occupancy, sex split. |
| `help`          | help, what can you do                                           | tulong, ano kaya mo                                          | What the assistant can answer.                                                   |
| `greeting`      | hi, hello, thanks                                               | kumusta, salamat, magandang umaga                            | Greeting with suggestions.                                                       |
| `unknown`       | anything else                                                   |                                                              | Says it cannot answer that yet and offers suggestions.                           |

Scoring: each matched keyword or phrase adds its weight to its intent; the
highest total wins; ties follow the table order. `greeting` and `help` win only
when no data intent matched, so "Hi, how many visitors today?" is answered as a
visitor question.

Granularity: "hour", "time", "oras", "anong oras" ask for the busiest hour;
"day", "araw", "anong araw", "which day" ask for the busiest day.

### 5.3 Periods

| Key         | Cues                                                                   | Range (Asia/Manila business days) |
| ----------- | ---------------------------------------------------------------------- | --------------------------------- |
| `today`     | today, ngayon, ngayong araw                                            | today                             |
| `yesterday` | yesterday, kahapon                                                     | yesterday                         |
| `week`      | week, this/last week, 7 days, linggo, ngayong linggo, nakaraang linggo | past 7 days including today       |
| `month`     | month, 30 days, buwan, ngayong buwan                                   | past 30 days including today      |

- When several are present the more specific wins (`month`, `week`,
  `yesterday`, then `today`), so "ngayong linggo" is the week. For comparisons,
  "today ... yesterday" compares today against yesterday.
- When none is present the dashboard's selected period is used.
- "Week" and "month" follow the dashboard's definitions (past 7 and 30 days) and
  are labelled that way, so replies never imply a calendar week or month.
- The previous period is the equal-length period immediately before.

### 5.4 Language

- The panel's language switch overrides detection.
- In Auto mode, the question's Tagalog and English marker words are counted
  ("ang, ng, mga, ba, po, ilan, anong, pinaka, bisita, ngayon..." against "the,
  is, what, how, many, which, today, visitors..."). More Tagalog markers means a
  Tagalog reply; a tie or no markers means English.

## 6. Answer rules

- Visitors: use `unique_count` when identification is available or partial,
  otherwise say unique estimates are unavailable and give entries instead.
- Busiest hour: highest `peak_occupancy`; ties and hours without occupancy use
  `entries + area_visits`. Report the hour as "2:00–3:00 PM" with the peak and
  the arrivals in that hour.
- Busiest day: highest `unique_count` among observed days, falling back to
  `peak_occupancy` when identification is unavailable.
- Comparison: absolute and percentage change of unique visitors; no percentage
  when the previous period had zero; "no change" when equal. A period that
  includes today adds "Today is not over yet".
- Sex split: only when `sex_estimation_state` is `estimated`; otherwise explain
  that the split is unavailable or partial for the period.
- Caveats are added whenever they apply:
  - `reconciliation_state` is `partial` (which also covers days with no
    records): "These figures are partial estimates."
  - coverage below 50% of the period's elapsed time: "Cameras observed only N%
    of this period." (with "<1%" for tiny values, matching the dashboard). A
    period that includes today is measured up to now, so a morning answer is
    not called low coverage;
  - live state partial or cameras missing: "Some cameras are offline."
  - hourly `state` partial or unavailable.
- Nothing observed: "No counts were recorded for <period>. Start your cameras
  in Camera Setup to collect activity."
- Data could not be loaded: "I can't read your counts right now. Check that the
  TANAW counting service is running."

Wording keeps consistent terms. English: "estimated visitors", "entries",
"exits", "people inside". Tagalog: "tinatayang bisita", "pumasok", "lumabas",
"tao sa loob". Times use "2:00–3:00 PM" in both languages and dates use the
en-PH format ("Nov 18").

## 7. Testing

Fast checks (every change)

- Vitest, `tests/unit/renderer/assistant/`:
  - `normalize.test.ts`: prefix splitting, variants, edit-distance matching.
  - `understand.test.ts`: a corpus of over 100 English, Tagalog and Taglish
    questions, including the examples in section 1 and misspellings, each with
    its expected intent, period and language. It reports the corpus accuracy and
    must stay at 100%; add any misread real question to it.
  - `periods.test.ts`: ranges and previous periods around Manila midnight.
  - `compose.test.ts`: every intent in both languages, caveats, missing data,
    zero previous period, hourly fallback, "<1%" coverage.
  - `data.test.ts`: only the needed requests are made; establishment mismatches
    and failed hourly requests are handled.
- pytest, `ml-service/tests/test_establishment_hourly.py`: hour bucketing across
  Manila midnight, interval overlap and peaks, entry rule parity with
  `daily_movements`, retention state, range validation, API shape and
  enterprise isolation.
- `npm run type`, `npm run lint`, `npm test`; `uv run ruff check .`,
  `uv run ruff format --check .`, `uv run mypy .`, `uv run pyright`,
  `uv run pytest` in `ml-service`.

Targeted Playwright

- `tests/e2e/browser/unified-metrics.spec.ts` (updated: new names, an English
  visitor question, a Tagalog busiest-hour question with a mocked hourly
  response, the report question).
- `tests/e2e/browser/dark-mode.spec.ts` (contrast audit of the panel via
  `theme-and-filters.ts`).
- `tests/e2e/electron/dashboard-interactions.spec.ts` (open, ask, collapse,
  focus return).

## 8. Implementation steps

1. Add the hourly aggregator, repository method, wrapper, route and pytest.
2. Add the desktop client function and types.
3. Build `normalize`, `lexicon`, `understand` with the question corpus tests.
4. Build `periods`, `facts`, `phrases`, `compose`, `suggestions` with tests.
5. Build `data.ts` with tests.
6. Rewire `TanawAssistant.tsx` and `DashboardView.tsx`; add styles for the
   language switch, details, notes and pending state in `design.css` and
   `theme.css` (dark mode).
7. Update the Playwright specs that name the assistant.
8. Run fast checks and the targeted Playwright specs; commit.

## 9. Risks and mitigations

| Risk                                  | Mitigation                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Phrasing nobody anticipated           | Helpful fallback with suggestions; grow the corpus from real questions.                  |
| Awkward Tagalog                       | Plain, conversational templates; native speakers on the team should review `phrases.ts`. |
| Hourly data older than 30 days        | `state: partial` and a caveat; daily figures still answer.                               |
| Older ML service without the endpoint | Hourly request failure falls back to daily figures.                                      |
| Users read it as an AI                | Named "TANAW Insights"; the footer says answers come from this computer's counts.        |

## 10. Later options

- A local or cloud language model could reword `Reply` text or classify unusual
  questions, but must only use the facts `compose` produced, with every number
  checked against them before display.
- More periods (calendar months, a named date) and more intents (per-camera
  activity) can be added to the lexicon and composers.
