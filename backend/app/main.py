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
   - Volumen = largo × ancho × alto × 0.523 (SIEMPRE 3 medidas, nunca 4)
   - Índice de resistividad renal (IR) = (Vmáx - Vmín) / Vmáx
   - Relación córtico-medular: valor corteza / valor médula
   Mostrá la fórmula y el resultado en el texto.

4) COMANDOS — Respondé a órdenes directas:
   - "corregí eso" / "cambiá lo último" → corregís la última parte
   - "borrá eso" / "sacá eso" → eliminás lo último
   - "agregá a..." → agregás al órgano indicado

═══════════════════════════════
FORMATO DEL TEXTO
===============================
- Primer bloque: datos del paciente (Paciente, Especie, Sexo, Edad)
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

CONCLUSION (SIEMPRE al final):
- Titulo: CONCLUSION
- Cada hallazgo patologico en una linea separada precedido por *
- Al final agrupar organos normales: "* Organo1, organo2... sin particularidades ecograficas significativas."
- Despues de la conclusion: "Informe realizado por:\\nM.V. Raffo Silvina"

EJEMPLO DE ORGANO NORMAL:
"PERITONEO: Sin particularidades ecograficas evidentes."

EJEMPLO DE ORGANO CON HALLAZGO:
"HIGADO: Hepatomegalia moderada. Bordes lisos, parenquima homogeneo con disminucion de la ecogenicidad en forma difusa, patron portal reforzado y venas hepaticas conservadas. Hallazgos sugestivos de hepatopatia inflamatoria aguda."

EJEMPLO DE RINONES:
"RINONES: * Rinon izquierdo: 41 x 25 mm. * Rinon derecho: 45 x 24 mm. Ambos conservan caracteristicas ecograficas normales."

EJEMPLO DE CONCLUSION:
"CONCLUSION\\n* Hepatopatia inflamatoria aguda con hepatomegalia moderada.\\n* Escasa cantidad de barro biliar.\\n* Rinones, vejiga, glandulas adrenales, pancreas, estomago, intestinos, bazo, peritoneo y linfonodulos sin particularidades ecograficas significativas.\\n\\nInforme realizado por:\\nM.V. Raffo Silvina"

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
def generate_pdf(data, img_paths):
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
    tc = Color(0.2, 0.1, 0.3)
    bc = Color(0.1, 0.1, 0.1)

    fields = {"tutor": (175, 749), "fecha": (445, 749), "mascota": (155, 727), "medico_derivante": (325, 727)}
    c.setFont("Helvetica", 11)
    c.setFillColor(tc)
    for k, (x, y) in fields.items():
        v = data.get(k, "")
        if v:
            c.drawString(x, y, v)

    body = data.get("cuerpo_informe", "")
    if body:
        # Wider margins: x=90 to x=530 (440pt wide vs 380 before)
        LEFT_X = 90
        RIGHT_X = 530
        TEXT_W = RIGHT_X - LEFT_X
        CHARS_PER_LINE = 78  # wider text
        y = 665  # start lower to avoid overlapping INFORME bar

        for para in body.split("\n"):
            if para.strip() == "":
                y -= 6
                continue

            stripped = para.strip()
            # Title detection: ALL CAPS, ends with ":", or is a section header
            is_title = (stripped.isupper() and len(stripped) < 50) or \
                       (stripped.endswith(":") and len(stripped) < 45 and stripped.split(":")[0].isupper())

            if is_title:
                c.setFont("Helvetica-Bold", 11)
                c.setFillColor(Color(0.25, 0.05, 0.4))
                y -= 6  # extra space before title
            else:
                c.setFont("Helvetica", 10)
                c.setFillColor(bc)

            wrapped = textwrap.wrap(para, width=CHARS_PER_LINE) or [""]
            for idx, line in enumerate(wrapped):
                if y < 65:
                    break

                # Justify: add spaces between words to fill the line width
                if not is_title and idx < len(wrapped) - 1 and len(line) > 40:
                    words = line.split()
                    if len(words) > 1:
                        total_text_w = c.stringWidth(line.replace(" ", ""), c._fontname, c._fontsize)
                        total_space = TEXT_W - total_text_w
                        space_w = total_space / (len(words) - 1)
                        cx = LEFT_X
                        for wi, word in enumerate(words):
                            c.drawString(cx, y, word)
                            cx += c.stringWidth(word, c._fontname, c._fontsize) + space_w
                    else:
                        c.drawString(LEFT_X, y, line)
                else:
                    c.drawString(LEFT_X, y, line)

                y -= 13

            if is_title:
                y -= 3  # extra space after title

    c.save()
    buf1.seek(0)
    page1 = template.pages[0]
    page1.merge_page(PdfReader(buf1).pages[0])
    writer.add_page(page1)

    if img_paths and len(template.pages) > 1:
        buf2 = io.BytesIO()
        c2 = canvas.Canvas(buf2, pagesize=A4)
        positions = [(115, 502), (345, 502), (115, 332), (345, 332), (115, 162), (345, 162)]
        for i, p in enumerate(img_paths[:6]):
            try:
                x, y = positions[i]
                c2.drawImage(ImageReader(p), x, y, width=200, height=150, preserveAspectRatio=True)
            except Exception as e:
                print(f"Img error {i}: {e}")
        c2.save()
        buf2.seek(0)
        page2 = template.pages[1]
        page2.merge_page(PdfReader(buf2).pages[0])
        writer.add_page(page2)
    elif len(template.pages) > 1:
        writer.add_page(template.pages[1])

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
                  images: list[UploadFile] = File(default=[])):
    if not TEMPLATE_PATH.exists():
        raise HTTPException(500, "Plantilla no encontrada")
    img_paths = []
    for img in images:
        p = UPLOADS_DIR / f"temp_{img.filename}"
        p.write_bytes(await img.read())
        img_paths.append(str(p))

    pdf = generate_pdf({"tutor": tutor, "fecha": fecha, "mascota": mascota,
                        "medico_derivante": medico_derivante, "cuerpo_informe": cuerpo_informe}, img_paths)

    for p in img_paths:
        try: os.unlink(p)
        except: pass

    # Save to Supabase
    if SUPABASE_URL:
        await supa_post("informes", {
            "fecha": fecha, "tutor": tutor, "mascota": mascota,
            "medico_derivante": medico_derivante, "cuerpo_informe": cuerpo_informe,
            "imagenes_count": len(img_paths)
        })

    fn = f"Informe_{mascota or 'eco'}_{fecha.replace('/', '_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fn}"'})

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
