import {
  PrismaClient,
  Role,
  Trade,
  Priority,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const INDIAN_FIRST_NAMES = [
  "Aarav", "Aditya", "Akash", "Ananya", "Aniket", "Ankita", "Arjun", "Ayush",
  "Bhavna", "Chirag", "Deepak", "Divya", "Gaurav", "Harsh", "Ishaan", "Kavya",
  "Karan", "Kunal", "Manish", "Meera", "Neha", "Nikhil", "Pooja", "Pranav",
  "Priya", "Rahul", "Riya", "Rohan", "Sachin", "Sakshi", "Sameer", "Sanjay",
  "Shreya", "Siddharth", "Sneha", "Tanvi", "Tarun", "Utkarsh", "Varun", "Vikas",
  "Abhishek", "Aman", "Amit", "Anjali", "Ashish", "Dev", "Isha", "Kritika",
  "Mohit", "Naveen", "Nisha", "Pallavi", "Pankaj", "Prashant", "Preeti", "Rajesh",
  "Ritu", "Rohit", "Rupal", "Sandhya", "Saurabh", "Shivani", "Simran", "Sonam",
  "Sourabh", "Suhani", "Sunil", "Suresh", "Swati", "Tanya", "Umesh", "Vaibhav",
  "Vidya", "Vishal", "Yash", "Alok", "Amrita", "Anita", "Archana", "Arpita",
  "Bhavesh", "Chetan", "Damini", "Dharmesh", "Garima", "Geeta", "Hemant", "Himanshu",
  "Inder", "Jatin", "Jyoti", "Kamal", "Kapil", "Komal", "Lalit", "Madhuri",
  "Mayank", "Monika", "Mukesh", "Nandini", "Neeraj", "Nidhi", "Nitin", "Parul",
  "Payal", "Poonam", "Pradeep", "Prakash", "Rachit", "Radhika", "Raj", "Rakesh",
  "Rashmi", "Ravi", "Reema", "Renu", "Rishabh", "Rohan", "Ruchi", "Saloni",
  "Sangeeta", "Sanket", "Santosh", "Sarita", "Seema", "Shalini", "Shashank", "Shikha",
  "Shivam", "Shubham", "Somya", "Sonu", "Subhash", "Sudhir", "Sumit", "Suraj",
  "Sushma", "Sweta", "Tushar", "Vandana", "Varsha", "Vedant", "Veena", "Vinay",
  "Vineet", "Vinod", "Vipin", "Vivek", "Yogesh", "Zoya"
];

const INDIAN_LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Reddy", "Mehta",
  "Jain", "Chauhan", "Yadav", "Mishra", "Joshi", "Bhatia", "Saxena", "Malhotra",
  "Bansal", "Aggarwal", "Pandey", "Nair", "Iyer", "Rao", "Das", "Ghosh",
  "Chatterjee", "Sen", "Mukherjee", "Roy", "Banerjee", "Dutta"
];

const CATEGORIES_DATA = [
  {
    name: "No power in room",
    trade: Trade.ELECTRICIAN,
    defaultPriority: Priority.URGENT,
    defaultDurationMin: 45,
    slaMinutes: 4 * 60, // 4 hours
  },
  {
    name: "Fan / light / socket fault",
    trade: Trade.ELECTRICIAN,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 40,
    slaMinutes: 48 * 60, // 48 hours
  },
  {
    name: "Water cooler / geyser fault",
    trade: Trade.ELECTRICIAN,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 60,
    slaMinutes: 48 * 60, // 48 hours
  },
  {
    name: "No water / major leak",
    trade: Trade.PLUMBER,
    defaultPriority: Priority.URGENT,
    defaultDurationMin: 60,
    slaMinutes: 4 * 60, // 4 hours
  },
  {
    name: "Tap / flush / drain issue",
    trade: Trade.PLUMBER,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 45,
    slaMinutes: 48 * 60, // 48 hours
  },
  {
    name: "Door lock broken",
    trade: Trade.CARPENTER,
    defaultPriority: Priority.URGENT,
    defaultDurationMin: 30,
    slaMinutes: 4 * 60, // 4 hours
  },
  {
    name: "Furniture / window repair",
    trade: Trade.CARPENTER,
    defaultPriority: Priority.LOW,
    defaultDurationMin: 60,
    slaMinutes: 120 * 60, // 120 hours
  },
  {
    name: "Wi-Fi / network down",
    trade: Trade.NETWORK,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 30,
    slaMinutes: 24 * 60, // 24 hours
  },
  {
    name: "Cleaning required",
    trade: Trade.HOUSEKEEPING,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 30,
    slaMinutes: 24 * 60, // 24 hours
  },
  {
    name: "Pest control",
    trade: Trade.HOUSEKEEPING,
    defaultPriority: Priority.LOW,
    defaultDurationMin: 60,
    slaMinutes: 72 * 60, // 72 hours
  },
];

async function main() {
  console.log("🌱 Starting idempotent database seed for HostelDesk...");

  const passwordHash = await bcrypt.hash("Demo@1234", 10);
  const semesterStart = new Date("2026-08-01T00:00:00.000Z");

  // 1. Blocks: A, B, C
  const blockNames = ["A", "B", "C"];
  const blockMap = new Map<string, string>();

  for (const name of blockNames) {
    const block = await prisma.block.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    blockMap.set(name, block.id);
  }
  console.log(`✓ Blocks verified: ${blockNames.join(", ")}`);

  // 2. Rooms: 4 floors, 10 rooms per floor per block (e.g. A-101 to A-410)
  const roomMap = new Map<string, string>(); // key: "A-101", value: id
  for (const blockName of blockNames) {
    const blockId = blockMap.get(blockName)!;
    for (let floor = 1; floor <= 4; floor++) {
      for (let r = 1; r <= 10; r++) {
        const number = `${floor}${r < 10 ? "0" + r : r}`;
        const room = await prisma.room.upsert({
          where: {
            blockId_number: {
              blockId,
              number,
            },
          },
          update: {},
          create: {
            blockId,
            floor,
            number,
          },
        });
        roomMap.set(`${blockName}-${number}`, room.id);
      }
    }
  }
  console.log(`✓ Rooms verified: 120 rooms across blocks A, B, C`);

  // 3. Categories (Section 5.2 table)
  for (const cat of CATEGORIES_DATA) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {
        trade: cat.trade,
        defaultPriority: cat.defaultPriority,
        defaultDurationMin: cat.defaultDurationMin,
        slaMinutes: cat.slaMinutes,
        isActive: true,
      },
      create: {
        name: cat.name,
        trade: cat.trade,
        defaultPriority: cat.defaultPriority,
        defaultDurationMin: cat.defaultDurationMin,
        slaMinutes: cat.slaMinutes,
        isActive: true,
      },
    });
  }
  console.log(`✓ Categories verified: ${CATEGORIES_DATA.length} categories`);

  // 4. Admin and Wardens
  const admin = await prisma.user.upsert({
    where: { email: "admin@hosteldesk.dev" },
    update: { name: "Rajesh Sharma", passwordHash, role: Role.ADMIN, isActive: true },
    create: {
      name: "Rajesh Sharma",
      email: "admin@hosteldesk.dev",
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  const chief = await prisma.user.upsert({
    where: { email: "chief@hosteldesk.dev" },
    update: { name: "Dr. Alok Verma", passwordHash, role: Role.CHIEF_WARDEN, isActive: true },
    create: {
      name: "Dr. Alok Verma",
      email: "chief@hosteldesk.dev",
      passwordHash,
      role: Role.CHIEF_WARDEN,
      isActive: true,
    },
  });

  const wardensData = [
    { email: "warden.a@hosteldesk.dev", name: "Prof. Ramesh Kumar", blockName: "A" },
    { email: "warden.b@hosteldesk.dev", name: "Prof. Suresh Nair", blockName: "B" },
    { email: "warden.c@hosteldesk.dev", name: "Prof. Anita Rao", blockName: "C" },
  ];

  for (const w of wardensData) {
    await prisma.user.upsert({
      where: { email: w.email },
      update: {
        name: w.name,
        passwordHash,
        role: Role.WARDEN,
        blockId: blockMap.get(w.blockName),
        isActive: true,
      },
      create: {
        name: w.name,
        email: w.email,
        passwordHash,
        role: Role.WARDEN,
        blockId: blockMap.get(w.blockName),
        isActive: true,
      },
    });
  }
  console.log(`✓ Admin, Chief Warden, and 3 Block Wardens verified`);

  // 5. Staff (10): 3 electricians, 3 plumbers, 1 carpenter, 1 network tech, 2 housekeeping
  const staffList = [
    { email: "electrician1@hosteldesk.dev", name: "Manoj Singh", trade: Trade.ELECTRICIAN, shiftType: "standard" },
    { email: "electrician2@hosteldesk.dev", name: "Sunil Gupta", trade: Trade.ELECTRICIAN, shiftType: "standard" },
    { email: "electrician3@hosteldesk.dev", name: "Dinesh Yadav", trade: Trade.ELECTRICIAN, shiftType: "evening" },
    { email: "plumber1@hosteldesk.dev", name: "Rakesh Patel", trade: Trade.PLUMBER, shiftType: "standard" },
    { email: "plumber2@hosteldesk.dev", name: "Vinod Mishra", trade: Trade.PLUMBER, shiftType: "wednesday_off" },
    { email: "plumber3@hosteldesk.dev", name: "Pankaj Joshi", trade: Trade.PLUMBER, shiftType: "standard" },
    { email: "carpenter1@hosteldesk.dev", name: "Harish Saxena", trade: Trade.CARPENTER, shiftType: "standard" },
    { email: "network1@hosteldesk.dev", name: "Amit Aggarwal", trade: Trade.NETWORK, shiftType: "standard" },
    { email: "housekeeping1@hosteldesk.dev", name: "Santosh Roy", trade: Trade.HOUSEKEEPING, shiftType: "standard" },
    { email: "housekeeping2@hosteldesk.dev", name: "Meena Devi", trade: Trade.HOUSEKEEPING, shiftType: "standard" },
  ];

  for (const s of staffList) {
    const staffUser = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        name: s.name,
        passwordHash,
        role: Role.STAFF,
        trade: s.trade,
        isActive: true,
      },
      create: {
        name: s.name,
        email: s.email,
        passwordHash,
        role: Role.STAFF,
        trade: s.trade,
        isActive: true,
      },
    });

    // Clear existing shifts and re-create for idempotency
    await prisma.staffShift.deleteMany({ where: { staffId: staffUser.id } });

    const shiftRows = [];
    if (s.shiftType === "standard") {
      // Mon (1) to Sat (6): 9:00 - 13:00 (540 to 780), 14:00 - 18:00 (840 to 1080)
      for (let day = 1; day <= 6; day++) {
        shiftRows.push(
          { staffId: staffUser.id, weekday: day, startMinute: 540, endMinute: 780 },
          { staffId: staffUser.id, weekday: day, startMinute: 840, endMinute: 1080 }
        );
      }
    } else if (s.shiftType === "evening") {
      // Evening shift: Mon to Sat: 13:00 - 17:00 (780 to 1020), 18:00 - 22:00 (1080 to 1320)
      for (let day = 1; day <= 6; day++) {
        shiftRows.push(
          { staffId: staffUser.id, weekday: day, startMinute: 780, endMinute: 1020 },
          { staffId: staffUser.id, weekday: day, startMinute: 1080, endMinute: 1320 }
        );
      }
    } else if (s.shiftType === "wednesday_off") {
      // Sun (0) and Mon, Tue, Thu, Fri, Sat (Wednesday 3 off): 9:00 - 13:00, 14:00 - 18:00
      const days = [0, 1, 2, 4, 5, 6];
      for (const day of days) {
        shiftRows.push(
          { staffId: staffUser.id, weekday: day, startMinute: 540, endMinute: 780 },
          { staffId: staffUser.id, weekday: day, startMinute: 840, endMinute: 1080 }
        );
      }
    }

    await prisma.staffShift.createMany({ data: shiftRows });
  }
  console.log(`✓ Staff verified: 10 members with realistic shifts`);

  // 6. Demo Students
  // student1 and student2 in Room A-301
  const roomA301Id = roomMap.get("A-301")!;

  const student1 = await prisma.user.upsert({
    where: { email: "student1@hosteldesk.dev" },
    update: { name: "Aditya Singh", passwordHash, role: Role.STUDENT, isActive: true },
    create: {
      name: "Aditya Singh",
      email: "student1@hosteldesk.dev",
      passwordHash,
      role: Role.STUDENT,
      isActive: true,
    },
  });

  const student2 = await prisma.user.upsert({
    where: { email: "student2@hosteldesk.dev" },
    update: { name: "Karan Malhotra", passwordHash, role: Role.STUDENT, isActive: true },
    create: {
      name: "Karan Malhotra",
      email: "student2@hosteldesk.dev",
      passwordHash,
      role: Role.STUDENT,
      isActive: true,
    },
  });

  // Assign occupancy for student1 & student2
  await prisma.roomOccupancy.deleteMany({
    where: { userId: { in: [student1.id, student2.id] } },
  });
  await prisma.roomOccupancy.createMany({
    data: [
      { userId: student1.id, roomId: roomA301Id, fromDate: semesterStart },
      { userId: student2.id, roomId: roomA301Id, fromDate: semesterStart },
    ],
  });

  // 7. ~150 Students populated across rooms
  // Generate student pool
  const allRoomsList = Array.from(roomMap.entries()).filter(([key]) => key !== "A-301");
  let studentCount = 2; // already have student1 & student2
  const targetStudents = 150;

  for (let i = 0; i < allRoomsList.length && studentCount < targetStudents; i++) {
    const [, roomId] = allRoomsList[i];
    // Distribution: mostly 2 per room, some 1, some empty
    // First 60 rooms get 2 students = 120 students
    // Next 28 rooms get 1 student = 28 students
    // Remaining rooms empty
    const occupantsInRoom = i < 60 ? 2 : i < 88 ? 1 : 0;

    for (let o = 0; o < occupantsInRoom && studentCount < targetStudents; o++) {
      studentCount++;
      const firstName = INDIAN_FIRST_NAMES[(studentCount * 3 + o) % INDIAN_FIRST_NAMES.length];
      const lastName = INDIAN_LAST_NAMES[(studentCount * 7 + o) % INDIAN_LAST_NAMES.length];
      const fullName = `${firstName} ${lastName}`;
      const email = `student${studentCount}@hosteldesk.dev`;

      const user = await prisma.user.upsert({
        where: { email },
        update: { name: fullName, passwordHash, role: Role.STUDENT, isActive: true },
        create: {
          name: fullName,
          email,
          passwordHash,
          role: Role.STUDENT,
          isActive: true,
        },
      });

      // Ensure room occupancy
      await prisma.roomOccupancy.deleteMany({ where: { userId: user.id } });
      await prisma.roomOccupancy.create({
        data: {
          userId: user.id,
          roomId,
          fromDate: semesterStart,
        },
      });
    }
  }

  console.log(`✓ Students verified: ${studentCount} students assigned across blocks`);

  console.log(`
========================================================================
🎉 HostelDesk Idempotent Seeding Completed Successfully!
========================================================================
Demo Accounts (Password for all: Demo@1234):

Role          Email                     Details
------------------------------------------------------------------------
STUDENT       student1@hosteldesk.dev   Room A-301 (Roommate: student2)
STUDENT       student2@hosteldesk.dev   Room A-301 (Roommate: student1)
STAFF         electrician1@hosteldesk.dev Trade: ELECTRICIAN (Morning/Afternoon)
STAFF         plumber1@hosteldesk.dev     Trade: PLUMBER (Standard Shift)
WARDEN        warden.a@hosteldesk.dev   Block A Warden
CHIEF_WARDEN  chief@hosteldesk.dev      Chief Warden (All blocks)
ADMIN         admin@hosteldesk.dev      Hostel Admin
========================================================================
`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
