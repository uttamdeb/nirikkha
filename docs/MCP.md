# Nirikkha MCP server

The marking agent, reachable from any MCP client. Submit a photographed
সৃজনশীল প্রশ্ন answer script, get per-part marks out of 10 — and, when the reader
cannot make out a word, a request to resolve it rather than a guess.

## Connect

| | |
|---|---|
| Endpoint | `POST https://nirikkha-23594790708.us-central1.run.app/mcp` |
| Transport | Streamable HTTP (plain JSON responses; no SSE stream is opened) |
| Protocol | MCP `2025-06-18`, JSON-RPC 2.0 |
| Auth | `Authorization: Bearer <token>` on every request |
| Server | `nirikkha` 0.1.0 |

The token is a Supabase access token for a Nirikkha account — the same one the
web client uses. There is no separate API key and no OAuth flow; `initialize`,
`ping` and `tools/list` are open, everything under `tools/call` requires it.

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.nirikkha]
url = "https://nirikkha-23594790708.us-central1.run.app/mcp"

[mcp_servers.nirikkha.http_headers]
Authorization = "Bearer <token>"
```

Use inline `http_headers`, not `bearer_token_env_var`: VS Code launched from the
Dock does not inherit shell exports, so the env var arrives empty. Restart VS
Code after editing. Verify with `codex mcp get nirikkha`.

### Anything else

```bash
claude mcp add --transport http nirikkha https://nirikkha-23594790708.us-central1.run.app/mcp \
  --header "Authorization: Bearer $NIRIKKHA_TOKEN"
```

```json
{"mcpServers": {"nirikkha": {
  "url": "https://nirikkha-23594790708.us-central1.run.app/mcp",
  "headers": {"Authorization": "Bearer <token>"}
}}}
```

### ChatGPT, and anything else that will not take a pasted token

Sign in instead — the server is an OAuth 2.1 protected resource and Supabase
Auth is its authorization server. Add the connector with **Authentication:
OAuth**, leave the advanced panel empty (the client registers itself), and
approve the consent screen the app shows you. Nothing to paste.

The discovery chain, if you are debugging it:

```
GET  {service}/.well-known/oauth-protected-resource   → authorization_servers
GET  {supabase}/auth/v1/.well-known/oauth-authorization-server
POST {supabase}/auth/v1/oauth/clients/register        → dynamic registration
     {service}/oauth/consent?authorization_id=…       → the app's consent screen
```

A 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="…"`
pointing at the first of those.

## What a CQ is

Four parts against one উদ্দীপক (stimulus), marked independently, totalling 10.

| key | label | marks | skill |
|---|---|---|---|
| `ka` | ক | 1 | জ্ঞান — knowledge |
| `kha` | খ | 2 | অনুধাবন — comprehension |
| `ga` | গ | 3 | প্রয়োগ — application |
| `gha` | ঘ | 4 | উচ্চতর দক্ষতা — higher-order skill |

The total is computed server-side by addition. It is never taken from a model
and never returned by one.

## Tools

### `check_cq_script` — mark a script

Not read-only; creates a submission. **Takes 20–60 seconds. Never call it twice
for the same script** — a second call marks the same pages again as a new
submission.

| argument | type | |
|---|---|---|
| `script_base64` | string | the page, base64. Required unless `pages_base64` is given |
| `pages_base64` | string[] | up to **3** pages of one script in reading order — preferred over three separate calls, because line numbers stay continuous and an answer spanning a page break is marked as one answer |
| `question_text` | string | উদ্দীপক plus all four parts, ≤20000 chars. Optional; omit when the photographed page carries the question and the marker will recover it |
| `mime_type` | enum | `image/jpeg` (default), `image/png`, `image/webp` |
| `subject` | string | e.g. `পদার্থবিজ্ঞান`, ≤120 chars. Optional, improves marking |

Max 20 MB per page and **23 MB across a script** — base64 inflates by a third
and the platform drops a body over 32 MiB before the service sees it, so the
smaller total limit is what gives you a real error message. Base64 is validated
strictly; a truncated payload names the page rather than corrupting silently.

### `list_cq_submissions` — find work

`status`, `limit` (≤50), and for teachers `flagged` and `student`. Read-only.

**This is the only way to find a `submission_id`** other than the call that
created one. A student sees their own scripts; a teacher sees everyone's, each
row naming the student. A student passing `flagged` or `student` is refused
rather than silently narrowed, so a short list never reads as "nothing to do".

### `clarify_unclear_line` — resolve a line the reader could not read

`submission_id`, `line_index` (integer ≥0, from an `unclear_lines` entry),
`text` (1–2000 chars).

Send **what the line actually says, mistakes included** — not a corrected
version. The mistakes are what gets marked. When the last unclear line is
resolved, marking runs automatically and the response comes back
`awaiting_teacher` with marks.

### `get_cq_result` — read status and marks

`submission_id`. Read-only. Owner or teacher only.

### `override_cq_mark` — change a mark, or the words explaining it

Teachers only. `submission_id`, `part` (`ka`/`kha`/`ga`/`gha`), and any of
`awarded`, `reason`, `improvement`, `note`. Pass what you mean to change; the
rest is untouched. An override that changes nothing is refused, and so is a
mark above the part's maximum. The agent's original is kept beside the
correction and the student is shown who made it. The total is recomputed here.

### `edit_cq_feedback` — rewrite the overall comment

Teachers only. `submission_id`, `feedback`. Same attribution rules.

### `fix_cq_transcription` — correct a misread line

Teachers only. `submission_id`, `line_index`, `text`. For when the reader read
the handwriting *wrongly*, as opposed to failing to read it. Marks computed from
the old text go stale and cannot be released until `regrade_cq_script` runs.

### `regrade_cq_script` — mark it again

Teachers only. `submission_id`. Discards the previous marks and any teacher
rewrites of the marker's wording, because the agent is now speaking about text
it has not seen before. 10–30 seconds.

### `release_cq_marks` — publish to the student

Teachers only. `submission_id`. Refused when the transcript changed after
marking. Read the result first: release is where a mistake reaches the student.

### `get_cq_rubric` — the mark scheme

No arguments. Read-only. Returns the table above.

## Result shape

Every successful call returns `content[0].text` (the JSON, pretty-printed) and
the same object again in `structuredContent`.

```json
{
  "submission_id": "uuid",
  "status": "awaiting_teacher",
  "total_awarded": 7,
  "total_max": 10,
  "feedback": "…",
  "needs_teacher_review": false,
  "provisional": true,
  "marks": [
    {"part": "ka", "bangla": "ক", "skill": "জ্ঞান",
     "awarded": 1, "max_marks": 1,
     "reason": "why this mark", "improvement": "what to have written instead"}
  ],
  "unclear_lines": [
    {"index": 3, "text_as_read": "… [[অস্পষ্ট]] …", "legibility": 0.4}
  ],
  "message": "present only on failure"
}
```

`unclear_lines` is present only when lines are outstanding. `message` only when
something failed.

## Status, and what to do about it

| status | meaning | what the client should do |
|---|---|---|
| `received`, `ocr_running`, `grading` | in flight | poll `get_cq_result` |
| `awaiting_student` | lines could not be read | show `unclear_lines`, ask the user what each says, call `clarify_unclear_line` per line |
| `awaiting_teacher` | marked, **provisional** | show the marks, and say they are not final |
| `released` | a teacher has released them | final |
| `failed` | see `unreadable` and `message` | relay `message` — it is written in Bangla for the student |

`provisional` is true for anything that is not `released`. Say so; do not
present a provisional score as a settled grade.

On `failed` with `"unreadable": true`, `reason` is one of `not_a_script`,
`rotated`, `too_blurry`, `blank`, `unknown`.

## The behaviour that matters

**The reader never guesses.** Where it cannot make out a word it emits
`[[অস্পষ্ট]]` in place — `[[অস্পষ্ট লাইন]]` for a whole line — and the script
stops for a human rather than being marked on invented text. So a first call
coming back `awaiting_student` is the system working, not an error. Show the
user the exact spans, collect what they say, send each with
`clarify_unclear_line`, and marking resumes on its own.

Legibility below `0.65` triggers the gate.

## Errors

Tool-level failures come back as a **successful** JSON-RPC result with
`isError: true` and `{"error": "…"}` inside, so the model can read the message
and decide what to do. Protocol-level failures use JSON-RPC error codes:
`-32700` parse, `-32600` invalid request, `-32601` unknown method, `-32602` bad
params or unknown tool, `-32001` not authenticated (HTTP 401).

A token that has expired shows up as `-32001`. Mint a new one; nothing else is
wrong.

## Scope

The tools are a channel to the agent, not a window into the database. A client
can submit a script, read back its own marks, and resolve a line. It cannot
enumerate other people's submissions or reach the tables underneath —
`clarify_unclear_line` and `get_cq_result` check ownership on every call, and a
teacher token is the only thing that reads another person's script.

## Smoke test

```bash
curl -s https://nirikkha-23594790708.us-central1.run.app/mcp \
  -H "Authorization: Bearer $NIRIKKHA_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```
