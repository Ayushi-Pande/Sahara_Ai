from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from app.database import settings, supabase_configured


def build_event(event: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = {"event": event, "timestamp": datetime.now(timezone.utc).isoformat(), **payload}
    return data


def publish_realtime_event(event: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = build_event(event, payload)
    if not supabase_configured():
        return data
    try:
        import httpx

        httpx.post(
            settings.supabase_url + "/rest/v1/",
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {settings.supabase_anon_key}",
                "Content-Type": "application/json",
            },
            data=json.dumps({"event": event, "payload": data}),
            timeout=5,
        )
    except Exception:
        pass
    return data
