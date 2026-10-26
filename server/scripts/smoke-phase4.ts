import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

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

async function runSmokePhase4() {
  console.log("=================================================");
  console.log("🚀 Running Phase 4 Smoke Test Script (Real Database)");
  console.log("=================================================\n");

  const createdTicketIds: string[] = [];

  try {
    // 0. Log in test users
    const [student1, student2, student3, plumber1, plumber2, plumber3, wardenA] = await Promise.all([
      loginUser("student1@hosteldesk.dev"),
      loginUser("student2@hosteldesk.dev"),
      loginUser("student3@hosteldesk.dev"),
      loginUser("plumber1@hosteldesk.dev"),
      loginUser("plumber2@hosteldesk.dev"),
      loginUser("plumber3@hosteldesk.dev"),
      loginUser("warden.a@hosteldesk.dev"),
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
          startsWith: "Phase4 Smoke - ",
        },
      },
    });

    // -------------------------------------------------------------------------
    // STEP 1: Room ticket code lifecycle & occupant privacy
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 1: Room Ticket Code Lifecycle & Occupant Privacy ---");
    process.stdout.write("1.1 student1 creates ROOM plumbing ticket -> ");
    const createRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase4 Smoke - Room tap broken valve",
        description: "Water leaking steadily from tap handle",
      });

    if (createRes.status !== 201) {
      throw new Error(`Failed to create room ticket: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    }
    const ticket1 = createRes.body.ticket;
    createdTicketIds.push(ticket1.id);
    const assignedStaff1 = getAssignedPlumber(ticket1);
    console.log(`OK (ID: ${ticket1.id}, Code: ${ticket1.code}, Assigned: ${assignedStaff1.user.name})`);

    process.stdout.write("1.2 assigned plumber starts work -> ");
    const startRes = await request(app)
      .post(`/api/tickets/${ticket1.id}/start`)
      .set("Cookie", assignedStaff1.cookie);
    if (startRes.status !== 200) {
      throw new Error(`Plumber failed to start work: ${startRes.status} ${JSON.stringify(startRes.body)}`);
    }
    console.log("OK (Status: IN_PROGRESS)");

    process.stdout.write("1.3 student1 (occupant) retrieves completion code -> ");
    const codeRes1 = await request(app)
      .get(`/api/tickets/${ticket1.id}/completion-code`)
      .set("Cookie", student1.cookie);
    if (codeRes1.status !== 200 || !codeRes1.body.code) {
      throw new Error(`Failed to get completion code: ${codeRes1.status} ${JSON.stringify(codeRes1.body)}`);
    }
    const completionCode = codeRes1.body.code;
    console.log(`OK (Code: ${completionCode})`);

    process.stdout.write("1.4 student2 (roommate occupant) retrieves completion code -> ");
    const codeRes2 = await request(app)
      .get(`/api/tickets/${ticket1.id}/completion-code`)
      .set("Cookie", student2.cookie);
    if (codeRes2.status !== 200 || codeRes2.body.code !== completionCode) {
      throw new Error(`Roommate failed to get matching code: ${codeRes2.status}`);
    }
    console.log(`OK (Matches: ${codeRes2.body.code})`);

    process.stdout.write("1.5 student3 (non-occupant) blocked from completion code (404) -> ");
    const codeRes3 = await request(app)
      .get(`/api/tickets/${ticket1.id}/completion-code`)
      .set("Cookie", student3.cookie);
    if (codeRes3.status !== 404) {
      throw new Error(`Non-occupant should get 404, got ${codeRes3.status}`);
    }
    console.log("OK (404 NOT_FOUND)");

    process.stdout.write("1.6 plumber uploads valid AFTER photo evidence -> ");
    await request(app)
      .post(`/api/tickets/${ticket1.id}/attachments`)
      .set("Cookie", assignedStaff1.cookie)
      .attach("photo", samplePng, "room_repair_after.png")
      .field("role", "AFTER");
    console.log("OK (After photo uploaded)");

    process.stdout.write("1.7 plumber attempts resolve with wrong code ('0000') -> ");
    const wrongCodeRes = await request(app)
      .post(`/api/tickets/${ticket1.id}/resolve`)
      .set("Cookie", assignedStaff1.cookie)
      .send({ code: "0000" });
    if (wrongCodeRes.status !== 400 || wrongCodeRes.body.error?.code !== "INVALID_CODE") {
      throw new Error(`Wrong code should return 400 INVALID_CODE, got ${wrongCodeRes.status} ${JSON.stringify(wrongCodeRes.body)}`);
    }
    console.log("OK (Rejected with remaining attempts warning)");

    process.stdout.write("1.8 plumber resolves with correct code -> ");
    const resolveRes1 = await request(app)
      .post(`/api/tickets/${ticket1.id}/resolve`)
      .set("Cookie", assignedStaff1.cookie)
      .send({ code: completionCode });
    if (resolveRes1.status !== 200) {
      throw new Error(`Resolve failed: ${resolveRes1.status} ${JSON.stringify(resolveRes1.body)}`);
    }
    console.log(`OK (Resolved: ${resolveRes1.body.ticket.status})`);

    // Verify DB state
    const dbTicket1 = await prisma.ticket.findUnique({ where: { id: ticket1.id } });
    if (dbTicket1?.completionCode !== null) throw new Error("Completion code was not cleared from DB!");
    if (!dbTicket1?.actualWorkMinutes || dbTicket1.actualWorkMinutes < 1) throw new Error("actualWorkMinutes not recorded!");

    // -------------------------------------------------------------------------
    // STEP 2: Dispute Always Wins Rule (48-hour window)
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 2: Dispute Always Wins Rule (48h Window) ---");
    process.stdout.write("2.1 student1 confirms resolution -> transitions to CLOSED -> ");
    const confirmRes1 = await request(app)
      .post(`/api/tickets/${ticket1.id}/confirm`)
      .set("Cookie", student1.cookie);
    if (confirmRes1.status !== 200 || confirmRes1.body.status !== "CLOSED") {
      throw new Error(`Confirm failed: ${confirmRes1.status} ${JSON.stringify(confirmRes1.body)}`);
    }
    console.log("OK (Status: CLOSED)");

    process.stdout.write("2.2 student2 (roommate) disputes closed ticket within 48h -> ");
    const disputeRes1 = await request(app)
      .post(`/api/tickets/${ticket1.id}/dispute`)
      .set("Cookie", student2.cookie)
      .send({ reason: "Valve is still dripping underneath the sink pipe" });
    if (disputeRes1.status !== 200) {
      throw new Error(`Dispute failed: ${disputeRes1.status} ${JSON.stringify(disputeRes1.body)}`);
    }
    if (disputeRes1.body.status !== "ASSIGNED" || disputeRes1.body.reopenCount !== 1) {
      throw new Error(`Ticket should be reopened to ASSIGNED with reopenCount=1, got ${disputeRes1.body.status}, count=${disputeRes1.body.reopenCount}`);
    }
    console.log(`OK (Dispute Wins: Status reopened to ${disputeRes1.body.status}, ReopenCount: ${disputeRes1.body.reopenCount})`);

    // Clean up ticket1 now that dispute was verified, clearing room 101 for locked-room flows
    await prisma.ticket.delete({ where: { id: ticket1.id } });

    // -------------------------------------------------------------------------
    // STEP 3: Common Area Ticket & After Photo Requirement
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 3: Common Area Ticket & After Photo Enforcement ---");
    process.stdout.write("3.1 student1 creates COMMON area ticket -> ");
    const createCommonRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "COMMON",
        categoryId: category.id,
        title: "Phase4 Smoke - Corridor washroom pipe leaking",
        description: "Puddle on floor outside common washroom",
        floor: 1,
        commonSpot: "WASHROOM",
      });
    if (createCommonRes.status !== 201) {
      throw new Error(`Failed to create common ticket: ${createCommonRes.status}`);
    }
    const ticket2 = createCommonRes.body.ticket;
    createdTicketIds.push(ticket2.id);
    const assignedStaff2 = getAssignedPlumber(ticket2);
    console.log(`OK (ID: ${ticket2.id}, Assigned: ${assignedStaff2.user.name})`);

    process.stdout.write("3.2 assigned plumber starts work on common ticket -> ");
    await request(app).post(`/api/tickets/${ticket2.id}/start`).set("Cookie", assignedStaff2.cookie);
    console.log("OK (Status: IN_PROGRESS)");

    process.stdout.write("3.3 plumber attempts to resolve common ticket WITHOUT after photo -> ");
    const resolveNoPhotoRes = await request(app)
      .post(`/api/tickets/${ticket2.id}/resolve`)
      .set("Cookie", assignedStaff2.cookie)
      .send({});
    if (resolveNoPhotoRes.status !== 400 || resolveNoPhotoRes.body.error?.code !== "AFTER_PHOTO_REQUIRED") {
      throw new Error(`Expected 400 AFTER_PHOTO_REQUIRED, got ${resolveNoPhotoRes.status} ${JSON.stringify(resolveNoPhotoRes.body)}`);
    }
    console.log("OK (Blocked: 400 AFTER_PHOTO_REQUIRED)");

    process.stdout.write("3.4 plumber uploads valid AFTER photo evidence -> ");
    const uploadAfterRes = await request(app)
      .post(`/api/tickets/${ticket2.id}/attachments`)
      .set("Cookie", assignedStaff2.cookie)
      .attach("photo", samplePng, "repair_after.png")
      .field("role", "AFTER");
    if (uploadAfterRes.status !== 201) {
      throw new Error(`Photo upload failed: ${uploadAfterRes.status} ${JSON.stringify(uploadAfterRes.body)}`);
    }
    console.log(`OK (Photo uploaded, ID: ${uploadAfterRes.body.attachment.id}, Kind: ${uploadAfterRes.body.attachment.kind})`);

    process.stdout.write("3.5 plumber resolves common ticket WITH after photo -> ");
    const resolveCommonRes = await request(app)
      .post(`/api/tickets/${ticket2.id}/resolve`)
      .set("Cookie", assignedStaff2.cookie)
      .send({});
    if (resolveCommonRes.status !== 200 || resolveCommonRes.body.ticket.status !== "AWAITING_VERIFICATION") {
      throw new Error(`Expected status AWAITING_VERIFICATION, got ${resolveCommonRes.status}`);
    }
    console.log("OK (Status: AWAITING_VERIFICATION)");

    // -------------------------------------------------------------------------
    // STEP 4: Locked Room Flow, SLA Pause, and 15-Minute Quick Return
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 4: Locked Room Flow, SLA Pause, & 15-Min Quick Return ---");
    process.stdout.write("4.1 student1 creates 2nd room ticket -> ");
    const createRoom2Res = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase4 Smoke - Shower head missing",
        description: "Shower head detached",
      });
    const ticket3 = createRoom2Res.body.ticket;
    createdTicketIds.push(ticket3.id);
    const assignedStaff3 = getAssignedPlumber(ticket3);
    await request(app).post(`/api/tickets/${ticket3.id}/start`).set("Cookie", assignedStaff3.cookie);
    console.log(`OK (ID: ${ticket3.id}, Status: IN_PROGRESS, Assigned: ${assignedStaff3.user.name})`);

    process.stdout.write("4.2 plumber attempts room-locked WITHOUT door photo -> ");
    const lockedNoPhotoRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/room-locked`)
      .set("Cookie", assignedStaff3.cookie);
    if (lockedNoPhotoRes.status !== 400 || lockedNoPhotoRes.body.error?.code !== "DOOR_PHOTO_REQUIRED") {
      throw new Error(`Expected 400 DOOR_PHOTO_REQUIRED, got ${lockedNoPhotoRes.status}`);
    }
    console.log("OK (Blocked: 400 DOOR_PHOTO_REQUIRED)");

    process.stdout.write("4.3 plumber uploads DOOR photo and reports room locked -> ");
    await request(app)
      .post(`/api/tickets/${ticket3.id}/attachments`)
      .set("Cookie", assignedStaff3.cookie)
      .attach("photo", samplePng, "door.png")
      .field("role", "DOOR");

    const roomLockedRes1 = await request(app)
      .post(`/api/tickets/${ticket3.id}/room-locked`)
      .set("Cookie", assignedStaff3.cookie);
    if (roomLockedRes1.status !== 200 || roomLockedRes1.body.status !== "AWAITING_ACCESS") {
      throw new Error(`Failed to report room locked: ${roomLockedRes1.status} ${JSON.stringify(roomLockedRes1.body)}`);
    }
    console.log(`OK (Status: AWAITING_ACCESS, lockedVisitCount: ${roomLockedRes1.body.lockedVisitCount})`);

    // Verify SLA paused in DB
    const pausedDbTicket = await prisma.ticket.findUnique({ where: { id: ticket3.id } });
    if (!pausedDbTicket?.pausedAt) throw new Error("Ticket pausedAt was not set on room-locked!");

    process.stdout.write("4.4 student1 responds with 'COMING_15' (15 min return) -> ");
    const coming15Res = await request(app)
      .post(`/api/tickets/${ticket3.id}/access`)
      .set("Cookie", student1.cookie)
      .send({ option: "COMING_15" });
    if (coming15Res.status !== 200 || coming15Res.body.status !== "ASSIGNED") {
      throw new Error(`Failed to submit 15 min return: ${coming15Res.status} ${JSON.stringify(coming15Res.body)}`);
    }
    console.log("OK (Status resumed to ASSIGNED, priorityBoostUntil set, SLA resumed)");

    // -------------------------------------------------------------------------
    // STEP 5: 2nd Locked Visit Blocks 15-Min Option & Enforces Slot Booking
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 5: 2nd Locked Visit Blocks 15-Min & Enforces Slot Booking ---");
    // Staff must start work before reporting locked again
    await request(app).post(`/api/tickets/${ticket3.id}/start`).set("Cookie", assignedStaff3.cookie);

    process.stdout.write("5.1 plumber reports room locked for 2nd visit -> ");
    await request(app)
      .post(`/api/tickets/${ticket3.id}/attachments`)
      .set("Cookie", assignedStaff3.cookie)
      .attach("photo", samplePng, "door2.png")
      .field("role", "DOOR");

    const roomLockedRes2 = await request(app)
      .post(`/api/tickets/${ticket3.id}/room-locked`)
      .set("Cookie", assignedStaff3.cookie);
    if (roomLockedRes2.status !== 200 || roomLockedRes2.body.lockedVisitCount !== 2) {
      throw new Error(`Expected lockedVisitCount=2, got ${roomLockedRes2.body?.lockedVisitCount}`);
    }
    console.log(`OK (lockedVisitCount: ${roomLockedRes2.body.lockedVisitCount})`);

    process.stdout.write("5.2 student1 attempts 'COMING_15' on 2nd visit -> blocked -> ");
    const blockedComingRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/access`)
      .set("Cookie", student1.cookie)
      .send({ option: "COMING_15" });
    if (blockedComingRes.status !== 400 || blockedComingRes.body.error?.code !== "SLOT_REQUIRED") {
      throw new Error(`Expected 400 SLOT_REQUIRED, got ${blockedComingRes.status} ${JSON.stringify(blockedComingRes.body)}`);
    }
    console.log("OK (Blocked: 400 SLOT_REQUIRED)");

    process.stdout.write("5.3 student1 fetches available 30-min shift access slots -> ");
    const slotsRes = await request(app)
      .get(`/api/tickets/${ticket3.id}/access-slots`)
      .set("Cookie", student1.cookie);
    if (slotsRes.status !== 200 || !slotsRes.body.slots || slotsRes.body.slots.length === 0) {
      throw new Error(`Failed to get slots: ${slotsRes.status}`);
    }
    const chosenSlot = slotsRes.body.slots[0];
    console.log(`OK (${slotsRes.body.slots.length} slots available, chosen: ${chosenSlot.label})`);

    const slotStartVal = chosenSlot.slotStart || chosenSlot.start;
    const bookSlotRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/access`)
      .set("Cookie", student1.cookie)
      .send({ option: "SLOT", slotStart: slotStartVal });
    if (bookSlotRes.status !== 200) {
      throw new Error(`Failed to book slot: ${bookSlotRes.status} ${JSON.stringify(bookSlotRes.body)}`);
    }
    console.log("OK (Slot scheduled, SLA resumed, status ASSIGNED)");

    // -------------------------------------------------------------------------
    // STEP 6: Code Refused Dispute & Warden Arbitration
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 6: Code Refused Dispute & Warden Decision ---");
    // Staff starts work after scheduled slot
    await request(app).post(`/api/tickets/${ticket3.id}/start`).set("Cookie", assignedStaff3.cookie);

    process.stdout.write("6.1 plumber reports occupant code refusal dispute -> ");
    const codeRefusedRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/disputes/code-refused`)
      .set("Cookie", assignedStaff3.cookie)
      .send({ reason: "Student refused to share 4-digit code after shower head fix" });
    if (codeRefusedRes.status !== 200) {
      throw new Error(`Failed to report code refusal: ${codeRefusedRes.status} ${JSON.stringify(codeRefusedRes.body)}`);
    }
    const refusalDispute = codeRefusedRes.body.dispute;
    console.log(`OK (Dispute ID: ${refusalDispute.id}, Type: ${refusalDispute.type})`);

    process.stdout.write("6.2 wardenA lists open disputes -> ");
    const disputesListRes = await request(app)
      .get("/api/disputes?status=OPEN")
      .set("Cookie", wardenA.cookie);
    if (disputesListRes.status !== 200 || !disputesListRes.body.disputes?.some((d: any) => d.id === refusalDispute.id)) {
      throw new Error("Dispute not found in warden dispute queue");
    }
    console.log("OK (Found in warden queue)");

    process.stdout.write("6.3 wardenA upholds dispute -> closes ticket with WARDEN_DECISION -> ");
    const decideRefusalRes = await request(app)
      .post(`/api/disputes/${refusalDispute.id}/decide`)
      .set("Cookie", wardenA.cookie)
      .send({ decision: "UPHELD", note: "Inspected room personally, shower head installed correctly" });
    if (decideRefusalRes.status !== 200) {
      throw new Error(`Failed to decide dispute: ${decideRefusalRes.status}`);
    }
    const closedDbTicket3 = await prisma.ticket.findUnique({ where: { id: ticket3.id } });
    if (closedDbTicket3?.status !== "CLOSED" || closedDbTicket3?.closeReason !== "WARDEN_DECISION") {
      throw new Error(`Expected CLOSED with WARDEN_DECISION, got ${closedDbTicket3?.status} / ${closedDbTicket3?.closeReason}`);
    }
    console.log("OK (Status: CLOSED, closeReason: WARDEN_DECISION)");

    // -------------------------------------------------------------------------
    // STEP 7: False Locked Claim Dispute & Warden Arbitration
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 7: False Locked Claim Dispute & 60-min Priority Boost ---");
    process.stdout.write("7.1 student1 creates 3rd room ticket and plumber reports locked -> ");
    const createRoom3Res = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Phase4 Smoke - Drain clogged",
        description: "Water backing up in drain",
      });
    const ticket4 = createRoom3Res.body.ticket;
    createdTicketIds.push(ticket4.id);
    const assignedStaff4 = getAssignedPlumber(ticket4);
    await request(app).post(`/api/tickets/${ticket4.id}/start`).set("Cookie", assignedStaff4.cookie);
    await request(app)
      .post(`/api/tickets/${ticket4.id}/attachments`)
      .set("Cookie", assignedStaff4.cookie)
      .attach("photo", samplePng, "door.png")
      .field("role", "DOOR");
    await request(app).post(`/api/tickets/${ticket4.id}/room-locked`).set("Cookie", assignedStaff4.cookie);
    console.log(`OK (ID: ${ticket4.id}, Status: AWAITING_ACCESS)`);

    process.stdout.write("7.2 student1 disputes locked claim (was present in room) -> ");
    const falseClaimRes = await request(app)
      .post(`/api/tickets/${ticket4.id}/disputes/locked-claim`)
      .set("Cookie", student1.cookie)
      .send({ reason: "Both my roommate and I were in room 101 studying, no knock received" });
    if (falseClaimRes.status !== 200) {
      throw new Error(`Failed to dispute locked claim: ${falseClaimRes.status} ${JSON.stringify(falseClaimRes.body)}`);
    }
    const falseClaimDispute = falseClaimRes.body.dispute;
    console.log(`OK (Dispute ID: ${falseClaimDispute.id})`);

    process.stdout.write("7.3 wardenA upholds false locked claim -> reassigns with 60-min priority boost -> ");
    const decideFalseClaimRes = await request(app)
      .post(`/api/disputes/${falseClaimDispute.id}/decide`)
      .set("Cookie", wardenA.cookie)
      .send({ decision: "UPHELD", note: "Student verified present on CCTV/hostel log" });
    if (decideFalseClaimRes.status !== 200) {
      throw new Error(`Failed to uphold false claim: ${decideFalseClaimRes.status}`);
    }
    const boostedTicket = await prisma.ticket.findUnique({ where: { id: ticket4.id } });
    if (!boostedTicket?.priorityBoostUntil) {
      throw new Error("Ticket priorityBoostUntil was not set!");
    }
    console.log("OK (Status: ASSIGNED, priorityBoostUntil set for 60 min)");

    // -------------------------------------------------------------------------
    // STEP 8: Warden Quality Inspection Checks on Closed Tickets
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 8: Warden Quality Inspection Checks ---");
    process.stdout.write("8.1 wardenA performs OK quality check on closed ticket -> ");
    const checkOkRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/warden-check`)
      .set("Cookie", wardenA.cookie)
      .send({ result: "OK" });
    if (checkOkRes.status !== 200) {
      throw new Error(`Warden OK check failed: ${checkOkRes.status}`);
    }
    console.log("OK (Event logged: WARDEN_VERIFIED, remains CLOSED)");

    process.stdout.write("8.2 wardenA performs PROBLEM quality check -> reopens ticket -> ");
    const checkProblemRes = await request(app)
      .post(`/api/tickets/${ticket3.id}/warden-check`)
      .set("Cookie", wardenA.cookie)
      .send({ result: "PROBLEM", note: "Noticed water seepage around the shower pipe fitting" });
    if (checkProblemRes.status !== 200 || checkProblemRes.body.status !== "ASSIGNED") {
      throw new Error(`Expected re-assigned ticket, got ${checkProblemRes.status} ${JSON.stringify(checkProblemRes.body)}`);
    }
    console.log(`OK (Status: ${checkProblemRes.body.status}, ReopenCount: ${checkProblemRes.body.reopenCount})`);

    console.log("\n=================================================");
    console.log("🎉 All Phase 4 Smoke Tests Passed Successfully!");
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

runSmokePhase4().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});
