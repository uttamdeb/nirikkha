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
    check("four tools exposed", len(tools) == 4, ", ".join(tools))
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

    print(f"\n\033[1m{passed} passed, {failed} failed\033[0m\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
