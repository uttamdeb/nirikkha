# Nirikkha

**নিরীক্ষা** — "scrutiny". Pronounced *ni-REEK-kha*.

*পড়ালেখা হোক নির্বিঘ্নে*

An AI marking agent for handwritten exam scripts, living in the group chat the class is already in.

Students photograph their handwritten answers and send them to a bot. The agent reads the
handwriting, marks it against a four-part rubric, explains every mark, and hands the result to a
teacher to approve. One rule shapes everything else:

> **When it cannot read a line, it does not guess. It asks.**

Words it cannot make out come back marked in place, and the script is not marked until a human says
what they say. A fabricated grade on handwriting nobody could read is the worst thing a system like
this can do, so it is the one thing this one will not do.

| | |
|---|---|
| **Live service** | https://nirikkha-23594790708.us-central1.run.app |
| **Telegram bot** | [@nirikkha_demo_bot](https://t.me/nirikkha_demo_bot) |
| **MCP endpoint** | `POST /mcp` — OAuth 2.1, or a bearer token |
| **Languages** | Bengali-first interface, full English mirror |
| **Licence** | MIT |

## The exam format, in 30 seconds

Secondary schools in Bangladesh mark by a national format called the **Creative Question (CQ)**. A
CQ is not multiple choice and not a single essay prompt. It is one short stimulus — a passage, a
scenario, a diagram — followed by four questions about it that climb a ladder of difficulty:

| Part | Marks | What it tests |
|---|---|---|
| a | 1 | **Recall** — state a definition or fact |
| b | 2 | **Comprehension** — explain a concept in your own words |
| c | 3 | **Application** — apply it to the stimulus |
| d | 4 | **Judgement** — evaluate, argue, or analyse using the stimulus |
| | **10** | |

*(In Bengali these parts are labelled ক, খ, গ, ঘ — the first four letters of the alphabet,
equivalent to a, b, c, d. You will see those characters in the code and the interface.)*

Two things follow from this format, and they are why this project exists:

1. **Each part needs its own judgement.** A student can nail the recall and fail the analysis. One
   overall score teaches them nothing; four scores with four reasons does.
2. **It is written by hand, in Bengali, on paper.** Every script is a photograph problem before it
   is a grading problem.

## Scope

**What it does.** Takes a photograph of a handwritten answer script, reads it into numbered lines,
stops and asks a human about any line it could not read, marks the four parts independently, and
holds the result as provisional until a teacher releases it.

**Where it does it.** Three surfaces over one pipeline:

- a **chat bot** (Telegram), where the class group already is;
- an **MCP server**, so a teacher can run the whole review loop by talking to ChatGPT, Claude or
  Codex;
- a **web app and teacher panel**, Bengali-first with an English mirror.

**What it deliberately does not do.** It does not decide a final grade — a human always releases. It
does not mark multiple choice, essays, or English-medium scripts. It does not read printed textbook
pages; it refuses them with a reason. It does not expose the database through its agent surfaces.

## Who it is for, and what hurts today

**The teacher.** A secondary-school teacher marks these scripts by hand, in the evening, for every
student in every section. Each script is four parts against one stimulus, each part judged on a
different skill, each needing a written reason and something useful to say about what the student
should have done instead. The marking is not hard; it is long. What gets dropped first, every time,
is the feedback — the part that actually teaches.

**The student.** Gets a number days later, with a tick or a cross and no explanation. They cannot
tell whether part d lost marks because the analysis was thin or because they never engaged with the
stimulus at all. So the same mistake comes back next exam.

**Why the obvious fix is worse than the problem.** Point a vision model at handwriting and it will
return an answer for every line — including the lines it could not actually read. The output looks
identical either way: fluent, plausible, and in the failure case, invented. A wrong mark that a
student cannot appeal, produced from a sentence the machine made up, is worse than no marking at
all. It is also exactly what a naive implementation ships.

That failure mode is the reason this project is shaped the way it is.

### The scale underneath it

- 85% of Class 8–9 students used private tuition or coaching in 2022; Bangladesh had 6,587
  registered coaching centres in 2024.
  [[1]](https://www.thedailystar.net/news/bangladesh/education/news/85-class-8-9-students-took-private-tuition-2022-report-3414601)
  [[2]](https://bbs.gov.bd/pages/files/report-on-private-educational-institutions-survey-2024-ge9v2k-6a11323ba8c92ace1b2cf524)
- Future Startup reports 500,000 registered Caretutors tutors and 125,000+ students and guardians.
  [[3]](https://futurestartup.com/2026/04/27/how-caretutors-is-changing-private-tuition-in-bangladesh/)
- Tutor Sheba reports 250,000+ tutors and 30,000+ parents and students.
  [[4]](https://www.tutorsheba.com/)
- Wider teacher-system pressure includes 60,295 vacant posts, a 1:35 secondary teacher-student
  ratio, and classes reaching 60–70+ students.
  [[5]](https://www.thedailystar.net/opinion/views/news/are-teachers-failing-or-is-the-system-failing-them-4155661)
- **A sizing estimate, not a census:** 560,000+ teachers at 10–100 students each puts the range at
  5.6M–56M teacher-student relationships.
- Research connects private tutoring with exam improvement and teacher income supplementation, and
  with the risk of rote learning.
  [[6]](https://www.researchgate.net/publication/361923778_Shadow_Education_and_Its_Academic_Effects_in_Bangladesh_A_Vygotskian_Perspective)

## Impact

- **The feedback survives.** Every part comes back with a reason for the mark and a line saying what
  should have been written instead. That is the part a tired human drops, and the part a student
  learns from.
- **Marking is never a fabrication risk.** Unreadable spans are pinned to the exact word and the
  script stops. Nothing is marked on invented text, ever.
- **The teacher stays the authority.** Marks are provisional until released. Overrides are
  append-only, the agent's original stays beside the correction, and the student is told whose words
  they are reading.
- **It meets people where they are.** No app to install and no account for the student — a photo in
  the group chat they are already in is the entire workflow.
- **The effort moves from marking to checking.** A teacher reviews and releases in bulk instead of
  marking each script from scratch.

## FAQ

**Is this an auto-grader that replaces the teacher?**
No. The pipeline cannot publish a result on its own. It ends at `awaiting_teacher`, and a human
releases. Everything before that is provisional and labelled as such on every surface.

**What actually happens when the handwriting is unreadable?**
The reader writes a marker — `[[অস্পষ্ট]]`, Bengali for *unclear* — in place of the word it could
not make out, and `[[অস্পষ্ট লাইন]]` for a whole unreadable line. Those lines score below the
legibility threshold, the submission moves to `awaiting_student`, and marking stops. The student is
asked what the line says, answers in the same chat thread, and marking resumes automatically once
the last one is resolved.

**Why not just let the model guess? It is usually right.**
"Usually" is the problem. A vision model gives no signal distinguishing a confident read from a
guess, so a wrong guess is indistinguishable from a correct one all the way to the student's result.
Refusing is the only behaviour that stays honest at scale.

**Why not ask the model how confident it is?**
Tried it. Asked for a calibrated confidence score per line, a model returns roughly the same number
for every line — which leaves the gate nothing to threshold on. Asking it to mark the exact word it
could not read pins the failure to a span instead of a number, and costs a fraction of the tokens.
The numeric score is then derived from marker density, so engines that do report real confidence
still work.

**How do you know the model did not just invent the total?**
Because the total is never read from a model. It is summed in code from the four part marks. Part
scores are range-checked against each part's maximum, and booleans are rejected before integer
coercion — in Python `isinstance(True, int)` is `True`, which would otherwise quietly award a mark.

**What stops a wrong mark reaching the student?**
Three things. Release is a human action. A transcript edited after marking is flagged stale and
cannot be released until it is marked again. And every override is written to an append-only table
with the old value, so a correction is visible rather than reconstructed.

**Why a chat app instead of your own app?**
Because the class group is already there. Students have no account to create, nothing to install,
and the camera that took the photo is in the same app as the conversation about it. The
clarification loop — *"line 4, what does this say?"* — is a chat message by nature; putting it in a
chat is not a wrapper, it is the right room for it. Telegram is the surface built first because its
bot API makes group enrollment and DM intake straightforward.

**Why an MCP server as well?**
So a teacher can do the review without a dashboard. Connected to ChatGPT or Claude, they can ask for
flagged scripts, read the marks, fix a misread line, mark it again, rewrite the wording, and release
— inside the client they already keep open. Fourteen tools, and no raw query surface: it is a
channel to the agent, not a window into the database.

**Does a judge need to read Bengali to evaluate this?**
No. The web app and teacher panel have a full English mirror, and the MCP server responds in
English. The Bengali you will see is the student's own handwriting, the unclear-line marker, and
messages written for students.

**Can it mark anything other than this exam format?**
The four-part scheme is fixed in one place in the code and the prompts are generated from it. An
exam may weight the parts differently from the default 1/2/3/4, but the four-part shape itself is
not configurable. Multiple choice and English-medium scripts are out of scope.

**Which models does it use, and am I locked in?**
Neither stage is hardcoded. Reading and grading each sit behind one interface selected by an
environment variable, and no provider name appears outside its own adapter. Stub providers are built
in, so the whole pipeline runs end to end with no API keys.

**Is it any good on real handwriting?**
Honestly: the legibility threshold (0.65) is not yet calibrated against a corpus of real scripts.
The refusal path is well exercised — photographed textbook pages are correctly rejected — and
calibrating against real student handwriting is the next measurement.

**Who can see a student's script?**
The student and a teacher, and nobody else. The database service key bypasses row-level security, so
authorisation is enforced explicitly in application code on every route and every MCP tool call,
with RLS underneath as defence in depth. The bot token is encrypted at rest with AES-256-GCM.

## Features, end to end

### 1 · A class group becomes a roster

A teacher adds the bot to the class's group chat and links that group to a batch in the panel.
Students tap **Register** once, or are enrolled automatically when they post in the group. No student
account, no password, no install.

### 2 · An exam goes out with a code

The teacher creates an exam — written by hand, or generated from source text or a photographed
textbook page, producing the stimulus, all four parts, mark splits and model answers. Publishing it
to a batch mints a short code like `NK-A7F2` and announces it in the group.

### 3 · The student sends a photo

Open a DM with the bot, send the exam code (or pick from a list), then send the photograph. Up to
three pages of one script are read together, so line numbers stay continuous and an answer running
over a page break is marked as one answer.

### 4 · The gate — the part that matters

```
upload → reading agent → confidence gate → grading agent → teacher review → release
                              │
                              └── unreadable lines → ask the student → resume
```

Two agents, deliberately separate: the reading agent only reads, the grading agent only ever sees
text — so the grader needs no vision capability and either can be swapped without touching the
other. A rotated, blurred, or non-answer page is refused with a reason written for the student.
Anything unreadable stops the script and asks.

### 5 · Marks, with the reasoning attached

Each of the four parts is marked independently against its own descriptor, with a reason for the
mark and a line on what should have been written instead. The total is computed in code.

### 6 · The teacher reviews

The panel shows every submission, not just the flagged ones: filter by status, exam or batch, search
by student or subject, correct any transcribed line, mark again, draw annotations on the page,
rewrite anything the agent wrote, write a note to the student, and release singly or in bulk. Every
mark shows what the agent proposed beside the current value.

Or do the same by talking to an MCP client — `list_cq_submissions`, `fix_cq_transcription`,
`regrade_cq_script`, `override_cq_mark`, `edit_cq_feedback`, `release_cq_marks`.

### 7 · The result comes back where it started

Released marks are sent to the student in the chat, with the feedback. An exam set to
`publish_mode: auto` sends them as soon as marking finishes; `admin` holds them until a teacher
releases.

## Surfaces

**Telegram bot** — group registration, exam codes, photo intake, the clarification conversation, and
results on release. Configure the token under Settings, then point the webhook at
`APP_URL/api/telegram/webhook`.

**MCP** — `POST /mcp`, Streamable HTTP, JSON-RPC 2.0, protocol `2025-06-18`. Fourteen tools. See
[docs/MCP.md](docs/MCP.md).

| | |
|---|---|
| *find work* | `list_cq_submissions` · `list_cq_exams` · `list_cq_batches` · `get_cq_result` · `get_cq_rubric` |
| *set work* | `create_cq_exam` · `publish_cq_exam` |
| *submit* | `check_cq_script` · `clarify_unclear_line` |
| *mark it* | `override_cq_mark` · `edit_cq_feedback` · `fix_cq_transcription` · `regrade_cq_script` · `release_cq_marks` |

**Web** — Bengali-first, English mirror, light and dark. Students submit and resolve unclear lines.

**Teacher panel** — the review queue, batches, exams, annotations, bulk release.

### Connecting an MCP client

**Sign in** — the server is an OAuth 2.1 protected resource with Supabase Auth as its authorization
server. Add the connector with **Authentication: OAuth**, leave the advanced panel empty, approve
the consent screen. Nothing to paste.

For clients that take a header instead:

```bash
python scripts/mcp_token.py                  # prints a token and the config to paste
python scripts/mcp_token.py --as you@x.com   # for an account with no password (Google sign-in)

claude mcp add --transport http nirikkha https://<service>/mcp \
  --header "Authorization: Bearer $NIRIKKHA_TOKEN"
```

Tokens expire. A client that starts answering *"Not authenticated"* needs a fresh one — that is
expiry, not a broken connection.

## Swapping models

Both stages sit behind one interface each, selected by environment variable. No provider name
appears outside its own adapter.

```bash
OCR_PROVIDER=gemini      OCR_MODEL=gemini-3.7-flash
GRADER_PROVIDER=openai   GRADER_MODEL=gpt-5.6-luna   GRADER_REASONING_EFFORT=high
```

`stub` providers are built in, so the whole pipeline runs end to end with no API keys.

To add an engine: implement `OcrProvider` (`api/app/agents/ocr.py`) or `GraderProvider`
(`api/app/agents/grader.py`), register it, done. Providers declare `supports_legibility` /
`supports_bbox` honestly, and the gate degrades rather than silently disappearing when a capability
is missing.

## Running locally

```bash
cp .env.example .env     # Supabase + model keys + APP_URL + SETTINGS_ENCRYPTION_KEY
uv venv && . .venv/bin/activate
uv pip install -e 'api[dev]'
cd api && uvicorn app.main:app --reload --port 8099
cd web && npm install && npm run dev
```

Apply everything in `supabase/migrations/` to a fresh project before first run. For local bot
webhooks, expose the API with ngrok and set `APP_URL` to that HTTPS origin, then use
**Settings → Save & connect webhook**.

### Granting the teacher role

Teachers see the review queue, override marks and release results. There is no self-service path to
the role; grant it out of band after the person signs up:

```bash
python scripts/set_role.py --list
python scripts/set_role.py teacher someone@example.com
```

### Tests

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
  agents/        ocr.py · grader.py · base.py   — providers and model-output validation
  telegram/      webhook.py · enroll.py · client.py · sessions.py
  prompts.py     the reading-uncertainty policy and the marking rubric
  pipeline.py    read → gate → grade → review → release
  classroom.py   batches, exams, publishing
  generate.py    exam-item generation from source text or an image
  mcp.py         MCP server
  main.py        HTTP surface, auth, static hosting
web/src/         React, Bengali-first, runtime-configured
supabase/        schema and RLS
```

Contributors should read [AGENTS.md](AGENTS.md) first — it carries the decisions that cost something
to learn.

## Licence

MIT. See [LICENSE](LICENSE).
