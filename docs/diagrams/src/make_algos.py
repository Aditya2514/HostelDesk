"""Animated algorithm diagrams for docs/ARCHITECTURE.md.
Run: python3 docs/diagrams/src/make_algos.py"""
import pathlib
from svgkit import Svg, P, esc
OUT = pathlib.Path(__file__).resolve().parents[2] / "assets"

def _kt(a, b, period, tail=0.9):
    """times for an element visible from a..(period-tail), fading in over [a,b]."""
    e = (period - tail) / period
    return f"0;{a/period:.4f};{b/period:.4f};{e:.4f};1"

def show(s, inner, t0, period, dur=0.35, tail=0.9):
    kt = _kt(t0, t0 + dur, period, tail)
    s.o.append(f'<g opacity="0">{inner}<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="{kt}" dur="{period}s" repeatCount="indefinite"/></g>')

def grow(s, x, y, w, h, fill, stroke, t0, t1, period, rx=8, extra="", tail=0.9):
    kt = _kt(t0, t1, period, tail)
    s.o.append(f'<rect x="{x}" y="{y}" width="0" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="2" {extra}>'
               f'<animate attributeName="width" values="0;0;{w};{w};0" keyTimes="{kt}" dur="{period}s" repeatCount="indefinite"/></rect>')

def hatch_defs():
    return ('<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<rect width="10" height="10" fill="#0a1022"/><line x1="0" y1="0" x2="0" y2="10" stroke="#243049" stroke-width="4"/></pattern>')

def add_defs(s, extra):
    s.o[2] = s.o[2].replace("</defs>", extra + "</defs>")

# ───────────────────────── queue simulation ─────────────────────────
def queue():
    PER = 15.0
    s = Svg(1200, 790, "Queue simulation: who finishes first?",
            "Monday 4:30 PM, a new 60-minute tap repair. Ramesh finishes Tuesday 10:05 AM, Suresh Tuesday 10:00 AM, Anil Monday 5:30 PM, so Anil gets it.")
    add_defs(s, hatch_defs())
    s.flow = False
    s.heading("Who finishes first?", "Monday 4:30 PM · a new 60-minute tap repair · shifts 9-1 and 2-6")
    PX = 4.0; X0 = 230                      # px per working minute, chart origin
    monx = lambda m: X0 + m * PX            # minutes after 4:30 PM Monday (max 90)
    GAP = 60; tue0 = X0 + 90 * PX + GAP     # Tuesday 9:00 AM
    tuex = lambda m: tue0 + m * PX          # minutes after 9:00 AM Tuesday
    # time axis
    for x, lab, an in [(X0, "MON 4:30 PM", "middle"), (X0 + 90*PX, "6:00 PM", "end"), (tue0, "TUE 9:00 AM", "start"), (tuex(90), "10:30 AM", "middle")]:
        s.text(x, 134, lab, 13, "#94a3b8", 800, an, spacing=1.2)
        s.o.append(f'<line x1="{x}" y1="142" x2="{x}" y2="598" stroke="#1e293b" stroke-width="1.5" stroke-dasharray="3 5"/>')
    s.o.append(f'<rect x="{X0+90*PX+4}" y="146" width="{GAP-8}" height="450" rx="8" fill="url(#hatch)"/>')
    s.text(X0 + 90*PX + GAP/2, 372, "NIGHT", 11.5, "#64748b", 800, "middle", spacing=2)
    lanes = [("Ramesh", "Works to 6 PM. An urgent 45m and an older 50m job are ahead.", "indigo"),
             ("Suresh", "Off on Monday. Empty queue.", "slate"),
             ("Anil", "Works until 6 PM. Empty queue.", "green")]
    LY = [156, 288, 420]; LH = 118
    for (name, sit, col), y in zip(lanes, LY):
        m = s.mark()
        acc, dark = P[col]
        s.o.append(f'<rect x="30" y="{y}" width="1140" height="{LH}" rx="14" fill="#0b1224" stroke="#1e293b" stroke-width="1.5" fill-opacity="0.55"/>')
        s.text(50, y + 40, name, 22, "#f8fafc", 800)
        for k, ln in enumerate(__import__("textwrap").wrap(sit, 26)):
            s.text(50, y + 62 + k*17, ln, 12.5, "#94a3b8")
        s.rise(m)
    BH = 46; by = lambda i: LY[i] + 36
    URG = ("#4c0519", "#fb7185"); OLD = ("#451a03", "#fbbf24"); NEW = ("#1e1b4b", "#818cf8"); OK = ("#064e3b", "#34d399")
    def lab(x, y, w, t, color):
        return f'<text x="{x+w/2}" y="{y+BH/2+5}" font-size="13.5" font-weight="800" fill="{color}" text-anchor="middle">{esc(t)}</text>'
    # Ramesh
    grow(s, monx(0), by(0), 45*PX, BH, *URG, 0.9, 1.6, PER); show(s, lab(monx(0), by(0), 45*PX, "URGENT · 45m", "#fda4af"), 1.5, PER)
    grow(s, monx(45), by(0), 45*PX, BH, *OLD, 1.8, 2.5, PER); show(s, lab(monx(45), by(0), 45*PX, "OLDER · 50m", "#fcd34d"), 2.4, PER)
    grow(s, tuex(0), by(0), 5*PX, BH, *OLD, 2.7, 2.9, PER)
    grow(s, tuex(5), by(0), 60*PX, BH, *NEW, 3.1, 4.0, PER); show(s, lab(tuex(5), by(0), 60*PX, "NEW · 60m", "#c7d2fe"), 3.9, PER)
    show(s, f'<text x="{tuex(65)+14}" y="{by(0)+BH/2+5}" font-size="15" font-weight="700" fill="#cbd5e1">finishes Tue 10:05 AM</text>', 4.1, PER)
    # Suresh
    show(s, f'<rect x="{monx(0)}" y="{by(1)}" width="{90*PX}" height="{BH}" rx="8" fill="url(#hatch)" stroke="#334155" stroke-width="1.5"/>'
            f'<text x="{monx(45)}" y="{by(1)+BH/2+5}" font-size="13.5" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="1.5">DAY OFF</text>', 4.6, PER)
    grow(s, tuex(0), by(1), 60*PX, BH, *NEW, 5.0, 5.9, PER); show(s, lab(tuex(0), by(1), 60*PX, "NEW · 60m", "#c7d2fe"), 5.8, PER)
    show(s, f'<text x="{tuex(60)+14}" y="{by(1)+BH/2+5}" font-size="15" font-weight="700" fill="#cbd5e1">finishes Tue 10:00 AM</text>', 6.0, PER)
    # Anil
    grow(s, monx(0), by(2), 60*PX, BH, *NEW, 6.5, 7.4, PER); show(s, lab(monx(0), by(2), 60*PX, "NEW · 60m", "#c7d2fe"), 7.3, PER)
    show(s, f'<text x="{monx(60)+14}" y="{by(2)+BH/2+5}" font-size="15" font-weight="800" fill="#34d399">finishes Mon 5:30 PM</text>', 7.6, PER)
    # winner highlight
    s.spot(30, LY[2], 1140, LH, "green", 8.2, 5.4, PER, r=14)
    show(s, f'<g><rect x="1040" y="{LY[2]+34}" width="110" height="38" rx="19" fill="#064e3b" stroke="#34d399" stroke-width="2"/>'
            f'<text x="1095" y="{LY[2]+59}" font-size="15" font-weight="800" fill="#6ee7b7" text-anchor="middle">✓ ASSIGNED</text></g>', 8.4, PER)
    # verdict
    m = s.mark()
    s.o.append(f'<rect x="30" y="566" width="1140" height="1" fill="none"/>')
    s.rise(m)
    show(s, '<rect x="30" y="560" width="1140" height="76" rx="14" fill="#06251d" stroke="#34d399" stroke-opacity="0.7" stroke-width="1.5"/>'
            '<text x="56" y="592" font-size="18" font-weight="800" fill="#6ee7b7">Anil gets the ticket: the earliest finish, not the fewest tickets.</text>'
            '<text x="56" y="618" font-size="14.5" fill="#cbd5e1">Suresh has the same empty queue, but his day off pushes the job to Tuesday. A plain ticket count would have missed that.</text>', 8.8, PER, tail=1.2)
    # legend
    lx = 50
    for fill, stroke, t in [("#4c0519", "#fb7185", "Urgent job ahead"), ("#451a03", "#fbbf24", "Older normal job"), ("#1e1b4b", "#818cf8", "The new ticket"), ("hatch", "#334155", "Off / night")]:
        f = "url(#hatch)" if fill == "hatch" else fill
        s.o.append(f'<rect x="{lx}" y="672" width="22" height="16" rx="4" fill="{f}" stroke="{stroke}" stroke-width="2"/>')
        s.text(lx + 32, 685, t, 13.5, "#94a3b8"); lx += 230
    s.text(50, 735, "Each queue is laid into the technician's real shift windows: in-progress first, then urgent, normal, low; oldest first within a priority.", 14, "#64748b")
    s.text(50, 757, "Asserted by server/tests/simulator.test.ts.", 14, "#64748b")
    s.save(OUT / "queue-simulation.svg")

# ───────────────────────── accuracy (working minutes) ─────────────────────────
def accuracy():
    PER = 13.0
    s = Svg(1200, 640, "Prediction error in working minutes",
            "Predicted Monday 5:50 PM, finished Tuesday 9:20 AM. Wall clock says 930 minutes; inside the shifts it is 30 working minutes.")
    add_defs(s, hatch_defs())
    s.flow = False
    s.heading("Why error is counted in working minutes", "Predicted Mon 5:50 PM · finished Tue 9:20 AM · shifts 9-1 and 2-6")
    PX = 8; xA = 80; wA = 30 * PX; xN = xA + wA; wN = 480; xB = xN + wN; wB = 30 * PX
    ty, th = 232, 64
    m = s.mark()
    s.o.append(f'<rect x="{xA}" y="{ty}" width="{wA}" height="{th}" rx="10" fill="#064e3b" stroke="#34d399" stroke-width="2"/>')
    s.o.append(f'<rect x="{xN}" y="{ty}" width="{wN}" height="{th}" fill="url(#hatch)" stroke="#334155" stroke-width="1.5"/>')
    s.o.append(f'<rect x="{xB}" y="{ty}" width="{wB}" height="{th}" rx="10" fill="#064e3b" stroke="#34d399" stroke-width="2"/>')
    s.text(xA + 14, ty + 28, "MON SHIFT", 12.5, "#6ee7b7", 800, spacing=1.4); s.text(xA + 14, ty + 48, "5:30 → 6:00 PM", 13, "#a7f3d0", 600)
    s.text(xN + wN/2, ty + 28, "OVERNIGHT", 13, "#64748b", 800, "middle", spacing=2.2); s.text(xN + wN/2, ty + 48, "15 hours of nobody working", 13.5, "#64748b", 600, "middle")
    s.text(xB + 14, ty + 28, "TUE SHIFT", 12.5, "#6ee7b7", 800, spacing=1.4); s.text(xB + 14, ty + 48, "9:00 → 9:30 AM", 13, "#a7f3d0", 600)
    s.rise(m)
    xp, xf = xA + 20 * PX, xB + 20 * PX
    # pins
    for x, t1, t2, col in [(xp, "PREDICTED", "Mon 5:50 PM", "#818cf8"), (xf, "FINISHED", "Tue 9:20 AM", "#fbbf24")]:
        show(s, f'<line x1="{x}" y1="{ty-8}" x2="{x}" y2="{ty+th+8}" stroke="{col}" stroke-width="3.5" stroke-linecap="round"/>'
                f'<circle cx="{x}" cy="{ty+th+14}" r="6" fill="{col}"/>'
                f'<text x="{x}" y="{ty+th+42}" font-size="13" font-weight="800" fill="{col}" text-anchor="middle" letter-spacing="1.2">{t1}</text>'
                f'<text x="{x}" y="{ty+th+60}" font-size="13.5" fill="#cbd5e1" text-anchor="middle">{t2}</text>', 0.8 if col == "#818cf8" else 1.3, PER)
    # wall-clock bracket (top)
    by = 196
    grow(s, xp, by - 3, xf - xp, 6, "#fb7185", "#fb7185", 2.2, 4.2, PER, rx=3, tail=1.4)
    show(s, f'<line x1="{xp}" y1="{by}" x2="{xp}" y2="{ty-10}" stroke="#fb7185" stroke-width="2.5"/><line x1="{xf}" y1="{by}" x2="{xf}" y2="{ty-10}" stroke="#fb7185" stroke-width="2.5"/>'
            f'<text x="{(xp+xf)/2}" y="{by-22}" font-size="21" font-weight="800" fill="#fb7185" text-anchor="middle">Wall clock: 15 h 30 min = 930 minutes ✗</text>', 4.0, PER, tail=1.4)
    # working brackets (bottom)
    wy = ty + th + 82
    grow(s, xp, wy - 3, xA + wA - xp, 6, "#34d399", "#34d399", 6.2, 6.8, PER, rx=3, tail=1.4)
    grow(s, xB, wy - 3, xf - xB, 6, "#34d399", "#34d399", 6.9, 7.8, PER, rx=3, tail=1.4)
    show(s, f'<text x="{(xp+xA+wA)/2}" y="{wy+26}" font-size="15" font-weight="800" fill="#6ee7b7" text-anchor="middle">10 min</text>'
            f'<text x="{(xB+xf)/2}" y="{wy+26}" font-size="15" font-weight="800" fill="#6ee7b7" text-anchor="middle">20 min</text>', 7.6, PER, tail=1.4)
    # result cards
    cy = 482
    show(s, f'<rect x="80" y="{cy}" width="500" height="112" rx="14" fill="#2a0a14" stroke="#fb7185" stroke-opacity="0.7" stroke-width="1.5"/>'
            f'<text x="104" y="{cy+34}" font-size="13" font-weight="800" fill="#fb7185" letter-spacing="1.5">WALL-CLOCK DIFFERENCE</text>'
            f'<text x="104" y="{cy+68}" font-size="30" font-weight="800" fill="#f8fafc">930 min</text>'
            f'<text x="104" y="{cy+94}" font-size="14" fill="#cbd5e1">Counts the 15 idle night hours as if they were the miss.</text>', 8.4, PER, tail=1.4)
    show(s, f'<rect x="620" y="{cy}" width="500" height="112" rx="14" fill="#06251d" stroke="#34d399" stroke-opacity="0.8" stroke-width="1.5"/>'
            f'<text x="644" y="{cy+34}" font-size="13" font-weight="800" fill="#34d399" letter-spacing="1.5">SHIFT-AWARE ERROR (USED)</text>'
            f'<text x="644" y="{cy+68}" font-size="30" font-weight="800" fill="#f8fafc">10 + 20 = <tspan fill="#34d399">30 working min</tspan></text>'
            f'<text x="644" y="{cy+94}" font-size="14" fill="#cbd5e1">Only time the technician could actually have been working.</text>', 9.2, PER, tail=1.4)
    s.save(OUT / "accuracy.svg")

queue(); accuracy()
