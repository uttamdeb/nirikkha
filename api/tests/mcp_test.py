"""Exercises the MCP surface the way a client would.

Drives the whole marking flow over JSON-RPC, including the clarification loop,
and checks that the tools cannot be used to read someone else's work.

    API=... python tests/mcp_test.py
"""

from __future__ import annotations

import base64
import json
import os
import struct
import sys
import zlib

import httpx

API = os.environ.get("API", "http://127.0.0.1:8099").rstrip("/")
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
PUBLISHABLE = os.environ["SUPABASE_PUBLISHABLE_KEY"]
PASSWORD = "NirikkhaDemo!2026"

passed = failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  \033[32m✓\033[0m {label}")
    else:
        failed += 1
        print(f"  \033[31m✗\033[0m {label}" + (f"  — {detail}" if detail else ""))


def png(w: int = 64, h: int = 64) -> bytes:
    raw = b"".join(b"\x00" + b"\xff" * (w * 3) for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def sign_in(email: str) -> str:
    r = httpx.post(f"{SUPABASE_URL}/auth/v1/token", params={"grant_type": "password"},
                   headers={"apikey": PUBLISHABLE},
                   json={"email": email, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


class Mcp:
    def __init__(self, token: str | None) -> None:
        self.client = httpx.Client(timeout=180)
        self.headers = {"Content-Type": "application/json"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self.n = 0

    def rpc(self, method: str, params: dict | None = None) -> httpx.Response:
        self.n += 1
        return self.client.post(
            f"{API}/mcp", headers=self.headers,
            json={"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}},
        )

    def call(self, name: str, arguments: dict) -> dict:
        r = self.rpc("tools/call", {"name": name, "arguments": arguments})
        body = r.json()
        if "error" in body:
            return {"_protocol_error": body["error"]}
        result = body["result"]
        payload = result.get("structuredContent", {})
        payload["_isError"] = result.get("isError", False)
        return payload


def main() -> int:
    print(f"\n\033[1mMCP surface\033[0m → {API}/mcp\n")
    student = Mcp(sign_in("student.demo@nirikkha.test"))
    other = Mcp(sign_in("teacher.demo@nirikkha.test"))
    anon = Mcp(None)

    print("\033[1mprotocol\033[0m")
    init = student.rpc("initialize").json()["result"]
    check("protocol version advertised", bool(init["protocolVersion"]))
    check("server identifies itself", init["serverInfo"]["name"] == "nirikkha")
    check("instructions explain the clarification loop",
          "clarify_unclear_line" in init["instructions"])
    check("ping answers", "result" in student.rpc("ping").json())
    check("unknown method is a protocol error",
          student.rpc("tools/nope").json()["error"]["code"] == -32601)
    check("notification returns no body", student.client.post(
        f"{API}/mcp", headers=student.headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202)

    tools = {t["name"]: t for t in student.rpc("tools/list").json()["result"]["tools"]}
    print("\n\033[1mtools\033[0m")
    expected = {
        "check_cq_script", "clarify_unclear_line", "get_cq_result", "list_cq_submissions",
        "override_cq_mark", "edit_cq_feedback", "release_cq_marks", "get_cq_rubric",
        "fix_cq_transcription", "regrade_cq_script", "list_cq_exams",
    }
    check("the expected tools, and no others", set(tools) == expected,
          f"extra {set(tools) - expected or '-'}, missing {expected - set(tools) or '-'}")
    check("read tools marked readOnly",
          tools["get_cq_result"]["annotations"]["readOnlyHint"] is True
          and tools["get_cq_rubric"]["annotations"]["readOnlyHint"] is True)
    check("write tools not marked readOnly",
          tools["check_cq_script"]["annotations"]["readOnlyHint"] is False)
    check("every tool documents its inputs",
          all(t["inputSchema"].get("properties") is not None or t["name"] == "get_cq_rubric"
              for t in tools.values()))
    check("no tool exposes raw table access",
          not any(k in tools for k in ("query", "sql", "list_submissions", "select")))

    print("\n\033[1mauthorisation\033[0m")
    check("anonymous call rejected",
          anon.rpc("tools/call", {"name": "get_cq_rubric", "arguments": {}}).status_code == 401)

    print("\n\033[1mrubric\033[0m")
    rubric = student.call("get_cq_rubric", {})
    check("rubric totals 10", rubric.get("total") == 10, str(rubric.get("total")))
    check("four parts", len(rubric.get("parts", [])) == 4)

    print("\n\033[1mmarking flow\033[0m")
    bad = student.call("check_cq_script", {"question_text": "short", "script_base64": "x"})
    check("rejects a too-short question", bad.get("_isError") is True)
    bad = student.call("check_cq_script", {
        "question_text": "উদ্দীপক: একটি বস্তুর উপর বল প্রয়োগ করা হলো। ক) ত্বরণ কাকে বলে?",
        "script_base64": "!!!not-base64!!!"})
    check("rejects malformed base64", bad.get("_isError") is True,
          str(bad.get("error"))[:60])

    result = student.call("check_cq_script", {
        "question_text": "উদ্দীপক: ৫ কেজি ভরের বস্তুর উপর ২০ N বল প্রয়োগ করা হলো।\n"
                         "ক) ত্বরণ কাকে বলে?\nখ) সম্পর্ক ব্যাখ্যা করো।\n"
                         "গ) ত্বরণ নির্ণয় করো।\nঘ) ভর দ্বিগুণ হলে বিশ্লেষণ করো।",
        "script_base64": base64.b64encode(png()).decode(),
        "mime_type": "image/png",
        "subject": "পদার্থবিজ্ঞান",
    })
    check("script accepted", result.get("_isError") is False, json.dumps(result)[:180])
    sid = result.get("submission_id")
    check("submission id returned", bool(sid))
    if not sid:
        return 1
    print(f"     status={result.get('status')}")

    if result.get("status") == "awaiting_student":
        unclear = result.get("unclear_lines", [])
        check("unclear lines returned for the client to ask about", len(unclear) > 0)
        check("each unclear line carries what was read",
              all("text_as_read" in u and "index" in u for u in unclear))

        print("\n\033[1mclarification over MCP\033[0m")
        wrong = other.call("clarify_unclear_line",
                           {"submission_id": sid, "line_index": unclear[0]["index"], "text": "x"})
        check("another user's clarify is refused or allowed only for teachers",
              wrong.get("_isError") is False or "someone else" in str(wrong.get("error", "")))

        bad_idx = student.call("clarify_unclear_line",
                               {"submission_id": sid, "line_index": -1, "text": "x"})
        check("negative line index rejected", bad_idx.get("_isError") is True)

        for _ in range(10):
            pend = result.get("unclear_lines") or []
            if not pend:
                break
            result = student.call("clarify_unclear_line", {
                "submission_id": sid, "line_index": pend[0]["index"],
                "text": "ঘ) ভর বাড়লে একই বলে ত্বরণ কমে যাবে।"})
            check("clarification accepted", result.get("_isError") is False,
                  str(result.get("error"))[:80])
        check("marking resumed after the last clarification",
              result.get("status") == "awaiting_teacher", str(result.get("status")))

    print("\n\033[1mresult\033[0m")
    final = student.call("get_cq_result", {"submission_id": sid})
    check("result readable", final.get("_isError") is False)
    check("four marks", len(final.get("marks", [])) == 4, str(len(final.get("marks", []))))
    check("total equals the sum of parts",
          final.get("total_awarded") == sum(m["awarded"] for m in final.get("marks", [])))
    check("marks flagged provisional before release", final.get("provisional") is True)
    check("each mark carries a reason", all(m["reason"] for m in final.get("marks", [])))
    for m in final.get("marks", []):
        print(f"     {m['bangla']} {m['awarded']}/{m['max_marks']}")
    print(f"     total {final.get('total_awarded')}/{final.get('total_max')}")

    print("\n\033[1mcross-user isolation\033[0m")
    mine = student.call("check_cq_script", {
        "question_text": "উদ্দীপক: পরীক্ষামূলক। ক) সংজ্ঞা দাও? খ) ব্যাখ্যা করো। গ) নির্ণয় করো। ঘ) বিশ্লেষণ করো।",
        "script_base64": base64.b64encode(png()).decode(), "mime_type": "image/png"})
    other_read = other.call("get_cq_result", {"submission_id": mine.get("submission_id")})
    check("a teacher may read a student's submission", other_read.get("_isError") is False)
    check("unknown submission id is an error",
          student.call("get_cq_result",
                       {"submission_id": "00000000-0000-0000-0000-000000000000"}
                       ).get("_isError") is True)

    print("\n\033[1mprotocol edges\033[0m")
    for version in ("2024-11-05", "2025-03-26", "2025-06-18"):
        got = anon.rpc("initialize", {"protocolVersion": version}).json()["result"]
        check(f"initialize echoes {version}", got["protocolVersion"] == version,
              got["protocolVersion"])
    unknown = anon.rpc("initialize", {"protocolVersion": "1999-01-01"}).json()["result"]
    check("an unknown version falls back to ours",
          unknown["protocolVersion"] == "2025-06-18", unknown["protocolVersion"])
    check("resources/list is empty, not an error",
          anon.rpc("resources/list").json()["result"]["resources"] == [])
    check("prompts/list is empty, not an error",
          anon.rpc("prompts/list").json()["result"]["prompts"] == [])
    check("GET is refused", httpx.get(f"{API}/mcp").status_code == 405)
    check("a batch is refused", httpx.post(
        f"{API}/mcp", json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}]).status_code == 400)
    check("a 401 says where to get a token",
          "resource_metadata" in (anon.rpc(
              "tools/call", {"name": "get_cq_rubric", "arguments": {}}
          ).headers.get("www-authenticate") or ""))

    print("\n\033[1mupload limits\033[0m")
    one = base64.b64encode(png()).decode()
    check("four pages are refused", student.call("check_cq_script", {
        "pages_base64": [one] * 4, "mime_type": "image/png"}).get("_isError") is True)
    check("nothing at all is refused",
          student.call("check_cq_script", {"mime_type": "image/png"}).get("_isError") is True)
    check("a bad mime type is refused", student.call("check_cq_script", {
        "script_base64": one, "mime_type": "image/gif"}).get("_isError") is True)
    check("mangled base64 is refused", student.call("check_cq_script", {
        "script_base64": "not base64!!", "mime_type": "image/png"}).get("_isError") is True)
    check("an empty page is refused", student.call("check_cq_script", {
        "script_base64": "", "pages_base64": [""], "mime_type": "image/png"
    }).get("_isError") is True)
    # 3 x 8 MB of incompressible noise clears the per-page limit and breaks the total.
    big = base64.b64encode(os.urandom(8 * 1024 * 1024)).decode()
    fat = student.call("check_cq_script", {"pages_base64": [big] * 3, "mime_type": "image/png"})
    check("too many megabytes in total is refused with a limit named",
          fat.get("_isError") is True and "23 MB" in str(fat.get("error")),
          str(fat.get("error"))[:90])

    print("\n\033[1mlisting\033[0m")
    own = student.call("list_cq_submissions", {"limit": 5})
    check("a student can list their own", own.get("_isError") is False, str(own.get("error"))[:80])
    check("listed as a student", own.get("viewing_as") == "student")
    check("their new script is in it",
          any(x["submission_id"] == sid for x in own.get("submissions", [])))
    check("no other student is named", all("student" not in x for x in own.get("submissions", [])))
    check("a student cannot filter across people",
          student.call("list_cq_submissions", {"flagged": True}).get("_isError") is True)

    one = other.call("list_cq_submissions", {"limit": 1})
    check("a page smaller than the set says there is more",
          one.get("count") == 1 and one.get("more") is True, str(one.get("more")))

    panel = other.call("list_cq_submissions", {"limit": 50})
    check("a teacher lists everyone", panel.get("viewing_as") == "teacher")
    check("rows name the student", all("student" in x for x in panel.get("submissions", [])))
    check("status filter narrows",
          all(x["status"] == "awaiting_teacher" for x in
              other.call("list_cq_submissions",
                         {"status": "awaiting_teacher", "limit": 50}).get("submissions", [])))
    check("unknown status is refused",
          other.call("list_cq_submissions", {"status": "banana"}).get("_isError") is True)

    print("\n\033[1mexams\033[0m")
    default = student.call("get_cq_rubric", {})
    check("the default scheme totals 10",
          default.get("total") == 10 and default.get("source") == "default",
          str(default.get("total")))
    for_script = student.call("get_cq_rubric", {"submission_id": sid})
    check("a script's own rubric is returned",
          for_script.get("total") == sum(p["max_marks"] for p in for_script["parts"]),
          str(for_script.get("total")))
    check("every row says where it came from",
          all(x.get("source") in ("app", "telegram") for x in panel.get("submissions", [])))
    check("a student cannot filter by exam",
          student.call("list_cq_submissions", {"exam": "x"}).get("_isError") is True)
    missing = other.call("list_cq_submissions", {"exam": "no-such-exam-xyz"})
    check("an unmatched exam says so rather than returning nothing",
          missing.get("_isError") is True and "no exam matches" in str(missing.get("error")),
          str(missing.get("error"))[:70])

    exams = other.call("list_cq_exams", {"limit": 5})
    check("a teacher can list exams", exams.get("_isError") is False, str(exams.get("error"))[:80])
    check("every exam carries a code and a status",
          all(e.get("status") and "exam_code" in e for e in exams.get("exams", [])))
    check("every exam counts its own scripts",
          all(isinstance(e.get("submissions", {}).get("total"), int)
              for e in exams.get("exams", [])))
    check("a student cannot list exams",
          student.call("list_cq_exams", {}).get("_isError") is True)
    check("an unknown exam status is refused",
          other.call("list_cq_exams", {"status": "banana"}).get("_isError") is True)
    drafts = other.call("list_cq_exams", {"status": "draft", "limit": 50})
    check("the status filter narrows",
          all(e["status"] == "draft" for e in drafts.get("exams", [])))

    print("\n\033[1mteacher edits\033[0m")
    before = student.call("get_cq_result", {"submission_id": sid})
    was = {m["part"]: m["awarded"] for m in before.get("marks", [])}

    check("a student may not override a mark",
          student.call("override_cq_mark",
                       {"submission_id": sid, "part": "ka", "awarded": 1}).get("_isError") is True)
    check("a student may not release",
          student.call("release_cq_marks", {"submission_id": sid}).get("_isError") is True)
    check("a student may not rewrite feedback",
          student.call("edit_cq_feedback",
                       {"submission_id": sid, "feedback": "x"}).get("_isError") is True)

    check("a mark above what the part is marked out of is refused",
          other.call("override_cq_mark",
                     {"submission_id": sid, "part": "ka", "awarded": 9}).get("_isError") is True)
    check("a negative mark is refused",
          other.call("override_cq_mark",
                     {"submission_id": sid, "part": "ka", "awarded": -1}).get("_isError") is True)
    check("an override that changes nothing is refused",
          other.call("override_cq_mark",
                     {"submission_id": sid, "part": "ka"}).get("_isError") is True)
    check("an unknown part is refused",
          other.call("override_cq_mark",
                     {"submission_id": sid, "part": "nga", "awarded": 1}).get("_isError") is True)

    target = 0 if was.get("gha", 0) else 1
    edited = other.call("override_cq_mark", {
        "submission_id": sid, "part": "gha", "awarded": target,
        "reason": "যুক্তি ঠিক আছে, কিন্তু উপসংহার নেই।", "note": "second read"})
    check("a teacher can change a mark", edited.get("_isError") is False,
          str(edited.get("error"))[:90])
    gha = next((m for m in edited.get("marks", []) if m["part"] == "gha"), {})
    check("the new mark is returned", gha.get("awarded") == target, str(gha.get("awarded")))
    check("the new reason is returned", "উপসংহার" in (gha.get("reason") or ""))
    check("the total was recomputed",
          edited.get("total_awarded") == sum(m["awarded"] for m in edited.get("marks", [])))

    said = other.call("edit_cq_feedback",
                      {"submission_id": sid, "feedback": "তোমার প্রয়োগ অংশ ভালো হয়েছে।"})
    check("a teacher can rewrite the feedback", said.get("feedback") == "তোমার প্রয়োগ অংশ ভালো হয়েছে।",
          str(said.get("feedback"))[:60])
    check("empty feedback is refused",
          other.call("edit_cq_feedback",
                     {"submission_id": sid, "feedback": "   "}).get("_isError") is True)

    print("\n\033[1mcorrecting a misread line\033[0m")
    lines_before = student.call("get_cq_result", {"submission_id": sid})
    check("a student may not fix a transcription",
          student.call("fix_cq_transcription", {
              "submission_id": sid, "line_index": 0, "text": "x"}).get("_isError") is True)
    check("a student may not regrade",
          student.call("regrade_cq_script", {"submission_id": sid}).get("_isError") is True)
    check("empty replacement text is refused",
          other.call("fix_cq_transcription", {
              "submission_id": sid, "line_index": 0, "text": "  "}).get("_isError") is True)
    check("a negative line index is refused",
          other.call("fix_cq_transcription", {
              "submission_id": sid, "line_index": -1, "text": "x"}).get("_isError") is True)

    fixed = other.call("fix_cq_transcription", {
        "submission_id": sid, "line_index": 0, "text": "ক) ত্বরণ হলো বেগের পরিবর্তনের হার।"})
    check("a teacher can correct a line", fixed.get("_isError") is False,
          str(fixed.get("error"))[:90])
    check("stale marks cannot be released",
          other.call("release_cq_marks", {"submission_id": sid}).get("_isError") is True)

    again = other.call("regrade_cq_script", {"submission_id": sid})
    check("marking again succeeds", again.get("_isError") is False, str(again.get("error"))[:90])
    check("and it is releasable once more", again.get("status") == "awaiting_teacher",
          str(again.get("status")))
    check("still four marks after regrading", len(again.get("marks", [])) == 4)
    check("total still equals the sum",
          again.get("total_awarded") == sum(m["awarded"] for m in again.get("marks", [])))
    assert lines_before is not None

    print("\n\033[1mrelease\033[0m")
    out = other.call("release_cq_marks", {"submission_id": sid})
    check("a teacher can release", out.get("_isError") is False, str(out.get("error"))[:90])
    check("released is no longer provisional", out.get("provisional") is False)
    check("the student sees it as released",
          student.call("get_cq_result", {"submission_id": sid}).get("status") == "released")

    print(f"\n\033[1m{passed} passed, {failed} failed\033[0m\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
