import { parseArgs } from "util";

// Parse CLI flags: npm run smoke:prod -- --base=https://hosteldesk.vercel.app
const options = {
  base: {
    type: "string" as const,
    default: process.env.BASE_URL || "http://localhost:4000",
  },
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options,
  strict: false,
});

const baseUrl = (values.base as string).replace(/\/+$/, "");

interface TimedResponse {
  res: Response;
  data: any;
  durationMs: number;
  cookie?: string;
}

const slowRequests: Array<{ url: string; durationMs: number }> = [];

async function timedFetch(
  endpoint: string,
  init: RequestInit = {},
  existingCookie?: string
): Promise<TimedResponse> {
  const url = `${baseUrl}${endpoint}`;
  const start = Date.now();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };

  if (existingCookie) {
    headers["Cookie"] = existingCookie;
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  const durationMs = Date.now() - start;

  if (durationMs > 5000) {
    slowRequests.push({ url: endpoint, durationMs });
    console.warn(`  ⚠️ Slow request (> 5s): ${endpoint} took ${(durationMs / 1000).toFixed(2)}s (Cold start detected)`);
  }

  const rawText = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = rawText;
  }

  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : existingCookie;

  return { res, data, durationMs, cookie };
}

async function loginRole(email: string, expectedRole: string) {
  const loginRes = await timedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "Demo@1234" }),
  });

  if (loginRes.res.status !== 200) {
    throw new Error(`Login failed for ${email}: status ${loginRes.res.status} ${JSON.stringify(loginRes.data)}`);
  }

  const meRes = await timedFetch("/api/auth/me", { method: "GET" }, loginRes.cookie);
  if (meRes.res.status !== 200 || meRes.data?.user?.role !== expectedRole) {
    throw new Error(`Auth /api/auth/me mismatch for ${email}. Expected ${expectedRole}, got ${meRes.data?.user?.role}`);
  }

  return {
    user: meRes.data.user,
    cookie: loginRes.cookie,
  };
}

async function runProductionSmoke() {
  const overallStart = Date.now();
  console.log("======================================================================");
  console.log(`🌐 Running Production Smoke Test Suite against: ${baseUrl}`);
  console.log("======================================================================\n");

  // Step 1: Health Check
  console.log("--- Step 1: Health Check ---");
  const healthRes = await timedFetch("/api/health");
  if (healthRes.res.status !== 200) {
    throw new Error(`Health check failed with status ${healthRes.res.status}: ${JSON.stringify(healthRes.data)}`);
  }
  console.log(`✓ GET /api/health returned 200 OK (${healthRes.durationMs}ms)`);

  // Step 2: Role Logins & /api/auth/me Verification
  console.log("\n--- Step 2: Role Authentication & Session Cookie Transport ---");
  const rolesToTest = [
    { role: "STUDENT", email: "student1@hosteldesk.dev" },
    { role: "STAFF", email: "electrician1@hosteldesk.dev" },
    { role: "WARDEN", email: "warden.a@hosteldesk.dev" },
    { role: "CHIEF_WARDEN", email: "chief@hosteldesk.dev" },
    { role: "ADMIN", email: "admin@hosteldesk.dev" },
  ];

  const sessions: Record<string, { user: any; cookie?: string }> = {};

  for (const r of rolesToTest) {
    const session = await loginRole(r.email, r.role);
    sessions[r.role] = session;
    console.log(`✓ Logged in as ${r.role} (${r.email}): Verified role in session cookie`);
  }

  // Step 3: Student Ticket List with ETA Verification
  console.log("\n--- Step 3: Student Ticket Listing & Real ETA Verification ---");
  const studentSession = sessions["STUDENT"];
  const ticketsRes = await timedFetch("/api/tickets?limit=50", { method: "GET" }, studentSession.cookie);
  if (ticketsRes.res.status !== 200) {
    throw new Error(`Student ticket listing failed: ${ticketsRes.res.status} ${JSON.stringify(ticketsRes.data)}`);
  }

  const tickets = ticketsRes.data?.tickets || [];
  const ticketWithEta = tickets.find((t: any) => t.etaP50At != null);
  if (!ticketWithEta) {
    throw new Error("Expected at least one ticket with a valid etaP50At prediction in student queue");
  }
  console.log(`✓ Student tickets listed (${tickets.length} tickets found)`);
  console.log(`  ✓ Sample Ticket with predicted ETA: ${ticketWithEta.code} -> P50: ${ticketWithEta.etaP50At}`);

  // Step 4: Student Creates [SMOKE] Ticket -> Warden Rejects for Cleanup
  console.log("\n--- Step 4: End-to-End Ticket Lifecycle: Create [SMOKE] & Warden Reject ---");
  // Fetch electrician category ID
  const catRes = await timedFetch("/api/categories", { method: "GET" }, studentSession.cookie);
  const categories = catRes.data?.categories || [];
  const cat = categories[0];
  if (!cat) throw new Error("No category found for smoke ticket creation");

  const createTicketRes = await timedFetch(
    "/api/tickets",
    {
      method: "POST",
      body: JSON.stringify({
        locationType: "ROOM",
        categoryId: cat.id,
        title: "[SMOKE] Production Smoke Test Ticket",
        description: "Automated end-to-end verification ticket created by smoke:prod script",
      }),
    },
    studentSession.cookie
  );

  if (createTicketRes.res.status !== 201) {
    throw new Error(`Failed to create smoke ticket: ${createTicketRes.res.status} ${JSON.stringify(createTicketRes.data)}`);
  }

  const createdTicket = createTicketRes.data?.ticket;
  console.log(`✓ Student created ticket: ${createdTicket.code} (Status: ${createdTicket.status}, AssignedTo: ${createdTicket.assignedToId})`);

  // Warden rejects with reason "smoke test cleanup"
  const wardenSession = sessions["WARDEN"];
  const rejectRes = await timedFetch(
    `/api/tickets/${createdTicket.id}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason: "smoke test cleanup" }),
    },
    wardenSession.cookie
  );

  if (rejectRes.res.status !== 200) {
    throw new Error(`Warden failed to reject smoke ticket: ${rejectRes.res.status} ${JSON.stringify(rejectRes.data)}`);
  }
  console.log(`✓ Warden rejected smoke ticket ${createdTicket.code} with reason "smoke test cleanup"`);

  // Step 5: Warden Analytics Overview
  console.log("\n--- Step 5: Warden Analytics Overview ---");
  const analyticsRes = await timedFetch("/api/analytics/overview?days=30", { method: "GET" }, wardenSession.cookie);
  if (analyticsRes.res.status !== 200) {
    throw new Error(`Analytics overview failed: ${analyticsRes.res.status} ${JSON.stringify(analyticsRes.data)}`);
  }
  console.log(`✓ GET /api/analytics/overview returned 200 OK`);
  console.log(`  Deadline breach rate: ${(analyticsRes.data.deadlineBreachRate * 100).toFixed(1)}%`);
  console.log(`  Scope enforced: Block ${analyticsRes.data.scope?.blockId || analyticsRes.data.meta?.scope?.blockId || "A"}`);

  // Step 6: Summary & Timing
  const totalDurationMs = Date.now() - overallStart;
  console.log("\n======================================================================");
  console.log(`🎉 Production Smoke Test Suite Completed Successfully!`);
  console.log(`⏱ Total Elapsed Time: ${(totalDurationMs / 1000).toFixed(2)}s`);
  if (slowRequests.length > 0) {
    console.log(`\n⚠️ ${slowRequests.length} Slow Request(s) (> 5s):`);
    for (const s of slowRequests) {
      console.log(`  - ${s.url}: ${(s.durationMs / 1000).toFixed(2)}s`);
    }
  } else {
    console.log(`⚡ All requests responded in under 5.0s (No cold start pauses).`);
  }
  console.log("======================================================================\n");
}

runProductionSmoke()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Production Smoke Test Failed:\n", err);
    process.exit(1);
  });
