# Working on Nirikkha

A marking agent for handwritten Bangla CQ (সৃজনশীল প্রশ্ন) answer scripts. Read this
before changing anything; most of it is decisions that cost something to learn.

## The one rule

**When the reader cannot make out a word, it does not guess.** It writes `[[অস্পষ্ট]]`
in place, and the script is held until a human resolves it. A fabricated grade on
handwriting nobody could read is the worst failure this system can have, so every
design choice defers to that.

Corollaries that are enforced in code, not just intended:

- A score is never published from a transcript that has changed since marking
  (`submissions.marks_stale` blocks release until the script is marked again).
- The **total is computed in code**, never taken from the model.
- A rotated, blurred or non-answer page is **refused with a reason**, not marked.
- Teacher overrides are append-only (`overrides`), and every field the agent wrote keeps
  its original beside the live value — `ai_awarded`, `ai_reason`, `ai_improvement`,
  `ai_feedback` — so a correction is visible rather than reconstructed.
- **Anything the agent wrote, a teacher can rewrite, and the student is told whose words
  they are reading.** `marks.edited_by` and `submissions.feedback_edited_by` carry the
  name. Marking again clears them, because the agent is then speaking about text it has
  not seen before.

## Layout

```
api/app/
  agents/ocr.py       reads a script into numbered lines; providers behind OcrProvider
  agents/grader.py    marks a transcript; providers behind GraderProvider
  agents/base.py      JSON coercion, retries, strict int parsing
  telegram/           Bot API client, enroll, sessions, webhook
  classroom.py        teacher settings, batches, exams, publish
  prompts.py          the OCR uncertainty policy and the CQ rubric
  pipeline.py         read → gate → grade → review → release
  mcp.py              MCP server (4 tools)
  main.py             HTTP surface, auth, teacher panel, static hosting
web/src/              React, Bangla-first with an English mirror, runtime-configured
supabase/migrations/  schema and RLS
scripts/set_role.py   grant the teacher role
```

Telegram, batches and exams need `APP_URL` (public HTTPS for `setWebhook`) and
`SETTINGS_ENCRYPTION_KEY` (AES-256-GCM for the bot token in `org_settings`).
## Two agents, on purpose

OCR reads; grading only ever sees text. Either swaps without touching the other, and
the grader needs no vision capability. Both sit behind an interface chosen by env var:

```bash
OCR_PROVIDER=gemini    OCR_MODEL=gemini-3.7-flash
GRADER_PROVIDER=openai GRADER_MODEL=gpt-5.6-luna  GRADER_REASONING_EFFORT=high
```

`stub` providers run the whole pipeline with no keys — that is what the test suites use.
To add an engine, implement the protocol and register it. Declare
`supports_legibility` / `supports_bbox` honestly; the gate degrades rather than silently
disappearing when a capability is missing.

**Model choice is a measurement question, settled in TenBench, not in code.** Two results
worth not re-deriving: `gemini-3.7-flash` beat `2.5-flash` (32% faster, and 2.5 misread
`৫ kg` as `৪ kg`, costing a mark for arithmetic that was correct); and high reasoning
effort caught a wrong division in 3 runs of 4 where the default caught it in 1.

## The CQ mark scheme is fixed

ক 1 · খ 2 · গ 3 · ঘ 4, total 10. Each part is marked independently against its own
descriptor. Do not invent an output format — `CQ_PARTS` in `schemas.py` is the source of
truth and the prompts are generated from it.

## Conventions

- **Numbers in the interface are Western digits, even in Bangla** — marks, line numbers,
  dates. Text transcribed from a script keeps whatever the student wrote. Use
  `formatDate()`; `toLocaleDateString(undefined, …)` follows the machine's locale and
  renders `১১ সেপ` on a bn-BD device.
- **Bangla voice**: conversational চলিত ভাষা, address the student as "তুমি", keep
  technical terms in English, no emojis. `BANGLA_VOICE` in `prompts.py`.
- **Never trust model output.** Strip fences, reject booleans before int coercion
  (`isinstance(True, int)` is `True` in Python and would award a mark), range-check every
  score, cap free text. `agents/base.py`.
- **A status reads differently depending on who is looking.** "Needs your help" is
  addressed to the student; a teacher sees "Waiting on the student". `statusKey()`.
- **Client config is fetched at runtime** from `/api/config`, not inlined by Vite, so one
  image runs in any environment. Do not reintroduce `VITE_SUPABASE_*` build args.
- **Comments explain why, not what**, and carry no reference to internal or third-party
  products — this repo is public.

## Security

The service key bypasses RLS, so **authorisation is enforced in application code**:
every route resolves the caller and checks ownership or the teacher role before touching
a row. RLS is defence in depth, not the only gate. Caller resolution is cached 30s
(`AUTH_TTL`), which is why a role change takes up to half a minute to take effect.

MCP tools are a channel to the agent, not a window into the database — four narrow tools,
no raw query surface. Keep it that way.

## Tests

```bash
cd api
python -m pytest tests/test_units.py -q   # pure logic, no network
python tests/e2e.py                       # full pipeline, stub providers
python tests/mcp_test.py                  # the MCP surface
python tests/teacher_test.py              # the teacher panel
API=https://… python tests/smoke_prod.py  # deployed service, real models
```

`e2e.py` and `mcp_test.py` assert stub-specific behaviour and are meant for a local
server; pointed at production they fail because a real vision model correctly refuses the
synthetic blank PNG they upload. `teacher_test.py` and `smoke_prod.py` work against both.

Run `ruff check api/app` before committing. `B008` is disabled because it flags FastAPI's
`Depends` idiom.

## Deploying

```bash
gcloud run deploy nirikkha --source . --region us-central1 \
  --timeout=900 --min-instances=1   # see README for the full env var list
```

`--timeout=900` because Cloud Run defaults to 5 minutes, and `--min-instances=1` because a
cold Python container takes 5–15s to wake and looks broken. Cloud Run caps an HTTP/1 body
at 32 MiB, which is why uploads are limited to 3 pages and 28 MB in total.

## Known gaps

- **`LEGIBILITY_THRESHOLD` (0.65) is uncalibrated on real handwriting.** Every real sample
  tried so far was a photographed textbook page, correctly refused, so nothing reached the
  scoring path. One legible handwritten script closes this. Org settings may override the
  threshold via `org_settings.ocr_confidence_threshold`.
- No bounding boxes from the reader (`supports_bbox: false`); teacher annotations are
  drawn by hand and do not depend on them.
- Multi-question exams only grade `questions[0]` (same as the upstream classroom app).
- Telegram-provisioned students use synthetic `tg_{id}@bot.local` accounts; there is no
  web account-linking UI yet.
