"""newsradar cache lives under VR_DATA_DIR, not backend/.cache/."""
from pathlib import Path

import newsradar as nr


def test_legacy_radar_migrates_to_user_dir(tmp_path, monkeypatch):
    old = tmp_path / "repo-cache" / "radar.json"
    old.parent.mkdir()
    old.write_text('{"generated_at": "old", "industries": []}', encoding="utf-8")
    dest_dir = tmp_path / "userdata"
    dest = dest_dir / "radar.json"
    monkeypatch.setattr(nr, "_OLD_CACHE_FILE", str(old))
    monkeypatch.setattr(nr, "CACHE_DIR", str(dest_dir))
    monkeypatch.setattr(nr, "CACHE_FILE", str(dest))
    nr._migrate_legacy()
    assert dest.is_file()
    assert nr.load_cache()["generated_at"] == "old"
    dest.write_text('{"generated_at": "new", "industries": []}', encoding="utf-8")
    nr._migrate_legacy()
    assert nr.load_cache()["generated_at"] == "new"


def test_cache_file_not_under_backend():
    backend = Path(nr.HERE).resolve()
    cache = Path(nr.CACHE_FILE).resolve()
    assert backend not in cache.parents
