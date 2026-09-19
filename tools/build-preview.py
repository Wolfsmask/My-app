"""
Builds mbonyx-preview.html: one self-contained file that opens by double-click.

Everything is embedded — fonts, screenshots, and all five concept builds plus
the legal pages. The demos run inside an iframe overlay so their CSS stays
isolated from the main page's CSS (both define :root variables and generic
class names like .wrap and .btn).
"""
import base64, json, re, pathlib

root = pathlib.Path(".")

def b64(path, mime):
    return f"data:{mime};base64," + base64.b64encode((root / path).read_bytes()).decode()

html = (root / "index.html").read_text()

# ---- 1. Inline the fonts ---------------------------------------------------
# Every font any page references. A family missing from this map is stripped
# from the sub-pages by FONT_MARKER and never re-injected, so the preview
# silently falls back to a system face — which is exactly the difference the
# concept builds are meant to demonstrate.
FONT_FACES = [
    # family,             style,    weight,     file
    ("Inter",             "normal", "100 900",  "inter-var.woff2"),
    ("Playfair Display",  "normal", "600",      "playfair-600.woff2"),
    ("Playfair Display",  "italic", "600",      "playfair-600-italic.woff2"),
    ("Fraunces",          "normal", "400 700",  "fraunces-var.woff2"),
    ("Oswald",            "normal", "400 700",  "oswald-var.woff2"),
]
fonts = {
    f"/assets/fonts/{f}": b64(f"assets/fonts/{f}", "font/woff2")
    for *_, f in FONT_FACES
}
for path, data in fonts.items():
    html = html.replace(f'url("{path}")', f'url("{data}")')

# Preload tags can't point at data URLs usefully; drop them.
html = re.sub(r'\s*<link rel="preload" href="/assets/fonts/[^>]+>', '', html)

# ---- 2. Inline the screenshots --------------------------------------------
for img in sorted((root / "assets/work").glob("*.webp")):
    html = html.replace(f"/assets/work/{img.name}", b64(f"assets/work/{img.name}", "image/webp"))

# ---- 3. Inline the favicon, drop tags that need a real server --------------
html = html.replace('href="/favicon.svg"', f'href="{b64("favicon.svg", "image/svg+xml")}"')
html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]+>', '', html)
html = re.sub(r'\s*<link rel="canonical"[^>]+>', '', html)
html = re.sub(r'\s*<meta property="og:[^>]+>', '', html)
html = re.sub(r'\s*<meta name="twitter:[^>]+>', '', html)

# ---- 4. Collect every sub-page, minus its own @font-face block -------------
FONT_MARKER = "/*__FONTS__*/"
pages = {}

def prep(path):
    src = (root / path).read_text()
    # Strip each page's @font-face rules; the shell re-injects them so the
    # base64 blobs appear exactly once in the output file instead of six times.
    src = re.sub(r'@font-face\{[^}]*\}', '', src)
    src = re.sub(r'  @font-face \{.*?\n  \}\n', '', src, flags=re.S)
    src = src.replace('<style>', '<style>' + FONT_MARKER, 1)
    # doc.css is an external stylesheet; inline it for the legal pages.
    if 'assets/doc.css' in src:
        doc_css = re.sub(r'@font-face\{[^}]*\}', '', (root / "assets/doc.css").read_text())
        src = src.replace('<link rel="stylesheet" href="/assets/doc.css">',
                          f'<style>{FONT_MARKER}{doc_css}</style>')
    src = re.sub(r'<link rel="(icon|apple-touch-icon|preload)"[^>]*>', '', src)
    # Inside the preview there is no server, so send internal links back to the shell.
    src = src.replace('href="/#work"', 'href="#" onclick="parent.closePreview();return false"')
    src = src.replace('href="/"', 'href="#" onclick="parent.closePreview();return false"')
    return src

for slug in ["lumen-dental", "northpoint-hvac", "ember-oak", "meridian-law", "forge-athletics"]:
    pages[slug] = prep(f"work/{slug}.html")
for slug in ["privacy", "terms", "success", "404"]:
    pages[slug] = prep(f"{slug}.html")

titles = {
    "lumen-dental": "Lumen Dental Studio", "northpoint-hvac": "Northpoint Heating & Air",
    "ember-oak": "Ember & Oak", "meridian-law": "Meridian Law Group",
    "forge-athletics": "Forge Athletics", "privacy": "Privacy Policy",
    "terms": "Terms of Service", "success": "Form success page", "404": "404 page",
}

font_css = "".join(
    f'@font-face{{font-family:"{fam}";font-style:{style};font-weight:{wt};'
    f'font-display:swap;src:url("{fonts["/assets/fonts/" + f]}") format("woff2")}}'
    for fam, style, wt, f in FONT_FACES
)

# ---- 5. Turn portfolio links into preview triggers -------------------------
html = re.sub(
    r'href="/work/([a-z-]+)\.html"\s*\n\s*target="_blank"\s*\n\s*rel="noopener"',
    r'href="#" data-preview="\1"', html)
html = html.replace('href="/privacy.html"', 'href="#" data-preview="privacy"')
html = html.replace('href="/terms.html"', 'href="#" data-preview="terms"')

# ---- 6. The overlay ---------------------------------------------------------
overlay = '''
<!-- ===== OFFLINE PREVIEW SHELL =========================================
     Only present in mbonyx-preview.html. The live site links to real pages.
====================================================================== -->
<style>
  .pv{position:fixed;inset:0;z-index:5000;display:none;flex-direction:column;background:#05070a}
  .pv.is-open{display:flex}
  .pv__bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:11px 16px;
    border-bottom:1px solid rgba(255,255,255,.1);background:#0b0f15;color:#f5f3ed;
    font-family:"Inter",Arial,sans-serif;font-size:.84rem}
  .pv__title{font-weight:700;letter-spacing:.02em;margin-right:auto}
  .pv__title small{display:block;font-weight:400;font-size:.72rem;color:#7d828c;letter-spacing:.06em;text-transform:uppercase}
  .pv__seg{display:flex;border:1px solid rgba(255,255,255,.14);border-radius:999px;overflow:hidden}
  .pv__seg button{padding:7px 15px;border:0;background:transparent;color:#b3b6bd;
    font:inherit;font-size:.78rem;font-weight:600;cursor:pointer}
  .pv__seg button.on{background:#c9ad72;color:#0a0c10}
  .pv__close{min-height:36px;padding:7px 16px;border:1px solid rgba(255,255,255,.18);
    border-radius:999px;background:transparent;color:#f5f3ed;font:inherit;font-size:.78rem;
    font-weight:700;cursor:pointer}
  .pv__close:hover{border-color:#c9ad72;color:#e6d3a5}
  .pv__stage{flex:1;display:grid;place-items:center;overflow:auto;padding:0;background:#05070a}
  .pv__stage.mobile{padding:22px}
  .pv__frame{width:100%;height:100%;border:0;background:#fff}
  .pv__stage.mobile .pv__frame{width:390px;height:min(780px,100%);max-width:100%;
    border:8px solid #22242b;border-radius:30px;box-shadow:0 30px 70px rgba(0,0,0,.6)}
  @media(max-width:620px){.pv__stage.mobile{padding:0}.pv__stage.mobile .pv__frame{width:100%;height:100%;border:0;border-radius:0}}
</style>

<div class="pv" id="pv" role="dialog" aria-modal="true" aria-label="Site preview">
  <div class="pv__bar">
    <div class="pv__title"><small>Concept build</small><span id="pvTitle"></span></div>
    <div class="pv__seg">
      <button type="button" id="pvDesktop" class="on">Desktop</button>
      <button type="button" id="pvMobile">Phone</button>
    </div>
    <button type="button" class="pv__close" id="pvClose">Close ✕</button>
  </div>
  <div class="pv__stage" id="pvStage"><iframe class="pv__frame" id="pvFrame" title="Preview"></iframe></div>
</div>

<script type="application/json" id="pvPages">__PAGES__</script>
<script>
(() => {
  const PAGES  = JSON.parse(document.getElementById("pvPages").textContent);
  const TITLES = __TITLES__;
  const FONTS  = document.getElementById("pvFonts").textContent;

  const pv = document.getElementById("pv");
  const frame = document.getElementById("pvFrame");
  const stage = document.getElementById("pvStage");
  const title = document.getElementById("pvTitle");
  const bDesk = document.getElementById("pvDesktop");
  const bMob  = document.getElementById("pvMobile");
  let lastFocus = null;

  function open(slug) {
    if (!PAGES[slug]) return;
    lastFocus = document.activeElement;
    title.textContent = TITLES[slug] || slug;
    frame.srcdoc = PAGES[slug].replace("/*__FONTS__*/", FONTS);
    pv.classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.getElementById("pvClose").focus();
  }

  window.closePreview = function () {
    pv.classList.remove("is-open");
    frame.srcdoc = "";
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  };

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-preview]");
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute("data-preview"));
  });

  document.getElementById("pvClose").addEventListener("click", closePreview);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && pv.classList.contains("is-open")) closePreview();
  });

  bDesk.addEventListener("click", () => {
    stage.classList.remove("mobile"); bDesk.classList.add("on"); bMob.classList.remove("on");
  });
  bMob.addEventListener("click", () => {
    stage.classList.add("mobile"); bMob.classList.add("on"); bDesk.classList.remove("on");
  });
})();
</script>
'''
overlay = overlay.replace("__PAGES__", json.dumps(pages).replace("</", "<\\/"))
overlay = overlay.replace("__TITLES__", json.dumps(titles))

html = html.replace("</body>",
    f'<script type="text/css" id="pvFonts">{font_css}</script>\n' + overlay + "\n</body>")

# A banner so it's obvious this copy is the offline one.
banner = '''<div style="position:relative;z-index:1000;background:#c9ad72;color:#0a0c10;
  font-family:Inter,Arial,sans-serif;font-size:.79rem;font-weight:600;text-align:center;
  padding:8px 16px;line-height:1.5">
  Offline preview — everything is embedded in this one file. Click any
  <strong>View live build</strong> to open that site.
</div>'''
html = html.replace('<body>', '<body>\n' + banner, 1)
html = html.replace("<title>", "<title>PREVIEW · ", 1)

leaked = re.findall(r'/assets/fonts/[\w.-]+\.woff2', html)
if leaked:
    raise SystemExit(
        f"{len(set(leaked))} font file(s) referenced but not inlined: {sorted(set(leaked))}\n"
        "Add them to FONT_FACES."
    )

out = root / "mbonyx-preview.html"
out.write_text(html)
print(f"{out}  {out.stat().st_size/1024:.0f}KB  ({len(pages)} sub-pages embedded)")
