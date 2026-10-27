"""Tiny SVG toolkit for the README diagrams (no external dependencies)."""
import html, textwrap, pathlib

FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
P = {  # palette: (accent, dark fill)
    "green":  ("#34d399", "#064e3b"),
    "indigo": ("#818cf8", "#1e1b4b"),
    "amber":  ("#fbbf24", "#451a03"),
    "orange": ("#fb923c", "#431407"),
    "violet": ("#c084fc", "#3b0764"),
    "rose":   ("#fb7185", "#4c0519"),
    "sky":    ("#38bdf8", "#082f49"),
    "slate":  ("#94a3b8", "#0f172a"),
}
CARD = "#0d1428"

def esc(s): return html.escape(str(s), quote=False)

class Svg:
    def __init__(self, w, h, title, desc):
        self.w, self.h = w, h
        self.o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}" role="img" aria-labelledby="t d">',
                  f'<title id="t">{esc(title)}</title><desc id="d">{esc(desc)}</desc>',
                  '''<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#070b17"/></linearGradient>
<marker id="arr" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto"><path d="M1,1 L10,6 L1,11 z" fill="#94a3b8"/></marker>
<filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>''',
                  f'<rect width="{w}" height="{h}" rx="22" fill="url(#bg)"/>',
                  f'<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="21" fill="none" stroke="#1e293b" stroke-width="2"/>']

    def heading(self, title, sub=None):
        self.o.append(f'<text x="{self.w/2}" y="58" text-anchor="middle" font-size="31" font-weight="800" fill="#f8fafc">{esc(title)}</text>')
        if sub:
            self.o.append(f'<text x="{self.w/2}" y="88" text-anchor="middle" font-size="16.5" fill="#94a3b8">{esc(sub)}</text>')

    def text(self, x, y, s, size=15, fill="#cbd5e1", weight=400, anchor="start", spacing=None):
        sp = f' letter-spacing="{spacing}"' if spacing else ''
        self.o.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{sp}>{esc(s)}</text>')

    def lane(self, x, y, w, h, label, col="#64748b"):
        self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="#0a1022" stroke="#1e293b" stroke-width="1.5"/>')
        self.text(x + 24, y + 30, label, 13, col, 800, spacing=2.2)

    def card(self, x, y, w, h, color, head=None, body=None, num=None, size=15, shadow=True, align="left", body_color="#cbd5e1", bar=True):
        acc, dark = P[color]
        wrap_w = max(10, int((w - (88 if num else 44)) / (size * 0.545)))
        g = '<g filter="url(#sh)">' if shadow else '<g>'
        self.o.append(f'{g}<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{CARD}" stroke="{acc}" stroke-opacity="0.55" stroke-width="1.5"/></g>')
        if bar:
            self.o.append(f'<rect x="{x}" y="{y+14}" width="5" height="{h-28}" rx="2.5" fill="{acc}"/>')
        tx = x + 24
        if num is not None:
            self.o.append(f'<circle cx="{x+38}" cy="{y+34}" r="17" fill="{dark}" stroke="{acc}" stroke-width="2.2"/>')
            self.text(x + 38, y + 40, num, 17, acc, 800, "middle")
            tx = x + 68
        cy = y + 30
        if head:
            self.text(tx, cy + (5 if num is not None else 0), head, size + 1, "#f8fafc" if num is not None else acc, 800, spacing=(None if num is not None else 0.6))
            cy += 26
        if body:
            lines = []
            for para in (body if isinstance(body, list) else [body]):
                lines += textwrap.wrap(para, wrap_w) or [""]
            cy = max(cy, y + 62) if num is not None else cy
            for ln in lines:
                self.text(tx, cy + 4, ln, size, body_color)
                cy += size + 7
        return (x, y, w, h)

    def pill(self, x, y, w, h, color, label, size=15):
        acc, dark = P[color]
        self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{dark}" stroke="{acc}" stroke-opacity="0.8" stroke-width="1.5"/>')
        self.text(x + w/2, y + h/2 + size*0.35, label, size, acc, 700, "middle")

    def diamond(self, cx, cy, w, h, color, label, size=14.5):
        acc, dark = P[color]
        pts = f'{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}'
        self.o.append(f'<polygon points="{pts}" fill="{dark}" stroke="{acc}" stroke-width="2"/>')
        lines = textwrap.wrap(label, 15)
        y0 = cy - (len(lines)-1) * (size+3) / 2 + size*0.35
        for i, ln in enumerate(lines):
            self.text(cx, y0 + i*(size+3), ln, size, "#f8fafc", 700, "middle")

    def arrow(self, pts, dashed=False, label=None, lpos=None, color="#94a3b8"):
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        da = ' stroke-dasharray="6 6"' if dashed else ''
        self.o.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.3" stroke-linejoin="round"{da} marker-end="url(#arr)"/>')
        if label:
            lx, ly = lpos or ((pts[0][0]+pts[-1][0])/2, (pts[0][1]+pts[-1][1])/2 - 8)
            self.o.append(f'<rect x="{lx-len(label)*3.7-6}" y="{ly-14}" width="{len(label)*7.4+12}" height="21" rx="6" fill="#0a1022"/>')
            self.text(lx, ly + 1, label, 13, "#cbd5e1", 600, "middle")

    def save(self, path):
        self.o.append('</svg>')
        p = pathlib.Path(path); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("\n".join(self.o), encoding="utf-8"); print("wrote", p)


def _node(self, x, y, w, h, color, label, size=15):
    acc, dark = P[color]
    self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{dark}" stroke="{acc}" stroke-width="2"/>')
    self.text(x + w/2, y + h/2 + size*0.36, label, size, "#f8fafc", 800, "middle", spacing=0.4)

def _entity(self, x, y, w, color, title, fields, note=None):
    """Entity card: header + monospace-ish field rows. Returns height."""
    acc, dark = P[color]
    rh = 24
    h = 44 + rh * len(fields) + (22 if note else 0) + 8
    self.o.append(f'<g filter="url(#sh)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{CARD}" stroke="{acc}" stroke-opacity="0.6" stroke-width="1.5"/></g>')
    self.o.append(f'<path d="M{x},{y+12} a12,12 0 0 1 12,-12 h{w-24} a12,12 0 0 1 12,12 v{44-12} h-{w} z" fill="{dark}"/>')
    self.text(x + 16, y + 28, title, 15.5, acc, 800, spacing=0.8)
    for i, f in enumerate(fields):
        yy = y + 44 + 18 + i * rh
        if isinstance(f, tuple):
            name, typ = f
        else:
            name, typ = f, ""
        self.o.append(f'<text x="{x+16}" y="{yy}" font-size="13.5" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">{esc(name)}</text>')
        if typ:
            self.o.append(f'<text x="{x+w-16}" y="{yy}" font-size="12.5" fill="#64748b" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">{esc(typ)}</text>')
    if note:
        self.text(x + 16, y + h - 12, note, 12.5, "#94a3b8")
    return h

def _dot(self, x, y, r=7, fill="#94a3b8"):
    self.o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')

Svg.node = _node; Svg.entity = _entity; Svg.dot = _dot
