# HostelDesk — Deployment & Infrastructure Guide

This guide provides step-by-step instructions for deploying the HostelDesk monorepo to production across **Neon** (PostgreSQL), **Render** (Node.js/Express Backend), **Vercel** (React/Vite Frontend), and **cron-job.org** (Scheduled Keep-Awake & Job Trigger).

---

## 1. Neon Database Setup (PostgreSQL)

1. Sign up / Log in to [Neon Console](https://console.neon.tech).
2. Create a new project:
   - **Project Name**: `hosteldesk`
   - **Postgres version**: `16` or `17`
   - **Region**: `AWS Asia Pacific (Singapore)`. Use the **same region** for Render, so every query doesn't cross an ocean.
   - **Branches**: use a **dedicated branch for production** and keep local development on a different one, so test data never reaches the deployed app. Neon names the default branch `production` (older projects: `main`). If you already developed against that default branch, create a new branch from it, wipe the new branch with `cd server && DATABASE_URL=… DIRECT_URL=… npx prisma migrate reset --force --skip-seed`, and use the **new** branch for production. Check that the host (`ep-…`) in the production strings differs from the one in your local `.env`.
3. In your Neon Project Dashboard, navigate to the **Connection Details** widget:
   - **Pooled Connection String (`DATABASE_URL`)**:
     - Toggle the switch: **"Connection pooling" (Checked/Enabled)**.
     - Copy the string. It looks like:
       `postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require`
     - *Why:* Neon uses PgBouncer to efficiently handle pooled connections from serverless and web instances without exhausting connection limits.
   - **Direct Connection String (`DIRECT_URL`)**:
     - Toggle the switch: **"Connection pooling" (Unchecked/Disabled)**.
     - Copy the string. It looks like:
       `postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=require`
     - *Why:* Prisma migrations (`prisma migrate deploy`) require direct connections for transactional DDL statements and migration locks that connection poolers don't support.

---

## 2. Backend Deployment on Render

1. Log in to [Render](https://render.com) and click **New +** → **Web Service**.
2. Connect your GitHub repository: `HostelDesk`.
3. Configure the web service:
   - **Name**: `hosteldesk-server`
   - **Region**: `Singapore` (same as Neon)
   - **Branch**: `main`
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm ci --include=dev && npm run build
     ```
   - **Start Command**:
     ```bash
     npx prisma migrate deploy && npm start
     ```
     *(This ensures all pending Prisma migrations run automatically on each deployment before starting the web server).*
   - *Why `--include=dev`:* with `NODE_ENV=production` set, a plain `npm install` skips `devDependencies`, which include TypeScript and the Prisma CLI. The build would then fail with `tsc: not found`.
4. Add the following **Environment Variables** in Render:
   | Variable | Value / Description |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Neon **Pooled** connection string of the **production** branch, with `&pgbouncer=true` appended |
   | `DIRECT_URL` | Neon **Direct** connection string of the **production** branch |
   | `JWT_SECRET` | Strong random string (min 32 characters, e.g. `openssl rand -hex 32`). Use a **different** value from your local `.env`. |
   | `CLIENT_ORIGIN` | Your production Vercel URL (e.g. `https://hosteldesk.vercel.app`) |
   | `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
   | `CLOUDINARY_API_KEY` | Cloudinary API Key |
   | `CLOUDINARY_API_SECRET` | Cloudinary API Secret |
   | `JOBS_SECRET` | Random token for cron trigger (e.g. `openssl rand -hex 16`) |
   | `DEMO_MODE` | `true` (enables time-travel and demo accounts panel for project presentation) |
   Render sets `PORT` itself; don't add it.
5. Click **Create Web Service** and wait for deployment.
6. Note the service URL Render gives you. If it is **not** exactly `https://hosteldesk-server.onrender.com` (Render adds a suffix when a name is taken; this project's is `https://hosteldesk-uxsm.onrender.com`), update the destination in `client/vercel.json` to match **before** deploying the frontend; otherwise every API call from the deployed site fails.

---

## 3. Seed Production Database (Run Once)

Once Render finishes the initial deployment and migrations:
1. From your local development machine with connection to the database (or via Render's Web Shell):
   ```bash
   cd server
   DATABASE_URL="<production-pooled-url>" DIRECT_URL="<production-direct-url>" npx prisma db seed
   DATABASE_URL="<production-pooled-url>" DIRECT_URL="<production-direct-url>" npm run seed:history
   ```
   Double-check you're using the **production** branch strings, not your development branch.
2. The seed script is **idempotent** (safe to run twice), but it deletes and recreates room occupancies, so **don't re-run it on production once real people use the app**. It initializes:
   - Blocks A, B, and C
   - 120 rooms (10 per floor across 4 floors)
   - 10 category SLAs & durations
   - 10 staff members with realistic shifts
   - Wardens & Chief Warden
   - Demo students including `student1@hosteldesk.dev` and `student2@hosteldesk.dev` in room A-301.

---

## 4. Frontend Deployment on Vercel

1. Log in to [Vercel](https://vercel.com) and click **Add New...** → **Project**.
2. Import the `HostelDesk` repository.
3. In project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click "Edit" and choose `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add the **Environment Variables**:
   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | Leave empty `""` (requests use same-site `/api` path) |
   | `VITE_DEMO_MODE` | `true` |
5. **Same-Site API Rewriting (`client/vercel.json`)**:
   - `client/vercel.json` contains a rewrite rule forwarding `/api/(.*)` directly to your Render backend (`https://hosteldesk-uxsm.onrender.com/api/$1` for this deployment) before the SPA fallback rewrite.
   - *Why:* This allows the browser to communicate with the API on the exact same origin as the frontend. The `token` authentication cookie is treated as **first-party (`SameSite=Lax`)**, completely bypassing Safari / iOS Intelligent Tracking Prevention (ITP) that would otherwise block third-party cookies on iPhone devices.
6. Click **Deploy**. All client-side routes (`/student`, `/staff`, `/warden`, `/admin`) rewrite to `index.html`.
7. Copy the Vercel URL (e.g. `https://hosteldesk.vercel.app`) into Render's `CLIENT_ORIGIN` environment variable and redeploy the Render service.

---

## 5. Keep-Awake & Scheduled Job Trigger (cron-job.org)

Render's free tier spins down after 15 minutes of inactivity. HostelDesk uses an external cron trigger to solve two critical needs:
1. Prevent the Render instance from going to sleep.
2. Trigger the idempotent escalation and auto-close job engine every 5 minutes.

### Setting up cron-job.org:
1. Sign up / log in to [cron-job.org](https://cron-job.org).
2. Click **Create Cronjob**:
   - **Title**: `HostelDesk Tick & Keep-Awake`
   - **URL**: `https://<your-render-app>.onrender.com/api/jobs/tick` (call Render **directly**, not through the Vercel URL: only direct traffic keeps the Render instance awake)
   - **Request Method**: `POST`
   - **Schedule**: Every 5 minutes (`*/5 * * * *`)
3. Under **Headers**, add a custom header:
   - **Header Name**: `x-jobs-secret`
   - **Header Value**: `<The JOBS_SECRET value configured on Render>`
4. Save the cron job. It will call `/api/jobs/tick` every 5 minutes, receiving a `200 OK` response.

---

## 6. Pre-Demo Checklist

> [!TIP]
> **Before recording your demonstration:**
> If you haven't accessed the app in a few hours, open the site once in your browser 1–2 minutes before the presentation. This ensures the free Render backend instance is warm and responds with sub-second latency during your presentation.

- [ ] Open the Vercel URL in an **incognito** window and log in as `student1@hosteldesk.dev` / `Demo@1234`
- [ ] Raise a ticket and check it shows an assignee and an ETA
- [ ] Log out and log in as `warden.a@hosteldesk.dev`: the student's data must not appear
- [ ] If possible, log in once from an iPhone (Safari) to confirm the cookie works
- [ ] cron-job.org shows recent successful (200) runs
