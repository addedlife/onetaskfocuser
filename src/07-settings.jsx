// === 07-settings.js ===

import React, { useState, useEffect } from 'react';
import { Store, aiGenSchemes, uid, DEF_AGE_THRESHOLDS, DEF_PRI, SCHEMES } from './01-core.js';
import { IC } from './02-icons.jsx';
import { PriEditor } from './04-components.jsx';

function SettingsModal({AS, setAS, T, ap, onClose, onSignOut,
  onOptimize, optLoading, onBulkAdd, onShatter, onDedup,
  curEnergy, onSetEnergy, focusModeActive, onToggleFocusMode,
  effectiveCount, overwhelmThreshold, hasAI}) {

  const [sTab, setSTab] = useState("queue");
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
  const pris = AS.priorities;

  const settingsAiOpts = AS ? {provider: AS.aiProvider || 'gemini', geminiKey: AS.geminiKey, claudeKey: AS.claudeApiKey} : null;
  const settingsHasAI = settingsAiOpts && (settingsAiOpts.provider === 'claude' ? !!settingsAiOpts.claudeKey : !!settingsAiOpts.geminiKey);

  async function handleGenSchemes() {
    if (!settingsHasAI) { setSchemeGenErr("Add an API key in the Account tab first."); return; }
    setSchemeGenLoading(true); setSchemeGenErr("");
    try {
      const existing = [
        ...Object.values(SCHEMES).map(s => s.name),
        ...Object.values(AS.customSchemes || {}).map(s => s.name),
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
  ];

  const sh = {fontSize:11,fontWeight:700,color:T.tFaint,margin:"0 0 10px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1};
  const tog = (on) => ({width:44,height:24,borderRadius:12,background:on?ap[0]?.color:T.brd,border:"none",cursor:"pointer",position:"relative",flexShrink:0});
  const knob = (on) => ({width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:on?23:3,transition:"left 0.25s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"});
  const rowSB = {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14};
  const actionBtn = {width:"100%",padding:"10px 14px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:8,marginBottom:8};

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:sTab==="appearance"?"rgba(0,0,0,0.08)":"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",overflowY:"auto",padding:20,transition:"background 0.3s"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:sTab==="appearance"?T.card+"ee":T.card,borderRadius:22,padding:"24px 20px",maxWidth:460,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:`0 6px 24px rgba(0,0,0,0.15)`,transition:"background 0.3s"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h3 style={{fontSize:16,fontWeight:600,margin:0}}>Settings</h3>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft}}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{display:"flex",gap:3,background:T.bgW,borderRadius:12,padding:3,marginBottom:20}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setSTab(t.id)} style={{flex:1,padding:"6px 4px",borderRadius:9,border:"none",background:sTab===t.id?T.card:"transparent",cursor:"pointer",fontSize:10,fontWeight:sTab===t.id?700:400,fontFamily:"system-ui",color:sTab===t.id?T.text:T.tSoft,transition:"background 0.15s",boxShadow:sTab===t.id?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
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
                <button key={String(e)} onClick={()=>onSetEnergy(e)} style={{flex:1,padding:"7px 0",borderRadius:9,border:`1px solid ${e==="high"?"#E07040":e==="low"?"#7EB0DE":T.brd}`,background:curEnergy===e?(e==="high"?"#E0704020":e==="low"?"#7EB0DE20":T.bgW):T.bgW,cursor:"pointer",fontSize:11,fontFamily:"system-ui",fontWeight:curEnergy===e?700:400,color:e==="high"?"#B85030":e==="low"?"#4A7898":T.tSoft}}>
                  {e==="high"?"⚡ High":e==="low"?"🌊 Low":"All"}
                </button>
              ))}
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 18px"}}/>
            <h4 style={sh}>Queue Actions</h4>

            <button onClick={()=>{onOptimize();onClose();}} disabled={optLoading} style={{...actionBtn,opacity:optLoading?0.5:1}}>
              <IC.Sparkle s={13} c={T.tSoft}/>{optLoading?"Optimizing…":"Optimize order"}{hasAI&&!optLoading&&<span style={{fontSize:10,opacity:.5,marginLeft:2}}>AI</span>}
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
                  <span style={{fontSize:12,fontFamily:"system-ui",color:T.text}}>Focus mode</span>
                  <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>Show only top {overwhelmThreshold} tasks (queue has {effectiveCount})</p>
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
              {Object.entries(SCHEMES).map(([k,v]) => {
                // Auto-contrast: pick white or dark text based on gradient luminance
                const hex = v.grad?.[0] || v.bg || "#888";
                const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
                const lum = (r*299+g*587+b*114)/1000;
                const btnText = lum < 140 ? "#F0F0F0" : "#2A2A2A";
                const brdC = AS.colorScheme===k ? btnText : (lum<140?"#ffffff30":"#00000020");
                return <button key={k} onClick={()=>setAS(p=>({...p,colorScheme:k}))} style={{padding:"8px 14px",borderRadius:10,border:`2px solid ${brdC}`,background:`linear-gradient(135deg,${v.grad[0]},${v.grad[2]})`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"system-ui",color:btnText,textShadow:lum<140?"0 1px 3px rgba(0,0,0,0.5)":"none"}}>{v.name}</button>;
              })}
              {Object.entries(AS.customSchemes || {}).map(([k,v]) => {
                const hex = v.grad?.[0] || v.bg || "#888";
                const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
                const lum = (r*299+g*587+b*114)/1000;
                const btnText = lum < 140 ? "#F0F0F0" : "#2A2A2A";
                const brdC = AS.colorScheme===k ? btnText : (lum<140?"#ffffff30":"#00000020");
                return (
                <div key={k} style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                  <button onClick={()=>setAS(p=>({...p,colorScheme:k}))} style={{padding:"8px 14px",borderRadius:10,border:`2px solid ${brdC}`,background:`linear-gradient(135deg,${v.grad[0]},${v.grad[2]})`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"system-ui",color:btnText,textShadow:lum<140?"0 1px 3px rgba(0,0,0,0.5)":"none",paddingRight:28}}>{v.name}</button>
                  <button onClick={e=>{e.stopPropagation();setAS(p=>{const c={...(p.customSchemes||{})};delete c[k];return {...p,customSchemes:c,colorScheme:p.colorScheme===k?"claude":p.colorScheme};});}} style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:12,color:btnText,lineHeight:1,padding:0,opacity:0.6}}>✕</button>
                </div>);
              })}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={handleGenSchemes} disabled={schemeGenLoading} style={{fontSize:11,color:T.tSoft,background:"none",border:`1px dashed ${T.brd}`,borderRadius:8,padding:"6px 14px",cursor:schemeGenLoading?"default":"pointer",fontFamily:"system-ui",opacity:schemeGenLoading?0.6:1}}>
                {schemeGenLoading ? "Generating…" : "✦ Generate more themes"}
              </button>
              {schemeGenErr && <span style={{fontSize:10,color:"#C94040",fontFamily:"system-ui"}}>{schemeGenErr}</span>}
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
                  <span style={{fontSize:12,fontFamily:"system-ui"}}>{p.label}{p.isShaila?" ⚡":""}</span>
                  {p.id !== "shaila" && ap.length > 1 && <button onClick={()=>remPri(p.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:T.tFaint}}>✕</button>}
                </div>
              ))}
            </div>
            <button onClick={()=>setShowPE(true)} style={{fontSize:12,color:T.tSoft,background:"none",border:`1px dashed ${T.brd}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"system-ui",marginBottom:4}}>+ Add Priority</button>
            {showPE && <PriEditor T={T} onAdd={(l,c)=>{addPri(l,c);setShowPE(false);}} onClose={()=>setShowPE(false)}/>}

            <div style={{height:1,background:T.brdS,margin:"16px 0"}}/>

            <h4 style={sh}>Task Age Thresholds</h4>
            <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 10px"}}>Show age indicator after this many hours:</p>
            {ap.map(p => (
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                <span style={{flex:1,fontSize:12,fontFamily:"system-ui"}}>{p.label}</span>
                <input type="number" min="1" max="720"
                  value={ageThresholds[p.id] ?? DEF_AGE_THRESHOLDS[p.id] ?? 72}
                  onChange={e=>setAS(prev=>({...prev,ageThresholds:{...(prev.ageThresholds||DEF_AGE_THRESHOLDS),[p.id]:parseInt(e.target.value)||24}}))}
                  style={{width:70,padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none",textAlign:"right"}}
                />
                <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",width:20}}>h</span>
              </div>
            ))}

            <div style={{height:1,background:T.brdS,margin:"16px 0"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:12,fontFamily:"system-ui",color:T.text}}>Overwhelm threshold</span>
                <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>Collapse queue above this count</p>
              </div>
              <select value={AS.overwhelmThreshold||7} onChange={e=>setAS(p=>({...p,overwhelmThreshold:parseInt(e.target.value)}))} style={{padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none"}}>
                {[5,6,7,8,10,15,20].map(n=><option key={n} value={n}>{n} tasks</option>)}
              </select>
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:12,fontFamily:"system-ui",color:T.text}}>Completion sound</span>
                <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>Chime + haptic when task done</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,completionSound:!p.completionSound}))} style={tog(AS.completionSound)}><div style={knob(AS.completionSound)}/></button>
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:12,fontFamily:"system-ui",color:T.text}}>Legacy Complete UI</span>
                <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>Dedicated icon for completions without timestamps</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,legacyCompleteUI:!p.legacyCompleteUI}))} style={tog(AS.legacyCompleteUI)}><div style={knob(AS.legacyCompleteUI)}/></button>
            </div>
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {sTab === "schedule" && (
          <div>
            <h4 style={sh}>Mrs. W Time Windows</h4>
            <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 14px"}}>High-priority window (outside = lowest priority)</p>

            <div style={{marginBottom:12}}>
              <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft,display:"block",marginBottom:6}}>Mon–Thu:</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="time" value={mrsWWindows.monThu.start}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,start:e.target.value}}}))}
                  style={{padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none"}}/>
                <span style={{fontSize:11,color:T.tFaint}}>to</span>
                <input type="time" value={mrsWWindows.monThu.end}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,end:e.target.value}}}))}
                  style={{padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none"}}/>
              </div>
            </div>

            <div style={{marginBottom:20}}>
              <span style={{fontSize:11,fontFamily:"system-ui",color:T.tSoft,display:"block",marginBottom:6}}>Friday:</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="time" value={mrsWWindows.fri.start}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,start:e.target.value}}}))}
                  style={{padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none"}}/>
                <span style={{fontSize:11,color:T.tFaint}}>to</span>
                <input type="time" value={mrsWWindows.fri.end}
                  onChange={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,end:e.target.value}}}))}
                  style={{padding:"4px 8px",borderRadius:7,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:12,fontFamily:"system-ui",outline:"none"}}/>
              </div>
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 14px"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:12,fontFamily:"system-ui",color:T.text}}>Hourly auto-optimize</span>
                <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>Silent background reprioritize every hour</p>
              </div>
              <button onClick={()=>setAS(p=>({...p,autoOptimize:!p.autoOptimize}))} style={tog(AS.autoOptimize)}><div style={knob(AS.autoOptimize)}/></button>
            </div>
          </div>
        )}

        {/* ── ACCOUNT TAB ── */}
        {sTab === "account" && (
          <div>
            <h4 style={sh}>AI Provider</h4>
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",gap:6,marginBottom:12}}>
                {["gemini","claude"].map(prov => (
                  <button key={prov} onClick={()=>setAS(p=>({...p,aiProvider:prov}))} style={{flex:1,padding:"8px 0",borderRadius:9,border:`1px solid ${(AS.aiProvider||"gemini")===prov?ap[0]?.color||T.text:T.brd}`,background:(AS.aiProvider||"gemini")===prov?(ap[0]?.color||T.text)+"18":"transparent",cursor:"pointer",fontSize:11,fontFamily:"system-ui",fontWeight:(AS.aiProvider||"gemini")===prov?700:400,color:(AS.aiProvider||"gemini")===prov?T.text:T.tSoft,transition:"all 0.15s"}}>
                    {prov==="gemini"?"✦ Gemini":"◆ Claude"}
                  </button>
                ))}
              </div>
              <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",margin:0}}>All AI features (optimize, breakdown, insights, chat) use the selected provider.</p>
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
            <h4 style={sh}>API Keys</h4>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui",fontWeight:600,display:"block",marginBottom:4}}>Gemini API Key</label>
              <input value={AS.geminiKey||""} onChange={e=>setAS(p=>({...p,geminiKey:e.target.value}))} placeholder="AIza…" type="password" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:12,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}/>
              <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",marginTop:4}}>For AI task breakdown, smart optimize, and voice transcription. From Google AI Studio.</p>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui",fontWeight:600,display:"block",marginBottom:4}}>Claude API Key</label>
              <input value={AS.claudeApiKey||""} onChange={e=>setAS(p=>({...p,claudeApiKey:e.target.value}))} placeholder="sk-ant-…" type="password" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:12,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}/>
              <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",marginTop:4}}>Alternative AI provider. Calls are proxied through a serverless function. From console.anthropic.com.</p>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui",fontWeight:600,display:"block",marginBottom:4}}>Soferai API Key</label>
              <input value={AS.soferaiKey||""} onChange={e=>setAS(p=>({...p,soferaiKey:e.target.value}))} placeholder="sk-soferai-…" type="password" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:12,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}/>
              <p style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",marginTop:4}}>For Hebrew/Yiddish transcription via Soferai.</p>
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
            <h4 style={{fontSize:11,fontWeight:700,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 8px",textTransform:"uppercase",letterSpacing:1}}>Backup</h4>
            <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 10px",lineHeight:1.5}}>
              Weekly backups save automatically. Set a folder and they'll appear there silently — no download prompt.
            </p>
            <button
              onClick={handleSetBackupFolder}
              disabled={backupFolderSetting}
              style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${T.brd}`,background:backupFolderSet?"rgba(80,180,100,0.08)":"none",color:backupFolderSet?"#4caf50":T.tSoft,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"system-ui",marginBottom:16}}
            >
              {backupFolderSetting ? "Opening…" : backupFolderSet ? "✓ Backup folder set — click to change" : "Set backup folder…"}
            </button>

            {onSignOut && (
              <>
                <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
                <button onClick={()=>{onClose();onSignOut();}} style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${T.brd}`,background:"none",color:T.tSoft,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"system-ui"}}>
                  Sign out
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}


export { SettingsModal };