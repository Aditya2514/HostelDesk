import fs from "fs";
import path from "path";
import {
  PrismaClient,
  Role,
  Trade,
  Priority,
  TicketStatus,
  LocationType,
  ResolutionMethod,
  AttachmentKind,
  DisputeType,
  DisputeStatus,
} from "@prisma/client";
import { clock } from "../src/lib/clock";
import { uploadToCloudinary } from "../src/modules/evidence/cloudinary";
import { EtaService } from "../src/modules/scheduling/eta.service";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--confirm")) {
    console.error("Refusing to run seed:demo in production without --confirm flag");
    process.exit(1);
  }

  console.log("=================================================");
  console.log("🎬 Seeding Demo Scenario for Video Recording");
  console.log("=================================================\n");

  const now = clock.now();

  // 1. Clean up only existing [DEMO] tickets
  console.log("1. Cleaning up any previous [DEMO] tickets...");
  const existingDemoTickets = await prisma.ticket.findMany({
    where: { title: { startsWith: "[DEMO]" } },
    select: { id: true, code: true },
  });

  const demoTicketIds = existingDemoTickets.map((t) => t.id);
  if (demoTicketIds.length > 0) {
    await prisma.attachment.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.ticketFollower.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.dispute.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.ticketPrediction.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.comment.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.notification.deleteMany({ where: { ticketId: { in: demoTicketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: demoTicketIds } } });
    console.log(`   Deleted ${demoTicketIds.length} previous [DEMO] tickets.`);
  } else {
    console.log("   No existing [DEMO] tickets found.");
  }

  // 2. Fetch context entities
  const blockA = await prisma.block.findUnique({ where: { name: "A" } });
  if (!blockA) throw new Error("Block A not found. Please run base seed first.");

  const categories = await prisma.category.findMany();
  const catElectrician = categories.find((c) => c.trade === Trade.ELECTRICIAN) || categories[0];
  const catPlumber = categories.find((c) => c.trade === Trade.PLUMBER) || categories[0];
  const catCarpenter = categories.find((c) => c.trade === Trade.CARPENTER) || categories[0];

  const students = await prisma.user.findMany({ where: { role: Role.STUDENT } });
  const staff = await prisma.user.findMany({ where: { role: Role.STAFF } });

  const student1 = students.find((s) => s.email === "student1@hosteldesk.dev") || students[0];
  const student2 = students.find((s) => s.email === "student2@hosteldesk.dev") || students[1];
  const student3 = students.find((s) => s.email === "student3@hosteldesk.dev") || students[2];
  const student4 = students.find((s) => s.email === "student4@hosteldesk.dev") || students[3];

  const electrician1 = staff.find((s) => s.email === "electrician1@hosteldesk.dev") || staff[0];
  const electrician2 = staff.find((s) => s.email === "electrician2@hosteldesk.dev") || staff[0];
  const electrician3 = staff.find((s) => s.email === "electrician3@hosteldesk.dev") || staff[0];
  const plumber1 = staff.find((s) => s.email === "plumber1@hosteldesk.dev") || staff[0];
  const plumber2 = staff.find((s) => s.email === "plumber2@hosteldesk.dev") || staff[0];
  const carpenter1 = staff.find((s) => s.email === "carpenter1@hosteldesk.dev") || staff[0];

  const roomA301 = await prisma.room.findFirst({ where: { blockId: blockA.id, number: "301" } });
  const roomA302 = await prisma.room.findFirst({ where: { blockId: blockA.id, number: "302" } });
  const roomA305 = await prisma.room.findFirst({ where: { blockId: blockA.id, number: "305" } });
  const roomA310 = await prisma.room.findFirst({ where: { blockId: blockA.id, number: "310" } });
  const roomA401 = await prisma.room.findFirst({ where: { blockId: blockA.id, number: "401" } });

  // 2b. Make sure the demo students actually live in the rooms their demo tickets belong to.
  // Students can only see tickets for their own room, so without this the login shown in the
  // demo table (student3 -> A-302, student4 -> A-305) would get "Ticket Not Found".
  // Idempotent. If the target room is already full (max 2), one synthetic occupant swaps into
  // the demo student's old room so the 2-per-room limit still holds.
  async function placeDemoStudent(studentId: string, targetRoomId: string | undefined) {
    if (!targetRoomId) return;
    const current = await prisma.roomOccupancy.findFirst({ where: { userId: studentId, toDate: null } });
    if (current?.roomId === targetRoomId) return;
    const occupants = await prisma.roomOccupancy.findMany({
      where: { roomId: targetRoomId, toDate: null, userId: { not: studentId } },
    });
    if (occupants.length >= 2 && current) {
      await prisma.roomOccupancy.update({ where: { id: occupants[0].id }, data: { roomId: current.roomId } });
    }
    await prisma.roomOccupancy.deleteMany({ where: { userId: studentId } });
    await prisma.roomOccupancy.create({
      data: { userId: studentId, roomId: targetRoomId, fromDate: current?.fromDate ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    });
  }
  await placeDemoStudent(student3.id, roomA302?.id);
  await placeDemoStudent(student4.id, roomA305?.id);

  // 3. Upload real demo assets to Cloudinary
  console.log("\n2. Uploading real demo assets to Cloudinary...");
  const assetsDir = path.resolve(__dirname, "demo-assets");

  const doorLockedBuf = fs.readFileSync(path.join(assetsDir, "door-locked.jpg"));
  const tapFixedBuf = fs.readFileSync(path.join(assetsDir, "tap-fixed.jpg"));
  const socketFixedBuf = fs.readFileSync(path.join(assetsDir, "socket-fixed.jpg"));

  console.log("   Uploading door-locked photo...");
  const doorUpload = await uploadToCloudinary(doorLockedBuf, "hosteldesk/demo/door");
  console.log(`   ✓ Uploaded: ${doorUpload.url}`);

  console.log("   Uploading tap-fixed photo...");
  const tapUpload = await uploadToCloudinary(tapFixedBuf, "hosteldesk/demo/tap");
  console.log(`   ✓ Uploaded: ${tapUpload.url}`);

  console.log("   Uploading socket-fixed photo...");
  const socketUpload = await uploadToCloudinary(socketFixedBuf, "hosteldesk/demo/socket");
  console.log(`   ✓ Uploaded: ${socketUpload.url}`);

  // Helper to generate next unique code
  async function getNextTicketCode(): Promise<string> {
    const lastTicket = await prisma.ticket.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNum = (lastTicket?.number || 0) + 1;
    return `HD-${String(nextNum).padStart(4, "0")}`;
  }

  console.log("\n3. Creating the 6 Demo Scenario Tickets...");
  const createdDemoTickets: Array<{
    num: number;
    code: string;
    title: string;
    state: string;
    demoRole: string;
    demoLogin: string;
    feature: string;
  }> = [];

  // ---------------------------------------------------------------------------
  // Ticket 1: Room A-301: "[DEMO] Ceiling fan not working" -> ASSIGNED with ETA
  // ---------------------------------------------------------------------------
  const code1 = await getNextTicketCode();
  const t1 = await prisma.ticket.create({
    data: {
      code: code1,
      title: "[DEMO] Ceiling fan not working",
      description: "Ceiling fan makes loud grinding noise and does not rotate even at speed 5.",
      locationType: LocationType.ROOM,
      roomId: roomA301?.id,
      blockId: blockA.id,
      floor: 3,
      categoryId: catElectrician.id,
      priority: Priority.NORMAL,
      status: TicketStatus.ASSIGNED,
      raisedById: student1.id,
      assignedToId: electrician2.id,
      createdAt: new Date(now.getTime() - 45 * 60 * 1000),
      dueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      etaP50At: new Date(now.getTime() + 60 * 60 * 1000),
      etaP80At: new Date(now.getTime() + 105 * 60 * 1000),
      etaNotifiedP50At: new Date(now.getTime() + 60 * 60 * 1000),
      completionCode: "3819",
      events: {
        createMany: {
          data: [
            {
              actorId: student1.id,
              type: "CREATED",
              fromStatus: null,
              toStatus: TicketStatus.ASSIGNED,
              note: "Ticket raised by occupant in Room A-301",
              createdAt: new Date(now.getTime() - 45 * 60 * 1000),
            },
            {
              actorId: student1.id,
              type: "ASSIGNED",
              fromStatus: TicketStatus.RAISED,
              toStatus: TicketStatus.ASSIGNED,
              note: `Assigned to ${electrician2.name}`,
              createdAt: new Date(now.getTime() - 40 * 60 * 1000),
            },
          ],
        },
      },
      predictions: {
        create: {
          staffId: electrician2.id,
          predictedP50At: new Date(now.getTime() + 60 * 60 * 1000),
          predictedP80At: new Date(now.getTime() + 105 * 60 * 1000),
          createdAt: new Date(now.getTime() - 40 * 60 * 1000),
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 1,
    code: t1.code,
    title: t1.title,
    state: "ASSIGNED",
    demoRole: "Student (Room A-301)",
    demoLogin: "student1@hosteldesk.dev",
    feature: "Student view, ETA range, 'Why this estimate?' breakdown",
  });

  // ---------------------------------------------------------------------------
  // Ticket 2: Common Area Floor 3 Washroom: "[DEMO] No water in washroom" -> ASSIGNED, 2 followers
  // ---------------------------------------------------------------------------
  const code2 = await getNextTicketCode();
  const t2 = await prisma.ticket.create({
    data: {
      code: code2,
      title: "[DEMO] No water in washroom",
      description: "Main supply line on 3rd floor washroom has no water pressure. Faucets and flush tanks dry.",
      locationType: LocationType.COMMON,
      blockId: blockA.id,
      floor: 3,
      commonSpot: "Block A Floor 3 Washroom",
      categoryId: catPlumber.id,
      priority: Priority.URGENT,
      status: TicketStatus.ASSIGNED,
      raisedById: student1.id,
      assignedToId: plumber1.id,
      createdAt: new Date(now.getTime() - 90 * 60 * 1000),
      dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
      etaP50At: new Date(now.getTime() + 45 * 60 * 1000),
      etaP80At: new Date(now.getTime() + 75 * 60 * 1000),
      followers: {
        createMany: {
          data: [
            { userId: student2.id },
            { userId: student3.id },
          ],
        },
      },
      events: {
        createMany: {
          data: [
            {
              actorId: student1.id,
              type: "CREATED",
              fromStatus: null,
              toStatus: TicketStatus.ASSIGNED,
              note: "Raised in common area: Block A Floor 3 Washroom",
              createdAt: new Date(now.getTime() - 90 * 60 * 1000),
            },
            {
              actorId: student1.id,
              type: "ASSIGNED",
              fromStatus: TicketStatus.RAISED,
              toStatus: TicketStatus.ASSIGNED,
              note: `Assigned to ${plumber1.name}`,
              createdAt: new Date(now.getTime() - 80 * 60 * 1000),
            },
          ],
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 2,
    code: t2.code,
    title: t2.title,
    state: "ASSIGNED (2 Followers)",
    demoRole: "Student (Block A)",
    demoLogin: "student1@hosteldesk.dev / student2",
    feature: "Common area duplicate grouping and 'Join Issue' flow",
  });

  // ---------------------------------------------------------------------------
  // Ticket 3: Room A-302: "[DEMO] Door lock broken" -> AWAITING_ACCESS, real door photo
  // ---------------------------------------------------------------------------
  const code3 = await getNextTicketCode();
  const t3 = await prisma.ticket.create({
    data: {
      code: code3,
      title: "[DEMO] Door lock broken",
      description: "Mortise key lock mechanism jammed from outside.",
      locationType: LocationType.ROOM,
      roomId: roomA302?.id,
      blockId: blockA.id,
      floor: 3,
      categoryId: catCarpenter.id,
      priority: Priority.NORMAL,
      status: TicketStatus.AWAITING_ACCESS,
      lockedVisitCount: 1,
      pausedAt: new Date(now.getTime() - 25 * 60 * 1000),
      totalPausedMinutes: 0,
      raisedById: student3.id,
      assignedToId: carpenter1.id,
      createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      startedAt: new Date(now.getTime() - 30 * 60 * 1000),
      dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      completionCode: "5512",
      attachments: {
        create: {
          uploaderId: carpenter1.id,
          url: doorUpload.url,
          publicId: doorUpload.publicId,
          kind: AttachmentKind.DOOR,
          createdAt: new Date(now.getTime() - 25 * 60 * 1000),
        },
      },
      events: {
        createMany: {
          data: [
            {
              actorId: student3.id,
              type: "CREATED",
              fromStatus: null,
              toStatus: TicketStatus.ASSIGNED,
              createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
            },
            {
              actorId: carpenter1.id,
              type: "STATUS_CHANGED",
              fromStatus: TicketStatus.ASSIGNED,
              toStatus: TicketStatus.IN_PROGRESS,
              createdAt: new Date(now.getTime() - 30 * 60 * 1000),
            },
            {
              actorId: carpenter1.id,
              type: "ROOM_LOCKED",
              fromStatus: TicketStatus.IN_PROGRESS,
              toStatus: TicketStatus.AWAITING_ACCESS,
              note: "Room found locked. Door photo attached.",
              createdAt: new Date(now.getTime() - 25 * 60 * 1000),
            },
          ],
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 3,
    code: t3.code,
    title: t3.title,
    state: "AWAITING_ACCESS",
    demoRole: "Student (Room A-302)",
    demoLogin: "student3@hosteldesk.dev",
    feature: "Locked-room flow: door photo, 15-min quick return & slot picker",
  });

  // ---------------------------------------------------------------------------
  // Ticket 4: Room A-305: "[DEMO] Tap leaking" -> RESOLVED via code, real after-photo
  // ---------------------------------------------------------------------------
  const code4 = await getNextTicketCode();
  const t4 = await prisma.ticket.create({
    data: {
      code: code4,
      title: "[DEMO] Tap leaking",
      description: "Bathroom basin tap leaking water continuously.",
      locationType: LocationType.ROOM,
      roomId: roomA305?.id,
      blockId: blockA.id,
      floor: 3,
      categoryId: catPlumber.id,
      priority: Priority.NORMAL,
      status: TicketStatus.RESOLVED,
      resolutionMethod: ResolutionMethod.CODE,
      raisedById: student4.id,
      assignedToId: plumber2.id,
      createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      startedAt: new Date(now.getTime() - 90 * 60 * 1000),
      resolvedAt: new Date(now.getTime() - 60 * 60 * 1000),
      actualWorkMinutes: 30,
      dueAt: new Date(now.getTime() + 20 * 60 * 60 * 1000),
      completionCode: "9421",
      attachments: {
        create: {
          uploaderId: plumber2.id,
          url: tapUpload.url,
          publicId: tapUpload.publicId,
          kind: AttachmentKind.AFTER,
          createdAt: new Date(now.getTime() - 62 * 60 * 1000),
        },
      },
      events: {
        createMany: {
          data: [
            {
              actorId: student4.id,
              type: "CREATED",
              fromStatus: null,
              toStatus: TicketStatus.ASSIGNED,
              createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
            },
            {
              actorId: plumber2.id,
              type: "STATUS_CHANGED",
              fromStatus: TicketStatus.ASSIGNED,
              toStatus: TicketStatus.IN_PROGRESS,
              createdAt: new Date(now.getTime() - 90 * 60 * 1000),
            },
            {
              actorId: plumber2.id,
              type: "CODE_VERIFIED",
              fromStatus: TicketStatus.IN_PROGRESS,
              toStatus: TicketStatus.RESOLVED,
              note: "Completion code 9421 verified by occupant",
              createdAt: new Date(now.getTime() - 60 * 60 * 1000),
            },
          ],
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 4,
    code: t4.code,
    title: t4.title,
    state: "RESOLVED (via Code)",
    demoRole: "Student (Room A-305)",
    demoLogin: "student4@hosteldesk.dev",
    feature: "Confirm / Dispute with 48h auto-close countdown & after-photo evidence",
  });

  // ---------------------------------------------------------------------------
  // Ticket 5: Room A-310: "[DEMO] Power point not working" -> ASSIGNED, dueAt 20 min from now
  // ---------------------------------------------------------------------------
  const code5 = await getNextTicketCode();
  const t5 = await prisma.ticket.create({
    data: {
      code: code5,
      title: "[DEMO] Power point not working",
      description: "Wall socket near the study table has no power; the plug tester light stays off.",
      locationType: LocationType.ROOM,
      roomId: roomA310?.id,
      blockId: blockA.id,
      floor: 3,
      categoryId: catElectrician.id,
      priority: Priority.NORMAL,
      status: TicketStatus.ASSIGNED,
      escalationLevel: 0,
      raisedById: student2.id,
      assignedToId: electrician1.id,
      createdAt: new Date(now.getTime() - 23.5 * 60 * 60 * 1000),
      dueAt: new Date(now.getTime() + 20 * 60 * 1000), // 20 minutes from now!
      etaP50At: new Date(now.getTime() + 15 * 60 * 1000),
      etaP80At: new Date(now.getTime() + 35 * 60 * 1000),
      completionCode: "1674",
      events: {
        create: {
          actorId: student2.id,
          type: "CREATED",
          fromStatus: null,
          toStatus: TicketStatus.ASSIGNED,
          createdAt: new Date(now.getTime() - 23.5 * 60 * 60 * 1000),
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 5,
    code: t5.code,
    title: t5.title,
    state: "ASSIGNED (due in 20 min)",
    demoRole: "Admin / Warden / Student",
    demoLogin: "admin@hosteldesk.dev / warden.a@hosteldesk.dev",
    feature: "Live escalation: advance demo time by +1h to watch deadline breach escalate",
  });

  // ---------------------------------------------------------------------------
  // Ticket 6: Room A-401: "[DEMO] Socket sparking" -> IN_PROGRESS, open CODE_REFUSED dispute
  // ---------------------------------------------------------------------------
  const code6 = await getNextTicketCode();
  const t6 = await prisma.ticket.create({
    data: {
      code: code6,
      title: "[DEMO] Socket sparking",
      description: "Electrical switchboard produces intermittent sparks and burning smell.",
      locationType: LocationType.ROOM,
      roomId: roomA401?.id,
      blockId: blockA.id,
      floor: 4,
      categoryId: catElectrician.id,
      priority: Priority.URGENT,
      status: TicketStatus.IN_PROGRESS,
      raisedById: student1.id,
      assignedToId: electrician3.id,
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      startedAt: new Date(now.getTime() - 40 * 60 * 1000),
      dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      completionCode: "7743",
      attachments: {
        create: {
          uploaderId: electrician3.id,
          url: socketUpload.url,
          publicId: socketUpload.publicId,
          kind: AttachmentKind.AFTER,
          createdAt: new Date(now.getTime() - 15 * 60 * 1000),
        },
      },
      disputes: {
        create: {
          raisedById: electrician3.id,
          type: DisputeType.CODE_REFUSED,
          reason: "Completed socket wiring replacement and after-photo taken; occupant was unavailable/refused code",
          status: DisputeStatus.OPEN,
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      },
      events: {
        createMany: {
          data: [
            {
              actorId: student1.id,
              type: "CREATED",
              fromStatus: null,
              toStatus: TicketStatus.ASSIGNED,
              createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
            },
            {
              actorId: electrician3.id,
              type: "STATUS_CHANGED",
              fromStatus: TicketStatus.ASSIGNED,
              toStatus: TicketStatus.IN_PROGRESS,
              createdAt: new Date(now.getTime() - 40 * 60 * 1000),
            },
            {
              actorId: electrician3.id,
              type: "DISPUTE_RAISED",
              fromStatus: TicketStatus.IN_PROGRESS,
              toStatus: TicketStatus.IN_PROGRESS,
              note: "Technician reported CODE_REFUSED dispute to Warden",
              createdAt: new Date(now.getTime() - 10 * 60 * 1000),
            },
          ],
        },
      },
    },
  });
  createdDemoTickets.push({
    num: 6,
    code: t6.code,
    title: t6.title,
    state: "IN_PROGRESS (Open Dispute)",
    demoRole: "Warden Block A",
    demoLogin: "warden.a@hosteldesk.dev",
    feature: "Warden dispute queue: review after-photo, uphold/overrule technician claim",
  });

  // 4. Recompute queues for affected staff
  console.log("\n4. Recomputing technician schedule queues...");
  const affectedStaffIds = [
    electrician1.id,
    electrician2.id,
    electrician3.id,
    plumber1.id,
    plumber2.id,
    carpenter1.id,
  ];
  for (const staffId of affectedStaffIds) {
    await EtaService.recomputeStaffQueue(staffId);
  }
  console.log("   ✓ All staff queues recomputed.");

  // 5. Print Demo Guide Table
  console.log("\n========================================================================================================");
  console.log("🎥 DEMO RECORDING SCENARIOS READY");
  console.log("========================================================================================================");
  console.table(
    createdDemoTickets.map((t) => ({
      "#": t.num,
      Code: t.code,
      State: t.state,
      "Log In As": t.demoLogin,
      "What To Show In Video": t.feature,
    }))
  );
  console.log("Password for all demo accounts: Demo@1234");
  console.log("========================================================================================================\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed demo failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
