from __future__ import annotations

from fastapi import APIRouter

from version import read_version

router = APIRouter(tags=["core"])
__version__ = read_version()

@router.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": __version__}
