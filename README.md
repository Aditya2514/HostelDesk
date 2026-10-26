# HostelDesk

> **HostelDesk replaces the hostel complaint register: every complaint gets a predicted fix time, and staff can't mark it done without proof.**

---

## 1. Problem Statement

Traditional university hostel complaint registers rely on physical paper logbooks kept at the security desk. This creates structural failures:
- **No Visibility or Accountability:** No one knows who has an active complaint, how long it has been sitting, or whether technicians actually visited.
- **No Expected Time of Arrival (ETA):** Students remain stuck waiting inside their dorm rooms indefinitely with zero estimation of when repairs will begin.
- **Unverified Completion:** Maintenance staff can sign off complaints on paper without doing the work or providing any tangible evidence.
- **Duplicate Chaos:** When common facilities fail (e.g., washroom water supply), dozens of students write the identical issue, fragmenting effort.
- **Zero Management Intelligence:** Wardens have no metrics on recurring facility failures, technician reliability, or SLA breach trends.

---

## 2. Target Users

1. **Students:** Raise room or common area complaints, track real-time ETAs, generate secure completion codes, confirm repairs, or dispute shoddy work.
2. **Maintenance Staff (Technicians):** View daily scheduled queues, start jobs, upload evidence, and verify completion codes.
3. **Block Wardens:** Oversee block queues, handle escalations, review technician disputes, adjust priorities, and conduct quality spot-checks.
4. **Chief Warden:** Campus-wide oversight, cross-block analytics, high-level escalations, and technician performance tracking.
5. **System Administrators:** Room and occupancy management (including bulk CSV import), staff onboarding and shift scheduling, category SLA configuration, and full mutation audit trails.

---

## 3. The Solution

HostelDesk digitizes the entire lifecycle into an accountable, transparent system:
- **Algorithmic Queue Simulation:** Every ticket is assigned to the technician who can finish it earliest, displaying a realistic completion range (`Likely by P50, latest around P80`) with an explicit "Why this estimate?" breakdown.
- **Cryptographic & Photographic Proof:** Room repairs require a secret 4-digit code known only to room occupants. Common areas require Cloudinary-backed after-photos.
- **Dispute-Always-Wins Guarantee:** Roommates have a 48-hour dispute window; any dispute instantly reopens the job regardless of prior confirmations.
- **Locked-Room Protocol:** Prevents technician ghosting with mandatory door photos, automatic SLA pauses, and 15-minute quick returns or scheduled slot bookings.
- **Block-Scoped Actionable Analytics:** Wardens and management receive aggregate SQL metrics on deadline breach rates, technician reliability scores, and chronic repeat-issue rooms.

---

## 4. Key Features by Role & Core Workflows

### Role Highlights
- **Student:** Roommate-shared room ticket visibility; common area duplicate joining; real-time ETA with confidence intervals; completion code generator; 48-hour dispute window.
- **Staff:** Mobile-first queue sorted by priority and shift hours; one-tap status advancement; door photo upload on locked rooms; dispute escalation on code refusals.
- **Warden:** Block-level isolation; open dispute arbitration; SLA breach notifications; manual priority override and ticket rejection; quality inspection flags.
- **Chief Warden & Admin:** Global cross-block filter; technician reliability scoring table; repeat breakdown hotspot list; CSV student import; shift window builder; tamper-evident audit logs.

### 5 Core Workflows
1. **Raise to Assignment:** Student files complaint $\to$ Category sets SLA/trade $\to$ Blended duration estimated $\to$ Simulator assigns staff member with earliest finish time $\to$ Live ETA calculated.
2. **Room Repair & Verification:** Staff taps "Start Work" $\to$ Status becomes `IN_PROGRESS` $\to$ Student retrieves 4-digit code $\to$ Staff inputs code + optional photo $\to$ Ticket transitions to `RESOLVED`.
3. **Common Area Deduplication:** Student searches/browses common issues $\to$ Existing open ticket identified $\to$ Student clicks "Join Complaint" (increments follower count without creating duplicate tickets).
4. **Locked Room Handling:** Staff finds room locked $\to$ Uploads mandatory door photo $\to$ Ticket status becomes `AWAITING_ACCESS` (SLA pauses) $\to$ Student selects "Coming in 15m" or books a 30m shift slot.
5. **Two-Stage Escalation:** Ticket breaches `dueAt` $\to$ Level 1 alert sent to Block Warden $\to$ If unresolved after 24h $\to$ Level 2 alert sent to Chief Warden.

---

## 5. Tech Stack & Justifications

| Technology | Selection Justification |
|---|---|
| **PostgreSQL (Neon)** | ACID transactions ensure atomic room moves, shift updates, and audit logging; relational joins eliminate data duplication. |
| **Prisma ORM** | Type-safe database queries, schema-driven migrations, and raw aggregate SQL capabilities (`$queryRaw`). |
| **Express & Node.js** | Lightweight, high-throughput asynchronous runtime well-suited for I/O-heavy scheduling engines and stateless APIs. |
| **React 18 + Vite** | Fast client bundling, sub-second HMR, and declarative UI state management with `@tanstack/react-query`. |
| **Vanilla Tailwind CSS** | Clean responsive design tokens, robust mobile layouts (375px+), and zero CSS bloat. |
| **Cloudinary** | Secure media CDN with server-signed multipart REST uploads, avoiding local filesystem storage on ephemeral hosts. |
| **Vercel API Rewrites** | Routes `/api/*` through the frontend domain, maintaining first-party `httpOnly` session cookies without third-party cookie blocking. |
| **External Cron (`cron-job.org`)** | Serverless execution model pings `/api/jobs/tick` every 5 minutes to run idempotent background escalations and prevent free-tier sleep. |

---

## 6. Architecture & System Design

### Deployment Topology

```mermaid
graph TD
  Browser["Client Browser (React 18)"]
  Vercel["Vercel Edge (Frontend + /api Rewrites)"]
  Render["Render Web Service (Express Node API)"]
  Neon[("Neon PostgreSQL (Pooled PgBouncer)")]
  Cloudinary[("Cloudinary Object Storage")]
  Cron["cron-job.org (Every 5 min)"]

  Browser -->|"HTTPS Same-Origin"| Vercel
  Vercel -->|"Proxy with httpOnly Cookie"| Render
  Cron -->|"POST /api/jobs/tick (x-jobs-secret)"| Render
  Render -->|"Prisma ORM"| Neon
  Render -->|"Signed REST Multipart"| Cloudinary
```

### Module Overview
- `auth`: JWT token generation, `httpOnly` cookie management, and role-based access control.
- `tickets`: Core ticket lifecycle, parent-child grouping, and state machine transitions.
- `scheduling`: Shift accounting, blended duration estimator, and discrete queue simulation engine.
- `evidence`: Signed Cloudinary uploads, 4-digit code lockout (5 attempts / 15 min), and door photos.
- `disputes`: Occupant and technician dispute arbitration pipeline.
- `jobs`: Idempotent SLA escalation, 48h auto-close, and queue health ticks.
- `analytics`: Scoped SQL aggregate calculations, prediction accuracy tracking, and reliability scores.
- `admin`: Room occupancy moves, two-step CSV student onboarding, shift editor, and audit logs.

### State Machine Diagram

```mermaid
stateDiagram-v2
  [*] --> RAISED : Raise Ticket
  RAISED --> ASSIGNED : Auto-Routed
  ASSIGNED --> IN_PROGRESS : Start Work
  IN_PROGRESS --> AWAITING_ACCESS : Room Locked + Door Photo
  AWAITING_ACCESS --> ASSIGNED : 15m Return / Booked Slot
  AWAITING_ACCESS --> CLOSED : 48h Timeout
  IN_PROGRESS --> ON_HOLD : Parts Pause
  ON_HOLD --> IN_PROGRESS : Resume
  IN_PROGRESS --> RESOLVED : Code Verified (Room)
  IN_PROGRESS --> AWAITING_VERIFICATION : After Photo (Common)
  IN_PROGRESS --> CLOSED : Warden Upholds Refusal
  AWAITING_VERIFICATION --> CLOSED : Confirmed / 48h Auto-Close
  RESOLVED --> CLOSED : Confirmed / 48h Auto-Close
  RESOLVED --> ASSIGNED : Dispute Upheld
  CLOSED --> ASSIGNED : Warden Inspection Problem
  ASSIGNED --> REJECTED : Warden Rejection
  RAISED --> REJECTED : Warden Rejection
  REJECTED --> [*]
  CLOSED --> [*]
```

### ETA Engine & Worked Examples

The ETA engine uses a 2-stage model:
1. **Empirical Duration Blended Estimator:**
   Calculates median duration using Bayesian sample weighting:
   $$w = \frac{n}{n + 5}$$
   $$\text{Estimated P50} = (1 - w) \times \text{Default} + w \times \text{ObservedMedian}$$
   - *Example:* Default ceiling fan repair = 40 min.
   - Week 1 ($n=0$): $w=0 \implies \mathbf{40\text{ min}}$.
   - Week 2 ($n=5$, observed median 70 min): $w=5/(5+5)=0.5 \implies 0.5(40) + 0.5(70) = \mathbf{55\text{ min}}$.
   - Week 4 ($n=20$, observed median 74 min): $w=20/(20+5)=0.8 \implies 0.2(40) + 0.8(74) = \mathbf{67.2} \approx \mathbf{67\text{ min}}$.

2. **Schedule Simulation & Technician Routing:**
   Simulates each eligible technician's queue in priority order (`URGENT` > `NORMAL` > `LOW`) strictly during active shift windows:
   - *Example (New 60m Ticket at 16:30 IST; Shift ends at 18:00 IST):*
     - **Ramesh:** Free. Finishes 16:30 + 60m = **17:30 IST Today**.
     - **Suresh:** Busy with 45m urgent job until 17:15. Takes 45m today + 15m tomorrow = **09:15 IST Tomorrow**.
     - **Anil:** Busy queue until tomorrow afternoon = **15:00 IST Tomorrow**.
     - $\implies$ **Routed to Ramesh** (earliest finish time).

*(For detailed math and code references, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))*

---

## 7. Local Setup

### Prerequisites
- Node.js 18+ (tested on Node 20 & 22)
- PostgreSQL database instance
- Cloudinary credentials

### Step-by-Step Installation
```bash
# 1. Clone repository
git clone https://github.com/Aditya2514/HostelDesk.git
cd HostelDesk

# 2. Setup Server
cd server
cp .env.example .env
npm install
npx prisma migrate dev

# 3. Seed Base Data, Synthetic History & Demo Walkthrough Scenarios
npm run prisma:seed    # Base rooms, users, categories, shifts
npm run seed:history   # 200 progressive synthetic tickets across 60 days
npm run seed:demo      # 6 reproducible walkthrough scenario tickets

# 4. Start Server Development Engine
npm run dev

# 5. Setup & Launch Client (in a separate terminal)
cd ../client
cp .env.example .env
npm install
npm run dev
```

---

## 8. Environment Variables

### Server (`server/.env`)
| Variable | Purpose | Example |
|---|---|---|
| `PORT` | API server listen port | `5000` |
| `NODE_ENV` | Runtime environment (`development`, `production`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `JWT_SECRET` | Secret key for signing session tokens | `your-secure-jwt-secret-key-32chars` |
| `JOBS_SECRET` | Header secret for triggering `/api/jobs/tick` | `your-secure-jobs-cron-secret` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud account name | `hosteldesk-cloud` |
| `CLOUDINARY_API_KEY` | Cloudinary REST API key | `123456789012345` |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | `abcdefghijklmnopqrstuvwx` |
| `CLIENT_ORIGIN` | Allowed CORS frontend domain | `http://localhost:5173` |
| `DEMO_MODE` | Enables admin time-travel offset APIs | `true` |

### Client (`client/.env`)
| Variable | Purpose | Example |
|---|---|---|
| `VITE_API_URL` | Base API URL (empty in production for Vercel rewrites) | `http://localhost:5000` |

---

## 9. Deployment

- **Production Frontend:** `<VERCEL_URL>`
- **Production Backend API:** `<RENDER_URL>`
- **Cron Engine:** Configured on `cron-job.org` calling `POST <RENDER_URL>/api/jobs/tick` with `x-jobs-secret` every 5 minutes.
- *Detailed production setup guide:* See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 10. Demo Accounts

Password for all pre-seeded accounts: **`Demo@1234`**

| Role | Email | Purpose / View |
|---|---|---|
| **Student (Room A-301)** | `student1@hosteldesk.dev` | View room tickets, completion codes, join common issues |
| **Student (Room A-301)** | `student2@hosteldesk.dev` | Roommate view, 48h dispute window demonstration |
| **Staff (Electrician)** | `electrician1@hosteldesk.dev` | Mobile queue, start work, resolve via 4-digit code |
| **Staff (Plumber)** | `plumber1@hosteldesk.dev` | Field queue, upload door/after photo evidence |
| **Block Warden (Block A)** | `warden.a@hosteldesk.dev` | Block A control center, dispute arbitration, quality check |
| **Chief Warden** | `chief.warden@hosteldesk.dev` | Cross-block analytics dashboard, staff reliability metrics |
| **Administrator** | `admin@hosteldesk.dev` | Room moves, CSV import, staff & shift roster, audit logs |

---

## 11. Testing & Verification

HostelDesk includes **199 automated unit/integration tests** and **5 end-to-end real-database smoke suites**.

```bash
# Run unit test suite (27 test files, 199 tests)
npm test

# Run real database smoke test suites
npm run smoke:phase2   # Core ticket creation, state transitions, duplicate joining
npm run smoke:phase3   # Estimator formulas, schedule simulation, queue recomputation
npm run smoke:phase4   # Completion code lockout, Cloudinary uploads, dispute-wins rule
npm run smoke:phase5   # SLA pause math, escalation levels, 48h auto-close
npm run smoke:phase6   # Scoped analytics SQL, room moves, CSV preview/apply, shift limits
npm run smoke:prod     # Production health and end-to-end user journeys
```

---

## 12. Security Architecture

- **Password Security:** Salted Bcrypt hashes (`10 rounds`); plain passwords never stored or logged.
- **Session Transport:** Stateless JWT tokens transported strictly via `httpOnly`, `SameSite=Lax`, `Secure` cookies.
- **Server-Side Authorization:** Role validation (`requireRole`) enforced on all API endpoints; client UI hiding is treated purely as visual guidance.
- **Lockout Safeguard:** 5 incorrect completion code attempts locks ticket code entry for 15 minutes.
- **Input Sanitization & Validation:** All incoming mutation payloads validated with strict `Zod` schemas.
- **Rate Limiting:** Protects `/api/auth/login` (5 requests / 15 min per IP) and general endpoints via `express-rate-limit`.
- **Zero Secrets in Git:** Scanned with `git ls-files`; only template `.env.example` committed.

---

## 13. Scalability & Growth Path

| Bottleneck | Architecture Growth Path |
|---|---|
| **Free-Tier Host Cold Starts** | External cron pings `/api/jobs/tick` every 5 min keeping instance awake; transition to paid compute requires zero code changes. |
| **Database Connection Exhaustion** | Connection pooling enabled via Neon PgBouncer connection string in `DATABASE_URL`. |
| **Long-Term Analytics Performance** | Raw SQL aggregation queries (`$queryRaw`) utilize database indexes; growth path introduces nightly materialized summary tables. |
| **Multi-Campus Multi-Tenancy** | Domain tables structured to incorporate `campusId` tenant partitioning across queries. |
| **Server CPU Scaling** | Stateless API architecture allows horizontal scaling behind a standard load balancer. |

---

## 14. Honest Notes & Limitations

- **Synthetic Historical Data:** Historical tickets generated via `seed:history` are synthetic, created using deterministic seeded pseudo-random algorithms to simulate 60 days of improving estimation accuracy.
- **Notification Transport:** Notifications are currently delivered via in-app UI notifications (polling with badge counts); external SMS/push gateways are not integrated.
- **Single Timezone:** Shifts and operational schedules operate in Indian Standard Time (IST / UTC+5:30).
- **Free-Tier Hosting Latency:** On Render free-tier instances, cold starts may introduce a 30–50 second delay on the initial request after dormancy.

---

## 15. AI Usage Disclosure

AI coding assistants were utilized for scaffolding boilerplate, exploratory test writing, and syntax optimization. Architectural topology, state machine definitions, algorithmic scheduling logic, dispute-wins guarantees, and real-database verification suites were designed, audited, and validated by the project author.
