"""Generates docs/assets/banner.svg. Run: python3 docs/diagrams/src/make_banner.py"""
import pathlib
OUT = pathlib.Path(__file__).resolve().parents[2] / "assets" / "banner.svg"
W, H = 1280, 340
F = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{F}" role="img" aria-labelledby="t">
<title id="t">HostelDesk: the hostel complaint register, rebuilt as software that keeps its promises</title>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="0.55" stop-color="#0b1020"/><stop offset="1" stop-color="#070b17"/></linearGradient>
<radialGradient id="glow1" cx="0.12" cy="0.1" r="0.6"><stop offset="0" stop-color="#6366f1" stop-opacity="0.45"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></radialGradient>
<radialGradient id="glow2" cx="0.95" cy="0.95" r="0.5"><stop offset="0" stop-color="#34d399" stop-opacity="0.22"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></radialGradient>
<linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.5"/></filter>
</defs>
<rect width="{W}" height="{H}" rx="22" fill="url(#bg)"/>
<rect width="{W}" height="{H}" rx="22" fill="url(#glow1)"/>
<rect width="{W}" height="{H}" rx="22" fill="url(#glow2)"/>
<rect x="1" y="1" width="{W-2}" height="{H-2}" rx="21" fill="none" stroke="#312e81" stroke-width="2"/>

<!-- logo -->
<g transform="translate(64,62)">
  <rect width="76" height="76" rx="20" fill="url(#logo)"/>
  <g fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="22" y="16" width="32" height="44" rx="2"/>
    <path d="M30 26h6M40 26h6M30 36h6M40 36h6M30 46h6M40 46h6M34 60v-8h8v8"/>
  </g>
</g>
<text x="164" y="108" font-size="62" font-weight="800" fill="#f8fafc" letter-spacing="-1">HostelDesk</text>
<text x="166" y="140" font-size="19" fill="#a5b4fc" font-weight="600">Campus complaint &amp; facility SLA engine</text>

<text x="64" y="206" font-size="27" font-weight="700" fill="#e2e8f0">The hostel complaint register,</text>
<text x="64" y="240" font-size="27" font-weight="700" fill="#e2e8f0">rebuilt as software that <tspan fill="#34d399">keeps its promises.</tspan></text>

<!-- pills -->
<g font-size="15" font-weight="700">
  <rect x="64" y="272" width="176" height="36" rx="18" fill="#064e3b" stroke="#34d399" stroke-opacity="0.7"/>
  <text x="152" y="295" text-anchor="middle" fill="#6ee7b7">Predicted ETA</text>
  <rect x="254" y="272" width="214" height="36" rx="18" fill="#451a03" stroke="#fbbf24" stroke-opacity="0.7"/>
  <text x="361" y="295" text-anchor="middle" fill="#fcd34d">Proof of completion</text>
  <rect x="482" y="272" width="194" height="36" rx="18" fill="#3b0764" stroke="#c084fc" stroke-opacity="0.7"/>
  <text x="579" y="295" text-anchor="middle" fill="#d8b4fe">Auto escalation</text>
</g>

<!-- mock ETA card -->
<g filter="url(#sh)" transform="translate(790,52)">
  <rect width="430" height="132" rx="18" fill="#101a38" stroke="#4f46e5" stroke-opacity="0.8" stroke-width="1.5"/>
  <circle cx="44" cy="46" r="20" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/>
  <path d="M44 34v13l9 6" fill="none" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/>
  <text x="84" y="38" font-size="12.5" font-weight="800" fill="#818cf8" letter-spacing="1.4">ESTIMATED COMPLETION RANGE</text>
  <text x="84" y="68" font-size="24" font-weight="800" fill="#f8fafc">Likely by <tspan fill="#34d399">Today 12:10 PM</tspan></text>
  <text x="84" y="92" font-size="14" fill="#94a3b8">latest around 2:15 PM</text>
  <rect x="24" y="104" width="382" height="1.5" fill="#1e293b"/>
  <text x="24" y="124" font-size="13" fill="#a5b4fc">6 similar repairs · 2 jobs ahead · shift 9-1, 2-6</text>
</g>

<!-- mock code card -->
<g filter="url(#sh)" transform="translate(790,206)">
  <rect width="430" height="98" rx="18" fill="#101a38" stroke="#f59e0b" stroke-opacity="0.7" stroke-width="1.5"/>
  <text x="24" y="34" font-size="12.5" font-weight="800" fill="#fbbf24" letter-spacing="1.4">COMPLETION CODE · OCCUPANTS ONLY</text>
  <g font-size="30" font-weight="800" fill="#fef3c7" text-anchor="middle">
    <rect x="24" y="46" width="52" height="38" rx="9" fill="#451a03" stroke="#b45309"/><text x="50" y="75">4</text>
    <rect x="86" y="46" width="52" height="38" rx="9" fill="#451a03" stroke="#b45309"/><text x="112" y="75">8</text>
    <rect x="148" y="46" width="52" height="38" rx="9" fill="#451a03" stroke="#b45309"/><text x="174" y="75">1</text>
    <rect x="210" y="46" width="52" height="38" rx="9" fill="#451a03" stroke="#b45309"/><text x="236" y="75">7</text>
  </g>
  <text x="282" y="62" font-size="14" fill="#cbd5e1">Share it only when</text>
  <text x="282" y="82" font-size="14" fill="#cbd5e1">the fix is really done.</text>
</g>
</svg>'''
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(svg, encoding="utf-8"); print("wrote", OUT)
