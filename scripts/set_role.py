#!/usr/bin/env python3
"""Grant or revoke the teacher role.

Teachers see the review queue, override marks and release results. There is no
self-service path to the role on purpose — it is granted out of band.

    python scripts/set_role.py teacher someone@example.com
    python scripts/set_role.py student someone@example.com
    python scripts/set_role.py --list

Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment or ./.env.
"""

from __future__ import annotations

import os
import pathlib
import sys

import httpx


def load_env() -> tuple[str, str]:
    env_file = pathlib.Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or ""
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (or present in .env)")
    return url, key


def main() -> int:
    url, key = load_env()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    with httpx.Client(timeout=30, headers=headers) as client:
        if args[0] == "--list":
            rows = client.get(
                f"{url}/rest/v1/profiles",
                params={"select": "email,role,created_at", "order": "role.asc,email.asc"},
            ).json()
            if not rows:
                print("no profiles yet")
                return 0
            width = max(len(r.get("email") or "") for r in rows)
            for row in rows:
                print(f"  {(row.get('email') or '—'):<{width}}  {row.get('role')}")
            return 0

        if len(args) != 2 or args[0] not in ("teacher", "student"):
            print(__doc__)
            return 2
        role, email = args

        found = client.get(
            f"{url}/rest/v1/profiles", params={"select": "id,email,role", "email": f"eq.{email}"}
        ).json()
        if not found:
            # The profile row is created by a trigger on first sign-up.
            sys.exit(f"No account for {email}. They need to sign up first.")

        response = client.patch(
            f"{url}/rest/v1/profiles",
            params={"email": f"eq.{email}"},
            json={"role": role},
            headers={**headers, "Prefer": "return=representation"},
        )
        if response.status_code >= 400:
            sys.exit(f"Failed: {response.status_code} {response.text[:200]}")
        was = found[0].get("role")
        print(f"{email}: {was} → {role}" if was != role else f"{email}: already {role}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
