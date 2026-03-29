"""Skill wrapper for opening URLs and browser searches."""

from __future__ import annotations

from typing import Literal, TypedDict
from urllib.parse import quote_plus, urlparse

from app.tools.open_url import open_url


BrowserAction = Literal["open_url", "search_query"]


class BrowserHelperResult(TypedDict):
    """Structured result returned by the browser-helper skill."""

    ok: bool
    action: BrowserAction
    request: str
    url: str
    message: str


def _strip_matching_quotes(value: str) -> str:
    normalized_value = value.strip()
    if len(normalized_value) >= 2 and normalized_value[0] == normalized_value[-1]:
        if normalized_value[0] in {'"', "'"}:
            return normalized_value[1:-1].strip()
    return normalized_value


def _normalize_url(target: str) -> tuple[str, str]:
    candidate = _strip_matching_quotes(target)
    if not candidate:
        raise ValueError("Browser requests need a destination.")

    if " " in candidate:
        raise ValueError("Open requests must use a valid URL.")

    display_target = candidate
    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Only http and https URLs are supported.")

    return parsed.geturl(), display_target


def _build_search_url(query: str) -> tuple[str, str]:
    normalized_query = _strip_matching_quotes(query)
    if not normalized_query:
        raise ValueError("Search requests need a query.")

    return (
        f"https://duckduckgo.com/?q={quote_plus(normalized_query)}",
        normalized_query,
    )


def run_browser_helper(request_text: str) -> BrowserHelperResult:
    """Parse a browser request and open it in the default browser."""

    normalized_request = request_text.strip()
    lowered_request = normalized_request.lower()

    if lowered_request.startswith("search for "):
        query = normalized_request[11:].strip()
        url, display_query = _build_search_url(query)
        tool_result = open_url(url)
        return {
            "ok": tool_result["ok"],
            "action": "search_query",
            "request": normalized_request,
            "url": url,
            "message": f'Sure, searching the web for "{display_query}".',
        }

    if lowered_request.startswith("open "):
        raw_target = normalized_request[5:].strip()
        url, display_target = _normalize_url(raw_target)
        tool_result = open_url(url)
        return {
            "ok": tool_result["ok"],
            "action": "open_url",
            "request": normalized_request,
            "url": url,
            "message": f"Opening {display_target}.",
        }

    raise ValueError(
        'Unsupported browser request. Use "search for <query>" or "open <url>".'
    )
