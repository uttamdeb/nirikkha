"""AES-256-GCM helpers for secrets stored in org_settings."""

from __future__ import annotations

import hashlib
import os
import secrets


def _key() -> bytes:
    raw = (os.environ.get("SETTINGS_ENCRYPTION_KEY") or "").strip()
    if not raw:
        raise RuntimeError("SETTINGS_ENCRYPTION_KEY is not set")
    if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return bytes.fromhex(raw)
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = secrets.token_bytes(12)
    ciphertext = AESGCM(_key()).encrypt(iv, plaintext.encode("utf-8"), None)
    # AESGCM appends the 16-byte tag to the ciphertext.
    data, tag = ciphertext[:-16], ciphertext[-16:]
    return f"{iv.hex()}:{tag.hex()}:{data.hex()}"


def decrypt_secret(payload: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    parts = payload.split(":")
    if len(parts) != 3:
        raise ValueError("Invalid encrypted payload")
    iv_hex, tag_hex, data_hex = parts
    iv = bytes.fromhex(iv_hex)
    tag = bytes.fromhex(tag_hex)
    data = bytes.fromhex(data_hex)
    plaintext = AESGCM(_key()).decrypt(iv, data + tag, None)
    return plaintext.decode("utf-8")


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "••••••••"
    return f"{value[:4]}••••{value[-4:]}"
