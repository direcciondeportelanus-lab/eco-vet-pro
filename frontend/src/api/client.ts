const API_BASE = import.meta.env.VITE_API_URL || '/api'

export async function whisperTranscribe(audioBlob: Blob, provider: string, apiKey: string): Promise<string> {
  const form = new FormData()
  // Detect extension from mime type
  const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('wav') ? 'wav' : 'webm'
  form.append('audio', audioBlob, `audio.${ext}`)
  form.append('provider', provider)
  form.append('api_key', apiKey)
  const res = await fetch(`${API_BASE}/whisper`, { method: 'POST', body: form })
  if (!res.ok) { const e = await res.json().catch(()=>({detail:'Error de transcripción'})); throw new Error(e.detail || 'Error Whisper') }
  return (await res.json()).text
}

export async function structureReport(transcription: string, provider: string, apiKey: string) {
  const res = await fetch(`${API_BASE}/structure`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcription, provider, api_key: apiKey }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Error LLM') }
  return res.json()
}

export async function generatePDF(data: Record<string, string>, images: File[], fontSize: number = 10, marginLevel: number = 0, lineSpacing: number = 1) {
  const form = new FormData()
  Object.entries(data).forEach(([k, v]) => form.append(k, v))
  form.append('font_size', fontSize.toString())
  form.append('margin_level', marginLevel.toString())
  form.append('line_spacing', lineSpacing.toString())
  images.forEach(img => form.append('images', img))
  const res = await fetch(`${API_BASE}/generate-pdf`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Error al generar PDF')
  return res.blob()
}

export async function getStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`)
    return res.json()
  } catch { return { total_informes: 0, patrones: 0 } }
}

export async function saveReport(data: Record<string, string>) {
  const form = new FormData()
  Object.entries(data).forEach(([k, v]) => form.append(k, v))
  const res = await fetch(`${API_BASE}/save-report`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Error al guardar')
  return res.json()
}

export async function getReports() {
  try {
    const res = await fetch(`${API_BASE}/informes`)
    return res.json()
  } catch { return [] }
}

export async function getEstilo() {
  try {
    const res = await fetch(`${API_BASE}/estilo`)
    return res.json()
  } catch { return { frases_habituales: [], terminos_preferidos: {}, correcciones_frecuentes: [] } }
}
