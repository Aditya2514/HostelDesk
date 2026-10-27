"""Generates the SVG diagrams in docs/assets/. Run: python3 docs/diagrams/src/make_flows.py
All diagrams are 1200-1300 px wide so text stays readable at README width."""
import pathlib, textwrap
from svgkit import Svg, P, esc
OUT = pathlib.Path(__file__).resolve().parents[2] / "assets"

# ───────────────────────── 1. Journey (hero) ─────────────────────────
def journey():
    W = 1200
    s = Svg(W, 1000, "One complaint, end to end", "Five stages: raise, route and predict, fix, prove, confirm, ending in a closed ticket with a full record, plus four safety nets.")
    s.heading("One complaint, end to end", "Every step leaves evidence, and every promise is checked against reality")
    stages = [
        ("1", "RAISE", "Student", "green", ["Report a room or common-area issue in seconds", "Priority comes from the category, not the student", "Same-room duplicates blocked; common-area reports can be joined"]),
        ("2", "ROUTE + PREDICT", "HostelDesk", "indigo", ["Simulates every eligible technician's real shifts and queue", "Routes to whoever finishes earliest", "Student sees a range plus a plain-language reason"]),
        ("3", "FIX", "Technician", "amber", ["Planned day with a start and finish time for each job", "Start work: a 4-digit code appears for the room's occupants", "Door locked? Photo it and the clock pauses"]),
        ("4", "PROVE", "Technician + Student", "orange", ["After-photo, timestamped by the server", "Occupant shares the code once satisfied", "5 wrong tries lock the ticket for 15 minutes"]),
        ("5", "CONFIRM", "Student", "green", ["Confirm, or report a problem within 48 hours", "A dispute always wins", "No response: auto-closes at 48 hours"]),
        ("✓", "CLOSED", "The record stays", "sky", ["Timeline of every change", "Photos, code check and who did what", "Feeds analytics and reliability scores"]),
    ]
    cw, ch, gap, x0, y0, y1 = 350, 352, 35, 40, 124, 526
    pos = [(x0, y0), (x0 + cw + gap, y0), (x0 + 2*(cw + gap), y0), (x0 + 2*(cw + gap), y1), (x0 + cw + gap, y1), (x0, y1)]
    PER = 13.0
    s.flow = False
    for i, ((num, title, actor, col, bullets), (x, y)) in enumerate(zip(stages, pos)):
        acc, dark = P[col]
        _m = s.mark()
        s.o.append(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="16" fill="#0d1428" stroke="{acc}" stroke-opacity="0.55" stroke-width="1.5"/></g>')
        s.o.append(f'<path d="M{x},{y+16} a16,16 0 0 1 16,-16 h{cw-32} a16,16 0 0 1 16,16 v6 h-{cw} z" fill="{acc}"/>')
        s.o.append(f'<circle cx="{x+40}" cy="{y+70}" r="23" fill="{dark}" stroke="{acc}" stroke-width="2.5"/>')
        s.text(x + 40, y + 78, num, 23, acc, 800, "middle")
        s.text(x + 76, y + 66, title, 19, "#f8fafc", 800, spacing=0.5)
        s.text(x + 76, y + 88, actor, 13.5, acc, 600)
        s.o.append(f'<line x1="{x+22}" y1="{y+116}" x2="{x+cw-22}" y2="{y+116}" stroke="#1e293b" stroke-width="1.5"/>')
        by = y + 152
        for b in bullets:
            lines = textwrap.wrap(b, 33)
            s.o.append(f'<circle cx="{x+30}" cy="{by-5}" r="4.5" fill="{acc}"/>')
            for k, ln in enumerate(lines):
                s.text(x + 46, by + k*22, ln, 15.5, "#cbd5e1")
            by += len(lines) * 22 + 18
        s.rise(_m)
        s.spot(x, y, cw, ch, col, i * 2.1, 2.1, PER, r=16)
    my = y0 + 70
    sq = lambda k: (k * 2.1 + 1.35, 0.7, PER)
    s.arrow([(x0+cw+4, my), (x0+cw+gap-6, my)], seq=sq(0)); s.arrow([(x0+2*cw+gap+4, my), (x0+2*cw+2*gap-6, my)], seq=sq(1))
    s.arrow([(x0+2*(cw+gap)+cw/2, y0+ch+4), (x0+2*(cw+gap)+cw/2, y1-6)], seq=sq(2))
    my2 = y1 + 70
    s.arrow([(x0+2*(cw+gap)-4, my2), (x0+cw+gap+cw+6, my2)], seq=sq(3)); s.arrow([(x0+cw+gap-4, my2), (x0+cw+6, my2)], seq=sq(4))
    ny = y1 + ch + 44
    s.text(x0, ny, "SAFETY NETS", 14, "#64748b", 800, spacing=2.5)
    nets = [("LOCKED ROOM", "amber", "Door photo is required and the SLA clock pauses. The occupant picks '15 minutes' or a time slot."),
            ("MISSED DEADLINE", "rose", "The block warden is alerted. Still open 24 hours later? The chief warden is alerted too."),
            ("DISPUTES", "violet", "Code refusals and false 'room locked' claims go to the warden, who decides from photos and the timeline."),
            ("LEARNING", "sky", "Every prediction is stored, then scored against what really happened, in working minutes.")]
    nw, ng = 272, 17
    nh = 156
    for i, (t, c, tx) in enumerate(nets):
        acc, dark = P[c]; x = x0 + i * (nw + ng); y = ny + 16
        _m = s.mark()
        s.o.append(f'<rect x="{x}" y="{y}" width="{nw}" height="{nh}" rx="14" fill="#0b1224" stroke="{acc}" stroke-opacity="0.45" stroke-width="1.5"/>')
        s.o.append(f'<rect x="{x}" y="{y+16}" width="5" height="{nh-32}" rx="2.5" fill="{acc}"/>')
        s.text(x + 22, y + 34, t, 14, acc, 800, spacing=1.2)
        for k, ln in enumerate(textwrap.wrap(tx, 29)):
            s.text(x + 22, y + 62 + k*22, ln, 15, "#cbd5e1")
        s.rise(_m, delay=1.2 + i * 0.12)
    s.h = ny + 16 + nh + 34
    s.o[0] = s.o[0].replace('height="1000"', f'height="{s.h}"').replace('viewBox="0 0 1200 1000"', f'viewBox="0 0 1200 {s.h}"')
    s.o[3] = s.o[3].replace('height="1000"', f'height="{s.h}"'); s.o[4] = s.o[4].replace('height="998"', f'height="{s.h-2}"')
    s.save(OUT / "journey.svg")

# ───────────────────────── 2. ETA engine ─────────────────────────
def eta():
    s = Svg(1200, 920, "How an ETA is built", "Inputs feed a duration estimate, a queue simulation and a routing choice; the student sees a range and reasons.")
    s.heading("How an ETA is built", "A transparent formula and a simulation of real shifts. No black box.")
    s.text(40, 128, "WHAT HOSTELDESK KNOWS", 13, "#64748b", 800, spacing=2.2)
    ins = [("Category default", "For example a fan repair is 40 minutes."),
           ("Similar past jobs", "Only code-verified or confirmed jobs: median and 80th percentile."),
           ("Shift windows", "Real hours in IST: lunch breaks, nights, days off."),
           ("Queue ahead", "In progress first, then urgent, normal, low; oldest first.")]
    for (h, b), y in zip(ins, [140, 254, 368, 482]):
        s.card(40, y, 300, 100, "slate", h, b, size=14, shadow=False)
    s.card(390, 140, 430, 200, "indigo", "HOW LONG WILL THE WORK TAKE?", None, num="1", spot=(0, 3.2, 9.6))
    s.text(420, 220, "estimate = (5 × default + n × median) ÷ (5 + n)", 15.5, "#e0e7ff", 700)
    s.text(420, 248, "n = number of trustworthy similar jobs. Example:", 13.5, "#94a3b8")
    s.text(420, 266, "default 40 min, observed median 70 min:", 13.5, "#94a3b8")
    for i, (a, b) in enumerate([("n = 0", "40 min"), ("n = 5", "55 min"), ("n = 45", "67 min")]):
        s.pill(420 + i * 130, 284, 124, 40, "indigo", f"{a} → {b}", 13.5)
    s.card(390, 380, 430, 200, "indigo", "WHEN WILL THEY GET TO IT?", ["Lay every queued job into the technician's real shift windows, skipping breaks, nights and days off."], num="2", spot=(3.2, 3.2, 9.6))
    for y in (190, 304, 418, 532): s.arrow([(340, y), (390, y)])
    s.arrow([(605, 340), (605, 380)], seq=(2.4, 0.8, 9.6))
    s.card(880, 250, 280, 240, "indigo", "WHO FINISHES FIRST?", ["Run steps 1 and 2 for every eligible technician. The ticket goes to the earliest finish, not the shortest queue."], num="3", spot=(6.4, 3.2, 9.6))
    s.arrow([(820, 480), (850, 480), (850, 370), (880, 370)], seq=(5.6, 0.8, 9.6))
    s.card(880, 530, 280, 200, "green", "THE STUDENT SEES", None)
    s.text(904, 596, "Likely by", 15, "#94a3b8"); s.text(904, 632, "Today 12:10 PM", 27, "#34d399", 800)
    s.text(904, 660, "latest around 2:15 PM", 15.5, "#cbd5e1")
    s.text(904, 694, "plus the reasons in plain words", 13.5, "#94a3b8"); s.text(904, 713, "(6 similar repairs, 2 jobs ahead…)", 13.5, "#94a3b8")
    s.arrow([(1020, 490), (1020, 530)], seq=(8.8, 0.7, 9.6))
    s.card(880, 770, 280, 120, "sky", "SCORED LATER", ["Each prediction is compared with what really happened, in working minutes."], size=14)
    s.arrow([(1020, 730), (1020, 770)], dashed=True)
    s.card(390, 650, 430, 130, "amber", "RE-RUN AUTOMATICALLY", ["When a ticket is added, reassigned, changes priority or is started, and every 5 minutes."], size=14.5)
    s.arrow([(605, 650), (605, 580)], dashed=True, label="queue changed", lpos=(690, 622))
    s.save(OUT / "eta-engine.svg")

# ───────────────────────── 3. Locked room ─────────────────────────
def locked():
    s = Svg(1200, 930, "Locked-room flow", "Technician finds the door locked, the clock pauses, the occupant chooses, and the ticket resumes, escalates or closes.")
    s.heading("When the room is locked", "No entry without the student. The clock stops, and false claims are checked.")
    cx = [40, 325, 610, 895]; cw = 265
    steps = [("1", "Door is locked", "The technician arrives and nobody answers."), ("2", "Door photo", "Required. The server stamps the time."),
             ("3", "Clock pauses", "AWAITING_ACCESS: the SLA deadline stops running."), ("4", "Occupants notified", "Every current roommate is told and asked to respond.")]
    for i, (n, h, b) in enumerate(steps):
        s.card(cx[i], 120, cw, 150, "amber", h, b, num=n, size=14.5, spot=(i * 2.2, 2.2, 11.5))
        if i < 3: s.arrow([(cx[i]+cw, 190), (cx[i+1], 190)], seq=(i * 2.2 + 1.5, 0.7, 11.5))
    busy = 306
    s.text(cx[0] + 4, busy - 14, "THE OCCUPANT CHOOSES", 13, "#64748b", 800, spacing=2.2)
    opts = [("green", "'I'll be there in 15 min'", "The technician moves to the top of the queue and returns once you reach your room."),
            ("green", "Pick a 30-minute slot", "Choose a window in the next 3 days. The technician is booked and won't come earlier."),
            ("violet", "'I was in my room'", "Report a false locked claim. The warden decides from the photo, timestamps and timeline."),
            ("rose", "No reply for 48 hours", "The ticket closes as unable to access.")]
    s.o.append(f'<path d="M{cx[3]+cw/2},270 L{cx[3]+cw/2},{busy} L{cx[0]+cw/2},{busy}" fill="none" stroke="#94a3b8" stroke-width="2.3"/>')
    for i, (c, h, b) in enumerate(opts):
        s.card(cx[i], 346, cw, 170, c, h, b, size=14.5)
        s.arrow([(cx[i]+cw/2, busy), (cx[i]+cw/2, 346)])
    r3 = 566
    s.card(40, r3, 550, 130, "indigo", "Technician returns and the clock resumes", ["Work continues from where it stopped. Time spent waiting does not count against the deadline."], size=14.5)
    s.arrow([(cx[0]+cw/2, 516), (cx[0]+cw/2, r3)]); s.arrow([(cx[1]+cw/2, 516), (cx[1]+cw/2, r3)])
    s.card(cx[2], r3, cw, 170, "violet", "Warden decides", ["Upheld: the room was open, so the ticket re-queues with a priority boost. Rejected: no change."], size=14.5)
    s.arrow([(cx[2]+cw/2, 516), (cx[2]+cw/2, r3)])
    s.card(cx[3], r3, cw, 130, "rose", "CLOSED: unable to access", ["Needs a new complaint if the problem is still there."], size=14.5)
    s.arrow([(cx[3]+cw/2, 516), (cx[3]+cw/2, r3)])
    r4 = 770
    s.card(40, r4, cw, 120, "green", "Door opens: fix and prove", ["Work, after-photo, completion code, resolved."], size=14.5)
    s.arrow([(cx[0]+cw/2, r3+130), (cx[0]+cw/2, r4)], label="door opens", lpos=(cx[0]+cw/2+54, r3+158))
    s.card(cx[1], r4, cw, 120, "amber", "Locked again?", ["The second locked visit requires a booked slot; no 15-minute option."], size=14.5)
    s.arrow([(cx[1]+cw/2, r3+130), (cx[1]+cw/2, r4)], label="locked again", lpos=(cx[1]+cw/2+58, r3+158))
    s.save(OUT / "locked-room.svg")

# ───────────────────────── 4. Escalation ─────────────────────────
def escalation():
    s = Svg(1200, 650, "Escalation and auto-close", "Missed deadlines escalate to the warden and then the chief warden; resolved tickets close after 48 hours.")
    s.heading("Nothing slips through", "Deadlines escalate by themselves, and silence never leaves a ticket hanging.")
    s.lane(30, 112, 1140, 234, "DEADLINES  ·  CHECKED EVERY 5 MINUTES")
    s.card(50, 170, 190, 110, "indigo", "Ticket created", ["The category sets the deadline."], size=14.5)
    s.arrow([(240, 225), (270, 225)])
    s.diamond(355, 225, 170, 124, "indigo", "Resolved by the deadline?")
    s.arrow([(440, 225), (480, 225)], label="no", lpos=(460, 213))
    s.pill(275, 306, 160, 32, "green", "No escalation", 14); s.arrow([(355, 287), (355, 306)]); s.text(369, 300, "yes", 13, "#cbd5e1", 600)
    s.card(480, 170, 210, 110, "violet", "Level 1", ["The block warden is alerted at the deadline."], size=14.5)
    s.arrow([(690, 225), (720, 225)])
    s.diamond(805, 225, 170, 124, "indigo", "Still open 24 h later?")
    s.arrow([(890, 225), (930, 225)], label="yes", lpos=(910, 213))
    s.pill(725, 306, 160, 32, "green", "Handled", 14); s.arrow([(805, 287), (805, 306)]); s.text(819, 300, "no", 13, "#cbd5e1", 600)
    s.card(930, 170, 230, 110, "rose", "Level 2", ["The chief warden is alerted."], size=14.5)
    s.lane(30, 370, 1140, 250, "AFTER THE FIX  ·  48-HOUR WINDOW")
    s.card(50, 430, 250, 130, "indigo", "Ticket resolved", ["Room tickets: RESOLVED. Common areas: AWAITING_VERIFICATION."], size=14.5)
    s.arrow([(300, 495), (340, 495)])
    s.diamond(425, 495, 170, 124, "green", "Student acts within 48 h?")
    for c, lab, res, y in [("green", "Confirms", "CLOSED", 440), ("rose", "Reports a problem", "REOPENED: a dispute always wins", 495), ("sky", "No response", "Closed automatically", 550)]:
        s.arrow([(510, 495), (555, 495), (555, y), (600, y)] if y != 495 else [(510, 495), (600, 495)])
        s.pill(600, y - 19, 190, 38, c, lab, 14.5)
        s.arrow([(790, y), (830, y)])
        s.text(842, y + 5, res, 15, "#e2e8f0", 700)
    s.save(OUT / "escalation.svg")

# ───────────────────────── 5. Architecture ─────────────────────────
def arch():
    s = Svg(1200, 800, "Architecture", "Browsers talk to a Vercel app that proxies /api to a stateless Render API, backed by Neon PostgreSQL and Cloudinary, with cron-job.org triggering jobs.")
    s.heading("Architecture", "Stateless server, external scheduler, one first-party origin.")
    s.text(40, 126, "USERS", 13, "#64748b", 800, spacing=2.2)
    for i, (c, h, b) in enumerate([("green", "Student phone", "Raises tickets, sees ETA and code"), ("amber", "Technician phone", "Queue, photos, resolve"), ("violet", "Warden / admin laptop", "Disputes, analytics, admin")]):
        s.card(40, 140 + i*130, 220, 110, c, h, b, size=14, shadow=False)
    s.card(330, 235, 210, 240, "slate", "VERCEL", ["React + Vite app, served as static files.", "A rewrite forwards /api/* to the API, so the login cookie is first-party and works on Safari."], size=14.5)
    for y in (195, 325, 455):
        s.arrow([(260, y), (295, y), (295, 355), (330, 355)] if y != 325 else [(260, 325), (295, 325), (295, 355), (330, 355)])
    s.text(296, 180, "HTTPS", 13, "#cbd5e1", 600, "middle")
    s.o.append('<rect x="610" y="130" width="330" height="460" rx="16" fill="#0d1428" stroke="#818cf8" stroke-opacity="0.6" stroke-width="1.5"/>')
    s.text(632, 164, "RENDER  ·  EXPRESS API", 13, "#818cf8", 800, spacing=1.5)
    s.text(632, 184, "stateless", 13, "#94a3b8")
    for i, m in enumerate(["auth", "tickets", "scheduling", "evidence", "disputes", "jobs", "analytics", "admin"]):
        r, c = divmod(i, 2)
        s.pill(634 + c * 148, 204 + r * 48, 138, 36, "indigo", m, 14.5)
    for k, ln in enumerate(["Row-locked transactions guard", "codes, state changes and the", "dispute-wins rule."]):
        s.text(634, 428 + k*21, ln, 14, "#cbd5e1")
    for k, ln in enumerate(["Every job is idempotent, so any", "instance can run it, and a retry", "does no harm."]):
        s.text(634, 510 + k*21, ln, 14, "#cbd5e1")
    s.arrow([(540, 355), (610, 355)], label="/api/*", lpos=(575, 347))
    s.text(1000, 126, "DATA", 13, "#64748b", 800, spacing=2.2)
    s.card(1000, 140, 160, 200, "sky", "NEON", ["PostgreSQL: pooled URL for the app, direct URL for migrations."], size=13.5)
    s.card(1000, 380, 160, 150, "amber", "CLOUDINARY", ["Photo evidence, uploaded with signed requests."], size=13.5)
    s.arrow([(940, 240), (1000, 240)], label="Prisma", lpos=(970, 232))
    s.arrow([(940, 455), (1000, 455)], label="signed", lpos=(970, 447))
    s.card(610, 630, 330, 140, "green", "CRON-JOB.ORG", ["POST /api/jobs/tick every 5 minutes with a secret header: escalation, auto-close, queue recompute. Also keeps the free instance awake."], size=13.5)
    s.arrow([(775, 630), (775, 590)], dashed=True)
    s.text(40, 640, "WHY THIS SHAPE", 13, "#64748b", 800, spacing=2.2)
    for k, ln in enumerate(["Render's free tier sleeps, so timers live", "outside the server. That also keeps the API", "stateless, so adding instances needs no", "code change."]):
        s.text(40, 670 + k*24, ln, 14.5, "#cbd5e1")
    s.save(OUT / "architecture.svg")

# ───────────────────────── 6. Ticket lifecycle ─────────────────────────
def lifecycle():
    s = Svg(1300, 660, "Ticket lifecycle", "State machine: raised, assigned, in progress, awaiting access, on hold, resolved, awaiting verification, closed, reopened, rejected.")
    s.heading("Ticket lifecycle", "Every transition is a row in one tested table. Anything not in it is refused with a 409.")
    NH = 48
    s.flow = False
    PER = 10.0
    def node(x, y, w, c, t, size=14, spot=None): s.node(x, y, w, NH, c, t, size, spot=spot)
    s.o.append('<rect x="750" y="170" width="260" height="262" rx="16" fill="#0a1022" stroke="#475569" stroke-dasharray="6 6" stroke-width="1.5"/>')
    s.text(768, 196, "WAITING FOR THE STUDENT (48 H)", 12, "#64748b", 800, spacing=1.2)
    node(770, 214, 220, "green", "RESOLVED", spot=(6, 2, PER)); node(770, 372, 220, "orange", "AWAITING_VERIFICATION", 13.5)
    s.text(880, 292, "room tickets: code entered", 12.5, "#94a3b8", 400, "middle"); s.text(880, 312, "common areas: after-photo", 12.5, "#94a3b8", 400, "middle")
    node(40, 290, 120, "indigo", "RAISED"); node(280, 290, 140, "indigo", "ASSIGNED", spot=(2, 2, PER)); node(540, 290, 150, "amber", "IN_PROGRESS", spot=(4, 2, PER))
    node(380, 440, 130, "orange", "ON_HOLD"); node(430, 110, 190, "orange", "AWAITING_ACCESS"); node(1120, 290, 120, "green", "CLOSED", spot=(8, 2, PER)); node(830, 520, 150, "rose", "REOPENED")
    s.pill(40, 170, 104, 36, "slate", "NEW TICKET", 13)
    s.arrow([(92, 206), (92, 290)], label="no eligible staff", lpos=(92, 250))
    s.arrow([(144, 188), (350, 188), (350, 290)], label="routed to a technician", lpos=(250, 180), seq=(0.3, 1.5, PER))
    s.arrow([(160, 314), (280, 314)], label="warden assigns", lpos=(220, 305))
    s.arrow([(420, 314), (540, 314)], label="start work", lpos=(480, 305), seq=(2.3, 1.4, PER))
    s.arrow([(330, 290), (330, 134), (430, 134)], label="room locked", lpos=(380, 126))
    s.arrow([(470, 158), (470, 215), (390, 215), (390, 290)], label="occupant picks a time", lpos=(430, 207))
    s.arrow([(600, 290), (600, 158)], label="room locked", lpos=(655, 232))
    s.arrow([(620, 134), (1180, 134), (1180, 290)], label="no reply in 48 h", lpos=(900, 126))
    s.arrow([(565, 338), (565, 452), (510, 452)], label="needs a part", lpos=(535, 398))
    s.arrow([(510, 476), (615, 476), (615, 338)], label="resume", lpos=(655, 398))
    s.arrow([(690, 304), (730, 304), (730, 238), (770, 238)], label="correct code", lpos=(730, 268), seq=(4.3, 1.5, PER))
    s.arrow([(690, 328), (730, 328), (730, 396), (770, 396)], label="after-photo", lpos=(730, 362))
    s.arrow([(1010, 314), (1120, 314)], label="confirmed / 48 h", lpos=(1065, 304), seq=(6.3, 1.5, PER))
    s.arrow([(900, 432), (900, 520)], label="dispute", lpos=(940, 478))
    s.arrow([(1180, 338), (1180, 544), (980, 544)], label="dispute within 48 h", lpos=(1090, 535))
    s.arrow([(830, 544), (350, 544), (350, 338)], label="re-routed", lpos=(590, 535))
    s.arrow([(670, 338), (670, 600), (1210, 600), (1210, 326), (1240, 326)], dashed=True, label="warden upholds a code refusal", lpos=(940, 592))
    s.arrow([(1240, 300), (1268, 300)]); s.dot(1276, 300, 7, "#34d399")
    s.pill(40, 596, 112, 32, "rose", "REJECTED", 13)
    s.text(166, 617, "A warden can reject any open ticket (reason required). It ends there.", 14, "#cbd5e1")
    lx = 840
    for c, lab in [("indigo", "open"), ("amber", "working"), ("orange", "waiting"), ("green", "done"), ("rose", "problem")]:
        acc, dark = P[c]
        s.o.append(f'<rect x="{lx}" y="22" width="14" height="14" rx="4" fill="{dark}" stroke="{acc}" stroke-width="2"/>'); s.text(lx + 20, 34, lab, 12.5, "#94a3b8"); lx += 84
    s.save(OUT / "ticket-lifecycle.svg")

# ───────────────────────── 7. Data model ─────────────────────────
def datamodel():
    s = Svg(1200, 1000, "Data model", "Entity overview: blocks, rooms, dated occupancy, users, staff shifts, notifications, categories, tickets and their events, photos, followers, disputes and predictions.")
    s.flow = False
    PER = 15.0
    sp = lambda t, d=1.6: (t, d, PER)
    s.heading("Data model (simplified)", "Occupancy has from/to dates, so 'who lived in A-301 on 12 Oct' is a query.")
    s.text(40, 118, "PEOPLE AND PLACES", 13, "#64748b", 800, spacing=2.2)
    s.entity(40, 130, 150, "slate", "BLOCK", [("name", "A|B|C")], spot=sp(0))
    s.entity(265, 130, 185, "slate", "ROOM", [("blockId", "FK"), ("floor", "int"), ("number", "text")], spot=sp(1.5))
    s.entity(525, 130, 250, "sky", "ROOM_OCCUPANCY", [("userId", "FK"), ("roomId", "FK"), ("fromDate", "date"), ("toDate", "null = current")], spot=sp(3))
    s.entity(850, 130, 310, "green", "USER", [("role", "STUDENT | STAFF | …"), ("trade", "staff only"), ("blockId", "wardens, staff"), ("isActive", "bool")], spot=sp(4.5))
    s.arrow([(190, 180), (265, 180)], label="contains", lpos=(228, 172), seq=(0.85, 0.65, PER)); s.arrow([(450, 180), (525, 180)], label="holds", lpos=(488, 172), seq=(2.35, 0.65, PER)); s.arrow([(850, 180), (775, 180)], label="lives in", lpos=(812, 172), seq=(3.85, 0.65, PER))
    s.text(40, 336, "THE TICKET", 13, "#64748b", 800, spacing=2.2)
    s.entity(40, 350, 250, "violet", "CATEGORY", [("trade", ""), ("defaultPriority", ""), ("defaultDurationMin", "int"), ("slaMinutes", "int")])
    th = s.entity(350, 350, 560, "indigo", "TICKET", [("code", "HD-0213"), ("status, priority", "enums"), ("locationType", "ROOM | COMMON_AREA"), ("roomId, blockId, floor", ""),
        ("raisedById, assignedToId", "FK"), ("dueAt", "SLA deadline"), ("etaP50At, etaP80At", "predicted range"), ("completionCode", "never in API responses"),
        ("codeFailedAttempts, codeBlockedUntil", ""), ("lockedVisitCount, pausedAt", "locked-room flow"), ("escalationLevel, reopenCount", "")], spot=sp(6.4, 2.0))
    s.entity(960, 350, 200, "amber", "STAFF_SHIFT", [("staffId", "FK"), ("weekday", "0-6"), ("startMinute", "540"), ("endMinute", "1080")])
    s.entity(960, 540, 200, "rose", "NOTIFICATION", [("userId", "FK"), ("ticketId", "FK"), ("message", ""), ("readAt", "null = unread")])
    s.arrow([(290, 450), (350, 450)], label="classifies", lpos=(320, 442), seq=(5.7, 0.65, PER)); s.arrow([(400, 254), (400, 350)], label="room tickets", lpos=(470, 306), seq=(5.6, 0.75, PER))
    s.arrow([(880, 278), (880, 350)], label="raises / is assigned", lpos=(960, 316), seq=(5.6, 0.75, PER)); s.arrow([(1060, 278), (1060, 350)], label="works", lpos=(1096, 316), flow=True)
    s.arrow([(910, 630), (960, 630)], label="about", lpos=(935, 622), flow=True)
    ty = 350 + th
    s.text(40, ty + 54, "WHAT HAPPENS TO A TICKET", 13, "#64748b", 800, spacing=2.2)
    sats = [("slate", "TICKET_EVENT", [("type", "enum"), ("fromStatus → toStatus", ""), ("actorId", "FK"), ("note", "")], "timeline of every change", "timeline"),
            ("amber", "ATTACHMENT", [("kind", "enum"), ("url, publicId", ""), ("uploaderId", "FK")], "photo evidence", "photos"),
            ("green", "TICKET_FOLLOWER", [("ticketId", "FK"), ("userId", "FK")], "joined common-area reports", "joined by"),
            ("violet", "DISPUTE", [("type", "enum"), ("status", "enum"), ("decidedById", "FK"), ("decisionNote", "")], "warden decides", "disputed in"),
            ("sky", "TICKET_PREDICTION", [("staffId", "FK"), ("predictedP50At", ""), ("predictedP80At", "")], "ETA history, scored later", "ETA history")]
    sw, sg, busy = 212, 15, ty + 96
    s.o.append(f'<path d="M630,{ty} L630,{busy}" fill="none" stroke="#94a3b8" stroke-width="2.3"/>')
    s.o.append(f'<path d="M{40+sw/2},{busy} L{40+4*(sw+sg)+sw/2},{busy}" fill="none" stroke="#94a3b8" stroke-width="2.3"/>')
    for i, (c, t, fl, note, lab) in enumerate(sats):
        x = 40 + i * (sw + sg)
        t0 = 8.6 + i * 1.2
        s.arrow([(x + sw/2, busy), (x + sw/2, busy + 34)], label=lab, lpos=(x + sw/2 + 54, busy + 22), seq=(t0 - 0.6, 0.55, PER))
        s.entity(x, busy + 34, sw, c, t, fl, note, spot=sp(t0, 1.2))
    s.save(OUT / "data-model.svg")

journey(); eta(); locked(); escalation(); arch(); lifecycle(); datamodel()
