# Resource Booking Platform

Backend API for booking shared resources (rooms, labs, equipment) with
conflict detection and concurrency-safe reservations.

## Features
- JWT auth with bcrypt-hashed passwords; user and admin roles
- Resource CRUD (create/update/delete restricted to admins)
- Bookings with validation: 30 min to 4 h duration, 15 min minimum notice, 90 days maximum advance
- Overlap prevention that holds under concurrent requests
- Suggestions of alternative resources and time slots on conflict (409)
- Cancel future bookings (owners only); cancelled slots become bookable again

## Tech Stack
Node.js, Express 5, PostgreSQL (Supabase), pg, JWT, bcrypt, Jest + Supertest, Postman

## Architecture
Postman → Express routes → middleware (auth, admin, errors) → controllers/services → PostgreSQL

## Database
users, resources, bookings (see db/schema.sql).
- bookings.status: CONFIRMED | CANCELLED
- CHECK on duration; EXCLUDE USING gist (resource_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE status = 'CONFIRMED'
- Ranges are half-open [start, end): 2-3pm and 3-4pm do not conflict

## Setup
1. `cd backend && npm install`
2. Copy `.env.example` to `.env`; set DATABASE_URL, JWT_SECRET, PORT
3. Run `db/schema.sql` in the Supabase SQL editor
4. `npm run dev`

## Creating an admin
Registration always creates a normal user. To promote one, run this in the Supabase SQL editor:
```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## API
| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| POST | /api/auth/register | - | 201 | 400, 409 |
| POST | /api/auth/login | - | 200 | 400, 401 |
| GET | /api/resources | - | 200 | |
| GET | /api/resources/:id | - | 200 | 400, 404 |
| POST/PUT/DELETE | /api/resources[/:id] | admin | 201/200 | 400, 401, 403, 404, 409 |
| POST | /api/bookings | user | 201 | 400, 401, 404, 409 |
| GET | /api/bookings/my | user | 200 | 401 |
| GET | /api/bookings/:id | owner | 200 | 400, 401, 403, 404 |
| DELETE | /api/bookings/:id | owner | 200 | 400, 401, 403, 404 |

Postman collection: `postman/`

## Concurrency Design
Booking runs in a transaction that takes `pg_advisory_xact_lock(resource_id)`,
so bookings for the same resource are serialized. Inside the lock it checks for
overlaps, then inserts. The EXCLUDE constraint is a second, database-level guard.
Test: 10 simultaneous requests for the same slot gave 1 success and 9 conflicts
(`docs/concurrency-test-output.txt`).

## Testing
`npm test` (Jest/Supertest), `npm run test:concurrency` (needs TEST_TOKEN)

## Known Limitations
- Alternative time suggestions only scan later on the same day
- Day boundaries for alternative suggestions are computed in IST (Asia/Kolkata)