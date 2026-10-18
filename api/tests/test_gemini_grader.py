"""Exercise the Gemini boundary without sending scripts to a model."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from google import genai

from app.agents.base import AgentError
from app.agents.grader import GeminiGrader, OpenAIGrader, StubGrader, get_grader
from app.config import Settings, settings
from app.prompts import CQ_GRADING_PROMPT


@pytest.fixture(autouse=True)
def gemini_settings(monkeypatch):
    monkeypatch.setenv("GRADER_PROVIDER", "gemini")
    monkeypatch.setenv("GRADER_MODEL", "gemini-3.8-flash")
    monkeypatch.setenv("GRADER_REASONING_EFFORT", "high")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    settings.reload()
    yield
    settings.reload()


def response_payload():
    return {
        "parts": [
            {"part": key, "awarded": score, "reason": "কারণ", "evidence_lines": [i]}
            for i, (key, score) in enumerate(zip(("ka", "kha", "ga", "gha"), (1, 2, 3, 4), strict=True))
        ],
        "feedback": "তোমার হিসাব স্পষ্ট করে লেখো।",
        "grader_uncertain": False,
        "total": 999,
    }


def mock_client(monkeypatch, *responses):
    generate = AsyncMock(side_effect=responses)
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
    factory = Mock(return_value=client)
    monkeypatch.setattr(genai, "Client", factory)
    return generate, factory


def test_registry_keeps_providers_separate():
    assert isinstance(get_grader(), GeminiGrader)
    assert isinstance(get_grader("openai"), OpenAIGrader)
    assert isinstance(get_grader("openrouter"), OpenAIGrader)
    assert isinstance(get_grader("stub"), StubGrader)


@pytest.mark.parametrize("provider,expected", [
    ("gemini", "gemini-3.8-flash"), ("openai", "gpt-5.6-luna"), ("stub", "gpt-5.6-luna"),
])
def test_model_default_matches_selected_provider(monkeypatch, provider, expected):
    monkeypatch.setenv("GRADER_PROVIDER", provider)
    monkeypatch.delenv("GRADER_MODEL", raising=False)
    assert Settings().grader_model == expected


@pytest.mark.asyncio
async def test_text_only_request_preserves_rubric_and_computes_total(monkeypatch):
    payload = response_payload()
    generate, factory = mock_client(monkeypatch, SimpleNamespace(text=json.dumps(payload)))
    result = await get_grader().grade("প্রশ্ন", "[0] শিক্ষার্থীর উত্তর")

    request = generate.call_args.kwargs
    assert request["model"] == "gemini-3.8-flash"
    assert isinstance(request["contents"], str)
    assert "প্রশ্ন" in request["contents"] and "[0] শিক্ষার্থীর উত্তর" in request["contents"]
    assert request["config"].system_instruction == CQ_GRADING_PROMPT
    assert request["config"].response_mime_type == "application/json"
    assert request["config"].thinking_config.thinking_level == "HIGH"
    assert result.total_awarded == 10
    factory.assert_called_once_with(api_key="test-key")


@pytest.mark.asyncio
async def test_custom_caps_are_checked_in_code(monkeypatch):
    payload = response_payload()
    payload["parts"][0]["awarded"] = 2
    payload["parts"][3]["awarded"] = 3
    mock_client(monkeypatch, SimpleNamespace(text=json.dumps(payload)))
    result = await get_grader().grade("q", "answer", part_max={"ka": 2, "kha": 2, "ga": 3, "gha": 3})
    assert result.parts[0].max_marks == 2
    assert result.total_awarded == 10


@pytest.mark.parametrize("bad_score", [True, 2, -1, 0.5])
@pytest.mark.asyncio
async def test_invalid_model_marks_are_refused(monkeypatch, bad_score):
    payload = response_payload()
    payload["parts"][0]["awarded"] = bad_score
    mock_client(monkeypatch, SimpleNamespace(text=json.dumps(payload)))
    with pytest.raises(AgentError):
        await get_grader().grade("q", "answer")


@pytest.mark.asyncio
async def test_vertex_credentials_and_client_reuse(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    settings.reload()
    generate, factory = mock_client(monkeypatch,
        SimpleNamespace(text=json.dumps(response_payload())),
        SimpleNamespace(text=json.dumps(response_payload())),
    )
    grader = get_grader()
    await grader.grade("q", "answer")
    await grader.grade("q", "answer")
    factory.assert_called_once_with(vertexai=True, project="test-project", location="us-central1")
    assert generate.call_count == 2


def test_missing_credentials_fail_clearly(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "")
    settings.reload()
    factory = Mock()
    monkeypatch.setattr(genai, "Client", factory)
    with pytest.raises(AgentError, match="Gemini needs"):
        get_grader()._get_client()
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_transport_and_empty_response_are_retried(monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr("app.agents.base.asyncio.sleep", sleep)
    generate, _ = mock_client(monkeypatch,
        RuntimeError("temporarily unavailable"),
        SimpleNamespace(text=None),
        SimpleNamespace(text=json.dumps(response_payload())),
    )
    result = await get_grader().grade("q", "answer")
    assert result.total_awarded == 10
    assert generate.call_count == 3 and sleep.call_count == 2


@pytest.mark.asyncio
async def test_exhausted_empty_responses_never_produce_marks(monkeypatch):
    monkeypatch.setattr("app.agents.base.asyncio.sleep", AsyncMock())
    mock_client(monkeypatch, *[SimpleNamespace(text=None)] * 3)
    with pytest.raises(AgentError, match="empty content"):
        await get_grader().grade("q", "answer")


@pytest.mark.asyncio
async def test_empty_effort_uses_model_default(monkeypatch):
    monkeypatch.setenv("GRADER_REASONING_EFFORT", "")
    settings.reload()
    generate, _ = mock_client(monkeypatch, SimpleNamespace(text=json.dumps(response_payload())))
    await get_grader().grade("q", "answer")
    assert generate.call_args.kwargs["config"].thinking_config is None


@pytest.mark.asyncio
async def test_unsupported_effort_is_not_silently_dropped(monkeypatch):
    monkeypatch.setenv("GRADER_REASONING_EFFORT", "xhigh")
    settings.reload()
    generate, _ = mock_client(monkeypatch)
    with pytest.raises(AgentError, match="GRADER_REASONING_EFFORT"):
        await get_grader().grade("q", "answer")
    generate.assert_not_called()
