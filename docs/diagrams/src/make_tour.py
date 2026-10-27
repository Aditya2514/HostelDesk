"""Builds docs/assets/tour.gif from docs/screenshots (needs Pillow + ffmpeg). Run: python3 docs/diagrams/src/make_tour.py"""
import pathlib, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS, OUT = ROOT / "screenshots", ROOT / "assets" / "tour.gif"
FD = "/usr/share/fonts/opentype/inter/"
def font(name, size): return ImageFont.truetype(FD + name, size)
F_T, F_S, F_C = font("Inter-Bold.otf", 30), font("Inter-Regular.otf", 17), font("Inter-Bold.otf", 15)

frames = [
    ("login", "Sign in as any role", "One-click demo accounts for every role on the login screen", None),
    ("student-dashboard", "Student: everything about my room", "Room tickets are shared with roommates; common-area reports have their own tab", None),
    ("student-eta-breakdown", "Student: a time range, and the reasons", "Similar past jobs, jobs ahead in the queue, and the technician's real shift windows", None),
    ("locked-room-flow", "Locked room: no entry without the student", "The SLA clock pauses; the student chooses a 15-minute return or books a slot", None),
    ("confirm-or-dispute", "Proof of completion", "Closed with the occupant's code and an after-photo; confirm or report a problem within 48 hours", None),
    ("staff-queue", "Technician: a planned day", "Start and finish time for every job, from real shift windows and priorities", None),
    ("warden-disputes", "Warden: decides from evidence", "Photos, server timestamps and the full timeline in one place", None),
    ("warden-analytics", "Analytics: promises vs reality", "Breach rate, reliability scores and prediction error in working minutes", 700),
]

W, H, PAD, TOP = 1280, 820, 40, 112
tmp = pathlib.Path(tempfile.mkdtemp())
for i, (name, title, sub, crop) in enumerate(frames, 1):
    im = Image.open(SHOTS / f"{name}.png").convert("RGB")
    scale = (W - 2*PAD) / im.width
    th = H - TOP - PAD
    src_h = min(im.height, int(th / scale))
    im = im.crop((0, 0, im.width, src_h)).resize((W - 2*PAD, int(src_h * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), "#070b17")
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((12, 12, W-12, H-12), 22, outline="#1e293b", width=2)
    d.rounded_rectangle((PAD, 30, PAD+74, 62), 16, fill="#1e1b4b", outline="#6366f1")
    d.text((PAD+37, 46), f"{i} / {len(frames)}", font=F_C, fill="#a5b4fc", anchor="mm")
    d.text((PAD+92, 46), title, font=F_T, fill="#f8fafc", anchor="lm")
    d.text((PAD+2, 88), sub, font=F_S, fill="#94a3b8", anchor="lm")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width-1, im.height-1), 14, fill=255)
    canvas.paste(im, (PAD, TOP), mask)
    d.rounded_rectangle((PAD, TOP, PAD+im.width, TOP+im.height), 14, outline="#334155", width=2)
    canvas.save(tmp / f"f{i:02d}.png")

OUT.parent.mkdir(parents=True, exist_ok=True)
pal = tmp / "pal.png"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "0.4", "-i", str(tmp / "f%02d.png"), "-vf", "scale=1100:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=full", str(pal)], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "0.4", "-i", str(tmp / "f%02d.png"), "-i", str(pal), "-lavfi", "scale=1100:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", str(OUT)], check=True)
print("wrote", OUT, round(OUT.stat().st_size/1e6, 2), "MB")
