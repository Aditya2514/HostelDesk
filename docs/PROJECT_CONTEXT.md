# HostelDesk — Master Project Context

> Paste this whole file at the start of every new agent session, or save it in the repo as `docs/PROJECT_CONTEXT.md` and tell the agent to read it before every phase.
> This file is the single source of truth. If any instruction in a phase prompt conflicts with this file, **stop and ask me** instead of guessing.

---

## 0. Who you are working with and how to behave

I am a first-year CS student building this as my **individual end-term software project**. Deadline: **27 October 2026, 11:59 PM IST**. I must be able to explain every design decision in a demo, so:

- Write **clear, readable code**. Prefer simple, explicit logic over clever abstractions.
- Put business logic in **service modules**, never inside route handlers or React components.
- **Do not invent features** that are not in this document. **Do not change any rule in section 5** without asking me.
- After each meaningful step, **make a git commit** with a clear message (e.g. `feat(tickets): add state machine with allowed transitions`). Never one giant commit. The evaluators read the git history.
- **Never commit secrets.** All secrets go in `.env` (git-ignored). Keep an up-to-date `.env.example` with placeholder values.
- At the end of every phase: run the app, run the tests, then give me a short report: what was built, what was tested, anything incomplete, and any decision you made that I should know about.

---

## 1. The problem

In my hostel, room and facility complaints are written in a **paper register** at the warden's desk. This means:

- No one knows **who** is handling a complaint or **since when**.
- Students have **no idea when** it will be fixed.
- Staff can mark a job as done **without actually doing it**; there is no proof.
- The same issue (e.g. no water on a floor) gets written 15 times by 15 students.
- Management has **no data**: which staff are reliable, which rooms keep breaking, how long jobs take.

## 2. Target users

| Role | Who | Main need |
|---|---|---|
| `STUDENT` | Hostel residents | Raise issues, know when they'll be fixed, confirm the fix |
| `STAFF` | Electricians, plumbers, carpenters, network techs, housekeeping | See their queue, do jobs, prove completion |
| `WARDEN` | One per block | Oversee their block, handle disputes, reassign, reprioritise |
| `CHIEF_WARDEN` | Over all blocks | Receives second-level escalations, sees all analytics |
| `ADMIN` | Hostel office | Manage blocks, rooms, occupancy, staff, shifts, categories |

## 3. The solution in one paragraph

HostelDesk is a web app where students raise complaints against their **room** or a **common area**. Each ticket is automatically **routed** to the staff member who can finish it **earliest**, using a **schedule simulation** over staff shifts and queues, and the student sees a **predicted completion time range**. Staff must **prove completion**: for room tickets, an occupant gives them a **4-digit completion code**; for common areas, staff upload **after-photos** and the reporter confirms. Tickets that miss their deadline **escalate** automatically. Duplicate complaints are **grouped**. Management gets **analytics** on staff reliability, repeat-problem rooms, and prediction accuracy.

---

## 4. Tech stack (fixed — do not change)

| Layer | Choice |
|---|---|
| Language | **TypeScript** everywhere |
| Frontend | React + Vite + Tailwind CSS + React Router + TanStack Query |
| Backend | Node.js + Express |
| Database | PostgreSQL (hosted on **Neon**) |
| ORM | **Prisma** (migrations committed to git) |
| Validation | **Zod** on every request body and query |
| Auth | JWT in an **httpOnly, secure, sameSite** cookie; passwords hashed with **bcrypt** |
| File storage | **Cloudinary** (photos) |
| Tests | **Vitest** (backend unit tests for core logic) |
| Hosting | Frontend on **Vercel**, backend on **Render** |
| Scheduled jobs | A protected endpoint `POST /api/jobs/tick` called every 5 minutes by **cron-job.org** (Render's free tier sleeps, so in-process cron is unreliable) |

### Why these choices (put these justifications in the README)

- **PostgreSQL over MongoDB:** the domain is relational (blocks → rooms → occupancy over time → tickets → events, followers, disputes, predictions). Correctness features such as state transitions, the roommate "dispute wins" rule and the completion-code attempt limit rely on **transactions, row locks, foreign keys and unique constraints**. Percentiles for the estimator are built in (`percentile_cont`).
- **External cron over in-process cron:** Render's free tier sleeps when idle; an external trigger also lets multiple server instances run without duplicate jobs.

### 4.1 Scalability & hosting rules (follow in every phase)

Expected load for a whole campus (~2,000 students, ~60 tickets/day, under ~20 requests/sec at peak) is tiny for Postgres. The design must still **stay ready to scale horizontally**:

1. **Stateless server.** No in-memory sessions, caches or timers that hold business state. Auth is a JWT cookie; everything else lives in the database. Any number of server instances must behave identically.
2. **Jobs are triggered externally and are idempotent.** Only `POST /api/jobs/tick` (protected by `JOBS_SECRET` in a header) runs background work. Use conditional updates (e.g. `WHERE escalationLevel = 0`) so concurrent or repeated ticks never double-act.
3. **Connection pooling.** `DATABASE_URL` uses Neon's **pooled** connection string; `DIRECT_URL` (non-pooled) is used only by Prisma migrations (`directUrl` in `schema.prisma`).
4. **Every list endpoint is paginated** (cursor or `limit`/`offset`, default 20, max 100). Never return unbounded lists.
5. **Indexes** exist for every frequent filter (status, assignee, block/floor/category/time, occupancy by room, unread notifications).
6. **Concurrency-sensitive updates** (status transitions, confirm vs dispute, code attempts) run inside a **transaction** that locks or conditionally updates the ticket row.
7. **Analytics queries** are written as aggregate SQL (or Prisma `groupBy` / `$queryRaw`), never by loading all rows into Node.
8. **Keep-awake:** the cron-job.org call to `/api/jobs/tick` every 5 minutes also stops the Render free instance from sleeping. Expose `GET /api/health` for a quick check.

**Documented growth path — describe in the README, do NOT build:**

| What breaks first | Fix |
|---|---|
| Free-tier sleeping and limits | Paid instance, no code change |
| DB connection exhaustion with many instances | Already using the pooled connection string |
| Slow analytics over years of history | Nightly summary tables or materialized views |
| Multiple colleges | Add `campusId` to core tables and scope every query (multi-tenancy) |
| Server CPU | More instances behind a load balancer (possible because of rules 1 and 2) |

### Repository layout (monorepo)

```
hosteldesk/
  client/            # React app
  server/
    prisma/          # schema.prisma, migrations, seed.ts
    src/
      config/        # env loading (validated with Zod)
      lib/           # clock, prisma client, cloudinary, errors
      middleware/    # auth, role guards, error handler, rate limit
      modules/       # one folder per domain: auth, tickets, scheduling, evidence, ...
        <module>/
          *.routes.ts
          *.controller.ts
          *.service.ts   # business logic lives here
          *.schema.ts    # zod schemas
      jobs/          # background job logic (escalation, auto-close)
    tests/
  docs/
  README.md
```

### Cross-cutting rules

1. **Clock service:** all business logic gets the current time from `lib/clock.ts` (`clock.now()`), **never** `new Date()` directly. In `DEMO_MODE=true`, an admin-only endpoint can **advance a time offset** so I can demo escalations without waiting hours. Tests use a fake clock.
2. **Times** are stored in UTC and displayed in **Asia/Kolkata**.
3. **Authorization is always enforced on the server.** Hiding buttons in the UI is not security.
4. Every status change writes a row to `ticket_events`. This is the audit trail and the source for analytics.
5. Every error returns a consistent JSON shape: `{ error: { code, message } }`. The frontend shows friendly messages, plus loading, empty and error states on every page.
6. Background jobs must be **idempotent**: running `/jobs/tick` twice in a row must not double-escalate or double-close anything.

---

## 5. Domain rules (decided — do not change without asking)

### 5.1 Locations and ownership

- A ticket is either for a **ROOM** or a **COMMON** area (floor + spot, e.g. "Floor 3 washroom").
- **Room tickets belong to the room, not to one student.** All *current* occupants can see it, get notifications, give the completion code, confirm, or dispute.
- Occupancy has dates (`room_occupancy` with `fromDate`/`toDate`). A student who moves out **loses access** to the old room's tickets; the new occupant gains it.

### 5.2 Categories, priority and deadlines

- The **category decides** the staff trade, default priority, default job duration and deadline (SLA).
- Students **cannot** set priority. Only a **warden** can change it.
- Default categories (seeded, editable by admin):

| Category | Trade | Priority | Default duration | SLA |
|---|---|---|---|---|
| No power in room | ELECTRICIAN | URGENT | 45 min | 4 h |
| Fan / light / socket fault | ELECTRICIAN | NORMAL | 40 min | 48 h |
| Water cooler / geyser fault | ELECTRICIAN | NORMAL | 60 min | 48 h |
| No water / major leak | PLUMBER | URGENT | 60 min | 4 h |
| Tap / flush / drain issue | PLUMBER | NORMAL | 45 min | 48 h |
| Door lock broken | CARPENTER | URGENT | 30 min | 4 h |
| Furniture / window repair | CARPENTER | LOW | 60 min | 120 h |
| Wi-Fi / network down | NETWORK | NORMAL | 30 min | 24 h |
| Cleaning required | HOUSEKEEPING | NORMAL | 30 min | 24 h |
| Pest control | HOUSEKEEPING | LOW | 60 min | 72 h |

### 5.3 Ticket statuses and allowed transitions

| From | To | Who | Condition |
|---|---|---|---|
| — | `ASSIGNED` | system | On creation, routing picks a staff member (5.5). If no eligible staff exists → `RAISED` and the warden is notified |
| `RAISED` | `ASSIGNED` | warden / system | Manual or retried assignment |
| `ASSIGNED` | `IN_PROGRESS` | assigned staff | Staff taps "Start work" (records start time) |
| `ASSIGNED` / `IN_PROGRESS` | `AWAITING_ACCESS` | assigned staff | Room locked; **door photo required** (5.7) |
| `AWAITING_ACCESS` | `ASSIGNED` | occupant | Occupant picks "15 min" or a time slot |
| `IN_PROGRESS` | `ON_HOLD` | assigned staff | Waiting for a part; **reason required** |
| `ON_HOLD` | `IN_PROGRESS` | assigned staff | Part arrived |
| `IN_PROGRESS` | `RESOLVED` | assigned staff | **Room ticket:** correct completion code entered + after-photo |
| `IN_PROGRESS` | `AWAITING_VERIFICATION` | assigned staff | **Common-area ticket:** after-photo uploaded |
| `RESOLVED` / `AWAITING_VERIFICATION` | `CLOSED` | occupant / reporter, or system | Confirmation, or 48 h with no dispute (auto-close) |
| `RESOLVED` / `AWAITING_VERIFICATION` | `REOPENED` | occupant / reporter | Dispute within 48 h, **reason required**; `reopenCount++` |
| `REOPENED` | `ASSIGNED` | system | Re-routed (same staff preferred if available) |
| any open status | `REJECTED` | warden | **Reason required** (invalid / not a hostel issue) |
| `AWAITING_ACCESS` | `CLOSED` (reason `UNABLE_TO_ACCESS`) | system | 48 h with no occupant response |

- Any transition not in this table must be **rejected with a 409 error**.
- `CLOSED` stores a `closeReason`: `CONFIRMED`, `AUTO_CLOSED`, `UNABLE_TO_ACCESS`, `WARDEN_DECISION`.
- Implement transitions in **one state-machine module** with a transition table, unit-tested.

### 5.4 Duplicates

- **Same room:** if an open ticket already exists for the same room and category, block creation and show the existing ticket ("Your roommate already reported this").
- **Same floor:** for COMMON tickets with the same category, same block and floor, raised within the last **2 hours**, suggest **joining** the existing ticket. Joining links the new reporter as a **follower** (they get notifications and can confirm or dispute). Closing the parent closes the whole group.

### 5.5 Routing and ETA prediction (no ML: a transparent, explainable algorithm)

**Job duration estimate** per ticket, using "similar" completed tickets (same category; same block if there are at least 5 such tickets, otherwise hostel-wide):

```
estimate = (k × defaultDuration + n × observedMedian) / (k + n),   k = 5
```

- Use the **median**, not the mean. Only use durations from tickets that reached `RESOLVED` via **completion code** or `CLOSED` with `CONFIRMED` (trustworthy data). Exclude locked-room visits.
- Also compute the **80th percentile** to give a range.

**Schedule simulation** for each eligible staff member (same trade, active):

1. Take their open queue, ordered by priority (URGENT > NORMAL > LOW), then by creation time.
2. Insert the new ticket in its correct position.
3. Lay each job's estimated duration into their **shift windows** (`staff_shifts`: weekday, start time, end time), starting from `clock.now()`.
4. Record when the new ticket would finish.

**Routing:** assign to the staff member with the **earliest simulated finish**. Ties → fewer open tickets.

**Display:** "Likely by {p50 time}, latest around {p80 time}".

**Recompute** ETAs for a staff member's whole queue when: a ticket is added, removed or reassigned, a priority changes, or a job finishes. If a ticket's ETA moves later by **more than 30 minutes**, notify its occupants or reporter.

**Accuracy tracking:** store every prediction (`ticket_predictions`) and the actual completion time. Analytics shows **average prediction error per week**.

### 5.6 Completion evidence

- **Completion code:** a random 4-digit code generated when the ticket enters `IN_PROGRESS` (regenerated on `REOPENED`). Visible **only** to current occupants of that room, via an authorized endpoint. Staff enter it to resolve.
- **Code attempt limit:** after **5 wrong attempts** on a ticket, code entry is blocked for **15 minutes** for that ticket. Silent: no warden notification. *(Remove this rule only if I tell you to.)*
- **Photos:** a before-photo is optional on creation; an **after-photo is required** to resolve. Uploads go to Cloudinary; the **server** records the timestamp and uploader. Images only, max 5 MB, max 3 per upload.
- **Dispute window:** 48 h after `RESOLVED` / `AWAITING_VERIFICATION`.
- **Roommates disagree:** a **dispute always wins** over a confirmation inside the 48 h window. Log who did what.
- **Staff disputes a refusal** (an occupant won't give the code even though the job is done): staff can raise a dispute → goes to the warden, who sees photos and history and decides (`CLOSED` with `WARDEN_DECISION`, or back to work).
- **Optional warden check:** a warden can open any closed ticket in their block and mark it "Verified OK" or "Problem found" (reopen). This is optional, never required.

### 5.7 Locked room

1. Staff taps "Room locked" with a **required door photo** → `AWAITING_ACCESS`. The **SLA clock pauses**.
2. All occupants are notified: "{staff} came at {time}; your room was locked."
3. An occupant chooses **"I'll be there in 15 min"** (the ticket stays at the top of that staff member's queue for 15 min) or **picks a time slot** (the scheduler places the job in that slot and recomputes the ETA).
4. Track `lockedVisitCount` on the ticket. On the **2nd** locked visit, the occupant **must** pick a time slot (no 15-min option).
5. No occupant response within **48 h** → `CLOSED` with `UNABLE_TO_ACCESS`; an occupant can reopen.
6. Occupants can dispute a locked claim ("I was in my room") → the warden reviews the door photo and timestamp. A confirmed false claim counts against the staff member.

### 5.8 SLA and escalation

- `dueAt = createdAt + category SLA + total paused time` (paused while in `AWAITING_ACCESS` or `ON_HOLD`).
- When `clock.now() > dueAt` and the ticket is still open:
  - level 0 → 1: notify the **block warden**
  - 24 h after level 1 and still open → level 2: notify the **chief warden**
- Escalation is checked by `/api/jobs/tick` **and** lazily whenever a dashboard loads.

### 5.9 Notifications

- In-app notifications only (a bell icon with an unread count). No SMS.
- Email is optional and only for escalations, if time permits.

### 5.10 Analytics (warden scoped to their block; chief warden and admin see all)

- Open tickets by status and category; deadline breach rate
- Average resolution time per category
- **Staff reliability score** = weighted mix of: % of jobs verified by code, reopen rate, SLA met rate, prediction accuracy
- **Locked-visit rate per staff member** (flag outliers)
- **Rooms with repeat issues** (≥3 tickets of the same trade in 30 days)
- **Prediction error over time** (weekly average)

---

## 6. Data model (Prisma; extend if needed, but tell me)

```
User(id, name, email unique, passwordHash, role, trade?, blockId?, isActive, createdAt)
Block(id, name)                       // e.g. "A", "B", "C"
Room(id, blockId, floor, number)      // unique (blockId, number)
RoomOccupancy(id, userId, roomId, fromDate, toDate?)
Category(id, name, trade, defaultPriority, defaultDurationMin, slaMinutes, isActive)
StaffShift(id, staffId, weekday 0-6, startMinute, endMinute)
Ticket(id, code e.g. "HD-0042", locationType ROOM|COMMON, roomId?, blockId, floor, commonSpot?,
       categoryId, priority, title, description, status, closeReason?,
       raisedById, assignedToId?, parentTicketId?,
       dueAt, pausedAt?, totalPausedMinutes, escalationLevel, escalatedAt?,
       reopenCount, lockedVisitCount, preferredSlotStart?, preferredSlotEnd?,
       completionCode?, codeFailedAttempts, codeBlockedUntil?,
       startedAt?, resolvedAt?, closedAt?, createdAt, updatedAt)
TicketFollower(ticketId, userId)
TicketEvent(id, ticketId, actorId?, fromStatus?, toStatus?, type, note?, createdAt)
Attachment(id, ticketId, uploaderId, url, kind BEFORE|AFTER|DOOR, createdAt)
Comment(id, ticketId, authorId, body, createdAt)
Dispute(id, ticketId, raisedById, type FIX_NOT_DONE|LOCKED_CLAIM_FALSE|CODE_REFUSED, reason, status OPEN|UPHELD|REJECTED, decidedById?, decidedAt?)
TicketPrediction(id, ticketId, staffId, predictedP50At, predictedP80At, createdAt)
Notification(id, userId, ticketId?, type, message, readAt?, createdAt)
```

---

## 7. Phases (do ONLY the phase you are given)

| Phase | Name | Outcome | Target finish |
|---|---|---|---|
| 1 | **Foundation** | Monorepo, schema, seed data, clock, auth, role guards, app shells per role, deployable skeleton | Mon 11 AM |
| 2 | **Ticket core** | Create room/common tickets, state machine, events timeline, duplicates (block + join), comments, notifications, role dashboards | Mon 5 PM |
| 3 | **Scheduling & ETA** | Shifts, duration estimator, schedule simulation, routing, ETA range, recompute + delay alerts, synthetic history generator, prediction logging | Mon 10 PM |
| 4 | **Evidence & access** | Completion code + attempt limit, photos, verification and dispute window, roommate rule, disputes, locked-room flow, on-hold, optional warden check | Tue 11 AM |
| 5 | **Jobs & escalation** | SLA pause accounting, escalation levels, auto-close jobs, `/jobs/tick` + lazy checks, demo time-travel | Tue 2 PM |
| 6 | **Analytics & admin** | Analytics pages, reliability score, admin management (rooms, occupancy CSV import, staff, shifts, categories) | Tue 5 PM |
| 7 | **Ship** | Polish UX states, tests, final deploy (cron keep-awake set up), README incl. tech-choice justifications + Scalability section, demo seed scenario | Tue 8 PM |

Each phase ends with: the app running, tests passing, commits pushed, and a short report to me.

---

## 8. Definition of done (whole project)

- [ ] All workflows in section 5 work end-to-end in the **deployed** app
- [ ] Server-side authorization on every endpoint
- [ ] Unit tests for: state machine, duration estimator, schedule simulation, SLA pause/escalation, code attempt limit
- [ ] No secrets in git; `.env.example` complete
- [ ] README with: problem, users, solution, features, stack **with justifications**, architecture, **Scalability & growth path** (section 4.1), setup, env vars, deployment links, and an honest note that historical data is **synthetic**
- [ ] Rules in section 4.1 hold: stateless server, idempotent externally triggered jobs, pooled DB connection, paginated lists
- [ ] cron-job.org pinging `/api/jobs/tick` every 5 min in production (keeps Render awake)
- [ ] Demo accounts listed in the README (one per role)
