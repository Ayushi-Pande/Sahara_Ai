# SAHARA AI Backend

FastAPI prototype backend for the SAHARA AI women's safety and emergency response platform. The API provides authenticated profiles, trusted circles, journey/location tracking, SOS incidents, community safety reports, a private evidence vault, and explainable rule-based safety insights.

## Requirements

- Python 3.11 or newer
- Windows, macOS, or Linux

## Installation

From this `backend` directory, create and activate a virtual environment, then install dependencies:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

On macOS/Linux, use `python3 -m venv .venv` and `source .venv/bin/activate`.

## Environment

Copy `.env.example` to `.env` and set a long random `SECRET_KEY` before any non-local use. Settings:

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy database URL | `sqlite:///./sahara.db` |
| `SECRET_KEY` | JWT signing secret | Development placeholder; replace it |
| `FRONTEND_URL` | Allowed browser origin for CORS | `http://localhost:5173` |
| `ACCESS_TOKEN_MINUTES` | JWT lifetime | `60` |
| `ROUTE_DEVIATION_METERS` | Prototype movement threshold | `500` |
| `MAX_UPLOAD_MB` | Evidence upload limit | `15` |
| `DEMO_MODE` | Indicates prototype mode | `true` |

CORS permits only the configured frontend origin. Set `FRONTEND_URL` to the deployed frontend origin; do not use `*` with credentials.

## Database and demo data

Tables are created when the app starts. SQLite stores data in `sahara.db` relative to the working directory. Seed sample help locations, journey, battery, and accounts with:

```powershell
python seed.py
```

The seed is idempotent. Demo login is `ayushi@sahara.demo` / `SaharaDemo123!`. Guardian demo accounts are `mom@sahara.demo`, `janhavi@sahara.demo`, and `praveen@sahara.demo`, each with the same password. Change or remove demo credentials before deployment.

## Run

From `backend/`:

```powershell
uvicorn app.main:app --reload
```

Interactive API docs are at <http://127.0.0.1:8000/docs>; health check is <http://127.0.0.1:8000/health>.

## API overview

Authenticated routes use `Authorization: Bearer <access_token>`. Signup/login return a token in `data.access_token`. Successful API routes return `{ "success": true, "data": ... }`; errors return `{ "success": false, "message": ... }`.

| Feature | Routes |
| --- | --- |
| Authentication | `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me` |
| Users | `GET/PUT /api/users/me` |
| Trusted contacts | `GET/POST /api/contacts`, `PUT/DELETE /api/contacts/{id}` |
| Journeys | `POST/GET /api/journeys`, `GET/PUT /api/journeys/{id}`, `POST /api/journeys/{id}/start`, `/end`, `/location`, `/route-check`, `/check-in`, `GET /api/journeys/{id}/locations`, `/location/latest`, `/safety-score` |
| SOS | `POST /api/sos`, `/api/sos/stealth`; `GET /api/sos/{id}`; `POST /api/sos/{id}/safe`, `/cancel`, `/need-help` |
| Security | `POST /api/security/duress-pin`, `/api/security/verify-pin` |
| Voice | `POST /api/voice/command` |
| Evidence | `POST /api/evidence/upload`, `GET /api/evidence`, `GET /api/evidence/{id}`, `GET /api/evidence/{id}/download`, `DELETE /api/evidence/{id}` |
| Nearby/community | `GET /api/help/nearby`, `GET/POST /api/community/reports` |
| Battery/notifications | `POST /api/battery/update`, `GET /api/battery/latest`, `GET /api/notifications`, `POST /api/notifications/{id}/read` |
| Guardian | `GET /api/guardian/users`, `GET /api/guardian/{user_id}/journey`, `/alerts`, `/location`, `/battery` |
| Smartwatch prototype | `POST /api/watch/sos`, `/checkin`, `/voice`; `GET /api/watch/status` |
| AI insight | `GET /api/ai/safety-insight/{journey_id}` |

## Frontend connection

Use `http://127.0.0.1:8000` as the Vite API base URL and send the bearer token on authenticated requests. JSON requests use `Content-Type: application/json`; evidence uploads use `multipart/form-data` fields `type`, optional `file`, `description`, `latitude`, and `longitude`.

## Demo mode and limitations

- Safety scores are rule-based decision support, not crime prediction or a guarantee of safety.
- Route deviation compares a submitted point with the last recorded point because the prototype has no geocoded route geometry.
- Trusted contacts with registered accounts receive in-app notifications only. No SMS, telephone, or emergency-service dispatch provider is connected.
- A periodic in-process check detects active journeys past expected arrival; production deployments should use a durable background worker.
- Stealth and smartwatch endpoints accept authenticated integration triggers; a normal browser cannot access physical buttons, lock-screen events, or a real watch connection.
- Voice intents are a small local parser and do not call an external AI provider.
- Evidence is stored locally under `uploads/`; production should use private object storage, malware scanning, encryption-at-rest, and retention policies.
- Use HTTPS, rotate the JWT secret, configure trusted origins, add rate limiting/audit retention, and obtain appropriate consent before production use.