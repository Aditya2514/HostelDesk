"""Animated roadmap diagrams. Run: python3 docs/diagrams/src/make_roadmap.py"""
import pathlib, textwrap
from svgkit import Svg, P, esc
OUT = pathlib.Path(__file__).resolve().parents[2] / "assets"

# ───────────── A. where AI plugs into the journey ─────────────
def planned(s, x, y, w, h, color, num, title, spot=None):
    acc, dark = P[color]
    m = s.mark()
    s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#0b1224" stroke="{acc}" stroke-width="1.6" stroke-dasharray="7 6" stroke-opacity="0.85"/>')
    s.o.append(f'<circle cx="{x+30}" cy="{y+h/2}" r="16" fill="{dark}" stroke="{acc}" stroke-width="2"/>')
    s.text(x + 30, y + h/2 + 6, str(num), 16, acc, 800, "middle")
    lines = textwrap.wrap(title, 13)
    y0 = y + h/2 - (len(lines) - 1) * 10 + 5
    for i, ln in enumerate(lines):
        s.text(x + 58, y0 + i * 20, ln, 14.5, "#e2e8f0", 700)
    s.rise(m)
    if spot: s.spot(x, y, w, h, color, *spot)

def journey_map():
    PER = 14.0
    s = Svg(1200, 650, "Where ML and AI would plug in", "Planned ideas attached to the stage of the ticket journey they would improve. None are built in v1.0.0.")
    s.flow = False
    s.heading("Where ML and AI would plug in", "Solid = what v1.0.0 does today · dashed = planned, not built yet")
    W, G, X0 = 170, 18, 45
    stages = [("RAISE", "green"), ("ROUTE + PREDICT", "indigo"), ("FIX", "amber"), ("PROVE", "orange"), ("CONFIRM / DISPUTE", "green"), ("LEARN + REPORT", "sky")]
    s.text(X0, 128, "TODAY · RULES AND FORMULAS", 13, "#64748b", 800, spacing=2.2)
    cols = {0: [(8, "Voice + languages", "amber"), (4, "Category + urgency hints", "violet"), (3, "Duplicate detection", "green")],
            1: [(1, "Learned ETA", "indigo")], 3: [(2, "Photo verification", "orange")], 4: [(5, "Dispute summaries", "violet")],
            5: [(6, "Preventive maintenance", "sky"), (7, "Shift forecasting", "amber")]}
    for i, (lab, col) in enumerate(stages):
        x = X0 + i * (W + G)
        s.node(x, 142, W, 56, col, lab, 13.5, spot=(i * 2.2, 2.2, PER))
        if i < len(stages) - 1:
            s.arrow([(x + W + 1, 170), (x + W + G - 3, 170)], seq=(i * 2.2 + 1.35, 0.6, PER))
    for i in range(len(stages)):
        x = X0 + i * (W + G)
        acc = P[stages[i][1]][0]
        s.o.append(f'<line x1="{x+W/2}" y1="200" x2="{x+W/2}" y2="262" stroke="{acc}" stroke-width="2" stroke-dasharray="3 6" stroke-opacity="0.7"/>')
        for j, (n, t, c) in enumerate(cols.get(i, [])):
            planned(s, x, 268 + j * 98, W, 84, c, n, t, spot=(i * 2.2, 2.2, PER))
        if i == 2:
            m = s.mark()
            s.text(x + W/2, 306, "Hands-on repair work:", 13.5, "#64748b", 600, "middle"); s.text(x + W/2, 326, "no AI planned here", 13.5, "#64748b", 600, "middle")
            s.rise(m)
    s.o.append('<rect x="45" y="584" width="1110" height="1" fill="#1e293b"/>')
    s.o.append('<rect x="45" y="12" width="0" height="0"/>')
    s.text(45, 616, "Every idea assists a person or flags something for one. None of them takes a decision away from students or wardens.", 15, "#94a3b8")
    s.save(OUT / "roadmap-map.svg")

# ───────────── B. how a model earns its place ─────────────
def gate():
    PER = 21.0
    s = Svg(1200, 730, "How a model earns its place", "Candidate models must beat today's formula on real data before release, and every AI output stays reviewable by a person.")
    s.flow = False
    s.heading("How a model earns its place", "No model ships on a hunch: it has to beat the formula that is already there")
    sp = lambda i: (i * 2.0, 2.0, PER)
    s.text(40, 128, "BEFORE RELEASE", 13, "#64748b", 800, spacing=2.2)
    s.card(40, 142, 190, 136, "green", "Collect real data", "Tickets, durations and outcomes from live use.", num="1", size=14, spot=sp(0))
    s.card(270, 142, 190, 136, "indigo", "Train a candidate", "On past completed tickets only.", num="2", size=14, spot=sp(1))
    s.card(500, 142, 220, 136, "violet", "Backtest vs the formula", "Same tickets, error counted in working minutes.", num="3", size=14, spot=sp(2))
    s.diamond(835, 210, 170, 140, "amber", "Beats the baseline?")
    s.card(950, 142, 210, 136, "sky", "Shadow mode", "Runs silently beside the formula on live tickets.", num="4", size=14, spot=sp(4))
    s.arrow([(230, 210), (270, 210)], seq=(1.3, 0.7, PER)); s.arrow([(460, 210), (500, 210)], seq=(3.3, 0.7, PER))
    s.arrow([(720, 210), (750, 210)], seq=(5.3, 0.6, PER)); s.arrow([(920, 210), (950, 210)], label="yes", lpos=(935, 198), seq=(7.2, 0.7, PER))
    s.card(950, 348, 210, 136, "green", "Release behind a flag", "Shown with its reason; one switch rolls it back.", num="5", size=14, spot=sp(5))
    s.arrow([(1055, 278), (1055, 348)], seq=(9.3, 0.7, PER))
    s.card(520, 348, 250, 120, "rose", "Keep today's formula", "Improve the data or the features, then try again.", size=14, dash=True)
    s.arrow([(835, 280), (835, 318), (645, 318), (645, 348)], label="no", lpos=(740, 310))
    s.arrow([(645, 468), (645, 508), (365, 508), (365, 280)], dashed=True, label="retry", lpos=(365, 420))
    s.card(40, 348, 300, 140, "slate", "THE BASELINE TO BEAT", ["estimate = (5×default + n×median) ÷ (5+n)", "Lower error, in working minutes, or it doesn't ship."], size=13)
    s.text(40, 568, "ONCE LIVE · EVERY AI OUTPUT", 13, "#64748b", 800, spacing=2.2)
    xs = [40, 330, 620, 910]; cw = 250
    items = [("violet", "AI suggests or flags", "It never acts on its own."), ("sky", "Shows its reason", "Like today's 'Why this estimate?' panel."),
             ("green", "A person decides", "Student confirms, or warden overrides."), ("slate", "Logged in the timeline", "Who accepted or overrode it, and when.")]
    for i, ((c, h, b), x) in enumerate(zip(items, xs)):
        s.card(x, 582, cw, 100, c, h, b, size=14, spot=(12 + i * 2.0, 2.0, PER))
        if i < 3: s.arrow([(x + cw, 632), (xs[i+1], 632)], seq=(12 + i * 2.0 + 1.3, 0.7, PER))
    s.save(OUT / "roadmap-gate.svg")

# ───────────── C. what can start sooner ─────────────
def phases():
    PER = 12.0
    s = Svg(1200, 740, "What could start sooner, and what needs data", "Eight planned ideas grouped by what they need before they can be built.")
    s.flow = False
    s.heading("What could start sooner, and what waits", "Grouped by what each idea needs first · the order is my planning estimate")
    X = [40, 430, 820]; CW = 340
    heads = [("green", "SOONER", "Pretrained models, no history needed", 1), ("indigo", "NEEDS REAL USAGE DATA", "Learns from how the hostel actually behaves", 3), ("amber", "NEEDS PRIVACY CARE", "Touches photos of people's rooms", 2)]
    for i, ((c, t, sub, pips), x) in enumerate(zip(heads, X)):
        acc, dark = P[c]
        m = s.mark()
        s.o.append(f'<g filter="url(#sh)"><rect x="{x}" y="124" width="{CW}" height="118" rx="16" fill="{dark}" stroke="{acc}" stroke-width="2"/></g>')
        s.text(x + 22, 158, t, 16, acc, 800, spacing=1.4)
        s.text(x + 22, 184, sub, 14, "#cbd5e1")
        s.text(x + 22, 218, "REAL DATA NEEDED", 11.5, "#94a3b8", 800, spacing=1.6)
        for p in range(3):
            fill = acc if p < pips else "#1e293b"
            s.o.append(f'<circle cx="{x+176+p*22}" cy="214" r="7" fill="{fill}" stroke="{acc}" stroke-width="1.5"/>')
        s.rise(m)
        s.spot(x, 124, CW, 118, c, i * 4.0, 4.0, PER, r=16)
    s.arrow([(40 + CW + 2, 183), (430 - 4, 183)], seq=(3.0, 0.8, PER)); s.arrow([(430 + CW + 2, 183), (820 - 4, 183)], seq=(7.0, 0.8, PER))
    items = [[("green", 3, "Duplicate detection", "Text embeddings find reports that mean the same thing."), ("violet", 4, "Category + urgency hints", "Suggests a category; the student confirms."),
              ("violet", 5, "Dispute summaries", "A neutral write-up for the warden, who still decides."), ("amber", 8, "Voice + languages", "Speech-to-text and translation for complaints.")],
             [("indigo", 1, "Learned ETA", "Beats the formula, or it doesn't ship."), ("sky", 7, "Shift forecasting", "Ticket volume per trade and day, from months of history."),
              ("sky", 6, "Preventive maintenance", "Predicts repeat failures from room and fixture history.")],
             [("orange", 2, "Photo verification", "Flags reused or unrelated photos for the warden.")]]
    for ci, col in enumerate(items):
        for j, (c, n, t, b) in enumerate(col):
            s.card(X[ci], 268 + j * 104, CW, 92, c, t, b, num=str(n), size=13.5, dash=True)
    m = s.mark()
    s.o.append(f'<rect x="{X[2]}" y="392" width="{CW}" height="164" rx="14" fill="#0a1022" stroke="#475569" stroke-dasharray="4 6" stroke-width="1.5"/>')
    for k, ln in enumerate(["Before any model sees room photos:", "• consent from the occupants", "• a retention limit", "• a person reviews every flag", "• a plan for false positives"]):
        s.text(X[2] + 22, 424 + k * 26, ln, 14, "#e2e8f0" if k == 0 else "#cbd5e1", 700 if k == 0 else 400)
    s.rise(m)
    s.text(40, 700, "Ratings and ordering are planning estimates, not measurements. Nothing on this page is built in v1.0.0.", 14, "#64748b")
    s.save(OUT / "roadmap-phases.svg")

journey_map(); gate(); phases()
