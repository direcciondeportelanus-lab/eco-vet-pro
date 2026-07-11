-- ═══════════════════════════════════════════
-- ECO VET PRO — Schema Supabase
-- Correr esto en el SQL Editor de Supabase
-- ═══════════════════════════════════════════

-- Informes ecográficos
CREATE TABLE informes (
  id BIGSERIAL PRIMARY KEY,
  fecha TEXT,
  tutor TEXT,
  mascota TEXT,
  medico_derivante TEXT,
  cuerpo_informe TEXT,
  transcripcion_original TEXT,
  imagenes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Estilo aprendido (frases, términos, correcciones)
CREATE TABLE estilo (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,        -- 'frase', 'termino', 'correccion'
  clave TEXT,                -- para términos: la palabra original
  valor TEXT NOT NULL,       -- el patrón aprendido
  frecuencia INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tipo, clave, valor)
);

-- Imágenes de ecografía (para ML fase 2)
CREATE TABLE imagenes (
  id BIGSERIAL PRIMARY KEY,
  informe_id BIGINT REFERENCES informes(id),
  filename TEXT,
  organo TEXT,               -- etiqueta: higado, riñon, bazo, etc.
  hallazgo TEXT,             -- etiqueta: normal, masa, liquido, etc.
  storage_path TEXT,         -- ruta en Supabase Storage
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_informes_fecha ON informes(created_at DESC);
CREATE INDEX idx_imagenes_organo ON imagenes(organo);
CREATE INDEX idx_estilo_tipo ON estilo(tipo);

-- Habilitar Row Level Security (por ahora abierto)
ALTER TABLE informes ENABLE ROW LEVEL SECURITY;
ALTER TABLE estilo ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON informes FOR ALL USING (true);
CREATE POLICY "Allow all" ON estilo FOR ALL USING (true);
CREATE POLICY "Allow all" ON imagenes FOR ALL USING (true);
