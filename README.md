# নিরীক্ষা · Nirikkha

**পড়ালেখা হোক নির্বিঘ্নে**

A marking agent for handwritten Bangladeshi **সৃজনশীল প্রশ্ন** (creative question) answer
scripts — with one rule that shapes everything else:

> **When it cannot read a line, it does not guess. It asks.**

Unreadable words come back marked `[[অস্পষ্ট]]` exactly where the reader failed, and the
script is not marked until a human resolves them. A fabricated grade on handwriting nobody
could read is the worst thing a system like this can do, so it is the one thing this one
will not do.

---

## The CQ mark scheme

| Part | Marks | Skill |
|---|---|---|
| ক | 1 | জ্ঞান — knowledge |
| খ | 2 | অনুধাবন — comprehension |
| গ | 3 | প্রয়োগ — application |
| ঘ | 4 | উচ্চতর দক্ষতা — higher-order skill |
| **মোট** | **10** | |

Each part is marked independently against its own descriptor. The total is computed in
code, never taken from the model.

## How it works

```
upload → OCR agent → confidence gate → grading agent → teacher review → release
                          │
                          └── unreadable lines → ask the student → resume
```

Two agents, deliberately separate. The OCR agent only reads; the grading agent only sees
text. Either can be swapped without touching the other, and the grader needs no vision
capability at all.

## Swapping models

Both stages sit behind one interface each, selected by environment variable. No provider
name appears outside its own adapter.

```bash
OCR_PROVIDER=gemini      OCR_MODEL=gemini-3.7-flash
GRADER_PROVIDER=openai   GRADER_MODEL=gpt-5.6-luna
```

`stub` providers are built in, so the whole pipeline runs end to end with no API keys —
useful for tests and for working offline.

To add an engine: implement `OcrProvider` (`api/app/agents/ocr.py`) or `GraderProvider`
(`api/app/agents/grader.py`), register it, done. Providers declare
`supports_legibility` / `supports_bbox` honestly, and the gate degrades rather than
silently disappearing when a capability is missing.

## Surfaces

- **Web** — Bangla-first, English mirror, light and dark. Students submit and resolve
  unclear lines.
- **Teacher panel** — every submission, not just the flagged ones: filter by status,
  exam, or batch; search by student or subject; correct any transcribed line, mark again,
  draw annotations on the page, write a note to the student, and release singly or in bulk.
  Marks show what the agent proposed alongside the current value, and a script whose
  transcript changed after marking cannot be released until it is marked again.
- **Batches & exams** — teachers link Telegram groups to batches, enroll students, create
  CQ exams (manual or generated), and publish an exam to a batch (`NK-XXXX` code + group
  announcement).
- **Telegram bot** — configure the token under Settings, connect the webhook to
  `APP_URL/api/telegram/webhook`. Students register in the group, DM the bot with the exam
  code, and upload a photo; results are DMed on release (or immediately when publish mode
  is `auto`).
- **MCP** — `POST /mcp`, four tools: `check_cq_script`, `clarify_unclear_line`,
  `get_cq_result`, `get_cq_rubric`. Deliberately narrow: a channel to the agent, not a
  window into the database.

### Connecting a client to the MCP server

```bash
python scripts/mcp_token.py            # prints a token and the config to paste
```

Streamable HTTP, JSON-RPC 2.0, authenticated with a Nirikkha account token in an
`Authorization: Bearer` header. Add it to Claude Code with:

```bash
claude mcp add --transport http nirikkha https://<service>/mcp \
  --header "Authorization: Bearer $NIRIKKHA_TOKEN"
```

Or in a `mcp.json` for Cursor or Claude Desktop:

```json
{ "mcpServers": { "nirikkha": {
    "url": "https://<service>/mcp",
    "headers": { "Authorization": "Bearer <token>" } } } }
```

**Tokens last one hour.** A client that starts answering "Not authenticated" needs a
fresh one from the script above — it is expiry, not a broken connection.

Once connected, ask in plain language: *"mark this answer script"* with an image, and the
client will call `check_cq_script`. If the reader could not make out a line it comes back
`awaiting_student` with the unreadable spans, and the client should show them to you and
send your answer with `clarify_unclear_line`; marking resumes on its own.

## Running locally

```bash
cp .env.example .env          # fill in Supabase + model keys + APP_URL + SETTINGS_ENCRYPTION_KEY
uv venv && . .venv/bin/activate
uv pip install -e '.[dev]'   # or: fastapi uvicorn pydantic httpx python-multipart google-genai openai cryptography
cd api && uvicorn app.main:app --reload --port 8099
```

For local Telegram webhooks, expose the API with ngrok (or similar) and set `APP_URL` to
that HTTPS origin, then use **Settings → Save & connect webhook**. Apply
`supabase/migrations/` (including `0008_classroom.sql`) before first run.

```bash
cd web && npm install && npm run dev
# In another terminal, run the API (Next rewrites /api → :8100):
cd api && uvicorn app.main:app --reload --port 8100
```

## Granting the teacher role

Teachers see the review queue, override marks and release results. There is no
self-service path to the role; grant it out of band after the person signs up:

```bash
python scripts/set_role.py --list
python scripts/set_role.py teacher someone@example.com
```

## Tests

```bash
cd api
python -m pytest tests/test_units.py -q    # pure logic, no network
python tests/e2e.py                        # full pipeline with stub providers
python tests/mcp_test.py                   # the MCP surface
python tests/teacher_test.py               # the teacher panel
API=https://… python tests/smoke_prod.py   # deployed service, real models
```

## Layout

```
api/app/
  agents/       ocr.py · grader.py · base.py   — providers and model-output validation
  prompts.py    the OCR uncertainty policy and the CQ rubric
  pipeline.py   read → gate → grade → review → release
  mcp.py        MCP server
  main.py       HTTP surface, auth, static hosting
web/            Next.js App Router, Bangla-first, runtime-configured
supabase/       schema and RLS
```

## Licence

MIT.
