"""
Eco Informes — Backend FastAPI
"""
import os, io, json, sqlite3, textwrap, tempfile
from datetime import datetime
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "data" / "informes.db"
TEMPLATE_PATH = BASE_DIR / "plantilla.pdf"
UPLOADS_DIR = BASE_DIR / "data" / "uploads"
STYLE_PATH = BASE_DIR / "data" / "estilo_aprendido.json"

# ── DB ──
def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""CREATE TABLE IF NOT EXISTS informes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, tutor TEXT,
        mascota TEXT, medico_derivante TEXT, cuerpo_informe TEXT,
        transcripcion_original TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    conn.commit(); conn.close()

def get_db():
    conn = sqlite3.connect(str(DB_PATH)); conn.row_factory = sqlite3.Row; return conn

# ── Style learning ──
def load_style():
    if STYLE_PATH.exists(): return json.loads(STYLE_PATH.read_text(encoding="utf-8"))
    return {"frases_habituales": [], "terminos_preferidos": {}, "correcciones_frecuentes": []}

def save_style(s):
    STYLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STYLE_PATH.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")

def merge_style(cur, new):
    if not new: return cur
    cur["frases_habituales"] = list(set(cur.get("frases_habituales",[]) + (new.get("frases_nuevas") or [])))
    cur["terminos_preferidos"] = {**cur.get("terminos_preferidos",{}), **(new.get("terminos_preferidos") or {})}
    cur["correcciones_frecuentes"] = list(set(cur.get("correcciones_frecuentes",[]) + (new.get("correcciones_frecuentes") or [])))
    return cur

# ── Prompt ──
SYSTEM_PROMPT = """Sos el asistente oficial de redacción de informes ecográficos de la Dra. Silvina Raffo (M.P. 11901), veterinaria.

REGLAS ABSOLUTAS:
- Nunca inventás datos, hallazgos, medidas ni diagnósticos que no estén en el dictado.
- Si falta un dato, dejá el campo vacío.
- Nunca cambiás el significado clínico. Mejorás redacción y ortografía, jamás contenido médico.
- Si el dictado es ambiguo, marcá "(a confirmar)".

INTERPRETACIÓN DEL DICTADO:
1) DATOS DEL PACIENTE — "paciente","tutor","dueño","mascota","derivado por","lo manda"
   → tutor / fecha / mascota / medico_derivante. "hoy" = fecha actual.
2) CUERPO — "hallazgos","se observa","a nivel de","conclusión","impresión diagnóstica"
   → Orden: Indicación clínica → Hallazgos por órgano → Conclusión.
   → Agrupá por órgano aunque los dicte salteados.

TONO: profesional, tercera persona, objetivo. Corregís errores de dictado sin alterar contenido médico.

RESPONDÉ SOLO JSON válido (sin markdown, sin backticks):
{"tutor":"","fecha":"","mascota":"","medico_derivante":"","cuerpo_informe":"","estilo_detectado":{"frases_nuevas":[],"terminos_preferidos":{},"correcciones_frecuentes":[]}}"""

PROVIDERS = {
    "groq": {"url": "https://api.groq.com/openai/v1/chat/completions", "model": "llama-3.3-70b-versatile",
             "whisper_url": "https://api.groq.com/openai/v1/audio/transcriptions", "whisper_model": "whisper-large-v3"},
    "openai": {"url": "https://api.openai.com/v1/chat/completions", "model": "gpt-4o-mini",
               "whisper_url": "https://api.openai.com/v1/audio/transcriptions", "whisper_model": "whisper-1"},
}

# ── Whisper transcription ──
async def transcribe_audio(provider: str, api_key: str, audio_bytes: bytes, filename: str) -> str:
    cfg = PROVIDERS.get(provider)
    if not cfg: raise HTTPException(400, "Proveedor no soportado")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            cfg["whisper_url"],
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (filename, audio_bytes, "audio/webm")},
            data={"model": cfg["whisper_model"], "language": "es"},
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Error Whisper: {resp.text}")
    return resp.json().get("text", "")

# ── LLM structuring ──
async def call_llm(provider: str, api_key: str, text: str, style: dict) -> dict:
    cfg = PROVIDERS.get(provider)
    if not cfg: raise HTTPException(400, "Proveedor no soportado")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if style and any(style.values()):
        messages.append({"role": "system", "content": f"ESTILO APRENDIDO:\n{json.dumps(style, ensure_ascii=False)}"})
    messages.append({"role": "user", "content": text})

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(cfg["url"],
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": cfg["model"], "messages": messages, "temperature": 0.2, "max_tokens": 3000})

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Error LLM: {resp.json().get('error',{}).get('message', resp.text)}")

    content = resp.json()["choices"][0]["message"]["content"]
    try: return json.loads(content.replace("```json","").replace("```","").strip())
    except: return {"tutor":"","fecha":"","mascota":"","medico_derivante":"","cuerpo_informe":content,
                     "estilo_detectado":{"frases_nuevas":[],"terminos_preferidos":{},"correcciones_frecuentes":[]}}

# ── PDF ──
def generate_pdf(data: dict, img_paths: list[str]) -> bytes:
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    PAGE_W, PAGE_H = A4
    template = PdfReader(str(TEMPLATE_PATH))
    writer = PdfWriter()

    buf1 = io.BytesIO()
    c = canvas.Canvas(buf1, pagesize=A4)
    tc = Color(0.2, 0.1, 0.3); bc = Color(0.1, 0.1, 0.1)

    fields = {"tutor":(175,749),"fecha":(445,749),"mascota":(155,727),"medico_derivante":(325,727)}
    c.setFont("Helvetica", 11); c.setFillColor(tc)
    for k,(x,y) in fields.items():
        v = data.get(k,"")
        if v: c.drawString(x, y, v)

    body = data.get("cuerpo_informe","")
    if body:
        c.setFont("Helvetica", 10); c.setFillColor(bc)
        y = 678
        for para in body.split("\n"):
            if para.strip() == "": y -= 10; continue
            for line in (textwrap.wrap(para, width=62) or [""]):
                if y < 65: break
                c.drawString(115, y, line); y -= 14

    c.save(); buf1.seek(0)
    page1 = template.pages[0]
    page1.merge_page(PdfReader(buf1).pages[0])
    writer.add_page(page1)

    if img_paths and len(template.pages) > 1:
        buf2 = io.BytesIO()
        c2 = canvas.Canvas(buf2, pagesize=A4)
        positions = [(115,502),(345,502),(115,332),(345,332),(115,162),(345,162)]
        for i, p in enumerate(img_paths[:6]):
            try:
                x, y = positions[i]
                c2.drawImage(ImageReader(p), x, y, width=200, height=150, preserveAspectRatio=True)
            except Exception as e: print(f"Img error {i}: {e}")
        c2.save(); buf2.seek(0)
        page2 = template.pages[1]
        page2.merge_page(PdfReader(buf2).pages[0])
        writer.add_page(page2)
    elif len(template.pages) > 1:
        writer.add_page(template.pages[1])

    out = io.BytesIO(); writer.write(out); return out.getvalue()

# ── FastAPI app ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(); yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class StructureReq(BaseModel):
    transcription: str; provider: str = "groq"; api_key: str

# Whisper: recibe audio, devuelve texto
@app.post("/api/whisper")
async def api_whisper(audio: UploadFile = File(...), provider: str = Form("groq"), api_key: str = Form("")):
    audio_bytes = await audio.read()
    text = await transcribe_audio(provider, api_key, audio_bytes, audio.filename or "audio.webm")
    return {"text": text}

# Structure: recibe texto, devuelve informe estructurado
@app.post("/api/structure")
async def api_structure(req: StructureReq):
    style = load_style()
    result = await call_llm(req.provider, req.api_key, req.transcription, style)
    if result.get("estilo_detectado"):
        save_style(merge_style(style, result["estilo_detectado"]))
    return result

# PDF: recibe data + imagenes, devuelve PDF
@app.post("/api/generate-pdf")
async def api_pdf(tutor:str=Form(""), fecha:str=Form(""), mascota:str=Form(""),
                  medico_derivante:str=Form(""), cuerpo_informe:str=Form(""),
                  images: list[UploadFile]=File(default=[])):
    if not TEMPLATE_PATH.exists(): raise HTTPException(500, "Plantilla no encontrada")
    img_paths = []
    for img in images:
        p = UPLOADS_DIR / f"temp_{img.filename}"; p.write_bytes(await img.read()); img_paths.append(str(p))

    pdf = generate_pdf({"tutor":tutor,"fecha":fecha,"mascota":mascota,
                        "medico_derivante":medico_derivante,"cuerpo_informe":cuerpo_informe}, img_paths)

    for p in img_paths:
        try: os.unlink(p)
        except: pass

    fn = f"Informe_{mascota or 'eco'}_{fecha.replace('/','_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fn}"'})

@app.post("/api/informes")
async def save_informe(tutor:str="",fecha:str="",mascota:str="",medico_derivante:str="",
                       cuerpo_informe:str="",transcripcion_original:str=""):
    conn = get_db()
    conn.execute("INSERT INTO informes (fecha,tutor,mascota,medico_derivante,cuerpo_informe,transcripcion_original) VALUES (?,?,?,?,?,?)",
                 (fecha,tutor,mascota,medico_derivante,cuerpo_informe,transcripcion_original))
    conn.commit(); rid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]; conn.close()
    return {"id": rid}

@app.get("/api/stats")
async def stats():
    conn = get_db(); t = conn.execute("SELECT COUNT(*) FROM informes").fetchone()[0]; conn.close()
    s = load_style()
    return {"total_informes":t,"patrones":len(s.get("frases_habituales",[]))+len(s.get("terminos_preferidos",{}))}

# Serve frontend
frontend_dir = BASE_DIR / "frontend" / "dist"
if frontend_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dir/"assets")), name="assets")
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="spa")
