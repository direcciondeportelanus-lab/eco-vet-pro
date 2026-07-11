import { useState, useRef, useEffect } from 'react'
import { whisperTranscribe, structureReport, generatePDF, getStats } from './api/client'

type View = 'dashboard' | 'nuevo' | 'informes' | 'config'
type Phase = 'idle' | 'recording' | 'transcribing' | 'structuring'
type Step = 'record' | 'edit' | 'done'
interface Report { tutor:string; fecha:string; mascota:string; medico_derivante:string; cuerpo_informe:string }

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [step, setStep] = useState<Step>('record')
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcription, setTranscription] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pdfUrl, setPdfUrl] = useState<string|null>(null)
  const [processing, setProcessing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [stats, setStats] = useState({total_informes:0, patrones:0})

  const [provider, setProvider] = useState(()=>localStorage.getItem('eco_prov')||'groq')
  const [apiKey, setApiKey] = useState(()=>localStorage.getItem('eco_key')||'')

  const [data, setData] = useState<Report>({
    tutor:'', fecha:new Date().toLocaleDateString('es-AR'),
    mascota:'', medico_derivante:'', cuerpo_informe:''
  })
  const [imgFiles, setImgFiles] = useState<File[]>([])
  const [imgPrevs, setImgPrevs] = useState<string[]>([])

  const mediaRec = useRef<MediaRecorder|null>(null)
  const chunks = useRef<Blob[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(()=>{ getStats().then(setStats).catch(()=>{}) },[view,step])

  // ── Recording ──
  const startRec = async () => {
    if(!apiKey){setShowConfig(true);return}
    setError('');setSuccess('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      const rec = new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'})
      chunks.current=[]
      rec.ondataavailable = e=>{if(e.data.size>0)chunks.current.push(e.data)}
      rec.onstop = async()=>{
        stream.getTracks().forEach(t=>t.stop())
        const blob = new Blob(chunks.current,{type:'audio/webm'})
        setPhase('transcribing')
        try {
          const text = await whisperTranscribe(blob,provider,apiKey)
          setTranscription(p=>p?p+' '+text:text)
          setPhase('structuring')
          const full = transcription?transcription+' '+text:text
          const r = await structureReport(full,provider,apiKey)
          setData({tutor:r.tutor||data.tutor||'',fecha:r.fecha||data.fecha,mascota:r.mascota||data.mascota||'',
            medico_derivante:r.medico_derivante||data.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''})
          const np=r.estilo_detectado?.frases_nuevas?.length||0
          setSuccess(np>0?`Informe listo. ${np} patrón(es) aprendido(s).`:'Informe estructurado.')
          setStep('edit')
        } catch(e:any){setError(e.message)}
        setPhase('idle')
      }
      rec.start();mediaRec.current=rec;setPhase('recording')
    } catch(e:any){setError('Micrófono: '+e.message)}
  }

  const handleMic = ()=>{
    if(phase==='recording')mediaRec.current?.stop()
    else if(phase==='idle')startRec()
  }

  const manualProcess = async()=>{
    if(!apiKey){setShowConfig(true);return}
    if(!transcription.trim()){setError('No hay texto.');return}
    setPhase('structuring');setError('')
    try{
      const r=await structureReport(transcription,provider,apiKey)
      setData({tutor:r.tutor||'',fecha:r.fecha||data.fecha,mascota:r.mascota||'',
        medico_derivante:r.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''})
      setSuccess('Informe estructurado.');setStep('edit')
    }catch(e:any){setError(e.message)}
    setPhase('idle')
  }

  const addImgs=(e:React.ChangeEvent<HTMLInputElement>)=>{
    Array.from(e.target.files||[]).forEach(f=>{
      setImgFiles(p=>[...p,f])
      const r=new FileReader();r.onload=ev=>setImgPrevs(p=>[...p,ev.target?.result as string]);r.readAsDataURL(f)
    });e.target.value=''
  }
  const delImg=(i:number)=>{setImgFiles(p=>p.filter((_,j)=>j!==i));setImgPrevs(p=>p.filter((_,j)=>j!==i))}

  const makePDF=async()=>{
    setProcessing(true);setError('')
    try{const b=await generatePDF(data,imgFiles);setPdfUrl(URL.createObjectURL(b));setStep('done')}
    catch(e:any){setError(e.message)}
    setProcessing(false)
  }

  const sharePDF=async()=>{
    if(!pdfUrl)return
    const b=await(await fetch(pdfUrl)).blob()
    const f=new File([b],`Informe_${data.mascota||'eco'}_${data.fecha.replace(/\//g,'-')}.pdf`,{type:'application/pdf'})
    if(navigator.share?.({files:[f]}))await navigator.share({files:[f]})
    else{const a=document.createElement('a');a.href=pdfUrl;a.download=f.name;a.click()}
  }

  const reset=()=>{
    setStep('record');setTranscription('');setImgFiles([]);setImgPrevs([])
    setPdfUrl(null);setError('');setSuccess('');setPhase('idle')
    setData({tutor:'',fecha:new Date().toLocaleDateString('es-AR'),mascota:'',medico_derivante:'',cuerpo_informe:''})
  }

  const startNew=()=>{reset();setView('nuevo')}
  const u=(k:keyof Report,v:string)=>setData(p=>({...p,[k]:v}))
  const prov=provider==='groq'?'Groq':'GPT'

  return (
    <div className="layout">
      {/* ══ Sidebar ══ */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">🩺</div>
          <div><div className="sidebar-title">Eco Vet Pro</div><div className="sidebar-subtitle">Informes Ecográficos</div></div>
        </div>

        <div className="sidebar-section">Informes</div>
        <ul className="sidebar-nav">
          <li className={`sidebar-item ${view==='dashboard'?'active':''}`} onClick={()=>setView('dashboard')}>
            <span className="sidebar-item-icon">📊</span> Dashboard
          </li>
          <li className={`sidebar-item ${view==='nuevo'?'active':''}`} onClick={startNew}>
            <span className="sidebar-item-icon">➕</span> Nuevo Informe
          </li>
          <li className={`sidebar-item`}>
            <span className="sidebar-item-icon">📋</span> Mis Informes
            {stats.total_informes>0&&<span className="sidebar-badge">{stats.total_informes}</span>}
          </li>
          <li className="sidebar-item"><span className="sidebar-item-icon">📄</span> Plantillas</li>
          <li className="sidebar-item"><span className="sidebar-item-icon">🖼️</span> Biblioteca de Imágenes</li>
        </ul>

        <div className="sidebar-section">IA & Aprendizaje</div>
        <ul className="sidebar-nav">
          <li className="sidebar-item"><span className="sidebar-item-icon">🏷️</span> Etiquetado de Ecos</li>
          <li className="sidebar-item"><span className="sidebar-item-icon">🧠</span> Modelos IA
            {stats.patrones>0&&<span className="sidebar-badge">{stats.patrones}</span>}
          </li>
          <li className="sidebar-item"><span className="sidebar-item-icon">📈</span> Aprendizaje Activo</li>
        </ul>

        <div className="sidebar-section">Configuración</div>
        <ul className="sidebar-nav">
          <li className={`sidebar-item`} onClick={()=>setShowConfig(true)}>
            <span className="sidebar-item-icon">⚙️</span> Configuración
          </li>
        </ul>
      </aside>

      {/* ══ Main ══ */}
      <div className="main">
        <div className="topbar">
          <div className="topbar-search">
            <span className="topbar-search-icon">🔍</span>
            <input placeholder="Buscar informes, pacientes..." />
          </div>
          <div className="topbar-actions">
            <button className="topbar-btn" onClick={startNew}>➕ Nuevo Informe</button>
            <div className="topbar-user">
              <div className="topbar-avatar">👩‍⚕️</div>
              <div><div className="topbar-username">Dra. Raffo</div><div className="topbar-role">Veterinaria</div></div>
            </div>
          </div>
        </div>

        {/* ══ DASHBOARD ══ */}
        {view==='dashboard' && (
          <div className="page">
            <div className="page-title">Hola, Dra. Raffo 👋</div>
            <div className="page-sub">Resumen de tu actividad</div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-icon purple">📋</div>
                <div><div className="stat-value">{stats.total_informes}</div><div className="stat-label">Informes</div></div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green">🧠</div>
                <div><div className="stat-value">{stats.patrones}</div><div className="stat-label">Patrones IA</div></div>
              </div>
              <div className="stat-card">
                <div className="stat-icon purple">🖼️</div>
                <div><div className="stat-value">{imgPrevs.length}</div><div className="stat-label">Imágenes</div></div>
              </div>
              <div className="stat-card">
                <div className="stat-icon yellow">⚡</div>
                <div><div className="stat-value">{prov}</div><div className="stat-label">Proveedor IA</div></div>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div className="card">
                <div className="card-head"><span className="card-head-title">⚡ Acciones rápidas</span></div>
                <div className="card-body">
                  <div className="actions-grid">
                    <div className="action-card" onClick={startNew}>
                      <div className="action-icon">🎙️</div>
                      <div className="action-title">Nuevo Informe</div>
                      <div className="action-desc">Dictar con IA</div>
                    </div>
                    <div className="action-card" onClick={()=>fileRef.current?.click()}>
                      <div className="action-icon">📷</div>
                      <div className="action-title">Subir Imágenes</div>
                      <div className="action-desc">Ecografías</div>
                    </div>
                    <div className="action-card">
                      <div className="action-icon">🏷️</div>
                      <div className="action-title">Etiquetar con IA</div>
                      <div className="action-desc">Entrenamiento</div>
                    </div>
                    <div className="action-card">
                      <div className="action-icon">📄</div>
                      <div className="action-title">Generar PDF</div>
                      <div className="action-desc">Exportar informe</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-head"><span className="card-head-title">📊 Estado del sistema</span></div>
                <div className="card-body" style={{color:'var(--text-secondary)',fontSize:14,lineHeight:2}}>
                  Proveedor activo: <strong style={{color:'var(--accent)'}}>{prov}</strong><br/>
                  API Key: <strong style={{color:apiKey?'var(--success)':'var(--danger)'}}>{apiKey?'✅ Configurada':'❌ No configurada'}</strong><br/>
                  Plantilla: <strong style={{color:'var(--success)'}}>✅ Cargada</strong><br/>
                  Base de datos: <strong style={{color:'var(--success)'}}>✅ {stats.total_informes} registros</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ NUEVO INFORME ══ */}
        {view==='nuevo' && (
          <div className="page">
            <div className="page-title">Nuevo Informe</div>
            <div className="page-sub">Dictá, editá y generá el PDF</div>

            <div className="steps-bar">
              <div className={`step-tab ${step==='record'?'active':step!=='record'?'done':''}`}>🎙️ Dictar</div>
              <div className={`step-tab ${step==='edit'?'active':step==='done'?'done':''}`}>✏️ Editar</div>
              <div className={`step-tab ${step==='done'?'active':''}`}>📄 PDF</div>
            </div>

            {error&&<div className="alert alert-error">⚠️ {error}</div>}
            {success&&<div className="alert alert-success">✅ {success}</div>}

            {/* STEP 1 */}
            {step==='record'&&(
              <>
                <div className="card"><div className="card-body">
                  <div className="mic-area">
                    <div className={`mic-ring ${phase}`} onClick={handleMic}>
                      <button className={`mic-btn-inner ${phase}`}>
                        {phase==='recording'?'⏹':phase==='idle'?'🎙️':'⏳'}
                      </button>
                    </div>
                    <span className={`mic-label ${phase}`}>
                      {phase==='idle'&&'Tocá para dictar'}
                      {phase==='recording'&&'● Grabando — tocá para detener'}
                      {phase==='transcribing'&&`Whisper (${prov}) transcribiendo...`}
                      {phase==='structuring'&&`${prov} estructurando informe...`}
                    </span>
                    <span className="mic-hint">{phase==='idle'&&`Transcripción y estructura con ${prov}`}</span>
                  </div>
                </div></div>

                {transcription&&(
                  <div className="card">
                    <div className="card-head"><span className="card-head-title"><span className="card-head-icon">📝</span> Transcripción</span></div>
                    <div className="card-body">
                      <textarea className="form-input" value={transcription} onChange={e=>setTranscription(e.target.value)} rows={5} />
                      <button className="btn btn-primary" style={{marginTop:12}} onClick={manualProcess} disabled={phase!=='idle'}>
                        ✨ Re-estructurar con {prov}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* STEP 2 */}
            {step==='edit'&&(
              <>
                <div className="card">
                  <div className="card-head"><span className="card-head-title"><span className="card-head-icon">🐾</span> Datos del paciente</span></div>
                  <div className="card-body">
                    <div className="field"><label className="field-label">Tutor</label><input className="form-input" value={data.tutor} onChange={e=>u('tutor',e.target.value)} placeholder="Nombre del tutor"/></div>
                    <div className="field-row">
                      <div className="field"><label className="field-label">Fecha</label><input className="form-input" value={data.fecha} onChange={e=>u('fecha',e.target.value)}/></div>
                      <div className="field"><label className="field-label">Méd. derivante</label><input className="form-input" value={data.medico_derivante} onChange={e=>u('medico_derivante',e.target.value)}/></div>
                    </div>
                    <div className="field" style={{marginTop:14}}><label className="field-label">Mascota</label><input className="form-input" value={data.mascota} onChange={e=>u('mascota',e.target.value)} placeholder="Nombre (especie, raza, edad)"/></div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-head"><span className="card-head-title"><span className="card-head-icon">📋</span> Informe ecográfico</span></div>
                  <div className="card-body">
                    <textarea className="form-input" style={{minHeight:300}} value={data.cuerpo_informe} onChange={e=>u('cuerpo_informe',e.target.value)}/>
                  </div>
                </div>

                <div className="card">
                  <div className="card-head"><span className="card-head-title"><span className="card-head-icon">🖼️</span> Ecografías</span></div>
                  <div className="card-body">
                    <input ref={fileRef} type="file" accept="image/*" multiple onChange={addImgs} style={{display:'none'}}/>
                    <button className="btn btn-secondary" style={{marginTop:0}} onClick={()=>fileRef.current?.click()}>📷 Seleccionar imágenes</button>
                    {imgPrevs.length>0&&(
                      <div className="img-grid">
                        {imgPrevs.map((s,i)=>(
                          <div key={i} className="img-item"><img src={s} className="img-thumb"/><button className="img-del" onClick={()=>delImg(i)}>✕</button></div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button className="btn btn-primary" onClick={makePDF} disabled={processing}>{processing?'⏳ Generando...':'📄 Generar PDF'}</button>
                <button className="btn btn-ghost" onClick={()=>setStep('record')}>← Volver a dictar</button>
              </>
            )}

            {/* STEP 3 */}
            {step==='done'&&pdfUrl&&(
              <>
                <div className="card"><div className="card-body result-card">
                  <div className="result-check">✅</div>
                  <div className="result-title">PDF generado</div>
                  <div className="result-sub">{data.mascota||'Informe'} — {data.fecha}</div>
                </div></div>
                <div className="card" style={{padding:0,overflow:'hidden'}}><iframe src={pdfUrl} className="pdf-frame" title="PDF"/></div>
                <button className="btn btn-primary" onClick={sharePDF}>📤 Compartir / Descargar</button>
                <button className="btn btn-secondary" onClick={()=>setStep('edit')}>✏️ Seguir editando</button>
                <button className="btn btn-ghost" onClick={startNew}>➕ Nuevo informe</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ══ Config Modal ══ */}
      {showConfig&&(
        <div className="modal-bg" onClick={()=>setShowConfig(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h2>⚙️ Configuración</h2>
            <div className="field"><label className="field-label">Proveedor de IA</label>
              <select className="form-input" value={provider} onChange={e=>setProvider(e.target.value)}>
                <option value="groq">Groq — Whisper + Llama 3.3 (gratis)</option>
                <option value="openai">OpenAI — Whisper + GPT-4o-mini</option>
              </select>
            </div>
            <div className="field"><label className="field-label">API Key</label>
              <input className="form-input" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={provider==='groq'?'gsk_...':'sk-...'}/>
              <p className="modal-info">{provider==='groq'?'🆓 Gratis → console.groq.com':'💳 ~$0.01/informe → platform.openai.com'}</p>
            </div>
            <hr className="modal-sep"/>
            <div style={{fontSize:13,color:'var(--text-secondary)',lineHeight:2}}>
              Informes guardados: <strong>{stats.total_informes}</strong><br/>
              Patrones aprendidos: <strong>{stats.patrones}</strong>
            </div>
            <button className="btn btn-primary" style={{marginTop:20}}
              onClick={()=>{localStorage.setItem('eco_key',apiKey);localStorage.setItem('eco_prov',provider);setShowConfig(false)}}>
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
