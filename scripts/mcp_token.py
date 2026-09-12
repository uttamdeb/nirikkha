#!/usr/bin/env python3
"""Print an access token for the MCP server, and the client config to paste.

Access tokens last as long as the project's JWT expiry, so run this again when a
client starts returning "Not authenticated" rather than hunting for a deeper
cause.

    python scripts/mcp_token.py                       # the demo teacher
    python scripts/mcp_token.py you@example.com PASS  # anyone with a password
    python scripts/mcp_token.py --as you@example.com  # anyone at all (admin key)
    python scripts/mcp_token.py --claude-code         # print the CLI command

`--as` exists because an account created through Google sign-in has no password
to grant against. It mints the session with the service key instead, by
generating a single-use link and redeeming it server-side. Nothing is emailed.
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import sys

import httpx

SERVICE = os.environ.get(
    "NIRIKKHA_URL", "https://nirikkha-23594790708.us-central1.run.app"
).rstrip("/")


def load_env() -> tuple[str, str, str]:
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
    return url, key, os.environ.get("SUPABASE_SECRET_KEY") or ""


def sign_in(url: str, key: str, email: str, password: str) -> dict:
    r = httpx.post(
        f"{url}/auth/v1/token", params={"grant_type": "password"},
        headers={"apikey": key}, json={"email": email, "password": password}, timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"Sign-in failed ({r.status_code}): {r.text[:200]}")
    return r.json()


def mint_as(url: str, key: str, secret: str, email: str) -> dict:
    """Mint a session for any account, without its password."""
    if not secret:
        sys.exit("--as needs SUPABASE_SECRET_KEY (it is an admin operation)")
    admin = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    # generate_link CREATES the account when the address is unknown, so a typo
    # would silently add a user rather than fail. Look it up first.
    listing = httpx.get(f"{url}/auth/v1/admin/users", headers=admin,
                        params={"page": 1, "per_page": 200}, timeout=30)
    if listing.status_code != 200:
        sys.exit(f"Could not list accounts ({listing.status_code}): {listing.text[:200]}")
    known = {u["email"] for u in listing.json().get("users", []) if u.get("email")}
    if email not in known:
        sys.exit(f"No account for {email}. Known: {', '.join(sorted(known))}")
    link = httpx.post(f"{url}/auth/v1/admin/generate_link", headers=admin,
                      json={"type": "magiclink", "email": email}, timeout=30)
    if link.status_code != 200:
        sys.exit(f"Could not generate a link for {email} ({link.status_code}): {link.text[:200]}")
    issued = link.json()
    # Newer projects return a hashed token; older ones only the numeric OTP.
    for body in ({"type": "magiclink", "token_hash": issued.get("hashed_token")},
                 {"type": "magiclink", "email": email, "token": issued.get("email_otp")}):
        if not all(body.values()):
            continue
        r = httpx.post(f"{url}/auth/v1/verify", headers={"apikey": key}, json=body, timeout=30)
        if r.status_code == 200:
            return r.json()
    sys.exit(f"Could not redeem a session for {email}")


def main() -> int:
    argv = sys.argv[1:]
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0

    impersonate = ""
    if "--as" in argv:
        at = argv.index("--as")
        if at + 1 >= len(argv):
            sys.exit("--as needs an email address")
        impersonate = argv[at + 1]
        del argv[at:at + 2]

    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}

    url, key, secret = load_env()
    if impersonate:
        session = mint_as(url, key, secret, impersonate)
    else:
        session = sign_in(
            url, key,
            args[0] if args else "teacher.demo@nirikkha.test",
            args[1] if len(args) > 1 else "NirikkhaDemo!2026",
        )

    token = session["access_token"]
    claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    hours = session.get("expires_in", 3600) // 3600
    lifetime = f"{hours} hours" if hours else f"{session.get('expires_in', 0) // 60} minutes"

    if "--claude-code" in flags:
        print(
            f'claude mcp add --transport http nirikkha {SERVICE}/mcp '
            f'--header "Authorization: Bearer {token}"'
        )
        return 0

    print(f"# {claims.get('email')} — valid for {lifetime}\n")
    print(f"export NIRIKKHA_TOKEN={token}\n")
    print("# Claude Code")
    print(f'claude mcp add --transport http nirikkha {SERVICE}/mcp \\')
    print('  --header "Authorization: Bearer $NIRIKKHA_TOKEN"\n')
    print("# Cursor / Claude Desktop — mcp.json")
    print(json.dumps({"mcpServers": {"nirikkha": {
        "url": f"{SERVICE}/mcp",
        "headers": {"Authorization": f"Bearer {token}"},
    }}}, indent=2))
    print("\n# Codex — ~/.codex/config.toml")
    print("[mcp_servers.nirikkha]")
    print(f'url = "{SERVICE}/mcp"\n')
    print("[mcp_servers.nirikkha.http_headers]")
    print(f'Authorization = "Bearer {token}"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
