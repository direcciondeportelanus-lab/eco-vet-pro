# Eco Informes — Dra. Silvina Raffo

App profesional para generar informes ecográficos veterinarios.

## Arquitectura

```
eco-app/
├── backend/           ← FastAPI (Python)
│   ├── app/main.py    ← API, PDF, DB, LLM
│   └── requirements.txt
├── frontend/          ← React + Vite
│   └── src/
│       ├── App.tsx    ← UI principal
│       ├── api/       ← Llamadas al backend
│       └── styles/    ← CSS profesional
├── data/              ← Se crea solo (DB + estilos aprendidos)
├── plantilla.pdf      ← Plantilla de la Dra. Raffo
└── start.bat          ← Doble click para arrancar
```

## Cómo ejecutar

### Windows (doble click)
1. Ejecutá `setup.bat` la primera vez (instala dependencias)
2. Ejecutá `start.bat` cada vez que quieras usarla
3. Se abre sola en el navegador

### Manual
```bash
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Abrí http://localhost:3000

## Proveedores de IA

- **Groq**: gratis, rápido. Sacá la key en console.groq.com/keys
- **OpenAI**: ~$0.01/informe. Key en platform.openai.com/api-keys

## Para ML (fase 2)

Cada informe se guarda en `data/informes.db` (SQLite) con:
- Transcripción original
- Texto estructurado
- Datos del paciente
- Timestamp

Las imágenes de eco se guardan en `data/uploads/`.
El estilo aprendido se guarda en `data/estilo_aprendido.json`.

Con estos datos se puede entrenar un modelo de clasificación de imágenes.
