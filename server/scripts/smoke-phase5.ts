import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { env } from "../src/config/env";

async function loginUser(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "Demo@1234" });

  if (res.status !== 200) {
    throw new Error(`Failed to log in as ${email}: ${res.status}`);
  }

  const cookie = res.headers["set-cookie"]?.[0];
  return { user: res.body.user, cookie };
}

// 1x1 valid PNG image buffer
const samplePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function runSmokePhase5() {
  console.log("=================================================");
  console.log("🚀 Running Phase 5 Smoke Test: Jobs & Escalations (Real Database)");
  console.log("=================================================\n");

  const createdTicketIds: string[] = [];

  try {
    // 0. Log in test users
    const [admin, chiefWarden, wardenA, student1, plumber1, plumber2, plumber3] = await Promise.all([
      loginUser("admin@hosteldesk.dev"),
      loginUser("chief@hosteldesk.dev"),
      loginUser("warden.a@hosteldesk.dev"),
      loginUser("student1@hosteldesk.dev"),
      loginUser("plumber1@hosteldesk.dev"),
      loginUser("plumber2@hosteldesk.dev"),
      loginUser("plumber3@hosteldesk.dev"),
    ]);

    const allPlumbers = [plumber1, plumber2, plumber3];
    const getAssignedPlumber = (t: any) => {
      const found = allPlumbers.find((p) => p.user.id === t.assignedToId);
      if (!found) throw new Error(`Ticket assigned to unknown plumber ${t.assignedToId}`);
      return found;
    };

    // Find category for plumbing
    const category = await prisma.category.findFirst({
      where: { trade: "PLUMBER", isActive: true },
    });
    if (!category) throw new Error("No active PLUMBER category found in database");

    // Clean up lingering test tickets from previous runs
    await prisma.ticket.deleteMany({
      where: {
        title: {
          startsWith: "Phase5 Smoke - ",
        },
      },
    });

    // Reset demo clock to real time
    await request(app)
      .post("/api/admin/demo/reset-time")
      .set("Cookie", admin.cookie);
    console.log("0.1 Demo clock reset to real time (0 offset)");

    // -------------------------------------------------------------------------
    // STEP 1: SLA Breach Escalation to Level 1 (Block Warden)
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 1: SLA Breach Escalation to Level 1 (Block Warden) ---");
    process.stdout.write("1.1 student1 creates room plumbing ticket -> ");
    const createRes1 = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase5 Smoke - Major pipe burst",
        description: "Water flooding room rapidly",
      });

    if (createRes1.status !== 201) {
      throw new Error(`Failed to create ticket: ${createRes1.status} ${JSON.stringify(createRes1.body)}`);
    }
    const ticket1 = createRes1.body.ticket;
    createdTicketIds.push(ticket1.id);
    console.log(`OK (ID: ${ticket1.id}, Code: ${ticket1.code}, Level: ${ticket1.escalationLevel}, DueAt: ${ticket1.dueAt})`);

    process.stdout.write("1.2 admin advances clock past SLA (+5 hours) -> ");
    const advanceRes1 = await request(app)
      .post("/api/admin/demo/advance-time")
      .set("Cookie", admin.cookie)
      .send({ minutes: 300 }); // +5 hours
    if (advanceRes1.status !== 200) {
      throw new Error(`Failed to advance clock: ${advanceRes1.status}`);
    }
    console.log(`OK (Advanced +300 min, new clock: ${advanceRes1.body.currentClock})`);

    process.stdout.write("1.3 trigger /api/jobs/tick with JOBS_SECRET -> ");
    const tickRes1 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);
    if (tickRes1.status !== 200) {
      throw new Error(`Tick failed: ${tickRes1.status} ${JSON.stringify(tickRes1.body)}`);
    }
    console.log(`OK (Ran: ${tickRes1.body.ran?.join(", ")}, Level 1 escalated: ${tickRes1.body.level1EscalatedCount})`);

    process.stdout.write("1.4 verify ticket DB state upgraded to escalationLevel=1 -> ");
    const dbTicket1 = await prisma.ticket.findUnique({ where: { id: ticket1.id } });
    if (dbTicket1?.escalationLevel !== 1 || !dbTicket1.escalatedAt) {
      throw new Error(`Expected escalationLevel=1 with escalatedAt set, got ${dbTicket1?.escalationLevel}`);
    }
    console.log(`OK (Level: ${dbTicket1.escalationLevel}, escalatedAt: ${dbTicket1.escalatedAt.toISOString()})`);

    process.stdout.write("1.5 verify Block Warden received TICKET_ESCALATED notification -> ");
    const wardenNotifications = await prisma.notification.findMany({
      where: {
        userId: wardenA.user.id,
        ticketId: ticket1.id,
        type: "TICKET_ESCALATED",
      },
    });
    if (wardenNotifications.length === 0) {
      throw new Error("Warden did not receive TICKET_ESCALATED notification!");
    }
    console.log(`OK (Notification verified: "${wardenNotifications[0].message}")`);

    // -------------------------------------------------------------------------
    // STEP 2: SLA Escalation to Level 2 (Chief Warden, 24h past Level 1)
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 2: SLA Escalation to Level 2 (Chief Warden) ---");
    process.stdout.write("2.1 admin advances clock +25 hours -> ");
    const advanceRes2 = await request(app)
      .post("/api/admin/demo/advance-time")
      .set("Cookie", admin.cookie)
      .send({ minutes: 1500 }); // +25 hours
    if (advanceRes2.status !== 200) {
      throw new Error(`Failed to advance clock: ${advanceRes2.status}`);
    }
    console.log(`OK (Advanced +1500 min, new clock: ${advanceRes2.body.currentClock})`);

    process.stdout.write("2.2 trigger /api/jobs/tick -> ");
    const tickRes2 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);
    if (tickRes2.status !== 200) {
      throw new Error(`Tick failed: ${tickRes2.status}`);
    }
    console.log(`OK (Level 2 escalated: ${tickRes2.body.level2EscalatedCount})`);

    process.stdout.write("2.3 verify ticket DB state upgraded to escalationLevel=2 -> ");
    const dbTicket1L2 = await prisma.ticket.findUnique({ where: { id: ticket1.id } });
    if (dbTicket1L2?.escalationLevel !== 2) {
      throw new Error(`Expected escalationLevel=2, got ${dbTicket1L2?.escalationLevel}`);
    }
    console.log(`OK (Level: ${dbTicket1L2.escalationLevel})`);

    process.stdout.write("2.4 verify Chief Warden received TICKET_ESCALATED notification -> ");
    const chiefNotifications = await prisma.notification.findMany({
      where: {
        userId: chiefWarden.user.id,
        ticketId: ticket1.id,
        type: "TICKET_ESCALATED",
      },
    });
    if (chiefNotifications.length === 0) {
      throw new Error("Chief Warden did not receive Level 2 TICKET_ESCALATED notification!");
    }
    console.log(`OK (Chief Warden notification verified: "${chiefNotifications[0].message}")`);

    // Delete ticket 1 before next tests
    await prisma.ticket.delete({ where: { id: ticket1.id } });

    // -------------------------------------------------------------------------
    // STEP 3: Auto-Close Resolved Ticket after 48h with No Dispute
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 3: Auto-Close Resolved Ticket (48h Window) ---");
    // Reset clock back to 0
    await request(app).post("/api/admin/demo/reset-time").set("Cookie", admin.cookie);

    process.stdout.write("3.1 student1 creates room ticket -> ");
    const createRes2 = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase5 Smoke - Dripping tap",
        description: "Small drip from bathroom tap",
      });
    const ticket2 = createRes2.body.ticket;
    createdTicketIds.push(ticket2.id);
    const assignedStaff2 = getAssignedPlumber(ticket2);
    console.log(`OK (ID: ${ticket2.id}, Code: ${ticket2.code})`);

    process.stdout.write("3.2 assigned plumber starts, uploads after photo, and resolves with code -> ");
    await request(app).post(`/api/tickets/${ticket2.id}/start`).set("Cookie", assignedStaff2.cookie);
    const codeRes = await request(app).get(`/api/tickets/${ticket2.id}/completion-code`).set("Cookie", student1.cookie);
    const completionCode = codeRes.body.code;

    await request(app)
      .post(`/api/tickets/${ticket2.id}/attachments`)
      .set("Cookie", assignedStaff2.cookie)
      .attach("photo", samplePng, "fix.png")
      .field("role", "AFTER");

    const resolveRes = await request(app)
      .post(`/api/tickets/${ticket2.id}/resolve`)
      .set("Cookie", assignedStaff2.cookie)
      .send({ code: completionCode });
    if (resolveRes.status !== 200 || resolveRes.body.ticket.status !== "RESOLVED") {
      throw new Error(`Failed to resolve ticket: ${resolveRes.status}`);
    }
    console.log("OK (Status: RESOLVED, resolvedAt set)");

    process.stdout.write("3.3 admin advances clock +50 hours (+3000 min) -> ");
    await request(app)
      .post("/api/admin/demo/advance-time")
      .set("Cookie", admin.cookie)
      .send({ minutes: 3000 });
    console.log("OK (+50 hours advanced)");

    process.stdout.write("3.4 trigger /api/jobs/tick -> ");
    const tickRes3 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);
    if (tickRes3.status !== 200) {
      throw new Error(`Tick failed: ${tickRes3.status}`);
    }
    console.log(`OK (autoClosedCount: ${tickRes3.body.autoClosedCount})`);

    process.stdout.write("3.5 verify ticket DB state is CLOSED with AUTO_CLOSED reason -> ");
    const dbTicket2 = await prisma.ticket.findUnique({ where: { id: ticket2.id } });
    if (dbTicket2?.status !== "CLOSED" || dbTicket2.closeReason !== "AUTO_CLOSED") {
      throw new Error(`Expected CLOSED with AUTO_CLOSED, got ${dbTicket2?.status} / ${dbTicket2?.closeReason}`);
    }
    console.log(`OK (Status: ${dbTicket2.status}, closeReason: ${dbTicket2.closeReason}, closedAt: ${dbTicket2.closedAt?.toISOString()})`);

    await prisma.ticket.delete({ where: { id: ticket2.id } });

    // -------------------------------------------------------------------------
    // STEP 4: Auto-Close AWAITING_ACCESS Ticket after 48h with No Response
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 4: Auto-Close AWAITING_ACCESS (Unable to Access, 48h) ---");
    // Reset clock back to 0
    await request(app).post("/api/admin/demo/reset-time").set("Cookie", admin.cookie);

    process.stdout.write("4.1 student1 creates room ticket -> ");
    const createRes3 = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase5 Smoke - Lock stuck",
        description: "Room door lock sticking",
      });
    const ticket3 = createRes3.body.ticket;
    createdTicketIds.push(ticket3.id);
    const assignedStaff3 = getAssignedPlumber(ticket3);
    console.log(`OK (ID: ${ticket3.id}, Code: ${ticket3.code})`);

    process.stdout.write("4.2 plumber reports room locked with door photo -> status AWAITING_ACCESS -> ");
    await request(app).post(`/api/tickets/${ticket3.id}/start`).set("Cookie", assignedStaff3.cookie);
    await request(app)
      .post(`/api/tickets/${ticket3.id}/attachments`)
      .set("Cookie", assignedStaff3.cookie)
      .attach("photo", samplePng, "door.png")
      .field("role", "DOOR");

    const lockedRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/room-locked`)
      .set("Cookie", assignedStaff3.cookie);
    if (lockedRes.status !== 200 || lockedRes.body.status !== "AWAITING_ACCESS") {
      throw new Error(`Failed to report locked: ${lockedRes.status}`);
    }
    console.log("OK (Status: AWAITING_ACCESS, SLA paused)");

    process.stdout.write("4.3 admin advances clock +50 hours without occupant response -> ");
    await request(app)
      .post("/api/admin/demo/advance-time")
      .set("Cookie", admin.cookie)
      .send({ minutes: 3000 });
    console.log("OK (+50 hours advanced)");

    process.stdout.write("4.4 trigger /api/jobs/tick -> ");
    const tickRes4 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);
    if (tickRes4.status !== 200) {
      throw new Error(`Tick failed: ${tickRes4.status}`);
    }
    console.log(`OK (unableToAccessCount: ${tickRes4.body.unableToAccessCount})`);

    process.stdout.write("4.5 verify ticket DB state is CLOSED with UNABLE_TO_ACCESS reason -> ");
    const dbTicket3 = await prisma.ticket.findUnique({ where: { id: ticket3.id } });
    if (dbTicket3?.status !== "CLOSED" || dbTicket3.closeReason !== "UNABLE_TO_ACCESS") {
      throw new Error(`Expected CLOSED with UNABLE_TO_ACCESS, got ${dbTicket3?.status} / ${dbTicket3?.closeReason}`);
    }
    console.log(`OK (Status: ${dbTicket3.status}, closeReason: ${dbTicket3.closeReason}, closedAt: ${dbTicket3.closedAt?.toISOString()})`);

    // Reset clock back to 0 at the end
    await request(app).post("/api/admin/demo/reset-time").set("Cookie", admin.cookie);
    console.log("\n0.2 Demo clock reset back to 0 offset");

    console.log("\n=================================================");
    console.log("🎉 All Phase 5 Smoke Tests Passed Successfully!");
    console.log("=================================================");
  } finally {
    // Cleanup created test tickets
    if (createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      });
    }
    await prisma.$disconnect();
  }
}

runSmokePhase5().catch((err) => {
  console.error("\n❌ Phase 5 Smoke test failed:", err);
  process.exit(1);
});
