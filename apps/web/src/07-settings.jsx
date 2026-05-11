// === 07-settings.js ===

import React, { useState, useEffect } from 'react';
import { Store, aiGenSchemes, uid, DEF_AGE_THRESHOLDS, DEF_PRI, SCHEMES } from './01-core.js';
import { IC } from './02-icons.jsx';
import { PriEditor } from './04-components.jsx';

const NC_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

function SettingsModal({AS, setAS, T, ap, onClose, onSignOut,
  onOptimize, optLoading, onBulkAdd, onShatter, onDedup,
  curEnergy, onSetEnergy, focusModeActive, onToggleFocusMode,
  effectiveCount, overwhelmThreshold, hasAI, aiConfig,
  deskPhoneThemeSync = true, deskPhoneOnline = false,
  onToggleDeskPhoneThemeSync, onRefreshDeskPhoneTheme, initialTab = "queue"}) {

  const [sTab, setSTab] = useState(initialTab || "queue");
  const [backupFolderSet, setBackupFolderSet] = useState(false);
  const [backupFolderSetting, setBackupFolderSetting] = useState(false);

  // Check on mount whether a backup folder handle is already stored
  React.useEffect(() => {
    Store._idbGet('backupDir').then(h => setBackupFolderSet(!!h));
  }, []);

  async function handleSetBackupFolder() {
    setBackupFolderSetting(true);
    const ok = await Store.chooseBackupDir();
    setBackupFolderSet(ok);
    setBackupFolderSetting(false);
  }
  const [showPE, setShowPE] = useState(false);
  const [schemeGenLoading, setSchemeGenLoading] = useState(false);
  const [schemeGenErr, setSchemeGenErr] = useState("");
  const [deskPhoneSyncBusy, setDeskPhoneSyncBusy] = useState(false);
  const [deskPhoneSyncNote, setDeskPhoneSyncNote] = useState("");
  const pris = AS.priorities;

  const selectedModel = AS.aiModel || aiConfig?.model || aiConfig?.textModel || "";
  const settingsAiOpts = AS ? {
    provider: "gemini",
    model: selectedModel,
    source: "server",
  } : null;
  const settingsHasAI = !!hasAI;
  const geminiModels = aiConfig?.models?.gemini || ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];

  async function handleGenSchemes() {
    if (!settingsHasAI) { setSchemeGenErr("AI server is not configured."); return; }
    setSchemeGenLoading(true); setSchemeGenErr("");
    try {
      const existing = [
        ...Object.values(SCHEMES).map(s => s.name),
        ...Object.values(AS.customSchemes || {}).map(s => safeScheme(s)?.name).filter(Boolean),
      ];
      const newSchemes = await aiGenSchemes(settingsAiOpts, existing);
      if (!newSchemes.length) throw new Error("No valid schemes returned.");
      const toAdd = {};
      newSchemes.forEach(s => { toAdd[`custom_${s.id}`] = s; });
      setAS(p => ({...p, customSchemes: {...(p.customSchemes || {}), ...toAdd}}));
    } catch(e) {
      setSchemeGenErr("Generation failed: " + e.message);
    } finally {
      setSchemeGenLoading(false);
    }
  }

  async function handleDeskPhoneThemeRefresh() {
    if (!onRefreshDeskPhoneTheme || deskPhoneSyncBusy) return;
    setDeskPhoneSyncBusy(true);
    setDeskPhoneSyncNote("");
    try {
      const ok = await onRefreshDeskPhoneTheme();
      setDeskPhoneSyncNote(ok ? "DeskPhone theme refreshed." : "DeskPhone is not answering.");
    } finally {
      setDeskPhoneSyncBusy(false);
    }
  }

  const addPri = (label, color) => {
    const id = "pri_" + uid();
    const mw = Math.max(...pris.map(p => p.weight), 0);
    setAS(p => ({...p, priorities: [...p.priorities, {id, label, color, weight: mw+1}]}));
  };
  const remPri = (id) => {
    if (id === "shaila") return;
    if (ap.length <= 1) return;
    setAS(p => ({...p, priorities: p.priorities.map(x => x.id===id ? {...x, deleted:true} : x)}));
  };

  const ageThresholds = AS.ageThresholds || DEF_AGE_THRESHOLDS;
  const mrsWWindows = AS.mrsWWindows || {monThu:{start:"08:30",end:"13:00"},fri:{start:"08:30",end:"10:00"}};

  const TABS = [
    {id:"queue",      label:"Queue"},
    {id:"appearance", label:"Appearance"},
    {id:"tasks",      label:"Tasks"},
    {id:"schedule",   label:"Schedule"},
    {id:"account",    label:"Account"},
    {id:"google",     label:"Google"},
  ];

  const settingsType = {
    section: 13,
    body: 15,
    help: 13,
    control: 14,
    line: 1.55,
  };
  const sh = {fontSize:settingsType.section,fontWeight:500,color:T.tFaint,margin:"0 0 14px",fontFamily:NC_FONT_STACK,textTransform:"uppercase",letterSpacing:0};
  const tog = (on) => ({width:44,height:24,borderRadius:12,background:on?ap[0]?.color:T.brd,border:"none",cursor:"pointer",position:"relative",flexShrink:0});
  const knob = (on) => ({width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:on?23:3,transition:"left 0.25s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"});
  const rowSB = {display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,marginBottom:18};
  const actionBtn = {width:"100%",minHeight:44,padding:"12px 16px",borderRadius:8,border:`1px solid ${T.brdS || T.brd}`,background:T.card,cursor:"pointer",fontSize:settingsType.control,fontWeight:400,fontFamily:NC_FONT_STACK,color:T.tSoft,display:"flex",alignItems:"center",gap:12,marginBottom:10};
  const safeScheme = (scheme) => (scheme && typeof scheme === "object" && typeof scheme.name === "string") ? scheme : null;
  const schemeButtonStyle = (id, scheme, hasDelete = false) => {
    scheme = safeScheme(scheme) || SCHEMES.claude;
    const active = AS.colorScheme === id;
    const bg = scheme.card || scheme.bg || "#FFFFFF";
    const accent = scheme.primary || scheme.brd || "#00796B";
    return {
      minHeight: 40,
      padding: hasDelete ? "8px 34px 8px 14px" : "8px 14px",
      borderRadius: 999,
      border: `1px solid ${active ? accent : (scheme.brd || T.brd)}`,
      background: active ? (scheme.tonal || scheme.bgW || bg) : bg,
      cursor: "pointer",
      fontSize: settingsType.control,
      fontWeight: 500,
      fontFamily: NC_FONT_STACK,
      color: scheme.text || T.text,
      boxShadow: "none",
    };
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:sTab==="appearance"?"rgba(0,0,0,0.08)":"rgba(0,0,0,0.32)",display:"flex",alignItems:"center",justifyContent:"center",overflowY:"auto",padding:24,transition:"background 0.3s",fontFamily:NC_FONT_STACK}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:sTab==="appearance"?T.card+"f7":T.card,borderRadius:8,border:`1px solid ${T.brdS || T.brd}`,padding:"28px 26px",maxWidth:560,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:`0 12px 32px rgba(60,64,67,0.22)`,transition:"background 0.3s",fontFamily:NC_FONT_STACK}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h3 style={{fontSize:20,fontWeight:500,margin:0,fontFamily:NC_FONT_STACK}}>Settings</h3>
          <button onClick={onClose} style={{width:40,height:40,background:"none",border:"none",cursor:"pointer",fontSize:20,color:T.tSoft,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{display:"flex",gap:6,background:T.bgW,borderRadius:8,padding:4,marginBottom:24}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setSTab(t.id)} style={{flex:1,minHeight:40,padding:"8px 8px",borderRadius:4,border:"none",background:sTab===t.id?T.card:"transparent",cursor:"pointer",fontSize:14,fontWeight:sTab===t.id?500:400,fontFamily:NC_FONT_STACK,color:sTab===t.id?T.text:T.tSoft,transition:"background 0.15s",boxShadow:"none"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── QUEUE TAB ── */}
        {sTab === "queue" && (
          <div>
            <h4 style={sh}>Energy Filter</h4>
            <div style={{display:"flex",gap:6,marginBottom:18}}>
              {["high","low",null].map(e => (
                <button key={String(e)} onClick={()=>onSetEnergy(e)} style={{flex:1,minHeight:40,padding:"8px 0",borderRadius:8,border:`1px solid ${e==="high"?"#E07040":e==="low"?"#7EB0DE":T.brd}`,background:curEnergy===e?(e==="high"?"#E0704020":e==="low"?"#7EB0DE20":T.bgW):T.bgW,cursor:"pointer",fontSize:settingsType.control,fontFamily:"system-ui",fontWeight:curEnergy===e?500:400,color:e==="high"?"#B85030":e==="low"?"#4A7898":T.tSoft}}>
                  {e==="high"?"⚡ High":e==="low"?"🌊 Low":"All"}
                </button>
              ))}
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 18px"}}/>
            <h4 style={sh}>Queue Actions</h4>

            <button onClick={()=>{onOptimize();onClose();}} disabled={optLoading} style={{...actionBtn,opacity:optLoading?0.5:1}}>
              <IC.Sparkle s={13} c={T.tSoft}/>{optLoading?"Optimizing…":"Optimize order"}{hasAI&&!optLoading&&<span style={{fontSize:12,opacity:.6,marginLeft:2}}>AI</span>}
            </button>
            <button onClick={()=>{onBulkAdd();onClose();}} style={actionBtn}>
              <IC.Bulk s={13} c={T.tSoft}/>Bulk add tasks
            </button>
            <button onClick={()=>{onShatter();onClose();}} style={actionBtn}>
              <IC.Split s={13} c={T.tSoft}/>Shatter task
            </button>
            <button onClick={()=>{onDedup();onClose();}} style={actionBtn}>
              <IC.Check s={13} c={T.tSoft}/>Remove duplicates
            </button>

            {effectiveCount > overwhelmThreshold && <>
              <div style={{height:1,background:T.brdS,margin:"10px 0 14px"}}/>
              <div style={rowSB}>
                <div>
                  <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Focus mode</span>
                  <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Show only top {overwhelmThreshold} tasks (queue has {effectiveCount})</p>
                </div>
                <button onClick={onToggleFocusMode} style={tog(focusModeActive)}><div style={knob(focusModeActive)}/></button>
              </div>
            </>}
          </div>
        )}

        {/* ── APPEARANCE TAB ── */}
        {sTab === "appearance" && (
          <div>
            <h4 style={sh}>Theme</h4>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
              {Object.entries(SCHEMES).map(([k,v]) => (
                <button key={k} onClick={()=>setAS(p=>({...p,colorScheme:k}))} style={schemeButtonStyle(k, v)}>{v.name}</button>
              ))}
              {Object.entries(AS.customSchemes || {}).filter(([,v]) => safeScheme(v)).map(([k,v]) => {
                return (
                <div key={k} style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                  <button onClick={()=>setAS(p=>({...p,colorScheme:k}))} style={schemeButtonStyle(k, v, true)}>{v.name}</button>
                  <button onClick={e=>{e.stopPropagation();setAS(p=>{const c={...(p.customSchemes||{})};delete c[k];return {...p,customSchemes:c,colorScheme:p.colorScheme===k?"claude":p.colorScheme};});}} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:12,color:v.tSoft || T.tSoft,lineHeight:1,padding:0,opacity:0.6}}>✕</button>
                </div>);
              })}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={handleGenSchemes} disabled={schemeGenLoading} style={{minHeight:40,fontSize:settingsType.control,color:T.tSoft,background:"none",border:`1px dashed ${T.brd}`,borderRadius:8,padding:"8px 16px",cursor:schemeGenLoading?"default":"pointer",fontFamily:"system-ui",opacity:schemeGenLoading?0.6:1}}>
                {schemeGenLoading ? "Generating…" : "✦ Generate more themes"}
              </button>
              {schemeGenErr && <span style={{fontSize:settingsType.help,color:"#C94040",fontFamily:"system-ui",lineHeight:settingsType.line}}>{schemeGenErr}</span>}
            </div>
            <div style={{height:1,background:T.brdS,margin:"18px 0 14px"}}/>
            <h4 style={sh}>Readability</h4>
            <div style={{display:"grid",gap:8,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12}}>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text,fontWeight:500}}>Font weight</span>
                <span style={{fontSize:settingsType.help,fontFamily:"system-ui",color:T.tFaint}}>{AS.fontWeightScale || 400}</span>
              </div>
              <input type="range" min="340" max="520" step="20" value={AS.fontWeightScale || 400}
                onChange={e=>setAS(p=>({...p,fontWeightScale:Number(e.target.value)}))}
                style={{width:"100%",accentColor:T.primary || T.text}}
              />
              <div style={{display:"flex",justifyContent:"space-between",fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui"}}>
                <span>lighter</span>
                <span style={{fontWeight:AS.fontWeightScale || 400,color:T.text}}>sample text</span>
                <span>heavier</span>
              </div>
            </div>
            <div style={{height:1,background:T.brdS,margin:"18px 0 14px"}}/>
            <h4 style={sh}>DeskPhone Link</h4>
            <div style={{...rowSB,alignItems:"flex-start",marginBottom:10}}>
              <div style={{paddingRight:12}}>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text,fontWeight:500}}>Link DeskPhone to this app's theme</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"4px 0 0",lineHeight:settingsType.line}}>When on, OneTask/Shamash pushes its active color scheme to DeskPhone. DeskPhone must also allow this in its Appearance settings.</p>
              </div>
              <button onClick={onToggleDeskPhoneThemeSync} style={tog(deskPhoneThemeSync)} title={deskPhoneThemeSync ? "DeskPhone theme sync is on" : "DeskPhone theme sync is off"}><div style={knob(deskPhoneThemeSync)}/></button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <button onClick={handleDeskPhoneThemeRefresh} disabled={!deskPhoneThemeSync || deskPhoneSyncBusy} style={{minHeight:40,fontSize:settingsType.control,color:T.tSoft,background:T.bgW,border:`1px solid ${T.brd}`,borderRadius:8,padding:"8px 14px",cursor:(!deskPhoneThemeSync || deskPhoneSyncBusy)?"default":"pointer",fontFamily:"system-ui",opacity:(!deskPhoneThemeSync || deskPhoneSyncBusy)?0.55:1}}>
                {deskPhoneSyncBusy ? "Refreshing..." : "Refresh sync"}
              </button>
              <span style={{fontSize:settingsType.help,color:deskPhoneOnline?"#2E7D32":T.tFaint,fontFamily:"system-ui",lineHeight:settingsType.line}}>
                {deskPhoneSyncNote || (deskPhoneOnline ? "DeskPhone linked." : "DeskPhone not confirmed.")}
              </span>
            </div>
          </div>
        )}

        {/* ── TASKS TAB ── */}
        {sTab === "tasks" && (
          <div>
            <h4 style={sh}>Priorities</h4>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              {ap.map(p => (
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:6,background:T.bgW,borderRadius:8,padding:"6px 10px"}}>
                  <div style={{width:14,height:14,borderRadius:"50%",background:p.color}}/>
                  <span style={{fontSize:settingsType.body,fontFamily:"system-ui"}}>{p.label}{p.isShaila?" ⚡":""}</span>
                  {p.id !== "shaila" && ap.length > 1 && <button onClick={()=>remPri(p.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:T.tFaint}}>✕</button>}
                </div>
              ))}
            </div>
            <button onClick={()=>setShowPE(true)} style={{minHeight:40,fontSize:settingsType.control,color:T.tSoft,background:"none",border:`1px dashed ${T.brd}`,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontFamily:"system-ui",marginBottom:4}}>+ Add Priority</button>
            {showPE && <PriEditor T={T} onAdd={(l,c)=>{addPri(l,c);setShowPE(false);}} onClose={()=>setShowPE(false)}/>}

            <div style={{height:1,background:T.brdS,margin:"16px 0"}}/>

            <h4 style={sh}>Task Age Thresholds</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 12px",lineHeight:settingsType.line}}>Show age indicator after this many hours:</p>
            {ap.map(p => (
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,minHeight:40}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                <span style={{flex:1,fontSize:settingsType.body,fontFamily:"system-ui"}}>{p.label}</span>
                <input type="number" min="1" max="720"
                  value={ageThresholds[p.id] ?? DEF_AGE_THRESHOLDS[p.id] ?? 72}
                  onChange={e=>setAS(prev=>({...prev,ageThresholds:{...(prev.ageThresholds||DEF_AGE_THRESHOLDS),[p.id]:parseInt(e.target.value)||24}}))}
                  style={{width:76,minHeight:36,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none",textAlign:"right"}}
                />
                <span style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",width:24}}>h</span>
              </div>
            ))}

            <div style={{height:1,background:T.brdS,margin:"16px 0"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Overwhelm threshold</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Collapse queue above this count</p>
              </div>
              <select value={AS.overwhelmThreshold||7} onChange={e=>setAS(p=>({...p,overwhelmThreshold:parseInt(e.target.value)}))} style={{minHeight:40,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}>
                {[5,6,7,8,10,15,20].map(n=><option key={n} value={n}>{n} tasks</option>)}
              </select>
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Completion sound</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Chime + haptic when task done</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,completionSound:!p.completionSound}))} style={tog(AS.completionSound)}><div style={knob(AS.completionSound)}/></button>
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Legacy Complete UI</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Dedicated icon for completions without timestamps</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,legacyCompleteUI:!p.legacyCompleteUI}))} style={tog(AS.legacyCompleteUI)}><div style={knob(AS.legacyCompleteUI)}/></button>
            </div>
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {sTab === "schedule" && (
          <div>
            <h4 style={sh}>Mrs. W Time Windows</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 16px",lineHeight:settingsType.line}}>High-priority window (outside = lowest priority)</p>

            <div style={{marginBottom:12}}>
              <span style={{fontSize:settingsType.help,fontFamily:"system-ui",color:T.tSoft,display:"block",marginBottom:8}}>Mon–Thu:</span>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <input type="time" value={mrsWWindows.monThu.start}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,start:e.target.value}}}))}
                  style={{minHeight:40,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}/>
                <span style={{fontSize:settingsType.help,color:T.tFaint}}>to</span>
                <input type="time" value={mrsWWindows.monThu.end}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,end:e.target.value}}}))}
                  style={{minHeight:40,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}/>
              </div>
            </div>

            <div style={{marginBottom:20}}>
              <span style={{fontSize:settingsType.help,fontFamily:"system-ui",color:T.tSoft,display:"block",marginBottom:8}}>Friday:</span>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <input type="time" value={mrsWWindows.fri.start}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,start:e.target.value}}}))}
                  style={{minHeight:40,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}/>
                <span style={{fontSize:settingsType.help,color:T.tFaint}}>to</span>
                <input type="time" value={mrsWWindows.fri.end}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,end:e.target.value}}}))}
                  style={{minHeight:40,padding:"6px 10px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}/>
              </div>
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 14px"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Hourly auto-optimize</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Silent background reprioritize every hour</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,autoOptimize:!p.autoOptimize}))} style={tog(AS.autoOptimize)}><div style={knob(AS.autoOptimize)}/></button>
            </div>
          </div>
        )}

        {/* ── ACCOUNT TAB ── */}
        {sTab === "account" && (
          <div>
            <h4 style={sh}>AI Model</h4>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",fontWeight:500,display:"block",marginBottom:6}}>Gemini model</label>
              <select value={AS.aiModel||""} onChange={e=>setAS(p=>({...p,aiModel:e.target.value}))} style={{width:"100%",minHeight:42,padding:"8px 12px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:settingsType.control,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}>
                <option value="">Server default ({aiConfig?.model || aiConfig?.textModel || "auto"})</option>
                {geminiModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"8px 0 0",lineHeight:settingsType.line}}>Gateway: {settingsHasAI ? "online" : "not configured"}</p>
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
            <h4 style={{...sh, color:T.tSoft, margin:"0 0 10px"}}>Backup</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 12px",lineHeight:settingsType.line}}>
              Weekly backups save automatically. Set a folder and they'll appear there silently — no download prompt.
            </p>
            <button
              onClick={handleSetBackupFolder}
              disabled={backupFolderSetting}
              style={{width:"100%",minHeight:44,padding:"10px 14px",borderRadius:8,border:`1px solid ${T.brd}`,background:backupFolderSet?"rgba(80,180,100,0.08)":"none",color:backupFolderSet?"#4caf50":T.tSoft,fontSize:settingsType.control,fontWeight:500,cursor:"pointer",fontFamily:"system-ui",marginBottom:16}}
            >
              {backupFolderSetting ? "Opening…" : backupFolderSet ? "✓ Backup folder set — click to change" : "Set backup folder…"}
            </button>

            {onSignOut && (
              <>
                <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
                <button onClick={()=>{onClose();onSignOut();}} style={{width:"100%",minHeight:44,padding:"10px 14px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",color:T.tSoft,fontSize:settingsType.control,fontWeight:500,cursor:"pointer",fontFamily:"system-ui"}}>
                  Sign out
                </button>
              </>
            )}
          </div>
        )}

        {/* ── GOOGLE TAB ── */}
        {sTab === "google" && (
          <div>
            <h4 style={sh}>Google Calendar & Gmail</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 16px",lineHeight:settingsType.line}}>
              Shows today's calendar events and important unread emails on your launchpad. Requires a Google OAuth Client ID — takes ~5 minutes to set up.
            </p>
            <div style={{background:T.bgW,borderRadius:8,border:`1px solid ${T.brd}`,padding:"14px 16px",marginBottom:16}}>
              <p style={{fontSize:settingsType.help,fontWeight:500,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 10px"}}>One-time setup:</p>
              <ol style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,paddingLeft:18,lineHeight:1.8}}>
                <li>Go to <span style={{fontWeight:700}}>console.cloud.google.com</span> → select your project</li>
                <li>APIs & Services → Enable <span style={{fontWeight:700}}>Google Calendar API</span> + <span style={{fontWeight:700}}>Gmail API</span></li>
                <li>Credentials → Create → OAuth 2.0 Client ID → Web Application</li>
                <li>Add origins: <span style={{fontFamily:"monospace",background:T.card,padding:"1px 4px",borderRadius:3}}>https://onetaskfocuser.netlify.app</span></li>
                <li>Copy the Client ID and paste below</li>
              </ol>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",fontWeight:500,display:"block",marginBottom:6}}>OAuth 2.0 Client ID</label>
              <input
                value={AS.googleClientId||""}
                onChange={e=>setAS(p=>({...p,googleClientId:e.target.value.trim()}))}
                placeholder="1234567890-abc….apps.googleusercontent.com"
                style={{width:"100%",minHeight:42,padding:"8px 12px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"monospace",background:T.bgW,color:T.text,boxSizing:"border-box"}}
              />
              <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",marginTop:6,lineHeight:settingsType.line}}>Stored only in your account — never sent to any server.</p>
            </div>
            {AS.googleClientId && (
              <div style={{padding:"12px 14px",borderRadius:8,border:`1px solid #4CAF5040`,background:"rgba(76,175,80,0.06)",display:"flex",gap:10,alignItems:"center"}}>
                <span style={{fontSize:14}}>✓</span>
                <span style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",lineHeight:settingsType.line}}>Client ID saved. Go to your launchpad and tap <strong>Connect Google</strong> to authorize.</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}


export { SettingsModal };
