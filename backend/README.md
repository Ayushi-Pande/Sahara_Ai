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
| `FRONTEND_URL` | Comma-separated allowed browser origins | `http://localhost:5173,http://127.0.0.1:5173` |
| `ACCESS_TOKEN_MINUTES` | JWT lifetime | `60` |
| `ROUTE_DEVIATION_METERS` | Prototype movement threshold | `500` |
| `MAX_UPLOAD_MB` | Evidence upload limit | `15` |
| `DEMO_MODE` | Indicates prototype mode | `true` |

CORS permits the comma-separated origins in `FRONTEND_URL` (one origin by default). For deployment, set this to the exact frontend origin(s), for example `https://app.example.com`; do not use `*` with credentials.

SQLite is the selected database for the hackathon build. Keep `DATABASE_URL=sqlite:///./sahara.db` and start the service from this `backend` directory. Startup checks the database and creates only missing SQLite tables; it does not drop or reset existing tables. PostgreSQL/Supabase connectivity, Supabase Auth, and Supabase Storage are not part of this setup. Authentication remains application-managed and evidence files are stored locally.

`/health` and `/api/system/status` probe the configured database with `SELECT 1`. A successful health response verifies only that database connection; it does not prove Supabase Auth, Storage, Realtime, or emergency delivery.

### Optional PostgreSQL connectivity test

The normal backend test suite uses isolated temporary SQLite databases. The repository also contains a strictly opt-in PostgreSQL connectivity probe for a dedicated test database. It is not required for local use and does not configure the application to use Supabase. Set `TEST_POSTGRESQL_DATABASE_URL` only if you intentionally want to run that read-only probe:

```powershell
$env:TEST_POSTGRESQL_DATABASE_URL = "postgresql://<test-user>:<password>@<test-host>/<test-database>"
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The optional test performs only `SELECT 1`; it does not create tables or modify data. If the variable is unset, the test is skipped. No real PostgreSQL or Supabase connection is claimed unless this test is run successfully against your own configured service.

## Database and demo data

SQLite stores `sahara.db` relative to the working directory. Do not run Alembic migrations as part of the hackathon demo. The existing Render Blueprint keeps its current start command and health check; because its filesystem is not configured here as persistent storage, SQLite data on a hosted instance must not be treated as durable across restarts. Configure a supported persistent volume before relying on hosted SQLite data.

Seed sample help locations, journey, battery, and accounts with:

```powershell
python seed.py
```

The seed is idempotent. Demo login is `ayushi@sahara.demo` / `SaharaDemo123!`. Guardian demo accounts are `mom@sahara.demo`, `janhavi@sahara.demo`, and `praveen@sahara.demo`, each with the same password. Change or remove demo credentials before deployment.

## Run

From `backend/`:

```powershell
uvicorn app.main:app --reload
```

Render starts the service with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Configure `FRONTEND_URL` with the exact deployed frontend origin. The current Render template does not configure a persistent SQLite disk, so hosted data durability remains a deployment setup item.

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
