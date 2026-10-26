import { app } from "../src/app";
import request from "supertest";

const DEMO_ACCOUNTS = [
  {
    email: "student1@hosteldesk.dev",
    role: "STUDENT",
    expectedRoom: "A-301",
    expectedBlock: "A",
  },
  {
    email: "student2@hosteldesk.dev",
    role: "STUDENT",
    expectedRoom: "A-301",
    expectedBlock: "A",
  },
  {
    email: "plumber1@hosteldesk.dev",
    role: "STAFF",
    expectedTrade: "PLUMBER",
  },
  {
    email: "electrician1@hosteldesk.dev",
    role: "STAFF",
    expectedTrade: "ELECTRICIAN",
  },
  {
    email: "warden.a@hosteldesk.dev",
    role: "WARDEN",
    expectedBlock: "A",
  },
  {
    email: "chief@hosteldesk.dev",
    role: "CHIEF_WARDEN",
  },
  {
    email: "admin@hosteldesk.dev",
    role: "ADMIN",
  },
];

async function runStep0Verification() {
  console.log("=================================================");
  console.log("🔍 Verifying Step 0 against Real Neon PostgreSQL");
  console.log("=================================================");

  let allPassed = true;
  let studentCookie = "";
  let adminCookie = "";

  for (const acc of DEMO_ACCOUNTS) {
    // 1. Test POST /api/auth/login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: acc.email, password: "Demo@1234" });

    if (loginRes.status !== 200) {
      console.error(`❌ Login failed for ${acc.email}:`, loginRes.status, loginRes.body);
      allPassed = false;
      continue;
    }

    const cookie = loginRes.headers["set-cookie"]?.[0];
    if (!cookie) {
      console.error(`❌ No set-cookie header returned for ${acc.email}`);
      allPassed = false;
      continue;
    }

    if (acc.email === "student1@hosteldesk.dev") studentCookie = cookie;
    if (acc.email === "admin@hosteldesk.dev") adminCookie = cookie;

    // 2. Test GET /api/auth/me with cookie
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie);

    if (meRes.status !== 200) {
      console.error(`❌ /api/auth/me failed for ${acc.email}:`, meRes.status, meRes.body);
      allPassed = false;
      continue;
    }

    const user = meRes.body.user;
    if (user.role !== acc.role) {
      console.error(`❌ Role mismatch for ${acc.email}: expected ${acc.role}, got ${user.role}`);
      allPassed = false;
    }

    if (acc.expectedTrade && user.trade !== acc.expectedTrade) {
      console.error(`❌ Trade mismatch for ${acc.email}: expected ${acc.expectedTrade}, got ${user.trade}`);
      allPassed = false;
    }

    if (acc.expectedRoom) {
      if (user.currentRoom?.displayName !== acc.expectedRoom) {
        console.error(`❌ Room mismatch for ${acc.email}: expected ${acc.expectedRoom}, got ${user.currentRoom?.displayName}`);
        allPassed = false;
      }
    }

    console.log(`✓ ${acc.email.padEnd(28)} [${user.role.padEnd(12)}] OK (Room: ${user.currentRoom?.displayName || "N/A"})`);
  }

  // 3. Test Student calling Admin endpoint -> Must return 403
  console.log("\n🔒 Testing Authorization Guards:");
  const studentAdminRes = await request(app)
    .post("/api/admin/demo/advance-time")
    .set("Cookie", studentCookie)
    .send({ minutes: 15 });

  if (studentAdminRes.status === 403) {
    console.log(`✓ Student accessing admin endpoint rejected with 403 FORBIDDEN`);
  } else {
    console.error(`❌ Expected 403 for student accessing admin endpoint, got ${studentAdminRes.status}`);
    allPassed = false;
  }

  // 4. Test Admin calling Admin endpoint -> Must return 200
  const adminAdminRes = await request(app)
    .post("/api/admin/demo/advance-time")
    .set("Cookie", adminCookie)
    .send({ minutes: 15 });

  if (adminAdminRes.status === 200) {
    console.log(`✓ Admin accessing admin endpoint accepted with 200 OK`);
  } else {
    console.error(`❌ Expected 200 for admin accessing admin endpoint, got ${adminAdminRes.status}`);
    allPassed = false;
  }

  console.log("=================================================");
  if (allPassed) {
    console.log("🎉 ALL STEP 0 CHECKS PASSED AGAINST REAL NEON DB!");
  } else {
    console.log("❌ SOME STEP 0 CHECKS FAILED!");
    process.exit(1);
  }
  console.log("=================================================");
}

runStep0Verification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error during Step 0 verification:", err);
    process.exit(1);
  });
