// Selector de Google Drive (Google Picker). Funciona en PC y celular.
// Requiere 3 variables de entorno (ver instrucciones): VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, VITE_GOOGLE_APP_ID
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined

export const driveEnabled = !!(CLIENT_ID && API_KEY && APP_ID)

const w = window as any

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('No se pudo cargar ' + src))
    document.head.appendChild(s)
  })
}

export async function pickFromDrive(): Promise<File[]> {
  if (!driveEnabled) throw new Error('Drive no está configurado')
  await Promise.all([
    loadScript('https://apis.google.com/js/api.js'),
    loadScript('https://accounts.google.com/gsi/client'),
  ])
  await new Promise<void>(r => w.gapi.load('picker', () => r()))

  const token = await new Promise<string>((resolve, reject) => {
    const tc = w.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r: any) => r.error ? reject(new Error(r.error)) : resolve(r.access_token),
      error_callback: (e: any) => reject(new Error(e?.type || 'No se pudo autorizar')),
    })
    tc.requestAccessToken({ prompt: '' })
  })

  const docs = await new Promise<any[]>(resolve => {
    const g = w.google.picker
    const view = new g.DocsView(g.ViewId.DOCS_IMAGES).setIncludeFolders(true).setSelectFolderEnabled(false)
    const picker = new g.PickerBuilder()
      .addView(view)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.Feature.SUPPORT_DRIVES)
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setCallback((d: any) => {
        if (d.action === 'picked') resolve(d.docs || [])
        else if (d.action === 'cancel') resolve([])
      })
      .build()
    picker.setVisible(true)
  })

  const files: File[] = []
  for (const d of docs) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${d.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`No se pudo bajar "${d.name}"`)
    const blob = await res.blob()
    files.push(new File([blob], d.name, { type: d.mimeType || blob.type }))
  }
  return files
}
