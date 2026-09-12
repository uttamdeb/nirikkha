#!/usr/bin/env python3
"""Print an access token for the MCP server, and the client config to paste.

Supabase access tokens last an hour, so run this again when a client starts
returning "Not authenticated" rather than hunting for a deeper cause.

    python scripts/mcp_token.py                       # the demo teacher
    python scripts/mcp_token.py you@example.com PASS  # anyone else
    python scripts/mcp_token.py --claude-code         # print the CLI command
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

import httpx

SERVICE = os.environ.get(
    "NIRIKKHA_URL", "https://nirikkha-23594790708.us-central1.run.app"
).rstrip("/")


def load_env() -> tuple[str, str]:
    env_file = pathlib.Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or ""
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (or in .env)")
    return url, key


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if "--help" in flags or "-h" in flags:
        print(__doc__)
        return 0

    email = args[0] if args else "teacher.demo@nirikkha.test"
    password = args[1] if len(args) > 1 else "NirikkhaDemo!2026"

    url, key = load_env()
    r = httpx.post(
        f"{url}/auth/v1/token", params={"grant_type": "password"},
        headers={"apikey": key}, json={"email": email, "password": password}, timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"Sign-in failed ({r.status_code}): {r.text[:200]}")
    token = r.json()["access_token"]
    minutes = r.json().get("expires_in", 3600) // 60

    if "--claude-code" in flags:
        print(
            f'claude mcp add --transport http nirikkha {SERVICE}/mcp '
            f'--header "Authorization: Bearer {token}"'
        )
        return 0

    print(f"# {email} — valid for {minutes} minutes\n")
    print(f"export NIRIKKHA_TOKEN={token}\n")
    print("# Claude Code")
    print(f'claude mcp add --transport http nirikkha {SERVICE}/mcp \\')
    print(f'  --header "Authorization: Bearer $NIRIKKHA_TOKEN"\n')
    print("# Cursor / Claude Desktop — mcp.json")
    print(json.dumps({"mcpServers": {"nirikkha": {
        "url": f"{SERVICE}/mcp",
        "headers": {"Authorization": f"Bearer {token}"},
    }}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
