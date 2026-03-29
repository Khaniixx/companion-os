from types import SimpleNamespace

import pytest

import app.tools.open_app as open_app_tool


def test_open_app_logs_and_raises_on_launch_failure(monkeypatch) -> None:
    logged_messages: list[tuple[object, ...]] = []

    monkeypatch.setattr(open_app_tool, "setup_runtime_logging", lambda: None)
    monkeypatch.setattr(
        open_app_tool,
        "logger",
        SimpleNamespace(
            error=lambda *args: logged_messages.append(args),
        ),
    )
    monkeypatch.setattr(
        open_app_tool.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=1,
            stdout="",
            stderr="Spotify was not available",
        ),
    )

    with pytest.raises(RuntimeError, match="Spotify was not available"):
        open_app_tool.open_app("spotify")

    assert logged_messages
    assert "App launch failed for %s" in str(logged_messages[0][0])


def test_open_app_logs_invalid_json_result(monkeypatch) -> None:
    logged_messages: list[tuple[object, ...]] = []

    monkeypatch.setattr(open_app_tool, "setup_runtime_logging", lambda: None)
    monkeypatch.setattr(
        open_app_tool,
        "logger",
        SimpleNamespace(
            error=lambda *args: logged_messages.append(args),
        ),
    )
    monkeypatch.setattr(
        open_app_tool.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout="not-json",
            stderr="",
        ),
    )

    with pytest.raises(RuntimeError, match="Launcher returned an invalid result"):
        open_app_tool.open_app("discord")

    assert logged_messages
    assert "invalid JSON" in str(logged_messages[0][0])
