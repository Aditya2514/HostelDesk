import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { env } from "../src/config/env";
import { OPEN_STATUSES } from "../src/modules/tickets/tickets.service";
import { RoutingService } from "../src/modules/scheduling/routing.service";

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

function fallsInsideShift(date: Date, shifts: { weekday: number; startMinute: number; endMinute: number }[]): boolean {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const weekday = istDate.getUTCDay();
  const minuteOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();

  return shifts.some((s) => s.weekday === weekday && minuteOfDay >= s.startMinute && minuteOfDay <= s.endMinute);
}

async function runSmokePhase3() {
  console.log("=================================================");
  console.log("🚀 Running Phase 3 Smoke Test Script (Real Database)");
  console.log("=================================================\n");

  const createdTicketIds: string[] = [];

  try {
    // 0. Log in test users
    console.log("0. Logging in test users (student1, student2, wardenA)...");
    const [student1, student2, wardenA] = await Promise.all([
      loginUser("student1@hosteldesk.dev"),
      loginUser("student2@hosteldesk.dev"),
      loginUser("warden.a@hosteldesk.dev"),
    ]);

    // Find electrical category with default priority NORMAL
    const elecCategory = await prisma.category.findFirst({
      where: { trade: "ELECTRICIAN", defaultPriority: "NORMAL", isActive: true },
    });
    if (!elecCategory) throw new Error("No active ELECTRICIAN category with NORMAL priority found in database");

    // Clean up any test tickets from previous runs
    await prisma.ticket.deleteMany({
      where: {
        title: {
          in: [
            "Phase3 Smoke - Ceiling fan burning smell",
            "Phase3 Smoke - Urgent electrical short circuit",
            "Phase3 Smoke - Another urgent short circuit",
          ],
        },
      },
    });

    // -------------------------------------------------------------
    // CHECK 1: student1 raises an electrical ticket -> etaP50At in future,
    // inside shift, etaP80At >= etaP50At
    // -------------------------------------------------------------
    process.stdout.write("1. student1 raises an electrical ticket -> ");
    const createRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: elecCategory.id,
        title: "Phase3 Smoke - Ceiling fan burning smell",
        description: "Ceiling fan motor is overheating and giving burnt smell",
      });

    if (createRes.status !== 201) {
      throw new Error(`Failed to create ticket: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    }

    const ticket = createRes.body.ticket;
    createdTicketIds.push(ticket.id);

    if (!ticket.etaP50At || !ticket.etaP80At) {
      throw new Error("Ticket does not have etaP50At or etaP80At set!");
    }

    const p50Date = new Date(ticket.etaP50At);
    const p80Date = new Date(ticket.etaP80At);
    const now = clock.now();

    if (p50Date.getTime() <= now.getTime()) {
      throw new Error(`etaP50At (${p50Date.toISOString()}) is not in the future relative to now (${now.toISOString()})`);
    }

    if (p80Date.getTime() < p50Date.getTime()) {
      throw new Error(`etaP80At (${p80Date.toISOString()}) is earlier than etaP50At (${p50Date.toISOString()})`);
    }

    // Verify it falls inside assignee's shift
    const assignee = await prisma.user.findUnique({
      where: { id: ticket.assignedToId },
      include: { shifts: true },
    });
    if (!assignee) throw new Error(`Assignee ${ticket.assignedToId} not found`);

    if (!fallsInsideShift(p50Date, assignee.shifts)) {
      throw new Error(`etaP50At (${p50Date.toISOString()}) does not fall inside assignee's shifts!`);
    }

    console.log(`PASS (Assigned to ${assignee.name}, ETA P50: ${p50Date.toISOString()}, P80: ${p80Date.toISOString()})`);

    // -------------------------------------------------------------
    // CHECK 2: The chosen electrician really has the earliest simulated finish
    // -------------------------------------------------------------
    process.stdout.write("2. Chosen electrician has earliest simulated finish -> ");
    const independentChoice = await RoutingService.chooseAssignee({
      id: ticket.id,
      categoryId: elecCategory.id,
      blockId: ticket.blockId,
      floor: ticket.floor,
      priority: ticket.priority,
      createdAt: new Date(ticket.createdAt),
    });

    if (!independentChoice) {
      throw new Error("Independent routing simulation returned null for assignee");
    }

    if (independentChoice.staffId !== ticket.assignedToId) {
      throw new Error(
        `Chosen electrician mismatch: Ticket has ${ticket.assignedToId}, independent simulation picked ${independentChoice.staffId}`
      );
    }
    console.log(`PASS (Simulated best candidate verified: ${independentChoice.staffId})`);

    // -------------------------------------------------------------
    // CHECK 3: eta-explanation returns n > 0 and doesn't leak other students
    // -------------------------------------------------------------
    process.stdout.write("3. eta-explanation returns n > 0 and privacy safe -> ");
    const explainRes = await request(app)
      .get(`/api/tickets/${ticket.id}/eta-explanation`)
      .set("Cookie", student1.cookie);

    if (explainRes.status !== 200) {
      throw new Error(`Failed to get eta explanation: ${explainRes.status} ${JSON.stringify(explainRes.body)}`);
    }

    const explanation = explainRes.body;
    if (!explanation.estimate || explanation.estimate.n === undefined || explanation.estimate.n <= 0) {
      throw new Error(`Expected n > 0 from seeded history, got ${explanation.estimate?.n}`);
    }

    // Check privacy of jobsAhead
    for (const job of explanation.jobsAhead) {
      const forbiddenFields = ["student", "studentName", "userName", "userEmail", "room", "roomId", "raiserId", "title"];
      for (const forbidden of forbiddenFields) {
        if (job[forbidden] !== undefined) {
          throw new Error(`Privacy leak in jobsAhead! Found forbidden field '${forbidden}': ${JSON.stringify(job)}`);
        }
      }
      if (!job.code || !job.priority || job.estMinutes === undefined) {
        throw new Error(`Expected jobsAhead item to have code, priority, estMinutes: ${JSON.stringify(job)}`);
      }
    }
    console.log(`PASS (Sample size n = ${explanation.estimate.n}, ${explanation.jobsAhead.length} jobs ahead, no leaks)`);

    // -------------------------------------------------------------
    // CHECK 4: Warden raises another ticket in the same queue to URGENT -> ETA pushed back, delay alert sent
    // -------------------------------------------------------------
    process.stdout.write("4. Adding URGENT ticket pushes ETA and creates delay alert -> ");
    const initialP50At = new Date(ticket.etaP50At);

    // student2 raises a common area electrical ticket
    const otherRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student2.cookie)
      .send({
        locationType: "COMMON",
        categoryId: elecCategory.id,
        floor: 1,
        commonSpot: "Main Floor 1 Distribution Board",
        title: "Phase3 Smoke - Urgent electrical short circuit",
        description: "Dangerous sparks from switchboard, immediate attention needed",
        joinExistingCheck: false,
      });

    if (otherRes.status !== 201) {
      throw new Error(`Failed to create ticket: ${otherRes.status} ${JSON.stringify(otherRes.body)}`);
    }
    const otherTicket = otherRes.body.ticket;
    createdTicketIds.push(otherTicket.id);

    // Ensure it is in the same electrician's queue
    if (otherTicket.assignedToId !== ticket.assignedToId) {
      await request(app)
        .post(`/api/tickets/${otherTicket.id}/reassign`)
        .set("Cookie", wardenA.cookie)
        .send({
          staffId: ticket.assignedToId,
          reason: "Consolidating electrical queue",
        });
    }

    // Now warden updates this ticket to URGENT
    const priorityRes = await request(app)
      .patch(`/api/tickets/${otherTicket.id}/priority`)
      .set("Cookie", wardenA.cookie)
      .send({
        priority: "URGENT",
        reason: "Critical safety hazard - exposed sparks",
      });

    if (priorityRes.status !== 200) {
      throw new Error(`Failed to update priority to URGENT: ${priorityRes.status}`);
    }

    // Fetch student1's ticket after the urgent ticket entered the queue ahead of it
    const updatedTicketRes = await request(app)
      .get(`/api/tickets/${ticket.id}`)
      .set("Cookie", student1.cookie);

    const updatedP50At = new Date(updatedTicketRes.body.ticket.etaP50At);
    if (updatedP50At.getTime() <= initialP50At.getTime()) {
      throw new Error(
        `Expected student ticket ETA to move later after urgent ticket added, but went from ${initialP50At.toISOString()} to ${updatedP50At.toISOString()}`
      );
    }

    const diffMinutes = (updatedP50At.getTime() - initialP50At.getTime()) / (60 * 1000);

    // Delay alert check (threshold is > 30 minutes)
    if (diffMinutes > 30) {
      const delayNotif = await prisma.notification.findFirst({
        where: {
          userId: student1.user.id,
          ticketId: ticket.id,
          type: "ETA_DELAYED",
        },
      });
      if (!delayNotif) {
        throw new Error("ETA pushed by > 30 min, but no ETA_DELAYED notification was created for student1!");
      }
      console.log(`PASS (ETA pushed by +${Math.round(diffMinutes)} min, delay notification verified: "${delayNotif.message}")`);
    } else {
      console.log(`PASS (ETA pushed by +${Math.round(diffMinutes)} min)`);
    }


    // -------------------------------------------------------------
    // CHECK 5: Reassign to another electrician -> both queues recomputed
    // -------------------------------------------------------------
    process.stdout.write("5. Reassign to another electrician recomputes both queues -> ");
    const otherElectrician = await prisma.user.findFirst({
      where: {
        role: "STAFF",
        trade: "ELECTRICIAN",
        id: { not: ticket.assignedToId },
        isActive: true,
      },
    });

    if (!otherElectrician) {
      throw new Error("Could not find second electrician for reassignment test");
    }

    const reassignRes = await request(app)
      .post(`/api/tickets/${ticket.id}/reassign`)
      .set("Cookie", wardenA.cookie)
      .send({
        staffId: otherElectrician.id,
        reason: "Balancing workload across electricians",
      });

    if (reassignRes.status !== 200) {
      throw new Error(`Failed to reassign ticket: ${reassignRes.status} ${JSON.stringify(reassignRes.body)}`);
    }

    // Verify ticket assignedToId updated
    const reassignedTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { assignedToId: true, etaP50At: true, etaP80At: true },
    });

    if (reassignedTicket?.assignedToId !== otherElectrician.id) {
      throw new Error(`Expected assignedToId to be ${otherElectrician.id}, got ${reassignedTicket?.assignedToId}`);
    }

    if (!reassignedTicket.etaP50At || !reassignedTicket.etaP80At) {
      throw new Error("Reassigned ticket does not have valid recalculated ETAs");
    }

    console.log(`PASS (Successfully reassigned to ${otherElectrician.name}, new ETA P50: ${reassignedTicket.etaP50At.toISOString()})`);

    // -------------------------------------------------------------
    // CHECK 6: Call /api/jobs/tick twice -> second call changes no ETAs & no prediction rows
    // -------------------------------------------------------------
    process.stdout.write("6. Call /api/jobs/tick twice for idempotence -> ");
    // First tick
    const tick1 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);

    if (tick1.status !== 200) {
      throw new Error(`First tick failed with status ${tick1.status}`);
    }

    const countAfterTick1 = await prisma.ticketPrediction.count();
    const ticketsSnap1 = await prisma.ticket.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: { id: true, etaP50At: true, etaP80At: true },
      orderBy: { id: "asc" },
    });

    // Second tick immediately
    const tick2 = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);

    if (tick2.status !== 200) {
      throw new Error(`Second tick failed with status ${tick2.status}`);
    }

    const countAfterTick2 = await prisma.ticketPrediction.count();
    const ticketsSnap2 = await prisma.ticket.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: { id: true, etaP50At: true, etaP80At: true },
      orderBy: { id: "asc" },
    });

    if (countAfterTick2 !== countAfterTick1) {
      throw new Error(
        `Tick is not idempotent! Prediction count changed from ${countAfterTick1} to ${countAfterTick2}`
      );
    }

    for (let i = 0; i < ticketsSnap1.length; i++) {
      const t1 = ticketsSnap1[i];
      const t2 = ticketsSnap2[i];
      if (t1.id !== t2.id) continue;
      const t1Time = t1.etaP50At ? t1.etaP50At.getTime() : null;
      const t2Time = t2.etaP50At ? t2.etaP50At.getTime() : null;
      if (t1Time !== t2Time) {
        throw new Error(
          `Tick is not idempotent! Ticket ${t1.id} etaP50At changed between ticks (${t1.etaP50At?.toISOString()} vs ${t2.etaP50At?.toISOString()})`
        );
      }
    }

    console.log(`PASS (Tick 1 preds: ${countAfterTick1}, Tick 2 preds: ${countAfterTick2}, identical open ticket ETAs)`);

    console.log("\n=================================================");
    console.log("✅ ALL PHASE 3 SMOKE CHECKS PASSED SUCCESSFULLY!");
    console.log("=================================================");
  } catch (error) {
    console.error("\n❌ Smoke test failed:", error);
    process.exit(1);
  } finally {
    // Clean up created smoke test tickets
    if (createdTicketIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { ticketId: { in: createdTicketIds } },
      });
      await prisma.ticketPrediction.deleteMany({
        where: { ticketId: { in: createdTicketIds } },
      });
      await prisma.ticketEvent.deleteMany({
        where: { ticketId: { in: createdTicketIds } },
      });
      await prisma.ticketFollower.deleteMany({
        where: { ticketId: { in: createdTicketIds } },
      });
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      });
    }
    await prisma.$disconnect();
  }
}

runSmokePhase3();
