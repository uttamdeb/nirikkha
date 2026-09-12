"""Generate CQ exam questions from source text or an image."""

from __future__ import annotations

import base64
import logging
from typing import Any

from .agents.base import AgentError, parse_json_object, with_retry
from .config import settings
from .rubric import DEFAULT_CQ_RUBRIC, rubric_to_probable_answer

log = logging.getLogger("nirikkha.generate")

SYSTEM = "You generate Bangla Creative Question exam items. Always return valid JSON."


def _prompt(count: int, source_text: str | None) -> str:
    source_block = f"\nSource material:\n{source_text}" if source_text else ""
    return f"""Generate {count} Bangla Creative Question (CQ) exam item(s) for secondary school.
Return JSON: {{ "questions": [ {{ promptText, probableAnswer, totalMarks, type, rubric }} ] }}
Each item needs:
- overall stem (promptText)
- exactly 4 rubric parts ক/খ/গ/ঘ with keys ka/kha/ga/gha
- default marks 1,2,3,4 (total 10) unless source material suggests otherwise
- part prompts and model answers (fields: key, label, title, prompt, modelAnswer, maxMarks)
type must be "cq".{source_block}"""


async def generate_questions(
    *,
    source_text: str | None = None,
    image: tuple[bytes, str] | None = None,
    count: int = 1,
) -> dict[str, Any]:
    if settings.grader_provider == "stub" or settings.ocr_provider == "stub":
        # Deterministic stub so tests and local runs need no model keys.
        q = {
            "promptText": (source_text or "স্টাব উদ্দীপক: একটি CQ প্রশ্ন।")[:2000],
            "probableAnswer": rubric_to_probable_answer(DEFAULT_CQ_RUBRIC),
            "totalMarks": 10,
            "type": "cq",
            "rubric": DEFAULT_CQ_RUBRIC,
        }
        return {"questions": [q] * count, "modelName": "stub"}

    provider = (settings.grader_provider or "openai").lower()
    if provider in ("openai", "openrouter"):
        raw, model = await _openai_generate(source_text, image, count)
    elif settings.gemini_api_key:
        raw, model = await _gemini_generate(source_text, image, count)
    else:
        raise AgentError("No model configured to generate questions")

    parsed = parse_json_object(raw, what="Question generator")
    questions_raw = parsed.get("questions")
    if not isinstance(questions_raw, list) or not questions_raw:
        raise AgentError("generator returned no questions")

    questions = []
    for item in questions_raw:
        if not isinstance(item, dict):
            continue
        rubric = item.get("rubric")
        if not isinstance(rubric, list) or len(rubric) != 4:
            rubric = DEFAULT_CQ_RUBRIC
        questions.append({
            "promptText": str(item.get("promptText") or ""),
            "probableAnswer": str(
                item.get("probableAnswer")
                or rubric_to_probable_answer(rubric)
            ),
            "totalMarks": int(item.get("totalMarks") or 10),
            "type": "cq",
            "rubric": rubric,
        })
    if not questions:
        raise AgentError("generator returned no usable questions")
    return {"questions": questions, "modelName": model}


async def _openai_generate(
    source_text: str | None,
    image: tuple[bytes, str] | None,
    count: int,
) -> tuple[str, str]:
    from openai import AsyncOpenAI

    if settings.grader_provider == "openrouter":
        if not settings.openrouter_api_key:
            raise AgentError("OPENROUTER_API_KEY is not set")
        client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
        )
    else:
        if not settings.openai_api_key:
            raise AgentError("OPENAI_API_KEY is not set")
        client = AsyncOpenAI(api_key=settings.openai_api_key)

    model = settings.grader_model
    user_content: Any
    if image:
        data, mime = image
        b64 = base64.b64encode(data).decode("ascii")
        user_content = [
            {"type": "text", "text": _prompt(count, source_text)},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ]
    else:
        user_content = _prompt(count, source_text)

    async def call() -> str:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        if not content:
            raise AgentError("generator returned empty content")
        return content

    return await with_retry(call, what=f"generate ({model})"), model


async def _gemini_generate(
    source_text: str | None,
    image: tuple[bytes, str] | None,
    count: int,
) -> tuple[str, str]:
    from google import genai
    from google.genai import types

    model = settings.ocr_model or "gemini-2.0-flash"
    client = genai.Client(api_key=settings.gemini_api_key)
    parts: list[Any] = [types.Part.from_text(text=_prompt(count, source_text))]
    if image:
        data, mime = image
        parts.append(types.Part.from_bytes(data=data, mime_type=mime))

    async def call() -> str:
        response = await client.aio.models.generate_content(
            model=model,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM,
                response_mime_type="application/json",
            ),
        )
        text = response.text or ""
        if not text:
            raise AgentError("generator returned empty content")
        return text

    return await with_retry(call, what=f"generate ({model})"), model
