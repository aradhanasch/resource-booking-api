# Resource Booking Platform (Backend API)

A REST API for booking shared resources such as meeting rooms, labs and equipment. Its main job is to guarantee that **two people can never hold overlapping bookings for the same resource, even when requests arrive at the same instant**. When a request does conflict, the API suggests other resources and other time slots.

This is a backend-only project. There is no frontend; the API is exercised through Postman and automated tests.

## Features

- JWT authentication with bcrypt-hashed passwords; `user` and `admin` roles
- Resource CRUD (create, update and delete are admin-only)
- Bookings with validation:
  - duration between 30 minutes and 4 hours
  - at least 15 minutes notice
  - at most 90 days in advance
  - timestamps must carry an explicit timezone offset
- Overlap prevention that holds under concurrent requests (see [Concurrency Design](#concurrency-design))
- On conflict (`409`), the response includes alternative resources of the same type and alternative time slots on the same resource
- Users can view their own bookings and cancel future ones; a cancelled slot becomes bookable again
- Admin booking list with filters (resource, user, status, IST calendar day)

## Tech Stack

Node.js, Express 5, PostgreSQL (hosted on Supabase), `pg`, JSON Web Tokens, bcrypt, Jest + Supertest, Postman

## Project Structure

```
.
├── db/schema.sql            # tables, index, EXCLUDE constraint, sample resources
├── docs/                    # saved output of the concurrency test
├── postman/                 # Postman collection + local environment
├── scripts/                 # manual concurrency and connection-pool tests
├── src/
│   ├── app.js               # Express app (routes, middleware)
│   ├── server.js            # entry point; checks required env vars
│   ├── controllers/         # auth, resources, bookings
│   ├── middleware/          # isAuthenticated, requireAdmin, errorHandler
│   ├── routes/
│   ├── services/            # alternative resource / time suggestions
│   ├── db/pool.js           # pg connection pool
│   └── utils/               # AppError, asyncHandler, JWT helper, IST helpers
└── tests/                   # Jest tests
```

## Getting Started

**Requirements:** Node.js 18+ and a PostgreSQL database. The project is tested on Supabase Postgres 15+.

1. Clone the repo and install dependencies:
```bash
   git clone https://github.com/aradhanasch/resource-booking-api.git
   cd resource-booking-api
   npm install
```
2. Copy `.env.example` to `.env` and fill in the values:

   | Variable | Description |
   |---|---|
   | `DATABASE_URL` | PostgreSQL connection string |
   | `JWT_SECRET` | Secret used to sign tokens (required; the server refuses to start without it) |
   | `PORT` | Port to listen on (defaults to 5000) |

3. Run `db/schema.sql` against your database (in Supabase: SQL Editor → paste → run). It enables `btree_gist`, creates the tables, and inserts three sample resources.
4. Start the server:
```bash
   npm run dev     # with nodemon
   npm start       # plain node
```
5. Check it is up: `GET http://localhost:5000/api/health` returns `{ "status": "ok" }`.

### Creating an admin

Registration always creates a normal user. To promote one, run this in the SQL editor:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## API

All responses are JSON. Errors have the shape `{ "success": false, "message": "..." }`.
Protected routes need the header `Authorization: Bearer <token>`, where the token comes from register or login.

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/api/health` | none | 200 | |
| POST | `/api/auth/register` | none | 201 | 400, 409 |
| POST | `/api/auth/login` | none | 200 | 400, 401 |
| GET | `/api/resources` | none | 200 | |
| GET | `/api/resources/:id` | none | 200 | 400, 404 |
| POST | `/api/resources` | admin | 201 | 400, 401, 403 |
| PUT | `/api/resources/:id` | admin | 200 | 400, 401, 403, 404 |
| DELETE | `/api/resources/:id` | admin | 200 | 400, 401, 403, 404, 409 (resource has bookings) |
| POST | `/api/bookings` | user | 201 | 400, 401, 404, 409 |
| GET | `/api/bookings` | admin | 200 | 400, 401, 403 |
| GET | `/api/bookings/my` | user | 200 | 401 |
| GET | `/api/bookings/:id` | owner | 200 | 400, 401, 403, 404 |
| DELETE | `/api/bookings/:id` | owner | 200 | 400, 401, 403, 404 |

`DELETE /api/bookings/:id` cancels the booking (sets its status to `CANCELLED`) rather than removing the row.

**Admin list filters** for `GET /api/bookings`: `resource_id`, `user_id`, `status` (`CONFIRMED` or `CANCELLED`) and `date` (`YYYY-MM-DD`, read as an IST calendar day; bookings that overlap that day are included). Results are newest first and capped at 100.

### Example: create a booking

```http
POST /api/bookings
Authorization: Bearer <token>
Content-Type: application/json

{
  "resource_id": 1,
  "start_time": "2026-10-15T10:00:00+05:30",
  "end_time": "2026-10-15T11:00:00+05:30"
}
```

`201 Created` returns `{ "success": true, "booking": { ... } }`.

If the slot is taken, the response is `409 Conflict`:

```json
{
  "success": false,
  "message": "This resource is already booked for the requested time",
  "alternatives": {
    "other_resources": [ { "id": 2, "name": "Room B", "...": "..." } ],
    "other_times": [
      { "start_time": "2026-10-15T05:30:00.000Z", "end_time": "2026-10-15T06:30:00.000Z" }
    ]
  }
}
```

## Booking Rules

| Rule | Value |
|---|---|
| Duration | 30 minutes to 4 hours |
| Minimum notice | 15 minutes before start |
| Maximum advance | 90 days |
| Overlaps on one resource | Not allowed between `CONFIRMED` bookings |
| Overlaps across different resources | Allowed, so one user can hold several bookings at once |
| Back-to-back bookings | Allowed: ranges are half-open `[start, end)`, so 2–3 pm and 3–4 pm do not conflict |
| Timezone | Single timezone, IST (Asia/Kolkata). Timestamps must include an offset, such as `+05:30` or `Z` |
| Not supported | Recurring bookings, waitlists, approval workflows |

## Database

Three tables: `users`, `resources`, `bookings` (see `db/schema.sql`).

- `bookings.status` is `CONFIRMED` or `CANCELLED`
- `CHECK` constraints enforce `end_time > start_time` and the 30 minute to 4 hour duration
- A partial index on `(resource_id, start_time, end_time) WHERE status = 'CONFIRMED'` speeds up the conflict check
- A GiST `EXCLUDE` constraint makes overlapping confirmed bookings impossible at the database level:
```sql
  EXCLUDE USING gist (resource_id WITH =, tstzrange(start_time, end_time) WITH &&)
  WHERE (status = 'CONFIRMED')
```

## Concurrency Design

Two layers protect against double-booking:

1. **Application layer.** Each booking runs in a transaction that first takes `pg_advisory_xact_lock(resource_id)`. Bookings for the same resource are serialized, while bookings for different resources still run in parallel. Inside the lock the code checks for overlaps and then inserts. The lock is released automatically on commit or rollback.
2. **Database layer.** The `EXCLUDE` constraint is the final guarantee. If an overlap ever got past the application check, Postgres rejects the insert (error `23P01`), and the API handles it like a normal conflict.

On a conflict the database connection is released **before** the alternatives are looked up, so conflict responses cannot starve the connection pool (`npm run test:pool` checks this).

**Result:** 10 simultaneous requests for the same slot gave exactly 1 success and 9 conflicts. The full output is in [`docs/concurrency-test-output.txt`](docs/concurrency-test-output.txt).

## Testing

| Command | What it does | Needs |
|---|---|---|
| `npm test` | Jest + Supertest: booking conflicts, validation, get-by-id, cancellation, and IST date helpers | `.env` with a working `DATABASE_URL` and the schema applied |
| `npm run test:concurrency` | Fires 10 simultaneous requests at one slot; expects 1 × 201 and 9 × 409 | Running server, `TEST_TOKEN` env var (a user JWT), and resource id 2 to exist |
| `npm run test:pool` | Fires 12 requests at a booked slot to confirm none time out | Running server and `TEST_TOKEN` |

> **Note:** `npm test` runs against the real database in `DATABASE_URL`. It registers throwaway test users, and it deletes **all** bookings that start on one IST day roughly 75 days ahead. Use a development database, not one holding data you care about.

**Postman:** import `postman/resource-booking-api.postman_collection.json` and `postman/local.postman_environment.json`. Promote an admin user (see above) and put their password in the environment's `adminPassword`. Then run the collection in order. It covers auth, resources, bookings (conflicts, validation, ownership, cancellation) and the admin list, and it cleans up after itself.

Automated Jest tests cover bookings and the IST helpers. Auth, resource and admin-list behaviour is covered by the Postman collection.

## Known Limitations

- Alternative time suggestions only scan forward from the requested start, within the same IST day
- Single timezone (IST); no per-user timezones
- `GET /api/bookings/my` is not paginated; the admin list is capped at 100 rows
- No rate limiting, and CORS is open to all origins
- JWTs last 7 days and there is no refresh or logout mechanism
- No frontend and no hosted deployment; the API runs locally against a hosted database

## Possible Next Steps

- Pagination for booking lists
- Rate limiting on auth routes