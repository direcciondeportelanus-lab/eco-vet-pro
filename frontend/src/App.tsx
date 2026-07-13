import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader, Plus, Search, Settings, LayoutDashboard, FileText, FolderOpen, Image, Brain, Tag, TrendingUp, Camera, Sparkles, HeartPulse, Scan, ArrowLeft, Pencil, Send, Menu, X, Save, Download } from 'lucide-react'
import { whisperTranscribe, structureReport, generatePDF, getStats, saveReport } from './api/client'

type View='dashboard'|'nuevo'; type Phase='idle'|'recording'|'transcribing'|'structuring'; type Step='record'|'edit'|'done'
interface Report{tutor:string;fecha:string;mascota:string;medico_derivante:string;cuerpo_informe:string}

export default function App(){
  const [view,setView]=useState<View>('dashboard')
  const [step,setStep]=useState<Step>('record')
  const [phase,setPhase]=useState<Phase>('idle')
  const [transcription,setTranscription]=useState('')
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [pdfUrl,setPdfUrl]=useState<string|null>(null)
  const [processing,setProcessing]=useState(false)
  const [showConfig,setShowConfig]=useState(false)
  const [sidebarOpen,setSidebarOpen]=useState(window.innerWidth>768)
  const [stats,setStats]=useState({total_informes:0,patrones:0})
  const [provider,setProvider]=useState(()=>localStorage.getItem('eco_prov')||'groq')
  const [apiKey,setApiKey]=useState(()=>localStorage.getItem('eco_key')||'')
  const [data,setData]=useState<Report>({tutor:'',fecha:new Date().toLocaleDateString('es-AR'),mascota:'',medico_derivante:'',cuerpo_informe:''})
  const [imgFiles,setImgFiles]=useState<File[]>([])
  const [imgPrevs,setImgPrevs]=useState<string[]>([])
  const [fontSize,setFontSize]=useState(10)
  const [drafts,setDrafts]=useState<any[]>([])  const mediaRec=useRef<MediaRecorder|null>(null)
  const chunks=useRef<Blob[]>([])
  const fileRef=useRef<HTMLInputElement>(null)

  useEffect(()=>{getStats().then(setStats).catch(()=>{})},[view,step])
  useEffect(()=>{
    try{const d=JSON.parse(localStorage.getItem('eco_drafts')||'[]');setDrafts(d)}catch{}
  },[])

  const saveDraft=()=>{
    const draft={id:Date.now(),fecha:data.fecha,tutor:data.tutor,mascota:data.mascota,
      medico_derivante:data.medico_derivante,cuerpo_informe:data.cuerpo_informe,
      transcription,fontSize,savedAt:new Date().toLocaleString('es-AR')}
    const updated=[draft,...drafts.filter((d:any)=>d.id!==draft.id)].slice(0,20)
    setDrafts(updated);localStorage.setItem('eco_drafts',JSON.stringify(updated))
    setSuccess('Borrador guardado')
  }

  const loadDraft=(draft:any)=>{
    setData({tutor:draft.tutor||'',fecha:draft.fecha||'',mascota:draft.mascota||'',
      medico_derivante:draft.medico_derivante||'',cuerpo_informe:draft.cuerpo_informe||''})
    setTranscription(draft.transcription||'')
    if(draft.fontSize)setFontSize(draft.fontSize)
    setStep('edit');setView('nuevo');setSidebarOpen(false)
    setSuccess('Borrador cargado')
  }

  const deleteDraft=(id:number)=>{
    const updated=drafts.filter((d:any)=>d.id!==id)
    setDrafts(updated);localStorage.setItem('eco_drafts',JSON.stringify(updated))
  }

  const startRec=async()=>{
    if(!apiKey){setShowConfig(true);return}
    setError('');setSuccess('')
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      const rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'})
      chunks.current=[]
      rec.ondataavailable=e=>{if(e.data.size>0)chunks.current.push(e.data)}
      rec.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop())
        const blob=new Blob(chunks.current,{type:'audio/webm'})
        setPhase('transcribing')
        try{
          const text=await whisperTranscribe(blob,provider,apiKey)
          setTranscription(p=>p?p+' '+text:text)
          setPhase('structuring')
          const full=transcription?transcription+' '+text:text
          const r=await structureReport(full,provider,apiKey)
          setData({tutor:r.tutor||data.tutor||'',fecha:r.fecha||data.fecha,mascota:r.mascota||data.mascota||'',medico_derivante:r.medico_derivante||data.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''})
          setSuccess(r.estilo_detectado?.frases_nuevas?.length>0?`Informe listo · ${r.estilo_detectado.frases_nuevas.length} patrón(es) aprendido(s)`:'Informe estructurado correctamente')
          setStep('edit')
        }catch(e:any){setError(e.message)}
        setPhase('idle')
      }
      rec.start();mediaRec.current=rec;setPhase('recording')
    }catch(e:any){setError('Micrófono: '+e.message)}
  }
  const handleMic=()=>{if(phase==='recording')mediaRec.current?.stop();else if(phase==='idle')startRec()}
  const manualProcess=async()=>{
    if(!apiKey){setShowConfig(true);return};if(!transcription.trim()){setError('Sin texto');return}
    setPhase('structuring');setError('')
    try{const r=await structureReport(transcription,provider,apiKey);setData({tutor:r.tutor||'',fecha:r.fecha||data.fecha,mascota:r.mascota||'',medico_derivante:r.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''});setSuccess('Informe estructurado');setStep('edit')}catch(e:any){setError(e.message)}
    setPhase('idle')
  }
  const addImgs=(e:React.ChangeEvent<HTMLInputElement>)=>{Array.from(e.target.files||[]).forEach(f=>{setImgFiles(p=>[...p,f]);const r=new FileReader();r.onload=ev=>setImgPrevs(p=>[...p,ev.target?.result as string]);r.readAsDataURL(f)});e.target.value=''}
  const delImg=(i:number)=>{setImgFiles(p=>p.filter((_,j)=>j!==i));setImgPrevs(p=>p.filter((_,j)=>j!==i))}
  const makePDF=async()=>{setProcessing(true);setError('');try{const b=await generatePDF(data,imgFiles,fontSize);setPdfUrl(URL.createObjectURL(b));setStep('done')}catch(e:any){setError(e.message)};setProcessing(false)}
  const sharePDF=async()=>{if(!pdfUrl)return;const b=await(await fetch(pdfUrl)).blob();const f=new File([b],`Informe_${data.mascota||'eco'}_${data.fecha.replace(/\//g,'-')}.pdf`,{type:'application/pdf'});if(navigator.share?.({files:[f]}))await navigator.share({files:[f]});else{const a=document.createElement('a');a.href=pdfUrl;a.download=f.name;a.click()}}
  const reset=()=>{setStep('record');setTranscription('');setImgFiles([]);setImgPrevs([]);setPdfUrl(null);setError('');setSuccess('');setPhase('idle');setData({tutor:'',fecha:new Date().toLocaleDateString('es-AR'),mascota:'',medico_derivante:'',cuerpo_informe:''})}
  const startNew=()=>{reset();setView('nuevo');setSidebarOpen(false)}
  const nav=(v:View)=>{if(v==='nuevo')startNew();else{setView(v);setSidebarOpen(false)}}
  const u=(k:keyof Report,v:string)=>setData(p=>({...p,[k]:v}))
  const prov=provider==='groq'?'Groq':'GPT'

  return(<>
    <div className="app-bg"/>
    <button className={`sidebar-toggle ${sidebarOpen?"shifted":""}`} onClick={()=>setSidebarOpen(!sidebarOpen)}>{sidebarOpen?<X size={20}/>:<Menu size={20}/>}</button>
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen?'open':'closed'}`}>
        <button className="sidebar-close" onClick={()=>setSidebarOpen(false)}><X size={18}/></button>
        <div className="sidebar-brand">
          <div className="sidebar-logo"><HeartPulse size={20} color="#fff"/></div>
          <div><div className="sidebar-title">Eco Vet Pro</div><div className="sidebar-subtitle">Diagnóstico Inteligente</div></div>
        </div>
        <div className="sidebar-section">Informes</div>
        <ul className="sidebar-nav">
          <li className={`sidebar-item ${view==='dashboard'?'active':''}`} onClick={()=>nav('dashboard')}><LayoutDashboard size={16}/> Dashboard</li>
          <li className={`sidebar-item ${view==='nuevo'?'active':''}`} onClick={()=>nav('nuevo')}><Plus size={16}/> Nuevo Informe</li>
          <li className="sidebar-item"><FileText size={16}/> Mis Informes{stats.total_informes>0&&<span className="sidebar-badge">{stats.total_informes}</span>}</li>
          <li className="sidebar-item"><FolderOpen size={16}/> Plantillas</li>
          <li className="sidebar-item"><Image size={16}/> Biblioteca</li>
        </ul>
        <div className="sidebar-section">IA & Aprendizaje</div>
        <ul className="sidebar-nav">
          <li className="sidebar-item"><Tag size={16}/> Etiquetado</li>
          <li className="sidebar-item"><Brain size={16}/> Modelos IA{stats.patrones>0&&<span className="sidebar-badge">{stats.patrones}</span>}</li>
          <li className="sidebar-item"><TrendingUp size={16}/> Aprendizaje</li>
        </ul>
        <div className="sidebar-section">Sistema</div>
        <ul className="sidebar-nav">
          <li className="sidebar-item" onClick={()=>{setShowConfig(true);setSidebarOpen(false)}}><Settings size={16}/> Configuración</li>
        </ul>
      </aside>

      <div className={`main ${sidebarOpen?"with-sidebar":""}`}>
        <div className="topbar">
          <div className="topbar-left">
            <div className="topbar-search"><Search size={14} color="#52525B"/><input placeholder="Buscar informes, pacientes..."/></div>
          </div>
          <div className="topbar-right">
            <button className="topbar-new" onClick={startNew}><Plus size={16}/> Nuevo Informe</button>
            <div className="topbar-user">
              <div className="topbar-avatar"><img src="/hero-pets.png" alt="avatar"/></div>
              <div><div className="topbar-name">Dra. Raffo</div><div className="topbar-role">Veterinaria</div></div>
            </div>
          </div>
        </div>

        {view==='dashboard'&&(
          <div className="page">
            <div className="hero">
              <div className="hero-content">
                <div className="hero-greeting">CENTRO DE DIAGNÓSTICO INTELIGENTE</div>
                <h1 className="hero-title">Hola, Dra. Raffo 👋</h1>
                <p className="hero-sub">Todo listo para crear un nuevo informe ecográfico con inteligencia artificial.</p>
                <div className="hero-actions">
                  <button className="hero-cta" onClick={startNew}><Sparkles size={20}/> Nuevo Informe</button>
                  <button className="hero-cta-secondary" onClick={()=>setShowConfig(true)}><Settings size={16}/> Configuración</button>
                </div>
              </div>
              <div className="hero-img"><img src="/hero-ai.png" alt="AI Veterinaria"/></div>
            </div>

            <div className="stats-band">
              <div className="stat-item"><div className="stat-value purple">{stats.total_informes}</div><div className="stat-label">Informes</div></div>
              <div className="stat-item"><div className="stat-value blue">{stats.patrones}</div><div className="stat-label">Patrones IA</div></div>
              <div className="stat-item"><div className="stat-value cyan">—</div><div className="stat-label">Imágenes</div></div>
              <div className="stat-item"><div className="stat-value green">{apiKey?'Activo':'—'}</div><div className="stat-label">Motor IA</div></div>
            </div>

            <div className="circle-actions">
              <div className="circle-action" onClick={startNew}>
                <button className="circle-btn cb-blue"><Mic size={28} color="#fff"/></button>
                <span className="circle-label">Dictar</span>
              </div>
              <div className="circle-action" onClick={()=>fileRef.current?.click()}>
                <button className="circle-btn cb-orange"><Camera size={28} color="#fff"/></button>
                <span className="circle-label">Ecografías</span>
              </div>
              <div className="circle-action">
                <button className="circle-btn cb-purple"><Tag size={28} color="#fff"/></button>
                <span className="circle-label">Etiquetar</span>
              </div>
              <div className="circle-action">
                <button className="circle-btn cb-cyan"><Brain size={28} color="#fff"/></button>
                <span className="circle-label">Modelo IA</span>
              </div>
            </div>

            <div className="panels-grid">
              <div className="panel">
                <div className="panel-head"><span className="panel-title"><Sparkles size={16} color="#8B5CF6"/> IA en Aprendizaje</span></div>
                <div className="panel-body" style={{color:'var(--text2)',fontSize:14,lineHeight:2.2}}>
                  Proveedor: <strong style={{color:'var(--accent)'}}>{prov}</strong><br/>
                  API Key: <strong style={{color:apiKey?'var(--green)':'var(--danger)'}}>{apiKey?'Configurada':'No configurada'}</strong><br/>
                  Patrones: <strong style={{color:'var(--cyan)'}}>{stats.patrones}</strong><br/>
                  Informes procesados: <strong>{stats.total_informes}</strong>
                </div>
              </div>
              <div className="panel">
                <div className="panel-head"><span className="panel-title"><HeartPulse size={16} color="#22D3EE"/> Sistema</span></div>
                <div className="panel-body" style={{color:'var(--text2)',fontSize:14,lineHeight:2.2}}>
                  Plantilla: <strong style={{color:'var(--green)'}}>Cargada</strong><br/>
                  Base de datos: <strong style={{color:'var(--green)'}}>{stats.total_informes} registros</strong><br/>
                  Whisper: <strong style={{color:'var(--green)'}}>Disponible</strong><br/>
                  PDF Engine: <strong style={{color:'var(--green)'}}>Activo</strong>
                </div>
              </div>
            </div>

            {drafts.length>0&&(
              <div className="panel" style={{animation:'fadeUp 1s ease'}}>
                <div className="panel-head"><span className="panel-title"><Save size={16} color="#F97316"/> Borradores guardados</span></div>
                <div className="panel-body">
                  {drafts.map((d:any)=>(
                    <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--gb)'}}>
                      <div style={{cursor:'pointer',flex:1}} onClick={()=>loadDraft(d)}>
                        <div style={{fontWeight:600,fontSize:14}}>{d.mascota||'Sin nombre'}</div>
                        <div style={{fontSize:12,color:'var(--text-muted)'}}>{d.tutor} — {d.savedAt}</div>
                      </div>
                      <button onClick={()=>deleteDraft(d.id)} style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',padding:8}}>
                        <X size={16}/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {view==='nuevo'&&(
          <div className="page">
            <div style={{marginBottom:24,animation:'fadeUp 0.5s ease'}}>
              <h2 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.5px'}}>Nuevo Informe</h2>
              <p style={{color:'var(--text2)',fontSize:14,marginTop:4}}>Dictá, editá y generá el PDF con inteligencia artificial</p>
            </div>

            <div className="steps-bar">
              <div className={`step-tab ${step==='record'?'active':step!=='record'?'done':''}`}><Mic size={14}/> Dictar</div>
              <div className={`step-tab ${step==='edit'?'active':step==='done'?'done':''}`}><Pencil size={14}/> Editar</div>
              <div className={`step-tab ${step==='done'?'active':''}`}><FileText size={14}/> PDF</div>
            </div>

            {error&&<div className="alert alert-error">{error}</div>}
            {success&&<div className="alert alert-success"><Sparkles size={14}/> {success}</div>}

            {step==='record'&&(<>
              <div className="panel"><div className="panel-body">
                <div className="mic-container">
                  <div className={`mic-ring ${phase}`} onClick={handleMic}>
                    <button className={`mic-inner ${phase}`}>
                      {phase==='recording'?<Square size={32} color="#fff"/>:phase==='idle'?<Mic size={36} color="#fff"/>:<Loader size={32} color="#fff" className="spin"/>}
                    </button>
                  </div>
                  <span className={`mic-text ${phase}`}>
                    {phase==='idle'&&'Tocá para comenzar a dictar'}
                    {phase==='recording'&&'Grabando — tocá para detener'}
                    {phase==='transcribing'&&'Whisper transcribiendo...'}
                    {phase==='structuring'&&`${prov} estructurando informe...`}
                  </span>
                  <span className="mic-sub">{phase==='idle'&&`Transcripción y estructura con ${prov}`}</span>
                </div>
              </div></div>
              {transcription&&(
                <div className="panel">
                  <div className="panel-head"><span className="panel-title"><FileText size={16}/> Transcripción</span></div>
                  <div className="panel-body">
                    <textarea className="form-input" value={transcription} onChange={e=>setTranscription(e.target.value)} rows={5}/>
                    <button className="btn btn-blue" style={{marginTop:14}} onClick={manualProcess} disabled={phase!=='idle'}><Sparkles size={16}/> Re-estructurar con {prov}</button>
                  </div>
                </div>
              )}
            </>)}

            {step==='edit'&&(<>
              <div className="panel">
                <div className="panel-head"><span className="panel-title"><Scan size={16}/> Datos del paciente</span></div>
                <div className="panel-body">
                  <div className="field"><label className="field-label">Tutor</label><input className="form-input" value={data.tutor} onChange={e=>u('tutor',e.target.value)} placeholder="Nombre del tutor"/></div>
                  <div className="field-row">
                    <div className="field"><label className="field-label">Fecha</label><input className="form-input" value={data.fecha} onChange={e=>u('fecha',e.target.value)}/></div>
                    <div className="field"><label className="field-label">Méd. derivante</label><input className="form-input" value={data.medico_derivante} onChange={e=>u('medico_derivante',e.target.value)}/></div>
                  </div>
                  <div className="field" style={{marginTop:16}}><label className="field-label">Mascota</label><input className="form-input" value={data.mascota} onChange={e=>u('mascota',e.target.value)} placeholder="Nombre (especie, raza, edad)"/></div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-head"><span className="panel-title"><FileText size={16}/> Informe ecográfico</span></div>
                <div className="panel-body"><textarea className="form-input" style={{minHeight:320}} value={data.cuerpo_informe} onChange={e=>u('cuerpo_informe',e.target.value)}/></div>
              </div>
              <div className="panel">
                <div className="panel-head"><span className="panel-title"><Camera size={16}/> Ecografías (hasta 18)</span></div>
                <div className="panel-body">
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={addImgs} style={{display:'none'}}/>
                  <button className="btn btn-glass" style={{marginTop:0}} onClick={()=>fileRef.current?.click()}><Image size={16}/> Seleccionar imágenes</button>
                  {imgPrevs.length>0&&<>
                    <div className="img-grid">{imgPrevs.map((s,i)=>(<div key={i} className="img-item"><img src={s} className="img-thumb"/><button className="img-del" onClick={()=>delImg(i)}>✕</button></div>))}</div>
                    <p style={{fontSize:12,color:'var(--text-muted)',marginTop:8}}>{imgPrevs.length} imagen(es) — 9 por página, grilla 3×3</p>
                  </>}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head"><span className="panel-title"><Settings size={16}/> Tamaño de letra</span></div>
                <div className="panel-body" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                  {[9,10,11,12,13,14].map(s=>(
                    <button key={s} onClick={()=>setFontSize(s)} className={`btn ${fontSize===s?'btn-blue':'btn-glass'}`}
                      style={{width:'auto',padding:'8px 16px',flex:'none',fontSize:s}}>{s}pt</button>
                  ))}
                  <p style={{fontSize:12,color:'var(--text-muted)',width:'100%',marginTop:4}}>
                    Informe corto → letra más grande. Informe largo → letra más chica.
                  </p>
                </div>
              </div>

              <button className="btn btn-blue" onClick={makePDF} disabled={processing}>{processing?<><Loader size={16} className="spin"/> Generando...</>:<><FileText size={16}/> Generar PDF</>}</button>
              <button className="btn btn-orange" onClick={saveDraft}><Save size={16}/> Guardar borrador</button>
              <button className="btn btn-ghost" onClick={()=>setStep('record')}><ArrowLeft size={14}/> Volver a dictar</button>
            </>)}

            {step==='done'&&pdfUrl&&(<>
              <div className="panel"><div className="panel-body result-card">
                <div className="result-icon"><Sparkles size={48} color="#8B5CF6"/></div>
                <div className="result-title">PDF generado correctamente</div>
                <div className="result-sub">{data.mascota||'Informe'} — {data.fecha}</div>
              </div></div>
              <div className="panel" style={{textAlign:'center',padding:'24px'}}>
                <button className="btn btn-glass" style={{marginTop:0,maxWidth:300,margin:'0 auto'}} onClick={()=>window.open(pdfUrl,'_blank')}>
                  <FileText size={18}/> Ver vista preliminar
                </button>
                <p style={{fontSize:12,color:'var(--text-muted)',marginTop:10}}>Se abre en una pestaña nueva</p>
              </div>
              <button className="btn btn-blue" onClick={async()=>{
                try{await saveReport({...data,transcripcion_original:transcription});setSuccess('Informe guardado en la base de datos')}catch(e:any){setError(e.message)}
              }}><Save size={16}/> Guardar informe</button>
              <button className="btn btn-orange" onClick={sharePDF}><Send size={16}/> Compartir por WhatsApp</button>
              <button className="btn btn-glass" onClick={()=>{
                const a=document.createElement('a');a.href=pdfUrl;a.download=`Informe_${data.mascota||'eco'}_${data.fecha.replace(/\//g,'-')}.pdf`;a.click()
              }}><Download size={16}/> Descargar PDF</button>
              <button className="btn btn-glass" onClick={()=>setStep('edit')}><Pencil size={14}/> Seguir editando</button>
              <button className="btn btn-ghost" onClick={startNew}><Plus size={14}/> Nuevo informe</button>
            </>)}
          </div>
        )}
      </div>
    </div>

    {showConfig&&(
      <div className="modal-bg" onClick={()=>setShowConfig(false)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <h2><Settings size={18}/> Configuración</h2>
          <div className="field"><label className="field-label">Proveedor de IA</label>
            <select className="form-input" value={provider} onChange={e=>setProvider(e.target.value)}>
              <option value="groq">Groq — Whisper + Llama 3.3 (gratis)</option>
              <option value="openai">OpenAI — Whisper + GPT-4o-mini</option>
            </select>
          </div>
          <div className="field"><label className="field-label">API Key</label>
            <input className="form-input" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={provider==='groq'?'gsk_...':'sk-...'}/>
            <p className="modal-info">{provider==='groq'?'Gratis → console.groq.com':'~$0.01/informe → platform.openai.com'}</p>
          </div>
          <hr className="modal-sep"/>
          <div style={{fontSize:13,color:'var(--text2)',lineHeight:2}}>Informes: <strong>{stats.total_informes}</strong> · Patrones IA: <strong>{stats.patrones}</strong></div>
          <button className="btn btn-blue" style={{marginTop:24}} onClick={()=>{localStorage.setItem('eco_key',apiKey);localStorage.setItem('eco_prov',provider);setShowConfig(false)}}>Guardar configuración</button>
        </div>
      </div>
    )}
    <input ref={fileRef} type="file" accept="image/*" multiple onChange={addImgs} style={{display:'none'}}/>
  </>)
}
