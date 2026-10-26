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

async function runSmokePhase2() {
  console.log("=================================================");
  console.log("🚀 Running Phase 2 Smoke Test Script (Real Database)");
  console.log("=================================================\n");

  const createdTicketIds: string[] = [];

  try {
    // 0. Log in test users
    const [student1, student2, student3, plumber1, plumber2, wardenA] = await Promise.all([
      loginUser("student1@hosteldesk.dev"),
      loginUser("student2@hosteldesk.dev"),
      loginUser("student3@hosteldesk.dev"),
      loginUser("plumber1@hosteldesk.dev"),
      loginUser("plumber2@hosteldesk.dev"),
      loginUser("warden.a@hosteldesk.dev"),
    ]);

    // Find category for plumbing
    const category = await prisma.category.findFirst({
      where: { trade: "PLUMBER", isActive: true },
    });
    if (!category) throw new Error("No active PLUMBER category found in database");

    // Clean up any lingering open test tickets from previous test runs
    await prisma.ticket.deleteMany({
      where: {
        title: {
          in: [
            "Bathroom tap leaking heavily",
            "Room tap broken again",
            "Main corridor washroom leak",
            "Washroom leak floor 3",
          ],
        },
      },
    });

    // -------------------------------------------------------------
    // STEP 1: student1 raises a ROOM plumbing ticket -> assigned to plumber
    // -------------------------------------------------------------
    process.stdout.write("1. student1 raises a ROOM plumbing ticket -> ");
    const createRoomRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Bathroom tap leaking heavily",
        description: "Water leaking constantly from faucet under sink",
      });

    if (createRoomRes.status !== 201) {
      console.log(`FAIL (Status: ${createRoomRes.status})`);
      console.error(createRoomRes.body);
      process.exit(1);
    }

    const roomTicket = createRoomRes.body.ticket;
    createdTicketIds.push(roomTicket.id);

    if (roomTicket.status === "ASSIGNED" && roomTicket.assignedToId) {
      console.log(`PASS (${roomTicket.code} assigned to staff ID: ${roomTicket.assignedToId})`);
    } else {
      console.log(`FAIL (Status: ${roomTicket.status}, Assignee: ${roomTicket.assignedToId})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 2: student2 (roommate) tries same category -> 409 DUPLICATE; can view ticket
    // -------------------------------------------------------------
    process.stdout.write("2. student2 tries duplicate category -> ");
    const duplicateRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student2.cookie)
      .send({
        locationType: "ROOM",
        categoryId: category.id,
        title: "Room tap broken again",
        description: "Reporting same issue that roommate already reported",
      });

    if (duplicateRes.status === 409 && duplicateRes.body.error?.code === "DUPLICATE_ROOM_TICKET") {
      // Roommate views the ticket
      const viewRes = await request(app)
        .get(`/api/tickets/${roomTicket.id}`)
        .set("Cookie", student2.cookie);

      if (viewRes.status === 200 && viewRes.body.ticket?.id === roomTicket.id) {
        console.log(`PASS (409 DUPLICATE_ROOM_TICKET caught & roommate can view ticket)`);
      } else {
        console.log(`FAIL (Roommate could not view ticket: ${viewRes.status})`);
        process.exit(1);
      }
    } else {
      console.log(`FAIL (Expected 409 DUPLICATE_ROOM_TICKET, got: ${duplicateRes.status})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 3: Student from another room cannot view ticket -> 404
    // -------------------------------------------------------------
    process.stdout.write("3. Student from another room views ticket -> ");
    const otherViewRes = await request(app)
      .get(`/api/tickets/${roomTicket.id}`)
      .set("Cookie", student3.cookie);

    if (otherViewRes.status === 404) {
      console.log(`PASS (Rejected with 404 NOT_FOUND so ticket IDs cannot be probed)`);
    } else {
      console.log(`FAIL (Expected 404, got: ${otherViewRes.status})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 4: COMMON ticket created; second student on same floor joins
    // -------------------------------------------------------------
    process.stdout.write("4. COMMON ticket creation & duplicate join -> ");
    const commonCreateRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student1.cookie)
      .send({
        locationType: "COMMON",
        categoryId: category.id,
        title: "Main corridor washroom leak",
        description: "Water leaking near wash basin in corridor",
        floor: 3,
        commonSpot: "Floor 3 North Washroom",
        joinExistingCheck: true,
      });

    if (commonCreateRes.status !== 201) {
      console.log(`FAIL (Common ticket create failed: ${commonCreateRes.status})`);
      process.exit(1);
    }

    const commonTicket = commonCreateRes.body.ticket;
    createdTicketIds.push(commonTicket.id);

    // Second student reports similar common issue on same floor within 2 hours
    const similarRes = await request(app)
      .post("/api/tickets")
      .set("Cookie", student2.cookie)
      .send({
        locationType: "COMMON",
        categoryId: category.id,
        title: "Washroom leak floor 3",
        description: "Sink leaking in north washroom",
        floor: 3,
        commonSpot: "Floor 3 North Washroom",
        joinExistingCheck: true,
      });

    if (similarRes.status === 409 && similarRes.body.error?.code === "SIMILAR_TICKETS_EXIST") {
      // Second student joins the complaint
      const followRes = await request(app)
        .post(`/api/tickets/${commonTicket.id}/follow`)
        .set("Cookie", student2.cookie);

      if (followRes.status === 200 && followRes.body.followerCount >= 1) {
        console.log(`PASS (SIMILAR_TICKETS_EXIST triggered & student joined successfully)`);
      } else {
        console.log(`FAIL (Follow endpoint failed: ${followRes.status})`);
        process.exit(1);
      }
    } else {
      console.log(`FAIL (Expected 409 SIMILAR_TICKETS_EXIST, got: ${similarRes.status})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 5: Assigned plumber starts work -> IN_PROGRESS & timeline checks
    // -------------------------------------------------------------
    process.stdout.write("5. Assigned staff starts work & timeline check -> ");
    // Determine which staff was assigned to roomTicket and log them in
    const assignedUser = await prisma.user.findUnique({
      where: { id: roomTicket.assignedToId },
    });
    if (!assignedUser) throw new Error("Assigned user not found");

    const assignedStaff = await loginUser(assignedUser.email);

    const startRes = await request(app)
      .post(`/api/tickets/${roomTicket.id}/start`)
      .set("Cookie", assignedStaff.cookie);

    if (startRes.status === 200 && startRes.body.status === "IN_PROGRESS") {
      // Check timeline events
      const eventsRes = await request(app)
        .get(`/api/tickets/${roomTicket.id}/events`)
        .set("Cookie", assignedStaff.cookie);

      const eventTypes = eventsRes.body.events?.map((e: any) => e.type) || [];
      const hasCreated = eventTypes.includes("CREATED");
      const hasAssigned = eventTypes.includes("ASSIGNED");
      const hasStatusChange = eventTypes.includes("STATUS_CHANGED") || eventTypes.includes("STATUS_CHANGE");

      if (hasCreated && hasAssigned && hasStatusChange) {
        console.log(`PASS (IN_PROGRESS reached; timeline contains CREATED, ASSIGNED, STATUS_CHANGED)`);
      } else {
        console.log(`FAIL (Missing timeline events: ${eventTypes.join(", ")})`);
        process.exit(1);
      }
    } else {
      console.log(`FAIL (Start work failed: ${startRes.status})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 6: Warden changes priority & reassigns; Student gets 403
    // -------------------------------------------------------------
    process.stdout.write("6. Warden reprioritise/reassign & student 403 -> ");
    const targetPriority = roomTicket.priority === "URGENT" ? "NORMAL" : "URGENT";

    // Student tries to change priority -> 403
    const studentPriorityRes = await request(app)
      .patch(`/api/tickets/${roomTicket.id}/priority`)
      .set("Cookie", student1.cookie)
      .send({ priority: targetPriority, reason: "Student attempt" });

    if (studentPriorityRes.status !== 403) {
      console.log(`FAIL (Student changing priority should return 403, got: ${studentPriorityRes.status})`);
      process.exit(1);
    }

    // Warden changes priority -> 200
    const wardenPriorityRes = await request(app)
      .patch(`/api/tickets/${roomTicket.id}/priority`)
      .set("Cookie", wardenA.cookie)
      .send({ priority: targetPriority, reason: "Water damage risk to floor" });

    if (wardenPriorityRes.status !== 200) {
      console.log(`FAIL (Warden priority change failed: ${wardenPriorityRes.status})`);
      process.exit(1);
    }

    // Warden tries to change to identical priority -> 400 PRIORITY_UNCHANGED
    const unchangedPriorityRes = await request(app)
      .patch(`/api/tickets/${roomTicket.id}/priority`)
      .set("Cookie", wardenA.cookie)
      .send({ priority: targetPriority, reason: "Same priority" });

    if (unchangedPriorityRes.status !== 400 || unchangedPriorityRes.body.error?.code !== "PRIORITY_UNCHANGED") {
      console.log(`FAIL (Expected 400 PRIORITY_UNCHANGED, got: ${unchangedPriorityRes.status})`);
      process.exit(1);
    }

    // Warden reassigns to other plumber
    const targetPlumberId = roomTicket.assignedToId === plumber1.user.id ? plumber2.user.id : plumber1.user.id;
    const reassignRes = await request(app)
      .post(`/api/tickets/${roomTicket.id}/reassign`)
      .set("Cookie", wardenA.cookie)
      .send({ staffId: targetPlumberId });

    if (reassignRes.status === 200) {
      console.log(`PASS (Priority changed to ${targetPriority}, identical rejected, reassigned, student got 403)`);
    } else {
      console.log(`FAIL (Warden reassign failed: ${reassignRes.status})`);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STEP 7: Notifications exist for audience and not for actor
    // -------------------------------------------------------------
    process.stdout.write("7. In-app notifications audience verification -> ");
    // student1 was the creator, student2 is roommate.
    // Warden made changes in step 6 -> student1 & student2 should have notifications
    const studentNotifs = await request(app)
      .get("/api/notifications")
      .set("Cookie", student1.cookie);

    const wardenNotifs = await request(app)
      .get("/api/notifications")
      .set("Cookie", wardenA.cookie);

    const studentHasNotifs = studentNotifs.body.notifications?.length > 0;
    // Warden was actor of last two events, so they shouldn't receive a notification for their own action
    const wardenHasSelfNotif = wardenNotifs.body.notifications?.some(
      (n: any) => n.message?.includes("priority changed") && n.ticketId === roomTicket.id
    );

    if (studentHasNotifs && !wardenHasSelfNotif) {
      console.log(`PASS (Audience received notifications; actor excluded)`);
    } else {
      console.log(
        `FAIL (Notifications check failed: studentHasNotifs=${studentHasNotifs}, wardenHasSelfNotif=${wardenHasSelfNotif})`
      );
      process.exit(1);
    }

    console.log("\n=================================================");
    console.log("🎉 ALL PHASE 2 SMOKE TESTS PASSED END-TO-END!");
    console.log("=================================================");
  } finally {
    // Clean up created test tickets
    if (createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      });
    }
  }
}

runSmokePhase2()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error during Phase 2 smoke tests:", err);
    process.exit(1);
  });
