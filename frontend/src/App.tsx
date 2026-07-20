import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader, Plus, Search, Settings, LayoutDashboard, FileText, FolderOpen, Image, Brain, Tag, TrendingUp, Camera, Sparkles, HeartPulse, Scan, ArrowLeft, Pencil, Send, Menu, X, Save, Download } from 'lucide-react'
import { whisperTranscribe, structureReport, generatePDF, getStats, saveReport, getReports, getEstilo } from './api/client'

type View='dashboard'|'nuevo'|'informes'|'biblioteca'; type Phase='idle'|'recording'|'transcribing'|'structuring'; type Step='record'|'edit'|'done'
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
  const [marginLevel,setMarginLevel]=useState(0)
  const [lineSpacing,setLineSpacing]=useState(1)
  const [drafts,setDrafts]=useState<any[]>([])
  const [savedReports,setSavedReports]=useState<any[]>([])
  const [estiloData,setEstiloData]=useState<any>({frases_habituales:[],terminos_preferidos:{},correcciones_frecuentes:[]})
  const mediaRec=useRef<MediaRecorder|null>(null)
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
      // Detect supported audio format (iOS Safari doesn't support webm)
      let mimeType='audio/webm;codecs=opus'
      if(!MediaRecorder.isTypeSupported(mimeType)){
        mimeType='audio/mp4'
        if(!MediaRecorder.isTypeSupported(mimeType)){
          mimeType='audio/wav'
          if(!MediaRecorder.isTypeSupported(mimeType)) mimeType=''
        }
      }
      const rec=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream)
      const actualMime=rec.mimeType||mimeType||'audio/webm'
      chunks.current=[]
      rec.ondataavailable=e=>{if(e.data.size>0)chunks.current.push(e.data)}
      rec.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop())
        const blob=new Blob(chunks.current,{type:actualMime})
        setPhase('transcribing')
        try{
          const text=await whisperTranscribe(blob,provider,apiKey)
          if(!text||text.trim().length<3){setError('No se detectó audio. Intentá de nuevo.');setPhase('idle');return}
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
          <li className={`sidebar-item ${view==='informes'?'active':''}`} onClick={()=>{setView('informes');setSidebarOpen(false);getReports().then(setSavedReports)}}><FileText size={16}/> Mis Informes{(stats.total_informes>0||drafts.length>0)&&<span className="sidebar-badge">{stats.total_informes+drafts.length}</span>}</li>
          <li className="sidebar-item"><FolderOpen size={16}/> Plantillas</li>
          <li className={`sidebar-item ${view==='biblioteca'?'active':''}`} onClick={()=>{setView('biblioteca');setSidebarOpen(false);getEstilo().then(setEstiloData)}}><Brain size={16}/> Aprendizaje IA</li>
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
                <div className="panel-head"><span className="panel-title"><Settings size={16}/> Formato del PDF</span></div>
                <div className="panel-body">
                  <div style={{marginBottom:16}}>
                    <label className="field-label">Tamaño de letra</label>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {[8,9,10,11,12,13,14].map(s=>(
                        <button key={s} onClick={()=>setFontSize(s)} className={`btn ${fontSize===s?'btn-blue':'btn-glass'}`}
                          style={{width:'auto',padding:'6px 14px',flex:'none',fontSize:Math.min(s,12)}}>{s}pt</button>
                      ))}
                    </div>
                  </div>
                  <div style={{marginBottom:16}}>
                    <label className="field-label">Margen izquierdo</label>
                    <div style={{display:'flex',gap:8}}>
                      {[{v:0,l:'Normal'},{v:1,l:'-1 tab'},{v:2,l:'-2 tabs'}].map(m=>(
                        <button key={m.v} onClick={()=>setMarginLevel(m.v)} className={`btn ${marginLevel===m.v?'btn-blue':'btn-glass'}`}
                          style={{width:'auto',padding:'6px 14px',flex:'none'}}>{m.l}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Interlineado</label>
                    <div style={{display:'flex',gap:8}}>
                      {[{v:1,l:'Con interlineado'},{v:0,l:'Sin interlineado'}].map(s=>(
                        <button key={s.v} onClick={()=>setLineSpacing(s.v)} className={`btn ${lineSpacing===s.v?'btn-blue':'btn-glass'}`}
                          style={{width:'auto',padding:'6px 14px',flex:'none'}}>{s.l}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn btn-blue" onClick={async()=>{
                setProcessing(true);setError('')
                try{const b=await generatePDF(data,imgFiles,fontSize,marginLevel,lineSpacing);const url=URL.createObjectURL(b);setPdfUrl(url);window.open(url,'_blank')}
                catch(e:any){setError(e.message)}
                setProcessing(false)
              }} disabled={processing}>{processing?<><Loader size={16} className="spin"/> Generando...</>:<><FileText size={16}/> Vista preliminar</>}</button>
              <p style={{fontSize:12,color:'var(--text-muted)',textAlign:'center',marginTop:4}}>Revisá el PDF, ajustá el tamaño de letra si es necesario, y después generá el PDF final</p>

              {pdfUrl&&<>
                <button className="btn btn-orange" onClick={()=>{
                  const a=document.createElement('a');a.href=pdfUrl;a.download=`Informe_${data.mascota||'eco'}_${data.fecha.replace(/\//g,'-')}.pdf`;a.click()
                }}><Download size={16}/> Descargar PDF</button>
                <button className="btn btn-glass" onClick={sharePDF}><Send size={16}/> Compartir por WhatsApp</button>
                <button className="btn btn-blue" style={{marginTop:10}} onClick={async()=>{
                  try{const r=await saveReport({...data,transcripcion_original:transcription});setSuccess(`Informe guardado. ${r.patterns_learned||0} patrón(es) aprendido(s).`)}catch(e:any){setError(e.message)}
                }}><Save size={16}/> Guardar informe</button>
              </>}
              <button className="btn btn-glass" onClick={saveDraft}><Save size={16}/> Guardar borrador</button>
              <button className="btn btn-ghost" onClick={()=>setStep('record')}><ArrowLeft size={14}/> Volver a dictar</button>
            </>)}

            {step==='done'&&pdfUrl&&(<>
              <div className="panel"><div className="panel-body result-card">
                <div className="result-icon"><Sparkles size={48} color="#8B5CF6"/></div>
                <div className="result-title">PDF generado correctamente</div>
                <div className="result-sub">{data.mascota||'Informe'} — {data.fecha}</div>
              </div></div>
              <button className="btn btn-blue" onClick={async()=>{
                try{await saveReport({...data,transcripcion_original:transcription});setSuccess('Informe guardado')}catch(e:any){setError(e.message)}
              }}><Save size={16}/> Guardar informe</button>
              <button className="btn btn-orange" onClick={()=>{
                const a=document.createElement('a');a.href=pdfUrl;a.download=`Informe_${data.mascota||'eco'}_${data.fecha.replace(/\//g,'-')}.pdf`;a.click()
              }}><Download size={16}/> Descargar PDF</button>
              <button className="btn btn-glass" onClick={sharePDF}><Send size={16}/> Compartir</button>
              <button className="btn btn-glass" onClick={()=>setStep('edit')}><Pencil size={14}/> Seguir editando</button>
              <button className="btn btn-ghost" onClick={startNew}><Plus size={14}/> Nuevo informe</button>
            </>)}
          </div>
        )}

        {/* ══ MIS INFORMES ══ */}
        {view==='informes'&&(
          <div className="page">
            <div style={{marginBottom:24,animation:'fadeUp 0.5s ease'}}>
              <h2 style={{fontSize:22,fontWeight:700}}>Mis Informes</h2>
              <p style={{color:'var(--text2)',fontSize:14,marginTop:4}}>Borradores e informes guardados</p>
            </div>

            {drafts.length>0&&(
              <div className="panel" style={{animation:'fadeUp 0.6s ease'}}>
                <div className="panel-head"><span className="panel-title"><Save size={16} color="#F97316"/> Borradores ({drafts.length})</span></div>
                <div className="panel-body">
                  {drafts.map((d:any)=>(
                    <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0',borderBottom:'1px solid var(--gb)'}}>
                      <div style={{cursor:'pointer',flex:1}} onClick={()=>loadDraft(d)}>
                        <div style={{fontWeight:600,fontSize:14}}>{d.mascota||'Sin nombre'} <span style={{color:'var(--orange)',fontSize:12}}>● Borrador</span></div>
                        <div style={{fontSize:12,color:'var(--text-muted)'}}>Tutor: {d.tutor||'—'} | {d.savedAt}</div>
                        <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{(d.cuerpo_informe||'').substring(0,80)}...</div>
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={()=>loadDraft(d)} style={{background:'var(--glass)',border:'1px solid var(--gb)',color:'var(--accent)',cursor:'pointer',padding:'6px 12px',borderRadius:8,fontSize:12,fontWeight:600}}>Abrir</button>
                        <button onClick={()=>deleteDraft(d.id)} style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',padding:8}}><X size={16}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="panel" style={{animation:'fadeUp 0.7s ease'}}>
              <div className="panel-head">
                <span className="panel-title"><FileText size={16} color="#3B82F6"/> Informes guardados ({savedReports.length})</span>
                <button onClick={()=>getReports().then(setSavedReports)} style={{background:'var(--glass)',border:'1px solid var(--gb)',color:'var(--text2)',cursor:'pointer',padding:'4px 12px',borderRadius:8,fontSize:12}}>Actualizar</button>
              </div>
              <div className="panel-body">
                {savedReports.length===0&&<p style={{color:'var(--text3)',fontSize:14,textAlign:'center',padding:20}}>No hay informes guardados aún. Generá un PDF y tocá "Guardar informe".</p>}
                {savedReports.map((r:any)=>(
                  <div key={r.id} style={{padding:'12px 0',borderBottom:'1px solid var(--gb)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{cursor:'pointer',flex:1}} onClick={()=>{
                        setData({tutor:r.tutor||'',fecha:r.fecha||'',mascota:r.mascota||'',medico_derivante:r.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''})
                        setStep('edit');setView('nuevo')
                      }}>
                        <div style={{fontWeight:600,fontSize:14}}>{r.mascota||'Sin nombre'} <span style={{color:'var(--green)',fontSize:12}}>✓ Guardado</span></div>
                        <div style={{fontSize:12,color:'var(--text-muted)'}}>Tutor: {r.tutor||'—'} | Fecha: {r.fecha||'—'} | {r.created_at?.substring(0,10)||''}</div>
                      </div>
                      <button onClick={()=>{
                        setData({tutor:r.tutor||'',fecha:r.fecha||'',mascota:r.mascota||'',medico_derivante:r.medico_derivante||'',cuerpo_informe:r.cuerpo_informe||''})
                        setStep('edit');setView('nuevo')
                      }} style={{background:'var(--glass)',border:'1px solid var(--gb)',color:'var(--accent)',cursor:'pointer',padding:'6px 12px',borderRadius:8,fontSize:12,fontWeight:600}}>Abrir</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button className="btn btn-blue" onClick={startNew}><Plus size={16}/> Nuevo informe</button>
          </div>
        )}

        {/* ══ BIBLIOTECA ══ */}
        {view==='biblioteca'&&(
          <div className="page">
            <div style={{marginBottom:24,animation:'fadeUp 0.5s ease'}}>
              <h2 style={{fontSize:22,fontWeight:700}}>Aprendizaje IA</h2>
              <p style={{color:'var(--text2)',fontSize:14,marginTop:4}}>Patrones extraídos de cada informe. Esta memoria mejora la IA con cada uso.</p>
            </div>

            <div className="stats-band" style={{animation:'fadeUp 0.6s ease'}}>
              <div className="stat-item"><div className="stat-value purple">{estiloData.frases_habituales?.length||0}</div><div className="stat-label">Frases aprendidas</div></div>
              <div className="stat-item"><div className="stat-value blue">{Object.keys(estiloData.terminos_preferidos||{}).length}</div><div className="stat-label">Términos preferidos</div></div>
              <div className="stat-item"><div className="stat-value cyan">{estiloData.correcciones_frecuentes?.length||0}</div><div className="stat-label">Correcciones</div></div>
            </div>

            <div className="panel" style={{animation:'fadeUp 0.7s ease'}}>
              <div className="panel-head"><span className="panel-title"><Sparkles size={16} color="#8B5CF6"/> Frases habituales</span></div>
              <div className="panel-body">
                {(estiloData.frases_habituales||[]).length===0&&<p style={{color:'var(--text3)',fontSize:14,textAlign:'center',padding:16}}>Todavía no hay frases aprendidas. Se extraen automáticamente de cada informe.</p>}
                {(estiloData.frases_habituales||[]).map((f:string,i:number)=>(
                  <div key={i} style={{padding:'8px 12px',background:'var(--glass)',borderRadius:8,marginBottom:6,fontSize:13,color:'var(--text2)',border:'1px solid var(--gb)'}}>"{f}"</div>
                ))}
              </div>
            </div>

            <div className="panel" style={{animation:'fadeUp 0.8s ease'}}>
              <div className="panel-head"><span className="panel-title"><Tag size={16} color="#3B82F6"/> Términos preferidos</span></div>
              <div className="panel-body">
                {Object.keys(estiloData.terminos_preferidos||{}).length===0&&<p style={{color:'var(--text3)',fontSize:14,textAlign:'center',padding:16}}>Sin términos registrados aún.</p>}
                {Object.entries(estiloData.terminos_preferidos||{}).map(([k,v]:any,i:number)=>(
                  <div key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--gb)',fontSize:13}}>
                    <span style={{color:'var(--danger)',textDecoration:'line-through'}}>{k}</span>
                    <span style={{color:'var(--text3)'}}>→</span>
                    <span style={{color:'var(--success)',fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{animation:'fadeUp 0.9s ease'}}>
              <div className="panel-head"><span className="panel-title"><TrendingUp size={16} color="#22D3EE"/> Correcciones frecuentes</span></div>
              <div className="panel-body">
                {(estiloData.correcciones_frecuentes||[]).length===0&&<p style={{color:'var(--text3)',fontSize:14,textAlign:'center',padding:16}}>Sin correcciones registradas.</p>}
                {(estiloData.correcciones_frecuentes||[]).map((c:string,i:number)=>(
                  <div key={i} style={{padding:'8px 12px',background:'var(--glass)',borderRadius:8,marginBottom:6,fontSize:13,color:'var(--text2)',border:'1px solid var(--gb)'}}>{c}</div>
                ))}
              </div>
            </div>

            <div className="panel" style={{animation:'fadeUp 1s ease'}}>
              <div className="panel-head"><span className="panel-title"><HeartPulse size={16} color="#F97316"/> ¿Cómo funciona?</span></div>
              <div className="panel-body" style={{color:'var(--text2)',fontSize:13,lineHeight:2}}>
                Cada vez que dictás un informe, la IA extrae:<br/>
                • <strong>Frases</strong> que usás frecuentemente<br/>
                • <strong>Términos</strong> que preferís (ej: "ganglios" → "linfonódulos")<br/>
                • <strong>Correcciones</strong> que Whisper suele necesitar<br/><br/>
                Estos patrones se guardan en Supabase y se inyectan en cada nuevo informe para que la IA escriba cada vez más como vos.
              </div>
            </div>

            <button className="btn btn-glass" onClick={()=>getEstilo().then(setEstiloData)}><TrendingUp size={16}/> Actualizar datos</button>
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
