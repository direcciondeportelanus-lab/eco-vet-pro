"""
Eco Vet Pro — Backend FastAPI
Con Supabase (PostgreSQL) + Whisper + LLM
"""
import os, io, json, textwrap
from datetime import datetime
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

BASE_DIR = Path(__file__).parent.parent
TEMPLATE_PATH = BASE_DIR / "plantilla.pdf"
UPLOADS_DIR = BASE_DIR / "data" / "uploads"

# ── Supabase config (env vars) ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

def supa_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

async def supa_get(table, params=""):
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{SUPABASE_URL}/rest/v1/{table}?{params}", headers=supa_headers())
    return r.json() if r.status_code == 200 else []

async def supa_post(table, data):
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=supa_headers(), json=data)
    return r.json() if r.status_code in (200, 201) else None

async def supa_upsert(table, data):
    h = {**supa_headers(), "Prefer": "resolution=merge-duplicates,return=representation"}
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=h, json=data)
    return r.json() if r.status_code in (200, 201) else None

# ── Style learning ──
async def load_style():
    rows = await supa_get("estilo", "select=tipo,clave,valor")
    style = {"frases_habituales": [], "terminos_preferidos": {}, "correcciones_frecuentes": []}
    for r in (rows if isinstance(rows, list) else []):
        if r["tipo"] == "frase":
            style["frases_habituales"].append(r["valor"])
        elif r["tipo"] == "termino":
            style["terminos_preferidos"][r.get("clave", "")] = r["valor"]
        elif r["tipo"] == "correccion":
            style["correcciones_frecuentes"].append(r["valor"])
    return style

async def save_patterns(patterns):
    if not patterns:
        return
    rows = []
    for f in (patterns.get("frases_nuevas") or []):
        rows.append({"tipo": "frase", "clave": None, "valor": f})
    for k, v in (patterns.get("terminos_preferidos") or {}).items():
        rows.append({"tipo": "termino", "clave": k, "valor": v})
    for c in (patterns.get("correcciones_frecuentes") or []):
        rows.append({"tipo": "correccion", "clave": None, "valor": c})
    if rows:
        await supa_upsert("estilo", rows)

# ── LLM ──
SYSTEM_PROMPT = """Sos el asistente oficial de redacción de informes ecográficos de la Dra. Silvina Raffo (M.P. 11901), veterinaria. Fecha de hoy: """ + datetime.now().strftime("%d/%m/%Y") + """.

═══════════════════════════════
REGLA #0 — LO QUE NUNCA HACÉS
═══════════════════════════════
- NUNCA inventás datos, hallazgos, medidas ni diagnósticos que no estén en el dictado.
- NUNCA resumís. Tu trabajo es ORDENAR, CLARIFICAR y REDACTAR con precisión lo que la Dra. dictó. Cada hallazgo, cada medida, cada detalle que ella diga debe quedar en el informe. No omitas nada.
- NUNCA cambiás el significado clínico.
- Si falta un dato, dejá el campo vacío.
- Si dice "hoy", usá la fecha de hoy.

═══════════════════════════════
DICCIONARIO MÉDICO VETERINARIO
═══════════════════════════════
Whisper suele transcribir mal estos términos. SIEMPRE corregí:
- "vaso" → BAZO (órgano abdominal)
- "vesiga", "besiga", "veciga" → VEJIGA
- "prostata" → PRÓSTATA
- "riñon" → RIÑÓN
- "higado" → HÍGADO
- "vesicula" → VESÍCULA BILIAR
- "eco grafía", "eco grafia" → ecografía
- "anecoico" → anecóico
- "hipoecoico" → hipoecóico
- "hiperecoico" → hiperecóico
- "parenquima" → parénquima
- "cortico medular" → córtico-medular
- "linfo nódulos", "linfono dulos" → linfonódulos
- "linfodanopatias" → linfadenopatías
- "cisitits", "sistitis" → cistitis
- "colecistitis" → colecistitis
- "colestosis" → colestasis
- "neoformacion" → neoformación
- "hiperplacia" → hiperplasia
Aplicá siempre acentos y ortografía médica correcta.

═══════════════════════════════
INTERPRETACIÓN DEL DICTADO
═══════════════════════════════
1) DATOS DEL PACIENTE — "paciente", "tutor", "dueño", "mascota", "derivado por", "lo manda"
   → Ubicás cada dato en: tutor / fecha / mascota / medico_derivante.

2) CUERPO DEL INFORME — "hallazgos", "se observa", "a nivel de", "conclusión", "impresión diagnóstica"
   → Orden fijo: INDICACIÓN CLÍNICA → hallazgos por órgano → CONCLUSIÓN
   → Agrupá por órgano aunque los dicte salteados o vuelva a uno ya mencionado.
   → NO resumís: transcribís todo lo que dijo, con mejor redacción y orden.
   → SIEMPRE escribí la CONCLUSIÓN al final. Si la Dra. no la dictó, escribí: "CONCLUSIÓN: (pendiente de completar por la profesional)."

3) CÁLCULOS — Si dice "haceme el cálculo", "calculame", "el volumen de":
   REGLAS DE FORMATO PARA NÚMEROS Y MEDIDAS:
   - CADA número debe llevar su unidad al lado: 3,2 cm × 2,1 cm × 1,2 cm (NO: 3,2 x 2,1 x 1,2 cm)
   - Si la Dra. dice los valores en mm, cada número lleva mm. Si dice cm, cada uno lleva cm.
   - Volumen: mostrá solo las 3 medidas con unidad y el resultado. NUNCA muestres el factor 0,523 en el texto.
     Ejemplo correcto: "Dimensiones de 3,2 cm × 2,1 cm × 1,2 cm. Volumen estimado: 4,22 cm³."
     Ejemplo INCORRECTO: "3,2 x 2,1 x 1,2 x 0,523 = 4,22 cm³" (NO mostrar el 0,523)
   - Internamente calculá: largo × ancho × alto × 0,523 = resultado en cm³
   - Índice de resistividad renal (IR) = (Vmáx - Vmín) / Vmáx. Mostrá valores y resultado.
   - Relación córtico-medular: valor corteza / valor médula

4) COMANDOS — Respondé a órdenes directas:
   - "corregí eso" / "cambiá lo último" → corregís la última parte
   - "borrá eso" / "sacá eso" → eliminás lo último
   - "agregá a..." → agregás al órgano indicado

═══════════════════════════════
FORMATO DEL TEXTO
===============================
- PRIMERA LINEA SIEMPRE: "Paciente: [nombre], especie [especie], [sexo], [edad]."
- Si la Dra. hace una introduccion o resena antes de los organos, ponerla como segundo parrafo.
- Luego INDICACION CLINICA si fue dictada
- Cada organo: nombre en MAYUSCULAS seguido de dos puntos
- ORDEN DE ORGANOS (respetar siempre este orden):
  PERITONEO, LINFONODULOS, VEJIGA, RINONES, GLANDULAS ADRENALES,
  ESTOMAGO, INTESTINO DELGADO, INTESTINO GRUESO, BAZO, HIGADO,
  VESICULA BILIAR, PANCREAS
- Si un organo no fue mencionado, escribir: "ORGANO: Sin particularidades ecograficas evidentes."
- Separar cada organo con una linea en blanco
- Oraciones completas con puntuacion correcta
- Tono: profesional, tercera persona ("se observa", "se evidencia", "presenta")
- FORMATO DE MEDIDAS: cada numero SIEMPRE lleva su unidad al lado.
  Si dicta en mm: "39 mm × 25 mm" (NO "39 x 25 mm")
  Si dicta en cm: "3,2 cm × 2,1 cm × 1,2 cm" (NO "3,2 x 2,1 x 1,2 cm")
  Los numeros con unidades son datos importantes del informe.

CONCLUSION (SIEMPRE al final, debe ser COMPLETA y DETALLADA):
- Titulo: CONCLUSION
- Enumerar TODOS los hallazgos patologicos encontrados, cada uno precedido por *
- Incluir grado de severidad cuando corresponda (leve, moderado, severo)
- Incluir localizacion cuando corresponda
- Mencionar hallazgos secundarios relevantes
- Al final: "* Organos sin particularidades: [listar organos normales] sin particularidades ecograficas significativas."
- Cerrar con: "Informe realizado por:\\nM.V. Raffo Silvina"
- La conclusion NO debe ser un resumen breve. Debe ser un listado completo de todos los hallazgos para que el medico derivante tenga claridad.

EJEMPLO DE ORGANO NORMAL:
"PERITONEO: Sin particularidades ecograficas evidentes."

EJEMPLO DE ORGANO CON HALLAZGO:
"HIGADO: Hepatomegalia moderada. Bordes lisos, parenquima homogeneo con disminucion de la ecogenicidad en forma difusa, patron portal reforzado y venas hepaticas conservadas. Hallazgos sugestivos de hepatopatia inflamatoria aguda."

EJEMPLO DE RINONES:
"RINONES: * Rinon izquierdo: 41 x 25 mm. * Rinon derecho: 45 x 24 mm. Ambos conservan caracteristicas ecograficas normales."

EJEMPLO DE CONCLUSION COMPLETA:
"CONCLUSION\\n* Hepatopatia inflamatoria aguda con hepatomegalia moderada a severa.\\n* Colestasis con barro biliar y paredes engrosadas, hallazgos sugestivos de colecistitis aguda.\\n* Nefropatia cronica difusa de probable origen inflamatorio en grado leve a moderado.\\n* Gastritis aguda con paredes engrosadas.\\n* Enteritis aguda en intestino delgado.\\n* Linfadenopatia mesenterica reactiva / infiltrativa difusa.\\n* Sedimento celular vesical.\\n* Organos sin particularidades: bazo, pancreas, intestino grueso y peritoneo sin particularidades ecograficas significativas.\\n\\nInforme realizado por:\\nM.V. Raffo Silvina"

===============================
RESPUESTA
===============================
RESPONDE SOLO con JSON valido. Sin markdown. Sin backticks. Sin texto adicional.
{"tutor":"","fecha":"","mascota":"","medico_derivante":"","cuerpo_informe":"texto completo del informe","estilo_detectado":{"frases_nuevas":[],"terminos_preferidos":{},"correcciones_frecuentes":[]}}"""

PROVIDERS = {
    "groq": {"url": "https://api.groq.com/openai/v1/chat/completions", "model": "llama-3.3-70b-versatile",
             "whisper_url": "https://api.groq.com/openai/v1/audio/transcriptions", "whisper_model": "whisper-large-v3"},
    "openai": {"url": "https://api.openai.com/v1/chat/completions", "model": "gpt-4o-mini",
               "whisper_url": "https://api.openai.com/v1/audio/transcriptions", "whisper_model": "whisper-1"},
}

async def transcribe_audio(provider, api_key, audio_bytes, filename):
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(400, "Proveedor no soportado")
    async with httpx.AsyncClient(timeout=60.0) as c:
        r = await c.post(cfg["whisper_url"],
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (filename, audio_bytes, "audio/webm")},
            data={"model": cfg["whisper_model"], "language": "es"})
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Whisper error: {r.text}")
    return r.json().get("text", "")

async def call_llm(provider, api_key, text, style):
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(400, "Proveedor no soportado")
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if style and any(style.values()):
        messages.append({"role": "system", "content": f"ESTILO APRENDIDO:\n{json.dumps(style, ensure_ascii=False)}"})
    messages.append({"role": "user", "content": text})

    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(cfg["url"],
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": cfg["model"], "messages": messages, "temperature": 0.2, "max_tokens": 3000})
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"LLM error: {r.json().get('error',{}).get('message', r.text)}")

    content = r.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(content.replace("```json", "").replace("```", "").strip())
    except:
        return {"tutor": "", "fecha": "", "mascota": "", "medico_derivante": "",
                "cuerpo_informe": content, "estilo_detectado": {"frases_nuevas": [], "terminos_preferidos": {}, "correcciones_frecuentes": []}}

# ── PDF ──
def generate_pdf(data, img_paths, font_size_option=10):
    import re
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    template = PdfReader(str(TEMPLATE_PATH))
    writer = PdfWriter()

    buf1 = io.BytesIO()
    c = canvas.Canvas(buf1, pagesize=A4)
    PAGE_W, PAGE_H = A4

    # Colors
    PURPLE = Color(0.25, 0.05, 0.4)
    BLACK = Color(0.08, 0.08, 0.08)

    # ── Layout constants ──
    LEFT_X = 75
    RIGHT_X = 540
    TEXT_W = RIGHT_X - LEFT_X
    font_size = max(8, min(15, font_size_option))
    CHARS_PER_LINE = int(85 * (10 / font_size))
    LINE_H = font_size + 4
    BODY_START_Y = 620

    # ── Header fields in BOLD ──
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(PURPLE)
    fields = {"tutor": (175, 735), "fecha": (445, 735), "mascota": (155, 713), "medico_derivante": (420, 713)}
    for k, (x, y) in fields.items():
        v = data.get(k, "")
        if v:
            # Reduce font if text is too long for the space
            fsize = 11
            if k == "medico_derivante" and len(v) > 20:
                fsize = 9
            c.setFont("Helvetica-Bold", fsize)
            c.drawString(x, y, v)

    # ── Helper: detect if line has measurements to bold+italic ──
    MEASURE_RE = re.compile(r'(\d+[\.,]?\d*\s*(?:×|x)\s*\d+[\.,]?\d*(?:\s*(?:×|x)\s*\d+[\.,]?\d*)?\s*(?:mm|cm|cm³|cm3)|\d+[\.,]?\d*\s*(?:mm|cm|cm³|cm3))')

    def draw_line_with_formatting(canvas_obj, text, x, y, font_size, is_justified, is_last_line):
        """Draw a line with bold+italic for measurements."""
        parts = MEASURE_RE.split(text)
        if len(parts) == 1:
            # No measurements, draw normally
            if is_justified and not is_last_line and len(text) > 50:
                _draw_justified(canvas_obj, text, x, y, font_size)
            else:
                canvas_obj.drawString(x, y, text)
        else:
            # Has measurements - draw mixed
            cx = x
            for i, part in enumerate(parts):
                if not part:
                    continue
                if MEASURE_RE.match(part):
                    canvas_obj.setFont("Helvetica-BoldOblique", font_size)
                    canvas_obj.drawString(cx, y, part)
                    cx += canvas_obj.stringWidth(part, "Helvetica-BoldOblique", font_size)
                    canvas_obj.setFont("Helvetica", font_size)
                else:
                    canvas_obj.drawString(cx, y, part)
                    cx += canvas_obj.stringWidth(part, "Helvetica", font_size)

    def _draw_justified(canvas_obj, text, x, y, font_size):
        """Draw text justified to fill TEXT_W."""
        words = text.split()
        if len(words) <= 1:
            canvas_obj.drawString(x, y, text)
            return
        total_text_w = sum(canvas_obj.stringWidth(w, canvas_obj._fontname, font_size) for w in words)
        total_space = TEXT_W - total_text_w
        if total_space < 0 or total_space > TEXT_W * 0.5:
            canvas_obj.drawString(x, y, text)
            return
        space_w = total_space / (len(words) - 1)
        cx = x
        for word in words:
            canvas_obj.drawString(cx, y, word)
            cx += canvas_obj.stringWidth(word, canvas_obj._fontname, font_size) + space_w

    # ── Body text with auto-pagination ──
    body = data.get("cuerpo_informe", "")
    overlay_buffers = []  # list of overlay BytesIO for each page
    current_buf = buf1
    page_num = 1
    BOTTOM_MARGIN = 70
    CONTINUATION_TOP = 740  # page 2 template has more space (no header fields/INFORME bar)

    def new_page():
        """Finish current overlay and start a new one for continuation."""
        nonlocal c, current_buf, y, page_num
        c.save()
        current_buf.seek(0)
        overlay_buffers.append(current_buf)
        page_num += 1
        current_buf = io.BytesIO()
        c = canvas.Canvas(current_buf, pagesize=A4)
        y = CONTINUATION_TOP

    def check_y(needed=LINE_H):
        """If not enough space, create a new page."""
        nonlocal y
        if y - needed < BOTTOM_MARGIN:
            new_page()

    if body:
        y = BODY_START_Y
        font_size = 10

        for para in body.split("\n"):
            if para.strip() == "":
                y -= 10
                continue

            stripped = para.strip()

            # Detect paragraph type
            is_conclusion_header = stripped.upper().startswith("CONCLUSI")
            is_section_header = stripped.isupper() and len(stripped) < 50
            is_conclusion_item = stripped.startswith("*")
            is_signature = stripped.startswith("Informe realizado") or stripped.startswith("M.V.")

            # Organ detection
            is_organ_header = False
            if ":" in stripped and not is_conclusion_header and not is_section_header:
                colon_pos = stripped.index(":")
                before_colon = stripped[:colon_pos].strip()
                if before_colon.isupper() and len(before_colon) < 35 and colon_pos < 35:
                    is_organ_header = True

            if is_conclusion_header or is_section_header:
                check_y(LINE_H + 12)
                c.setFont("Helvetica-Bold", 12)
                c.setFillColor(PURPLE)
                y -= 8
                c.drawString(LEFT_X, y, stripped)
                y -= LINE_H + 4
                c.setFont("Helvetica", font_size)
                c.setFillColor(BLACK)
                continue

            if is_organ_header:
                colon_idx = stripped.index(":")
                organ_name = stripped[:colon_idx + 1]
                organ_text = stripped[colon_idx + 1:].strip()
                check_y(LINE_H + 10)
                y -= 10

                c.setFont("Helvetica-Bold", 11)
                c.setFillColor(PURPLE)
                c.drawString(LEFT_X, y, organ_name)
                organ_w = c.stringWidth(organ_name + " ", "Helvetica-Bold", 11)

                if organ_text:
                    c.setFont("Helvetica", font_size)
                    c.setFillColor(BLACK)
                    remaining_w = TEXT_W - organ_w
                    remaining_chars = int(remaining_w / (c.stringWidth("a", "Helvetica", font_size)))

                    first_wrap = textwrap.wrap(organ_text, width=remaining_chars) or [""]
                    draw_line_with_formatting(c, first_wrap[0], LEFT_X + organ_w, y, font_size, False, len(first_wrap) <= 1)
                    y -= LINE_H

                    if len(first_wrap) > 1:
                        rest_text = organ_text[len(first_wrap[0]):].strip()
                        rest_lines = textwrap.wrap(rest_text, width=CHARS_PER_LINE) or []
                        for li, line in enumerate(rest_lines):
                            check_y()
                            c.setFont("Helvetica", font_size)
                            draw_line_with_formatting(c, line, LEFT_X, y, font_size, True, li == len(rest_lines) - 1)
                            y -= LINE_H
                else:
                    y -= LINE_H
                continue

            if is_conclusion_item:
                c.setFont("Helvetica-Bold", font_size)
                c.setFillColor(BLACK)
                wrapped = textwrap.wrap(stripped, width=CHARS_PER_LINE) or [stripped]
                for li, line in enumerate(wrapped):
                    check_y()
                    c.drawString(LEFT_X, y, line)
                    y -= LINE_H
                c.setFont("Helvetica", font_size)
                continue

            if is_signature:
                check_y()
                c.setFont("Helvetica-Bold", 10)
                c.setFillColor(PURPLE)
                text_w = c.stringWidth(stripped, "Helvetica-Bold", 10)
                c.drawString(RIGHT_X - text_w, y, stripped)
                y -= LINE_H + 2
                c.setFont("Helvetica", font_size)
                c.setFillColor(BLACK)
                continue

            # Regular paragraph
            c.setFont("Helvetica", font_size)
            c.setFillColor(BLACK)
            wrapped = textwrap.wrap(stripped, width=CHARS_PER_LINE) or [stripped]
            for li, line in enumerate(wrapped):
                check_y()
                is_last = (li == len(wrapped) - 1)
                draw_line_with_formatting(c, line, LEFT_X, y, font_size, True, is_last)
                y -= LINE_H

    # Finish last overlay
    c.save()
    current_buf.seek(0)
    overlay_buffers.append(current_buf)

    # ══════════════════════════════════════════════
    # PAGE ASSEMBLY — 3-page template logic:
    # Template page 0 = Page 1 (header fields + INFORME + text)
    # Template page 1 = Page 2 (continuation text, no header fields)
    # Template page 2 = Page 3 (IMÁGENES, 3x3 grid)
    # ══════════════════════════════════════════════

    # ── Text pages ──
    for i, obuf in enumerate(overlay_buffers):
        if i == 0:
            pg = template.pages[0]  # Page 1 with header fields
        else:
            # Continuation pages use page 2 template (no header fields)
            template_copy = PdfReader(str(TEMPLATE_PATH))
            pg = template_copy.pages[1] if len(template_copy.pages) > 1 else template_copy.pages[0]
        pg.merge_page(PdfReader(obuf).pages[0])
        writer.add_page(pg)

    # ── Image pages (page 3 template, 3x3 grid, up to 18 images) ──
    if img_paths and len(template.pages) > 2:
        IMGS_PER_PAGE = 9
        IMG_W = 145
        IMG_H = 175
        GAP_X = 10
        GAP_Y = 10
        GRID_LEFT = 80
        GRID_TOP = 680  # below IMÁGENES bar

        # Calculate 3x3 positions
        def get_positions():
            positions = []
            for row in range(3):
                for col in range(3):
                    x = GRID_LEFT + col * (IMG_W + GAP_X)
                    y = GRID_TOP - (row + 1) * (IMG_H + GAP_Y) + GAP_Y
                    positions.append((x, y))
            return positions

        positions = get_positions()

        # Split images into pages of 9
        for page_start in range(0, len(img_paths), IMGS_PER_PAGE):
            page_images = img_paths[page_start:page_start + IMGS_PER_PAGE]

            img_buf = io.BytesIO()
            ci = canvas.Canvas(img_buf, pagesize=A4)

            for idx, p in enumerate(page_images):
                try:
                    x, y = positions[idx]
                    ci.drawImage(ImageReader(p), x, y, width=IMG_W, height=IMG_H, preserveAspectRatio=True)
                except Exception as e:
                    print(f"Img error {idx}: {e}")

            ci.save()
            img_buf.seek(0)

            # Use page 3 template for each image page
            template_copy = PdfReader(str(TEMPLATE_PATH))
            img_page = template_copy.pages[2]
            img_page.merge_page(PdfReader(img_buf).pages[0])
            writer.add_page(img_page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()

# ── App ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class StructureReq(BaseModel):
    transcription: str
    provider: str = "groq"
    api_key: str

@app.post("/api/whisper")
async def api_whisper(audio: UploadFile = File(...), provider: str = Form("groq"), api_key: str = Form("")):
    audio_bytes = await audio.read()
    text = await transcribe_audio(provider, api_key, audio_bytes, audio.filename or "audio.webm")
    return {"text": text}

@app.post("/api/structure")
async def api_structure(req: StructureReq):
    style = await load_style()
    result = await call_llm(req.provider, req.api_key, req.transcription, style)
    if result.get("estilo_detectado"):
        await save_patterns(result["estilo_detectado"])
    return result

@app.post("/api/generate-pdf")
async def api_pdf(tutor: str = Form(""), fecha: str = Form(""), mascota: str = Form(""),
                  medico_derivante: str = Form(""), cuerpo_informe: str = Form(""),
                  font_size: int = Form(10),
                  images: list[UploadFile] = File(default=[])):
    if not TEMPLATE_PATH.exists():
        raise HTTPException(500, "Plantilla no encontrada")
    img_paths = []
    for img in images:
        p = UPLOADS_DIR / f"temp_{img.filename}"
        p.write_bytes(await img.read())
        img_paths.append(str(p))

    pdf = generate_pdf({"tutor": tutor, "fecha": fecha, "mascota": mascota,
                        "medico_derivante": medico_derivante, "cuerpo_informe": cuerpo_informe}, img_paths, font_size)

    for p in img_paths:
        try: os.unlink(p)
        except: pass

    fn = f"Informe_{mascota or 'eco'}_{fecha.replace('/', '_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{fn}"'})

@app.post("/api/save-report")
async def save_report(tutor: str = Form(""), fecha: str = Form(""), mascota: str = Form(""),
                      medico_derivante: str = Form(""), cuerpo_informe: str = Form(""),
                      transcripcion_original: str = Form("")):
    """Save report to Supabase and update learned style."""
    result = {"saved": False, "id": None}

    if SUPABASE_URL:
        row = await supa_post("informes", {
            "fecha": fecha, "tutor": tutor, "mascota": mascota,
            "medico_derivante": medico_derivante, "cuerpo_informe": cuerpo_informe,
            "transcripcion_original": transcripcion_original,
        })
        if row and isinstance(row, list) and len(row) > 0:
            result = {"saved": True, "id": row[0].get("id")}
        elif row:
            result = {"saved": True, "id": None}

    return result

@app.get("/api/stats")
async def stats():
    if not SUPABASE_URL:
        return {"total_informes": 0, "patrones": 0}
    informes = await supa_get("informes", "select=id")
    estilo = await supa_get("estilo", "select=id")
    return {
        "total_informes": len(informes) if isinstance(informes, list) else 0,
        "patrones": len(estilo) if isinstance(estilo, list) else 0
    }

@app.get("/api/informes")
async def list_informes():
    return await supa_get("informes", "select=*&order=created_at.desc&limit=50")

@app.get("/api/estilo")
async def get_estilo():
    return await load_style()
