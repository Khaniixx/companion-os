from pathlib import Path

import app.runtime_paths as runtime_paths


def test_runtime_data_dir_uses_environment_override(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("COMPANION_RUNTIME_DATA_DIR", str(tmp_path))

    assert runtime_paths.runtime_data_dir() == tmp_path
    assert runtime_paths.runtime_data_path("preferences.json") == tmp_path / "preferences.json"
