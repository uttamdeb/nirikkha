"""Caller resolution from Supabase JWT. Shared by main and classroom routes."""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import Depends, Header, HTTPException

from . import db
from .config import settings

AUTH_TTL = 30.0
AUTH_CACHE_MAX = 512
_auth_cache: dict[str, tuple[float, Caller]] = {}


class Caller:
    def __init__(self, user_id: str, email: str | None, role: str) -> None:
        self.id = user_id
        self.email = email
        self.role = role

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"


def _cache_get(token: str) -> Caller | None:
    hit = _auth_cache.get(token)
    if hit is None:
        return None
    expires, caller = hit
    if expires < time.monotonic():
        _auth_cache.pop(token, None)
        return None
    return caller


def _cache_put(token: str, caller: Caller) -> None:
    if len(_auth_cache) >= AUTH_CACHE_MAX:
        now = time.monotonic()
        for key in [k for k, (exp, _) in _auth_cache.items() if exp < now]:
            _auth_cache.pop(key, None)
        if len(_auth_cache) >= AUTH_CACHE_MAX:
            _auth_cache.clear()
    _auth_cache[token] = (time.monotonic() + AUTH_TTL, caller)


async def current_user(authorization: str | None = Header(default=None)) -> Caller:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    cached = _cache_get(token)
    if cached is not None:
        return cached

    try:
        response = await db.client().get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key or settings.supabase_secret_key,
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"Auth check failed: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(401, "Invalid or expired session")

    user = response.json()
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(401, "Invalid session")

    profile = await db.select_one(
        "profiles", params={"id": f"eq.{user_id}", "select": "role,email"}
    )
    caller = Caller(user_id, user.get("email"), (profile or {}).get("role") or "student")
    _cache_put(token, caller)
    return caller


async def require_teacher(caller: Caller = Depends(current_user)) -> Caller:
    if not caller.is_teacher:
        raise HTTPException(403, "This action is for teachers")
    return caller


async def load_submission(submission_id: str, caller: Caller) -> dict[str, Any]:
    row = await db.select_one(
        "submissions", params={"id": f"eq.{submission_id}", "select": "*"}
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    if row["student_id"] != caller.id and not caller.is_teacher:
        raise HTTPException(403, "Not your submission")
    return row
