# Eco Vet Pro — Dra. Silvina Raffo

## Desarrollo local

### 1. Setup (una vez)
```
cd eco-app
setup.bat
```

### 2. Supabase (una vez)
- Crear cuenta en supabase.com
- Crear proyecto → copiar URL y anon key
- SQL Editor → pegar el contenido de `supabase_schema.sql` → Run

### 3. Arrancar
```
start.bat
```
Te pide URL y Key de Supabase. Abre http://localhost:3001

## Deploy a producción

### Frontend → Vercel
```
cd frontend
git init && git add . && git commit -m "v1"
# Subir a GitHub → importar en vercel.com
# Agregar env var: VITE_API_URL = https://tu-backend.railway.app/api
```

### Backend → Railway
```
cd backend
git init && git add . && git commit -m "v1"
# Subir a GitHub → importar en railway.app
# Agregar env vars:
#   SUPABASE_URL = https://xxx.supabase.co
#   SUPABASE_KEY = eyJ...
```

### Mobile (PWA)
Safari → abrir URL de Vercel → Compartir → "Agregar a inicio"

## Estructura
```
eco-app/
├── backend/             ← FastAPI + Supabase
│   ├── app/main.py
│   ├── requirements.txt
│   ├── plantilla.pdf
│   ├── Procfile          ← Railway
│   └── .env.example
├── frontend/            ← React + Vite
│   ├── src/App.tsx
│   ├── public/          ← hero-ai.png, hero-pets.png
│   └── vercel.json
├── supabase_schema.sql  ← SQL para crear tablas
├── setup.bat
└── start.bat
```
