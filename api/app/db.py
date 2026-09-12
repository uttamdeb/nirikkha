"""Supabase access over PostgREST + Storage, using the service key.

Deliberately thin: no ORM, no client library. The service key bypasses RLS, so
every call site here must do its own ownership check — see `require_access`.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("nirikkha.db")

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# One pooled client for the process. Building a client per call meant a fresh
# TLS handshake for every query — six of them to render one submission — which
# dominated latency on a page that polls while work is in flight.
_LIMITS = httpx.Limits(max_connections=32, max_keepalive_connections=16, keepalive_expiry=60.0)
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_TIMEOUT, limits=_LIMITS)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


class DbError(RuntimeError):
    pass


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    if not settings.supabase_secret_key:
        raise DbError("SUPABASE_SECRET_KEY is not set")
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def _rest_url(path: str) -> str:
    if not settings.supabase_url:
        raise DbError("SUPABASE_URL is not set")
    return f"{settings.supabase_url}/rest/v1/{path.lstrip('/')}"


async def _request(method: str, path: str, **kwargs: Any) -> Any:
    prefer = kwargs.pop("prefer", None)
    headers = _headers({"Prefer": prefer} if prefer else None)
    response = await client().request(method, _rest_url(path), headers=headers, **kwargs)
    if response.status_code >= 400:
        raise DbError(f"{method} {path} → {response.status_code}: {response.text[:400]}")
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


async def select(table: str, *, params: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await _request("GET", table, params=params)
    return rows if isinstance(rows, list) else []


async def select_one(table: str, *, params: dict[str, Any]) -> dict[str, Any] | None:
    rows = await select(table, params={**params, "limit": 1})
    return rows[0] if rows else None


async def insert(table: str, payload: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = await _request("POST", table, json=payload, prefer="return=representation")
    return rows if isinstance(rows, list) else ([rows] if rows else [])


async def upsert(
    table: str, payload: list[dict[str, Any]], *, on_conflict: str
) -> list[dict[str, Any]]:
    rows = await _request(
        "POST", table, json=payload,
        params={"on_conflict": on_conflict},
        prefer="return=representation,resolution=merge-duplicates",
    )
    return rows if isinstance(rows, list) else []


async def delete(table: str, *, params: dict[str, Any]) -> None:
    await _request("DELETE", table, params=params)


async def update(table: str, *, params: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await _request(
        "PATCH", table, params=params, json=payload, prefer="return=representation"
    )
    return rows if isinstance(rows, list) else []


# --------------------------------------------------------------------- storage

async def download(path: str) -> tuple[bytes, str]:
    """Fetch a script image from the private bucket. Returns (bytes, mime)."""
    url = f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path.lstrip('/')}"
    response = await client().get(url, headers={
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    })
    if response.status_code >= 400:
        raise DbError(f"storage download {path} → {response.status_code}: {response.text[:200]}")
    mime = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    return response.content, mime


async def upload(path: str, data: bytes, mime: str) -> str:
    url = f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path.lstrip('/')}"
    response = await client().post(url, content=data, headers={
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": mime,
        "x-upsert": "true",
    })
    if response.status_code >= 400:
        raise DbError(f"storage upload {path} → {response.status_code}: {response.text[:200]}")
    return path


async def remove(path: str) -> None:
    """Delete one stored object. Used to tidy up a half-finished upload."""
    url = f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path.lstrip('/')}"
    response = await client().delete(url, headers={
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    })
    if response.status_code >= 400:
        log.warning("storage delete %s → %s", path, response.status_code)


async def signed_url(path: str, *, expires_in: int = 3600) -> str | None:
    """Short-lived read URL so the browser can show a private script."""
    url = (
        f"{settings.supabase_url}/storage/v1/object/sign/"
        f"{settings.storage_bucket}/{path.lstrip('/')}"
    )
    try:
        response = await client().post(url, headers=_headers(), json={"expiresIn": expires_in})
        if response.status_code >= 400:
            log.warning("signed_url %s → %s", path, response.status_code)
            return None
        body = response.json()
        signed = body.get("signedURL") or body.get("signedUrl")
        if not signed:
            return None
        return f"{settings.supabase_url}/storage/v1{signed}" if signed.startswith("/") else signed
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("signed_url %s failed: %s", path, exc)
        return None
