const API_BASE = import.meta.env.VITE_API_URL || '/api'

export async function whisperTranscribe(audioBlob: Blob, provider: string, apiKey: string): Promise<string> {
  const form = new FormData()
  form.append('audio', audioBlob, 'audio.webm')
  form.append('provider', provider)
  form.append('api_key', apiKey)
  const res = await fetch(`${API_BASE}/whisper`, { method: 'POST', body: form })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Error Whisper') }
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

export async function generatePDF(data: Record<string, string>, images: File[], fontSize: number = 10) {
  const form = new FormData()
  Object.entries(data).forEach(([k, v]) => form.append(k, v))
  form.append('font_size', fontSize.toString())
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
