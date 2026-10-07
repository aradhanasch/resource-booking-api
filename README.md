# Resource Booking Platform (Backend API)

A REST API for booking shared resources such as meeting rooms, labs, and equipment. Its main goal is to guarantee that **two people cannot hold overlapping bookings for the same resource, even when requests arrive concurrently**.

When a booking conflicts, the API suggests alternative resources and alternative time slots.

This is a **backend-only SDE project**. The API is deployed on Railway and can also be tested locally through Postman and automated tests.

## Features

* JWT authentication with bcrypt-hashed passwords
* `user` and `admin` roles
* Resource CRUD operations with admin-only create, update, and delete access
* Booking validation:

  * Duration between 30 minutes and 4 hours
  * At least 15 minutes notice
  * Maximum 90 days in advance
  * Timestamps must include an explicit timezone offset
* Concurrent booking protection using PostgreSQL transactions, advisory locks, and an `EXCLUDE` constraint
* Conflict responses (`409`) include:

  * Alternative resources of the same type
  * Alternative time slots on the requested resource
* Users can view their own bookings and cancel future bookings
* Cancelled slots become available for new bookings
* Admin booking list with filters for resource, user, status, and IST calendar day

## Tech Stack

* **Backend:** Node.js, Express
* **Database:** PostgreSQL (Supabase)
* **Authentication:** JSON Web Tokens (JWT), bcrypt
* **Database Driver:** `pg`
* **Testing:** Jest, Supertest
* **API Testing:** Postman
* **Deployment:** Railway

## Project Structure

```text
.
├── db/
│   └── schema.sql                 # Tables, indexes, constraints, sample resources
├── docs/
│   └── concurrency-test-output.txt
├── postman/
│   ├── resource-booking-api.postman_collection.json
│   └── local.postman_environment.json
├── scripts/
│   ├── concurrencyTest.js         # Manual concurrency test (10 simultaneous requests)
│   └── poolPressureTest.js        # Connection-pool pressure test
├── src/
│   ├── app.js                     # Express app, routes and middleware
│   ├── server.js                  # Server entry point and environment checks
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── resourceController.js
│   │   └── bookingController.js
│   ├── middleware/
│   │   ├── isAuthenticated.js
│   │   ├── requireAdmin.js
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── resourceRoutes.js
│   │   └── bookingRoutes.js
│   ├── services/
│   │   └── alternativeService.js  # Alternative resource/time suggestions
│   ├── db/
│   │   └── pool.js                # PostgreSQL connection pool
│   └── utils/
│       ├── AppError.js
│       ├── asyncHandler.js
│       ├── generateToken.js       # Signs JWTs
│       └── istTime.js             # IST day-boundary helpers
├── tests/
│   ├── booking.test.js            # Jest + Supertest API tests
│   └── istTime.test.js            # Unit tests for IST helpers
├── .env.example
└── package.json
```

## Getting Started

### Requirements

* Node.js 18+
* PostgreSQL 15+
* A PostgreSQL database (the project was tested with Supabase PostgreSQL)

### 1. Clone the Repository

```bash
git clone https://github.com/aradhanasch/resource-booking-api.git
cd resource-booking-api
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and provide the required values:

| Variable       | Description                                       |
| -------------- | ------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string                      |
| `JWT_SECRET`   | Secret used to sign JWTs                          |
| `PORT`         | Port on which the server runs; defaults to `5000` |

### 3. Set Up the Database

Run `db/schema.sql` against your PostgreSQL database.

For Supabase:

1. Open the **SQL Editor**
2. Paste the contents of `db/schema.sql`
3. Run the script

The schema:

* Enables the `btree_gist` extension
* Creates the required tables
* Adds indexes and constraints
* Creates the booking overlap protection
* Inserts three sample resources

### 4. Start the Server

Development mode:

```bash
npm run dev
```

Normal mode:

```bash
npm start
```

### 5. Check the API

```text
GET http://localhost:5000/api/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## Live Deployment

The backend API is deployed on **Railway**.

Health endpoint:

```text
/api/health
```

The API can also be tested using the included Postman collection.

## Creating an Admin

Registration always creates a normal user.

To promote a user to admin, run:

```sql
UPDATE users
SET role = 'admin'
WHERE email = 'you@example.com';
```

## API

All responses are returned as JSON.

General error format:

```json
{
  "success": false,
  "message": "..."
}
```

Protected routes require:

```text
Authorization: Bearer <token>
```

The token is returned after registration or login.

| Method | Path                 | Auth  | Success | Errors                  |
| ------ | -------------------- | ----- | ------- | ----------------------- |
| GET    | `/api/health`        | None  | 200     |                         |
| POST   | `/api/auth/register` | None  | 201     | 400, 409                |
| POST   | `/api/auth/login`    | None  | 200     | 400, 401                |
| GET    | `/api/resources`     | None  | 200     |                         |
| GET    | `/api/resources/:id` | None  | 200     | 400, 404                |
| POST   | `/api/resources`     | Admin | 201     | 400, 401, 403           |
| PUT    | `/api/resources/:id` | Admin | 200     | 400, 401, 403, 404      |
| DELETE | `/api/resources/:id` | Admin | 200     | 400, 401, 403, 404, 409 |
| POST   | `/api/bookings`      | User  | 201     | 400, 401, 404, 409      |
| GET    | `/api/bookings`      | Admin | 200     | 400, 401, 403           |
| GET    | `/api/bookings/my`   | User  | 200     | 401                     |
| GET    | `/api/bookings/:id`  | Owner | 200     | 400, 401, 403, 404      |
| DELETE | `/api/bookings/:id`  | Owner | 200     | 400, 401, 403, 404      |

`DELETE /api/bookings/:id` cancels the booking by changing its status to `CANCELLED` rather than deleting the database row.

### Admin Booking Filters

`GET /api/bookings` supports:

* `resource_id`
* `user_id`
* `status` — `CONFIRMED` or `CANCELLED`
* `date` — `YYYY-MM-DD`, interpreted as an IST calendar day

Bookings that overlap the requested IST day are included.

Results are returned newest first and are capped at 100 records.

## Example: Create a Booking

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

Successful response:

```text
201 Created
```

Example response:

```json
{
  "success": true,
  "booking": {}
}
```

If the requested slot is already booked:

```text
409 Conflict
```

The response includes alternative resources and available time slots.

## Booking Rules

| Rule                  | Value                                    |
| --------------------- | ---------------------------------------- |
| Duration              | 30 minutes to 4 hours                    |
| Minimum notice        | 15 minutes                               |
| Maximum advance       | 90 days                                  |
| Same-resource overlap | Not allowed between `CONFIRMED` bookings |
| Different resources   | Bookings can overlap                     |
| Back-to-back bookings | Allowed                                  |
| Timezone              | IST (`Asia/Kolkata`)                     |

Bookings use **half-open intervals `[start, end)`**.

Therefore, a booking from 2:00 PM–3:00 PM and another from 3:00 PM–4:00 PM do not conflict.

### Not Supported

* Recurring bookings
* Waitlists
* Approval workflows

## Database

The database contains three main tables:

* `users`
* `resources`
* `bookings`

Important database-level rules include:

* `bookings.status` can only be `CONFIRMED` or `CANCELLED`
* `CHECK` constraints validate booking times and duration
* A partial index on `(resource_id, start_time, end_time)` improves conflict-check performance
* A PostgreSQL GiST `EXCLUDE` constraint prevents overlapping confirmed bookings at the database level

```sql
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(start_time, end_time) WITH &&
)
WHERE (status = 'CONFIRMED')
```

## Concurrency Design

The booking system uses **two layers of protection** against double booking.

### 1. Application-Level Protection

Each booking is executed inside a database transaction.

Before checking availability, the application acquires a transaction-scoped PostgreSQL advisory lock for the resource:

```sql
SELECT pg_advisory_xact_lock(resource_id);
```

This serializes booking attempts for the **same resource**, while allowing bookings for different resources to proceed independently.

Inside the lock, the application:

1. Checks for an overlapping confirmed booking.
2. Inserts the booking if the slot is available.
3. Commits the transaction.

The advisory lock is automatically released when the transaction commits or rolls back.

### 2. Database-Level Protection

The PostgreSQL `EXCLUDE` constraint provides a final database-level guarantee.

If an overlapping booking reaches the insert operation, PostgreSQL rejects it with error code `23P01`.

The API handles this as a booking conflict and returns:

```text
409 Conflict
```

### Concurrency Test

The concurrency test sends **10 simultaneous booking requests for the same resource and time slot**.

Result:

```text
1 successful booking
9 conflicts
```

The full test output is available at:

```text
docs/concurrency-test-output.txt
```

The database connection is released before searching for alternative resources and time slots. This prevents conflict responses from unnecessarily occupying connection-pool slots.

## Testing

| Command                    | Description                                                                                        | Requirements                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm test`                 | Jest + Supertest tests for booking conflicts, validation, get-by-id, cancellation, and IST helpers | `.env` with a working database and schema applied |
| `npm run test:concurrency` | Sends 10 simultaneous requests for the same slot; expects 1 × 201 and 9 × 409                      | Running server, `TEST_TOKEN`, resource ID 2       |
| `npm run test:pool`        | Sends multiple requests to a booked slot to verify connection-pool behavior                        | Running server, `TEST_TOKEN`                      |

> **Note:** `npm test` runs against the database configured in `DATABASE_URL`. It creates temporary test users and removes bookings from a test day roughly 75 days in the future. Use a development database rather than a database containing important data.

## Postman

The project includes a Postman collection:

```text
postman/resource-booking-api.postman_collection.json
```

and a local environment:

```text
postman/local.postman_environment.json
```

### Using the Collection

1. Import both files into Postman.
2. Create or promote an admin user.
3. Add the admin password to the environment.
4. Run the collection in order.

The collection covers:

* Authentication
* Resource management
* Booking creation
* Booking conflicts
* Booking validation
* Ownership checks
* Cancellation
* Admin booking list
* Admin filters

## Known Limitations

* Alternative time suggestions only scan forward from the requested start within the same IST day
* Only IST (`Asia/Kolkata`) is supported
* `GET /api/bookings/my` is not paginated
* Admin booking list is capped at 100 rows
* No rate limiting
* JWTs expire after 7 days
* No refresh-token or logout mechanism
* No frontend; this project focuses on the backend API

## Possible Next Steps

If the project were extended further, possible improvements would include:

* Pagination for booking lists
* Rate limiting on authentication routes
* Refresh tokens
* More comprehensive automated test coverage
* Support for multiple timezones
* Frontend application

## Project Focus

This project was built as a **backend-focused SDE project** to explore:

* REST API design
* Authentication and authorization
* PostgreSQL
* Database constraints
* Transactions
* Concurrency control
* Connection-pool management
* Automated API testing

---

Built with Node.js, Express, PostgreSQL, and a focus on reliable concurrent booking.