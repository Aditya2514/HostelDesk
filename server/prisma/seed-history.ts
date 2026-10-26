import { PrismaClient, Role, Trade, Priority, TicketStatus, LocationType, ResolutionMethod, CloseReason } from "@prisma/client";
import { clock } from "../src/lib/clock";
import { calculateBlendedEstimate } from "../src/modules/scheduling/estimator";
import { EtaService } from "../src/modules/scheduling/eta.service";

const prisma = new PrismaClient();

// Seeded PRNG for 100% deterministic reproducibility
function createPrng(seed: number) {
  let s = seed;
  return function next(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rng: () => number, mean = 0, std = 1): number {
  const u1 = Math.max(rng(), 1e-7);
  const u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

function randomLogNormal(rng: () => number, targetMedian: number, sigma = 0.22): number {
  const mu = Math.log(targetMedian);
  const val = Math.exp(randomNormal(rng, mu, sigma));
  return Math.max(5, Math.round(val));
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--confirm")) {
    console.error("Refusing to run seed:history in production without --confirm flag");
    process.exit(1);
  }

  console.log("🌱 Starting reproducible synthetic history generation...");
  const rng = createPrng(424242);

  // 1. Delete previous synthetic tickets (idempotence)
  console.log("Cleaning up previous synthetic data...");
  const deleted = await prisma.ticket.deleteMany({
    where: { isSynthetic: true },
  });
  console.log(`Deleted ${deleted.count} previous synthetic tickets.`);

  // 2. Fetch context data
  const users = await prisma.user.findMany();
  const students = users.filter((u) => u.role === Role.STUDENT);
  const allStaff = users.filter((u) => u.role === Role.STAFF && u.trade);
  const wardens = users.filter((u) => u.role === Role.WARDEN);
  const blocks = await prisma.block.findMany();
  const rooms = await prisma.room.findMany();
  const categories = await prisma.category.findMany();

  if (students.length === 0 || allStaff.length === 0 || categories.length === 0) {
    throw new Error("Base database entities missing. Please run base seed first.");
  }

  // Define staff speed factors: one electrician noticeably slow (x1.4), one plumber fast (x0.8)
  const electricians = allStaff.filter((s) => s.trade === Trade.ELECTRICIAN);
  const plumbers = allStaff.filter((s) => s.trade === Trade.PLUMBER);
  const slowElectricianId = electricians[0]?.id;
  const fastPlumberId = plumbers[0]?.id;

  const getStaffSpeedFactor = (staffId: string): number => {
    if (staffId === slowElectricianId) return 1.4;
    if (staffId === fastPlumberId) return 0.8;
    return 1.0;
  };

  // True duration medians vs defaults (so estimator visibly learns from data)
  const getTrueMedian = (catName: string, defaultMin: number): number => {
    const lower = catName.toLowerCase();
    if (lower.includes("fan") || lower.includes("light") || lower.includes("socket")) return 70; // default 40
    if (lower.includes("water cooler") || lower.includes("geyser")) return 75; // default 60
    if (lower.includes("no power")) return 60; // default 45
    if (lower.includes("wifi") || lower.includes("internet")) return 25; // default 30
    if (lower.includes("drainage") || lower.includes("leak") || lower.includes("plumb")) return 55;
    return defaultMin;
  };

  const now = clock.now();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  const startHistoryTime = new Date(now.getTime() - sixtyDaysMs);

  // 3. Generate timestamps for 200 completed tickets over the past 60 days
  const completedTicketsCount = 200;
  interface PlannedTicket {
    code: string;
    studentId: string;
    staffId: string;
    categoryId: string;
    categoryName: string;
    defaultDurationMin: number;
    trueMedian: number;
    blockId: string;
    floor: number;
    roomId: string | null;
    locationType: LocationType;
    commonSpot: string | null;
    priority: Priority;
    title: string;
    description: string;
    createdAt: Date;
    actualWorkMinutes: number;
    resolutionMethod: ResolutionMethod;
    reopenCount: number;
    lockedVisitCount: number;
  }

  const plannedTickets: PlannedTicket[] = [];

  // Spread tickets uniformly over 60 days with realistic shift hours (09:00 - 18:00 IST)
  for (let i = 0; i < completedTicketsCount; i++) {
    // Generate day offset between 0 and 59 days ago
    const dayRatio = i / completedTicketsCount; // 0.0 to 1.0 chronological
    const ticketDayMs = startHistoryTime.getTime() + dayRatio * (sixtyDaysMs - 2 * 60 * 60 * 1000);

    // Pick hour during work shift (09:00 to 17:00 IST = 03:30 to 11:30 UTC)
    const hourOffsetMinutes = Math.floor(rng() * 480); // 8 hours in minutes
    const ticketCreatedMs = ticketDayMs + hourOffsetMinutes * 60 * 1000;
    const createdAt = new Date(ticketCreatedMs);

    // Pick random category
    const cat = categories[Math.floor(rng() * categories.length)];
    const eligibleStaff = allStaff.filter((s) => s.trade === cat.trade);
    const staff = eligibleStaff[Math.floor(rng() * eligibleStaff.length)] || allStaff[0];

    // Pick student and location
    const student = students[Math.floor(rng() * students.length)];
    const isRoom = rng() > 0.25; // 75% room, 25% common
    const room = rooms[Math.floor(rng() * rooms.length)];
    const block = blocks.find((b) => b.id === room.blockId) || blocks[0];

    // True work duration calculation with log-normal noise and staff speed factor
    const trueMed = getTrueMedian(cat.name, cat.defaultDurationMin);
    const baseDuration = randomLogNormal(rng, trueMed);
    const speedFactor = getStaffSpeedFactor(staff.id);
    const actualWorkMinutes = Math.max(10, Math.round(baseDuration * speedFactor));

    // Resolution method mix: ~75% CODE, ~20% PHOTO, ~5% WARDEN
    const methodRand = rng();
    let resolutionMethod = ResolutionMethod.CODE;
    if (methodRand > 0.95) {
      resolutionMethod = ResolutionMethod.WARDEN;
    } else if (methodRand > 0.75 || !isRoom) {
      resolutionMethod = ResolutionMethod.PHOTO;
    }

    // Edge cases: 8% reopened once, 10% locked visits
    const reopenCount = rng() < 0.08 ? 1 : 0;
    const lockedVisitCount = rng() < 0.10 ? 1 : 0;

    const code = `HD-SYN-${String(i + 1).padStart(4, "0")}`;

    plannedTickets.push({
      code,
      studentId: student.id,
      staffId: staff.id,
      categoryId: cat.id,
      categoryName: cat.name,
      defaultDurationMin: cat.defaultDurationMin,
      trueMedian: trueMed,
      blockId: block.id,
      floor: isRoom ? room.floor : (Math.floor(rng() * 4) + 1),
      roomId: isRoom ? room.id : null,
      locationType: isRoom ? LocationType.ROOM : LocationType.COMMON,
      commonSpot: isRoom ? null : "Floor Corridor / Washroom",
      priority: rng() < 0.2 ? Priority.URGENT : Priority.NORMAL,
      title: `${cat.name} issue in ${isRoom ? `Room ${room.number}` : "common area"}`,
      description: `Reported issue with ${cat.name}. Needs inspection and fix.`,
      createdAt,
      actualWorkMinutes,
      resolutionMethod,
      reopenCount,
      lockedVisitCount,
    });
  }

  // Sort chronologically
  plannedTickets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // 4. Chronological Replay: insert tickets and generate improving predictions
  console.log("Inserting 200 historical completed tickets with progressive predictions...");

  // Cache to track historical tickets that completed before each ticket
  interface PastRecord {
    categoryId: string;
    blockId: string;
    actualWorkMinutes: number;
  }
  const historyRecords: PastRecord[] = [];

  for (let idx = 0; idx < plannedTickets.length; idx++) {
    const t = plannedTickets[idx];

    // Compute prediction using only history before this ticket
    const similarHostel = historyRecords.filter((h) => h.categoryId === t.categoryId);
    const similarBlock = similarHostel.filter((h) => h.blockId === t.blockId);

    let n = 0;
    let observedMedian: number | null = null;
    let observedP80: number | null = null;
    let scope: "BLOCK" | "HOSTEL" = "HOSTEL";

    if (similarBlock.length >= 5) {
      n = similarBlock.length;
      scope = "BLOCK";
      const durations = similarBlock.map((s) => s.actualWorkMinutes);
      observedMedian = calculatePercentile(durations, 0.5);
      observedP80 = calculatePercentile(durations, 0.8);
    } else if (similarHostel.length > 0) {
      n = similarHostel.length;
      scope = "HOSTEL";
      const durations = similarHostel.map((s) => s.actualWorkMinutes);
      observedMedian = calculatePercentile(durations, 0.5);
      observedP80 = calculatePercentile(durations, 0.8);
    }

    const predictionEst = calculateBlendedEstimate({
      defaultDuration: t.defaultDurationMin,
      n,
      observedMedian,
      observedP80,
      scope,
    });

    const predictedP50At = new Date(t.createdAt.getTime() + predictionEst.p50Minutes * 60 * 1000);
    const predictedP80At = new Date(t.createdAt.getTime() + predictionEst.p80Minutes * 60 * 1000);

    // Timestamps for lifecycle events
    const startedAt = new Date(t.createdAt.getTime() + 60 * 60 * 1000); // 1 hour after creation
    const resolvedAt = new Date(startedAt.getTime() + t.actualWorkMinutes * 60 * 1000);
    const closedAt = new Date(resolvedAt.getTime() + 30 * 60 * 1000);
    const dueAt = new Date(t.createdAt.getTime() + 48 * 60 * 60 * 1000);

    // Insert ticket
    const createdTicket = await prisma.ticket.create({
      data: {
        code: t.code,
        locationType: t.locationType,
        roomId: t.roomId,
        blockId: t.blockId,
        floor: t.floor,
        commonSpot: t.commonSpot,
        categoryId: t.categoryId,
        priority: t.priority,
        title: t.title,
        description: t.description,
        status: TicketStatus.CLOSED,
        closeReason: CloseReason.CONFIRMED,
        raisedById: t.studentId,
        assignedToId: t.staffId,
        isSynthetic: true,
        actualWorkMinutes: t.actualWorkMinutes,
        resolutionMethod: t.resolutionMethod,
        reopenCount: t.reopenCount,
        lockedVisitCount: t.lockedVisitCount,
        startedAt,
        resolvedAt,
        closedAt,
        dueAt,
        etaP50At: predictedP50At,
        etaP80At: predictedP80At,
        etaNotifiedP50At: predictedP50At,
        createdAt: t.createdAt,
        updatedAt: closedAt,
      },
    });

    // Record Prediction
    await prisma.ticketPrediction.create({
      data: {
        ticketId: createdTicket.id,
        staffId: t.staffId,
        predictedP50At,
        predictedP80At,
        createdAt: t.createdAt,
      },
    });

    // Record Events
    await prisma.ticketEvent.createMany({
      data: [
        {
          ticketId: createdTicket.id,
          actorId: t.studentId,
          type: "CREATED",
          note: "Ticket reported by student",
          createdAt: t.createdAt,
        },
        {
          ticketId: createdTicket.id,
          actorId: null,
          fromStatus: TicketStatus.RAISED,
          toStatus: TicketStatus.ASSIGNED,
          type: "ASSIGNED",
          note: "Assigned by schedule simulation",
          createdAt: t.createdAt,
        },
        {
          ticketId: createdTicket.id,
          actorId: t.staffId,
          fromStatus: TicketStatus.ASSIGNED,
          toStatus: TicketStatus.IN_PROGRESS,
          type: "STATUS_CHANGED",
          note: "Staff started work",
          createdAt: startedAt,
        },
        {
          ticketId: createdTicket.id,
          actorId: t.staffId,
          fromStatus: TicketStatus.IN_PROGRESS,
          toStatus: TicketStatus.RESOLVED,
          type: "STATUS_CHANGED",
          note: `Resolved via ${t.resolutionMethod}`,
          createdAt: resolvedAt,
        },
        {
          ticketId: createdTicket.id,
          actorId: t.studentId,
          fromStatus: TicketStatus.RESOLVED,
          toStatus: TicketStatus.CLOSED,
          type: "STATUS_CHANGED",
          note: "Occupant confirmed fix",
          createdAt: closedAt,
        },
      ],
    });

    // Record in history accumulator for future predictions
    historyRecords.push({
      categoryId: t.categoryId,
      blockId: t.blockId,
      actualWorkMinutes: t.actualWorkMinutes,
    });
  }

  // 5. Create ~12 currently open tickets (10 ASSIGNED, 2 IN_PROGRESS)
  console.log("Creating 12 live open tickets sitting in staff queues...");
  const openCount = 12;

  for (let j = 0; j < openCount; j++) {
    const cat = categories[j % categories.length];
    const eligibleStaff = allStaff.filter((s) => s.trade === cat.trade);
    const staff = eligibleStaff[j % eligibleStaff.length] || allStaff[0];
    const student = students[j % students.length];
    const room = rooms[j % rooms.length];
    const block = blocks.find((b) => b.id === room.blockId) || blocks[0];

    const isInProgress = j < 2; // 2 in progress
    const createdOffsetMin = (j + 1) * 35;
    const ticketCreatedAt = new Date(now.getTime() - createdOffsetMin * 60 * 1000);
    const startedAt = isInProgress ? new Date(now.getTime() - 15 * 60 * 1000) : null;
    const dueAt = new Date(ticketCreatedAt.getTime() + 48 * 60 * 60 * 1000);

    const openCode = `HD-SYN-OPEN-${String(j + 1).padStart(2, "0")}`;

    const createdOpenTicket = await prisma.ticket.create({
      data: {
        code: openCode,
        locationType: LocationType.ROOM,
        roomId: room.id,
        blockId: block.id,
        floor: room.floor,
        categoryId: cat.id,
        priority: j === 0 ? Priority.URGENT : Priority.NORMAL,
        title: `Active ${cat.name} in Room ${room.number}`,
        description: `Current open ticket in queue for testing live schedule engine.`,
        status: isInProgress ? TicketStatus.IN_PROGRESS : TicketStatus.ASSIGNED,
        raisedById: student.id,
        assignedToId: staff.id,
        isSynthetic: true,
        startedAt,
        dueAt,
        createdAt: ticketCreatedAt,
      },
    });

    await prisma.ticketEvent.create({
      data: {
        ticketId: createdOpenTicket.id,
        actorId: student.id,
        type: "CREATED",
        note: "Active ticket created in queue",
        createdAt: ticketCreatedAt,
      },
    });

    if (isInProgress) {
      await prisma.ticketEvent.create({
        data: {
          ticketId: createdOpenTicket.id,
          actorId: staff.id,
          fromStatus: TicketStatus.ASSIGNED,
          toStatus: TicketStatus.IN_PROGRESS,
          type: "STATUS_CHANGED",
          note: "Staff started work",
          createdAt: startedAt!,
        },
      });
    }
  }

  // 6. Run recomputeStaffQueue for all staff members to populate live ETAs
  console.log("Recomputing live queues for all staff members...");
  for (const staff of allStaff) {
    await EtaService.recomputeStaffQueue(staff.id, "initial synthetic queue setup", prisma);
  }

  const finalTotal = await prisma.ticket.count({ where: { isSynthetic: true } });
  console.log(`\n=============================================================`);
  console.log(`🎉 Synthetic History Generation Complete!`);
  console.log(`Total Synthetic Tickets: ${finalTotal} (200 completed + 12 open)`);
  console.log(`=============================================================\n`);
}

main()
  .catch((e) => {
    console.error("Error generating synthetic history:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
