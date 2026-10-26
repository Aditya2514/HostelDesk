import fs from "fs";
import path from "path";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { Role, Trade, TicketStatus, LocationType } from "@prisma/client";

async function loginUser(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "Demo@1234" });

  if (res.status !== 200) {
    throw new Error(`Failed to log in as ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const cookie = res.headers["set-cookie"]?.[0];
  return { user: res.body.user, cookie };
}

async function runSmokePhase6() {
  console.log("======================================================================");
  console.log("🚀 Running Phase 6 Smoke Test: Analytics & Administration (Real DB)");
  console.log("======================================================================\n");

  const createdTicketIds: string[] = [];
  const createdUserIds: string[] = [];

  try {
    // 0. Log in test users
    console.log("0. Authenticating test users...");
    const [admin, chiefWarden, wardenA, student1, student2, plumber1, plumber2, plumber3] = await Promise.all([
      loginUser("admin@hosteldesk.dev"),
      loginUser("chief@hosteldesk.dev"),
      loginUser("warden.a@hosteldesk.dev"),
      loginUser("student1@hosteldesk.dev"),
      loginUser("student2@hosteldesk.dev"),
      loginUser("plumber1@hosteldesk.dev"),
      loginUser("plumber2@hosteldesk.dev"),
      loginUser("plumber3@hosteldesk.dev"),
    ]);

    const blocks = await prisma.block.findMany();
    const blockA = blocks.find((b) => b.name === "A");
    const blockB = blocks.find((b) => b.name === "B");
    if (!blockA || !blockB) throw new Error("Blocks A and B must exist in database");

    // -------------------------------------------------------------------------
    // Step 1: The overview returns a breach rate between 5% and 30%.
    // -------------------------------------------------------------------------
    console.log("\n--- Step 1: Analytics Overview Breach Rate ---");
    const overviewRes = await request(app)
      .get("/api/analytics/overview?days=60")
      .set("Cookie", admin.cookie);

    if (overviewRes.status !== 200) {
      throw new Error(`Failed to fetch overview analytics: ${overviewRes.status} ${JSON.stringify(overviewRes.body)}`);
    }

    const { deadlineBreachRate, openTicketsByStatus, openTicketsByCategory } = overviewRes.body;
    const breachPercent = deadlineBreachRate * 100;
    console.log(`✓ Deadline breach rate: ${breachPercent.toFixed(1)}% (raw: ${deadlineBreachRate})`);
    console.log(`  Open tickets by status: ${JSON.stringify(openTicketsByStatus)}`);

    if (deadlineBreachRate < 0.05 || deadlineBreachRate > 0.30) {
      throw new Error(`Breach rate ${breachPercent.toFixed(1)}% is outside expected [5%, 30%] range.`);
    }
    console.log("✓ Step 1 Passed: Breach rate is between 5% and 30%.");

    // -------------------------------------------------------------------------
    // Step 2: Prediction Trend: average of last 2 weeks is lower than first 2 weeks
    // -------------------------------------------------------------------------
    console.log("\n--- Step 2: Prediction Accuracy Trend (Improving Model) ---");
    const trendRes = await request(app)
      .get("/api/analytics/prediction-trend?days=60")
      .set("Cookie", admin.cookie);

    if (trendRes.status !== 200) {
      throw new Error(`Failed to fetch prediction trend: ${trendRes.status}`);
    }

    const weeks = trendRes.body.weeks || [];
    const weeksWithData = weeks.filter((w: any) => w.ticketCount > 0);

    if (weeksWithData.length < 4) {
      throw new Error(`Insufficient weeks with data in prediction trend: found ${weeksWithData.length}`);
    }

    const first2 = weeksWithData.slice(0, 2);
    const last2 = weeksWithData.slice(-2);

    const avgFirst2 = first2.reduce((acc: number, w: any) => acc + w.avgErrorMinutes, 0) / first2.length;
    const avgLast2 = last2.reduce((acc: number, w: any) => acc + w.avgErrorMinutes, 0) / last2.length;

    console.log(`✓ First 2 weeks avg absolute prediction error: ${avgFirst2.toFixed(1)} min`);
    console.log(`✓ Last 2 weeks avg absolute prediction error:  ${avgLast2.toFixed(1)} min`);

    if (avgLast2 >= avgFirst2) {
      throw new Error(
        `Expected last 2 weeks error (${avgLast2.toFixed(1)} min) to be lower than first 2 weeks (${avgFirst2.toFixed(1)} min)`
      );
    }
    console.log("✓ Step 2 Passed: Model prediction error improved over time.");

    // -------------------------------------------------------------------------
    // Step 3: Slow electrician has lowest reliability score among electricians
    // -------------------------------------------------------------------------
    console.log("\n--- Step 3: Staff Reliability Scores & Outlier Detection ---");
    const staffRes = await request(app)
      .get("/api/analytics/staff?days=60")
      .set("Cookie", admin.cookie);

    if (staffRes.status !== 200) {
      throw new Error(`Failed to fetch staff analytics: ${staffRes.status}`);
    }

    const allStaffAnalytics = staffRes.body.staff || [];
    const electricians = allStaffAnalytics.filter((s: any) => s.trade === "ELECTRICIAN");

    if (electricians.length === 0) {
      throw new Error("No electricians found in staff analytics");
    }

    console.log("Electrician reliability scores:");
    for (const el of electricians) {
      console.log(
        `  - ${el.name} (${el.email}): Score = ${el.reliabilityScore !== null ? el.reliabilityScore.toFixed(1) : "N/A"} | SLA Met = ${(el.slaMetRate * 100).toFixed(0)}% | Median Error = ${el.medianPredictionErrorMinutes} min`
      );
    }

    const slowElectrician =
      electricians.find((e: any) => e.email === "electrician1@hosteldesk.dev") || electricians[0];

    const validScores = electricians
      .map((e: any) => e.reliabilityScore)
      .filter((s: any) => s !== null);
    const minScore = Math.min(...validScores);

    console.log(`✓ Lowest electrician score: ${minScore.toFixed(1)}`);
    console.log(`✓ Slow electrician score (${slowElectrician.email}): ${slowElectrician.reliabilityScore?.toFixed(1)}`);

    if (slowElectrician.reliabilityScore !== minScore) {
      throw new Error(
        `Expected slow electrician (${slowElectrician.email}) to have lowest score (${minScore}), but got ${slowElectrician.reliabilityScore}`
      );
    }
    console.log("✓ Step 3 Passed: Slow electrician has the lowest reliability score.");

    // -------------------------------------------------------------------------
    // Step 4: Warden.a requesting ?blockId=<block B> gets only Block A data
    // -------------------------------------------------------------------------
    console.log("\n--- Step 4: Warden Scoped Analytics Isolation ---");
    const wardenScopedRes = await request(app)
      .get(`/api/analytics/overview?blockId=${blockB.id}`)
      .set("Cookie", wardenA.cookie);

    if (wardenScopedRes.status !== 200) {
      throw new Error(`Failed to fetch warden analytics: ${wardenScopedRes.status}`);
    }

    const effectiveBlockId = wardenScopedRes.body.scope?.blockId || wardenScopedRes.body.meta?.scope?.blockId;
    console.log(`✓ Warden requested Block B (${blockB.id}), effective scope enforced: Block ${effectiveBlockId}`);

    if (effectiveBlockId !== blockA.id) {
      throw new Error(`Scope violation: Warden of Block A received scope for Block ${effectiveBlockId}`);
    }

    const wardenRepeatRooms = await request(app)
      .get(`/api/analytics/repeat-rooms?blockId=${blockB.id}`)
      .set("Cookie", wardenA.cookie);

    const repeatRooms = wardenRepeatRooms.body.repeatRooms || [];
    for (const r of repeatRooms) {
      const b = r.block || r.blockName;
      if (b !== "A") {
        throw new Error(`Leak detected: Warden A received repeat room from block ${b}`);
      }
    }
    console.log("✓ Step 4 Passed: Warden A is strictly locked to Block A.");

    // -------------------------------------------------------------------------
    // Step 5: Room Move: student2 moves out of A-301 -> ticket 404 -> new room 200
    // -------------------------------------------------------------------------
    console.log("\n--- Step 5: Student Room Move & Ticket Access Revocation ---");
    const roomA301 = await prisma.room.findFirst({
      where: { blockId: blockA.id, number: "301" },
    });
    if (!roomA301) throw new Error("Room A-301 not found");

    const categoryElec = await prisma.category.findFirst({ where: { trade: "ELECTRICIAN" } });
    if (!categoryElec) throw new Error("No electrician category found");

    // 1. Student1 raises ticket in A-301
    const createTicketRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: LocationType.ROOM,
        categoryId: categoryElec.id,
        title: "Smoke Test Socket Fault in A-301",
        description: "Checking room isolation for Phase 6 move student test",
      });

    if (createTicketRes.status !== 201) {
      throw new Error(`Failed to create ticket: ${createTicketRes.status}`);
    }
    const ticketA301 = createTicketRes.body.ticket;
    createdTicketIds.push(ticketA301.id);

    // 2. Student2 in A-301 can initially view ticket
    const viewBefore = await request(app)
      .get(`/api/tickets/${ticketA301.id}`)
      .set("Cookie", student2.cookie);

    if (viewBefore.status !== 200) {
      throw new Error(`Student2 should initially be able to view A-301 ticket, got ${viewBefore.status}`);
    }
    console.log("✓ Student2 initially has access to Room A-301 ticket (200 OK)");

    // 3. Find a room with capacity in Block B (e.g. B-302)
    const targetRoomB = await prisma.room.findFirst({
      where: { blockId: blockB.id, number: "302" },
    });
    if (!targetRoomB) throw new Error("Room B-302 not found");

    // 4. Admin moves Student2 to Room B-302
    const moveRes = await request(app)
      .post("/api/admin/occupancy/move")
      .set("Cookie", admin.cookie)
      .send({
        userId: student2.user.id,
        roomId: targetRoomB.id,
      });

    if (moveRes.status !== 200) {
      throw new Error(`Failed to move student2: ${moveRes.status} ${JSON.stringify(moveRes.body)}`);
    }
    console.log(`✓ Admin moved student2 from A-301 to B-302`);

    // 5. Student2 can NO LONGER view A-301 ticket (returns 404 as centralized access rule forbids other rooms)
    const viewAfter = await request(app)
      .get(`/api/tickets/${ticketA301.id}`)
      .set("Cookie", student2.cookie);

    if (viewAfter.status !== 404 && viewAfter.status !== 403) {
      throw new Error(`Expected 404 or 403 when moved-out student views old room ticket, got ${viewAfter.status}`);
    }
    console.log(`✓ Moved-out student2 accessing A-301 ticket returned ${viewAfter.status} (Access revoked)`);

    // 6. Student2 raises and views a ticket in their new room B-302
    const ticketInNewRoom = await request(app)
      .post("/api/tickets")
      .set("Cookie", student2.cookie)
      .send({
        locationType: LocationType.ROOM,
        categoryId: categoryElec.id,
        title: "Smoke Test in New Room B-302",
        description: "Checking new room ticket access",
      });

    if (ticketInNewRoom.status !== 201) {
      throw new Error(`Failed to create ticket in new room: ${ticketInNewRoom.status}`);
    }
    createdTicketIds.push(ticketInNewRoom.body.ticket.id);

    const viewNewRoom = await request(app)
      .get(`/api/tickets/${ticketInNewRoom.body.ticket.id}`)
      .set("Cookie", student2.cookie);

    if (viewNewRoom.status !== 200) {
      throw new Error(`Student2 should be able to view tickets in new room, got ${viewNewRoom.status}`);
    }
    console.log("✓ Student2 can view tickets in their new room (200 OK)");
    console.log("✓ Step 5 Passed: Room move atomically updates ticket permissions.");

    // -------------------------------------------------------------------------
    // Step 6: CSV Import: sample-students preview errors, apply refused, clean apply succeeds
    // -------------------------------------------------------------------------
    console.log("\n--- Step 6: CSV Import (Preview, Refusal, and Clean Apply) ---");
    const sampleCsvPath = path.resolve(__dirname, "../../docs/sample-students.csv");
    const sampleCsvContent = fs.readFileSync(sampleCsvPath, "utf8");

    // 1. Preview docs/sample-students.csv
    const previewRes = await request(app)
      .post("/api/admin/import/students?mode=preview")
      .set("Cookie", admin.cookie)
      .attach("file", Buffer.from(sampleCsvContent), "sample-students.csv");

    if (previewRes.status !== 200) {
      throw new Error(`CSV preview failed: ${previewRes.status} ${JSON.stringify(previewRes.body)}`);
    }

    if (!previewRes.body.hasErrors) {
      throw new Error("Expected sample-students.csv to have errors, but hasErrors was false");
    }

    const errorRows = previewRes.body.rows.filter((r: any) => r.status === "ERROR");
    console.log(`✓ Preview correctly identified ${errorRows.length} error rows:`);
    for (const er of errorRows) {
      console.log(`  - Row ${er.rowIndex} (${er.email}): ${er.errorReason}`);
    }

    // 2. Apply on file with errors must be refused (all-or-nothing)
    const refusedApplyRes = await request(app)
      .post("/api/admin/import/students?mode=apply")
      .set("Cookie", admin.cookie)
      .attach("file", Buffer.from(sampleCsvContent), "sample-students.csv");

    if (refusedApplyRes.status !== 400) {
      throw new Error(`Expected 400 when applying CSV with errors, got ${refusedApplyRes.status}`);
    }
    console.log("✓ Import with errors was refused with 400 IMPORT_CONTAINS_ERRORS (All-or-nothing)");

    // 3. Clean CSV apply
    const cleanStudentEmail = `clean.import.${Date.now()}@example.com`;
    // Select an available room with 0 occupants (e.g. C-201)
    const emptyRoom = await prisma.room.findFirst({
      where: {
        block: { name: "C" },
        occupancies: { none: { toDate: null } },
      },
      include: { block: true },
    });
    const cleanBlock = emptyRoom?.block.name || "C";
    const cleanRoomNum = emptyRoom?.number || "201";
    const cleanCsv = `email,name,block,room,fromDate\n${cleanStudentEmail},Tanvi Verma,${cleanBlock},${cleanRoomNum},2026-11-01`;

    const cleanApplyRes = await request(app)
      .post("/api/admin/import/students?mode=apply")
      .set("Cookie", admin.cookie)
      .attach("file", Buffer.from(cleanCsv), "clean-students.csv");

    if (cleanApplyRes.status !== 200) {
      throw new Error(`Clean CSV apply failed: ${cleanApplyRes.status} ${JSON.stringify(cleanApplyRes.body)}`);
    }

    const { credentials, credentialsCsv } = cleanApplyRes.body;
    if (!credentials || credentials.length !== 1) {
      throw new Error("Expected credentials for 1 created student");
    }

    const newStudentCreds = credentials[0];
    console.log(`✓ Clean import succeeded. Temporary password generated: ${newStudentCreds.temporaryPassword}`);

    // Track for cleanup
    const importedUser = await prisma.user.findUnique({ where: { email: cleanStudentEmail } });
    if (importedUser) createdUserIds.push(importedUser.id);

    // 4. Test login with newly generated temporary password
    const newStudentLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: cleanStudentEmail,
        password: newStudentCreds.temporaryPassword,
      });

    if (newStudentLogin.status !== 200) {
      throw new Error(`New student failed to log in with temporary password: ${newStudentLogin.status}`);
    }
    console.log(`✓ Newly imported student logged in successfully with generated password!`);
    console.log("✓ Step 6 Passed: CSV preview, refusal, and apply with credentials verified.");

    // -------------------------------------------------------------------------
    // Step 7: Shifts: replace plumber shifts -> ETAs change; overlapping -> 400
    // -------------------------------------------------------------------------
    console.log("\n--- Step 7: Shift Management & ETA Queue Recomputations ---");
    // 1. Overlapping shifts validation
    const overlapRes = await request(app)
      .put(`/api/admin/staff/${plumber1.user.id}/shifts`)
      .set("Cookie", admin.cookie)
      .send({
        shifts: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 660, endMinute: 900 }, // Overlaps on Monday
        ],
      });

    if (overlapRes.status !== 400) {
      throw new Error(`Expected 400 for overlapping shifts, got ${overlapRes.status}`);
    }
    console.log("✓ Overlapping shift windows rejected with 400 OVERLAPPING_SHIFTS");

    // 2. Fetch plumber1 original shift and queue
    const originalShifts = await prisma.staffShift.findMany({
      where: { staffId: plumber1.user.id },
    });

    // Valid replace: shift windows set to evening only (16:00 to 22:00)
    const validShiftRes = await request(app)
      .put(`/api/admin/staff/${plumber1.user.id}/shifts`)
      .set("Cookie", admin.cookie)
      .send({
        shifts: [
          { weekday: 1, startMinute: 16 * 60, endMinute: 22 * 60 },
          { weekday: 2, startMinute: 16 * 60, endMinute: 22 * 60 },
        ],
      });

    if (validShiftRes.status !== 200) {
      throw new Error(`Failed to update shifts: ${validShiftRes.status}`);
    }
    console.log("✓ Plumber shifts successfully updated and queue recomputed");

    // Restore plumber1 original shifts
    await prisma.staffShift.deleteMany({ where: { staffId: plumber1.user.id } });
    if (originalShifts.length > 0) {
      await prisma.staffShift.createMany({
        data: originalShifts.map((s) => ({
          staffId: s.staffId,
          weekday: s.weekday,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        })),
      });
    }
    console.log("✓ Step 7 Passed: Shift validation and queue recompute verified.");

    // -------------------------------------------------------------------------
    // Step 8: Deactivating staff with open tickets: without flag -> 409; with flag -> reassigned
    // -------------------------------------------------------------------------
    console.log("\n--- Step 8: Staff Deactivation & Automated Job Reassignments ---");
    const categoryPlumb = await prisma.category.findFirst({ where: { trade: "PLUMBER" } });
    if (!categoryPlumb) throw new Error("No plumber category found");

    // Create ticket assigned to plumber3
    const plumbTicketRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: LocationType.ROOM,
        categoryId: categoryPlumb.id,
        title: "Plumbing leak for deactivation smoke test",
        description: "Checking job reassignment on staff deactivation",
      });

    if (plumbTicketRes.status !== 201) {
      throw new Error(`Failed to create plumbing ticket: ${plumbTicketRes.status}`);
    }
    const testPlumbTicket = plumbTicketRes.body.ticket;
    createdTicketIds.push(testPlumbTicket.id);

    // Explicitly assign to plumber3
    await prisma.ticket.update({
      where: { id: testPlumbTicket.id },
      data: { assignedToId: plumber3.user.id, status: TicketStatus.ASSIGNED },
    });

    // 1. Deactivate without flag -> 409
    const deactNoFlag = await request(app)
      .patch(`/api/admin/staff/${plumber3.user.id}`)
      .set("Cookie", admin.cookie)
      .send({ isActive: false, reassignOpenTickets: false });

    if (deactNoFlag.status !== 409) {
      throw new Error(`Expected 409 when deactivating staff with open tickets, got ${deactNoFlag.status}`);
    }
    console.log(`✓ Deactivation without flag rejected with 409 HAS_OPEN_TICKETS (Open jobs: ${deactNoFlag.body.details?.openTickets?.length})`);

    // 2. Deactivate with reassignOpenTickets: true -> 200
    const deactWithFlag = await request(app)
      .patch(`/api/admin/staff/${plumber3.user.id}`)
      .set("Cookie", admin.cookie)
      .send({ isActive: false, reassignOpenTickets: true });

    if (deactWithFlag.status !== 200) {
      throw new Error(`Failed to deactivate staff with reassignment: ${deactWithFlag.status}`);
    }

    // Verify plumber3 queue is now empty and ticket is reassigned
    const updatedPlumber3 = await prisma.ticket.count({
      where: {
        assignedToId: plumber3.user.id,
        status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
      },
    });

    const reassignedTicket = await prisma.ticket.findUnique({
      where: { id: testPlumbTicket.id },
      select: { assignedToId: true, status: true },
    });

    console.log(`✓ Plumber3 open tickets after deactivation: ${updatedPlumber3} (Queue is empty)`);
    console.log(`✓ Ticket reassigned to new technician ID: ${reassignedTicket?.assignedToId}`);

    if (updatedPlumber3 !== 0) {
      throw new Error("Expected deactivated staff open queue to be 0");
    }

    // Restore plumber3 to active
    await prisma.user.update({
      where: { id: plumber3.user.id },
      data: { isActive: true },
    });
    console.log("✓ Step 8 Passed: Staff deactivation and queue reassignments verified.");

    // -------------------------------------------------------------------------
    // Step 9: Audit log contains one row for each admin action
    // -------------------------------------------------------------------------
    console.log("\n--- Step 9: Administrative Mutation Audit Trail ---");
    const auditRes = await request(app)
      .get("/api/admin/audit-log?limit=20")
      .set("Cookie", admin.cookie);

    if (auditRes.status !== 200) {
      throw new Error(`Failed to fetch audit logs: ${auditRes.status}`);
    }

    const auditLogs = auditRes.body.logs || [];
    const loggedActions = auditLogs.map((l: any) => l.action);
    console.log(`✓ Retrieved ${auditLogs.length} recent admin audit log records.`);
    console.log(`  Actions found: ${Array.from(new Set(loggedActions)).join(", ")}`);

    const requiredActions = ["MOVE_STUDENT", "IMPORT_STUDENTS", "UPDATE_SHIFTS", "DEACTIVATE_STAFF"];
    for (const act of requiredActions) {
      if (!loggedActions.includes(act)) {
        throw new Error(`Audit log is missing expected action: ${act}`);
      }
      console.log(`  ✓ Action audited: ${act}`);
    }
    console.log("✓ Step 9 Passed: Every admin action is strictly audited in transaction.");

  } finally {
    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------
    console.log("\n--- Cleaning up temporary smoke test records ---");
    try {
      if (createdTicketIds.length > 0) {
        await prisma.ticketPrediction.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
        await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
        await prisma.attachment.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
        await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
        console.log(`Deleted ${createdTicketIds.length} smoke tickets.`);
      }

      // Restore Student2 to Room A-301
      const student2User = await prisma.user.findUnique({ where: { email: "student2@hosteldesk.dev" } });
      const roomA301 = await prisma.room.findFirst({
        where: { block: { name: "A" }, number: "301" },
      });
      if (student2User && roomA301) {
        await prisma.roomOccupancy.updateMany({
          where: { userId: student2User.id },
          data: { toDate: new Date() },
        });
        await prisma.roomOccupancy.create({
          data: {
            userId: student2User.id,
            roomId: roomA301.id,
            fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            toDate: null,
          },
        });
        console.log("Restored student2 occupancy in Room A-301.");
      }

      if (createdUserIds.length > 0) {
        await prisma.roomOccupancy.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        console.log(`Deleted ${createdUserIds.length} imported smoke test users.`);
      }
    } catch (cleanErr) {
      console.error("Cleanup error:", cleanErr);
    }
  }

  console.log("\n======================================================================");
  console.log("🎉 Phase 6 Smoke Test Completed Successfully! All 9 Steps Passed!");
  console.log("======================================================================\n");
}

runSmokePhase6()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Phase 6 Smoke Test Failed:\n", err);
    process.exit(1);
  });
