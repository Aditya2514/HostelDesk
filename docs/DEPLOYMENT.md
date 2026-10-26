# HostelDesk — Deployment & Infrastructure Guide

This guide provides step-by-step instructions for deploying the HostelDesk monorepo to production across **Neon** (PostgreSQL), **Render** (Node.js/Express Backend), **Vercel** (React/Vite Frontend), and **cron-job.org** (Scheduled Keep-Awake & Job Trigger).

---

## 1. Neon Database Setup (PostgreSQL)

1. Sign up / Log in to [Neon Console](https://console.neon.tech).
2. Create a new project:
   - **Project Name**: `hosteldesk`
   - **Postgres version**: `16` or `17`
   - **Region**: Choose the closest region to your backend (e.g. `US East (Ohio)` or `Asia-Pacific (Singapore)`).
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
   - **Region**: Match or be close to your Neon database region
   - **Branch**: `main`
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm install && npm run build
     ```
   - **Start Command**:
     ```bash
     npx prisma migrate deploy && npm start
     ```
     *(This ensures all pending Prisma migrations run automatically on each deployment before starting the web server).*
4. Add the following **Environment Variables** in Render:
   | Variable | Value / Description |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `4000` (Render will map to port automatically) |
   | `DATABASE_URL` | Neon **Pooled** connection string |
   | `DIRECT_URL` | Neon **Direct** connection string |
   | `JWT_SECRET` | Strong random string (min 32 characters, e.g. `openssl rand -hex 32`) |
   | `CLIENT_ORIGIN` | Your production Vercel URL (e.g. `https://hosteldesk.vercel.app`) |
   | `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
   | `CLOUDINARY_API_KEY` | Cloudinary API Key |
   | `CLOUDINARY_API_SECRET` | Cloudinary API Secret |
   | `JOBS_SECRET` | Random token for cron trigger (e.g. `openssl rand -hex 16`) |
   | `DEMO_MODE` | `true` (enables time-travel and demo accounts panel for project presentation) |
5. Click **Create Web Service** and wait for deployment.

---

## 3. Seed Production Database (Run Once)

Once Render finishes the initial deployment and migrations:
1. From your local development machine with connection to the database (or via Render's Web Shell):
   ```bash
   cd server
   DATABASE_URL="<your-neon-pooled-url>" DIRECT_URL="<your-neon-direct-url>" npx prisma db seed
   ```
2. The seed script is completely **idempotent** (safe to run multiple times). It initializes:
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
   - `client/vercel.json` contains a rewrite rule forwarding `/api/(.*)` directly to your Render backend (`https://hosteldesk-server.onrender.com/api/$1`) before the SPA fallback rewrite.
   - *Why:* This allows the browser to communicate with the API on the exact same origin as the frontend. The `token` authentication cookie is treated as **first-party (`SameSite=Lax`)**, completely bypassing Safari / iOS Intelligent Tracking Prevention (ITP) that would otherwise block third-party cookies on iPhone devices.
6. Click **Deploy**. All client-side routes (`/student`, `/staff`, `/warden`, `/admin`) rewrite to `index.html`.

---

## 5. Keep-Awake & Scheduled Job Trigger (cron-job.org)

Render's free tier spins down after 15 minutes of inactivity. HostelDesk uses an external cron trigger to solve two critical needs:
1. Prevent the Render instance from going to sleep.
2. Trigger the idempotent escalation and auto-close job engine every 5 minutes.

### Setting up cron-job.org:
1. Sign up / log in to [cron-job.org](https://cron-job.org).
2. Click **Create Cronjob**:
   - **Title**: `HostelDesk Tick & Keep-Awake`
   - **URL**: `https://<your-render-app>.onrender.com/api/jobs/tick`
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
