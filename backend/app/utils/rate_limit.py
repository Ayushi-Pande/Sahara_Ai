import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_REQUEST_BUCKETS = defaultdict(deque)


def rate_limit(limit: int = 30, window_seconds: int = 60):
    async def dependency(request: Request):
        client_id = request.client.host if request.client is not None else "anonymous"
        now = time.time()
        bucket = _REQUEST_BUCKETS[client_id]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(
                status_code=429,
                detail={"success": False, "message": "Too many requests. Please slow down and try again shortly."},
            )
        bucket.append(now)

    return dependency
