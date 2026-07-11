const API = '/api'

export async function whisperTranscribe(audioBlob: Blob, provider: string, apiKey: string): Promise<string> {
  const form = new FormData()
  form.append('audio', audioBlob, 'audio.webm')
  form.append('provider', provider)
  form.append('api_key', apiKey)
  const res = await fetch(`${API}/whisper`, { method: 'POST', body: form })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Error Whisper') }
  return (await res.json()).text
}

export async function structureReport(transcription: string, provider: string, apiKey: string) {
  const res = await fetch(`${API}/structure`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcription, provider, api_key: apiKey }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Error LLM') }
  return res.json()
}

export async function generatePDF(data: Record<string, string>, images: File[]) {
  const form = new FormData()
  Object.entries(data).forEach(([k, v]) => form.append(k, v))
  images.forEach(img => form.append('images', img))
  const res = await fetch(`${API}/generate-pdf`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Error al generar PDF')
  return res.blob()
}

export async function getStats() {
  const res = await fetch(`${API}/stats`)
  return res.json()
}
