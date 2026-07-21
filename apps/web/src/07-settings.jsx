// === 07-settings.js ===

import React, { useState, useEffect } from 'react';
import { Store, aiGenSchemes, uid, DEF_AGE_THRESHOLDS, DEF_PRI, BEFORE_SHAVUOS_PRIORITY_ID, SCHEMES, ensureSchemeContrast } from './01-core.js';
import { PriEditor } from './04-components.jsx';
import { NC_TYPE, RADIUS, SP } from './08-app-split/ui-tokens.jsx';
import { ActionBtn, IconBtn, Switch, TextField, Slider } from './08-app-split/m3.jsx';

const NC_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

function SettingsModal({AS, setAS, T, ap, onClose, onSignOut,
  curEnergy, onSetEnergy, focusModeActive, onToggleFocusMode,
  effectiveCount, overwhelmThreshold, hasAI, aiConfig,
  deskPhoneThemeSync = true, deskPhoneOnline = false,
  onToggleDeskPhoneThemeSync, onRefreshDeskPhoneTheme, initialTab = "queue",
  sidebarW = 0}) {

  const [sTab, setSTab] = useState(initialTab || "queue");
  const [backupFolderInfo, setBackupFolderInfo] = useState({ available: false, set: false, name: "", permission: "unknown" });
  const [backupFolderSetting, setBackupFolderSetting] = useState(false);

  // Check on mount whether a backup folder handle is already stored
  React.useEffect(() => {
    Store.getBackupDirInfo().then(setBackupFolderInfo);
  }, []);

  async function handleSetBackupFolder() {
    setBackupFolderSetting(true);
    const ok = await Store.chooseBackupDir();
    const info = await Store.getBackupDirInfo();
    setBackupFolderInfo(ok ? info : { ...info, set: info.set || false });
    setBackupFolderSetting(false);
  }
  const [showPE, setShowPE] = useState(false);
  const [schemeGenLoading, setSchemeGenLoading] = useState(false);
  const [schemeGenErr, setSchemeGenErr] = useState("");
  const [deskPhoneSyncBusy, setDeskPhoneSyncBusy] = useState(false);
  const [deskPhoneSyncNote, setDeskPhoneSyncNote] = useState("");
  const pris = AS.priorities;

  // Gemini-only since the Firebase (Spark/Blaze) migration — OpenAI and Claude were dropped.
  // The live server catalog (aiConfig.catalog) overrides this; the fallback only shows if
  // app-config can't be fetched, so keep it in sync with the backend MODEL_CATALOG.
  const modelCatalog = aiConfig?.catalog || [
    {provider:"gemini", model:"gemini-3.1-pro-preview", label:"Gemini 3.1 Pro Preview", tier:"frontier"},
    {provider:"gemini", model:"gemini-3-flash-preview", label:"Gemini 3 Flash Preview", tier:"fast"},
    {provider:"gemini", model:"gemini-3.1-flash-lite", label:"Gemini 3.1 Flash-Lite", tier:"budget"},
  ];
  const selectedProvider = AS.aiProvider || aiConfig?.provider || aiConfig?.defaultProvider || "gemini";
  const selectedModel = AS.aiModel || aiConfig?.model || aiConfig?.textModel || "";
  const selectedModelKey = AS.aiModel ? `${selectedProvider}:${AS.aiModel}` : "";
  const availableProviders = aiConfig?.available || {};
  const selectedProviderOnline = !!availableProviders[selectedProvider] || !!hasAI;
  const geminiCredentialLanes = aiConfig?.credentialLanes?.gemini || [
    {id:"primary", label:"Gemini Primary", available:!!availableProviders.gemini},
  ];
  const selectedGeminiCredential = AS.aiGeminiCredential || aiConfig?.defaultGeminiCredential || "auto";
  const settingsAiOpts = AS ? {
    provider: selectedProvider,
    model: selectedModel,
    geminiCredential: selectedGeminiCredential,
    source: "server",
  } : null;
  const settingsHasAI = !!(hasAI || availableProviders.gemini || availableProviders.openai || availableProviders.claude);

  async function handleGenSchemes() {
    if (!settingsHasAI) { setSchemeGenErr("AI server is not configured."); return; }
    setSchemeGenLoading(true); setSchemeGenErr("");
    try {
      const existingSchemes = [...Object.values(SCHEMES), ...Object.values(AS.customSchemes || {})];
      const newSchemes = await aiGenSchemes(settingsAiOpts, {
        names: existingSchemes.map(s => s.name),
        bgColors: existingSchemes.map(s => s.bg).filter(Boolean),
      });
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
    if (id === "shaila" || id === BEFORE_SHAVUOS_PRIORITY_ID) return;
    if (ap.length <= 1) return;
    setAS(p => ({...p, priorities: p.priorities.map(x => x.id===id ? {...x, deleted:true} : x)}));
  };
  const renamePri = (id, label) => {
    const nextLabel = label.slice(0, 40);
    setAS(p => ({...p, priorities: p.priorities.map(x => x.id===id ? {...x, label: nextLabel} : x)}));
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
    {id:"features",   label:"Features"},
  ];

  const settingsType = {
    section: 13,
    body: 15,
    help: 13,
    control: 14,
    line: 1.55,
  };
  const sh = {fontSize:settingsType.section,fontWeight:500,color:T.tFaint,margin:"0 0 14px",fontFamily:NC_FONT_STACK,textTransform:"uppercase",letterSpacing:0};
  // Shared md-switch color vars — matches the old tog()'s on-color (first priority's
  // accent) so every toggle in Settings keeps the same "on" tint it always had.
  const switchVars = {
    '--md-switch-selected-track-color': ap[0]?.color || T.text,
    '--md-switch-selected-hover-track-color': ap[0]?.color || T.text,
    '--md-switch-selected-focus-track-color': ap[0]?.color || T.text,
    '--md-switch-selected-pressed-track-color': ap[0]?.color || T.text,
  };
  const rowSB = {display:"flex",alignItems:"center",justifyContent:"space-between",gap:SP.lg,marginBottom:18};
  // Per-scheme ActionBtn props (variant="tonal") — swatch pill keeps its own bg/border/
  // label color per color scheme, same values schemeButtonStyle used to compute.
  const schemeBtnProps = (id, scheme, hasDelete = false) => {
    scheme = ensureSchemeContrast(scheme);
    const active = AS.colorScheme === id;
    const bg = scheme.card || scheme.bg || "#FFFFFF";
    const accent = scheme.primary || scheme.brd || "#00796B";
    return {
      containerColor: active ? (scheme.tonal || scheme.bgW || bg) : bg,
      labelColor: scheme.text || T.text,
      height: 40,
      labelSize: settingsType.control,
      style: {
        border: `1px solid ${active ? accent : (scheme.brd || T.brd)}`,
        ...(hasDelete ? { '--md-filled-tonal-button-trailing-space': '34px' } : {}),
      },
    };
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:sTab==="appearance"?"rgba(0,0,0,0.08)":"rgba(0,0,0,0.32)",display:"flex",alignItems:"center",justifyContent:"flex-start",overflowY:"auto",paddingTop:24,paddingRight:24,paddingBottom:24,paddingLeft:Math.max(24,(sidebarW||0)+12),transition:"background 0.3s",fontFamily:NC_FONT_STACK}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:sTab==="appearance"?T.card+"f7":T.card,borderRadius:RADIUS.sm,border:`1px solid ${T.brdS || T.brd}`,padding:0,maxWidth:680,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:`0 12px 32px rgba(60,64,67,0.22)`,transition:"background 0.3s",fontFamily:NC_FONT_STACK}}>

        {/* Header + tab bar — full-width and sticky, so the title bar spans the whole
            card and stays put while the settings content scrolls (owner ticket pFQuwQVJ:
            "header bar is not long enough / streamline the panel"). */}
        <div style={{position:"sticky",top:0,zIndex:2,background:sTab==="appearance"?T.card+"f7":T.card,padding:"20px 26px 12px",borderBottom:`1px solid ${T.brdS || T.brd}`,transition:"background 0.3s"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{fontSize:22,fontWeight:500,margin:0,fontFamily:NC_FONT_STACK}}>Settings</h3>
            <IconBtn icon="close" iconSize={20} color={T.tSoft} onClick={onClose} title="Close" aria-label="Close settings" />
          </div>
          {/* Tabs scroll horizontally instead of squeezing — labels never truncate. */}
          <div style={{display:"flex",gap:6,background:T.bgW,borderRadius:RADIUS.sm,padding:SP.xs,overflowX:"auto"}}>
            {TABS.map(t => (
              <ActionBtn key={t.id} variant={sTab===t.id?"tonal":"text"} containerColor={T.card} labelColor={sTab===t.id?T.text:T.tSoft}
                height={40} labelSize={NC_TYPE.body} onClick={()=>setSTab(t.id)} style={{flex:"1 0 auto"}}>
                {t.label}
              </ActionBtn>
            ))}
          </div>
        </div>

        {/* Scrollable settings content */}
        <div style={{padding:"20px 26px 28px"}}>

        {/* ── QUEUE TAB ── */}
        {sTab === "queue" && (
          <div>
            <h4 style={sh}>Energy Filter</h4>
            <div style={{display:"flex",gap:6,marginBottom:18}}>
              {["high","low",null].map(e => {
                const brand = e==="high"?"#E07040":e==="low"?"#7EB0DE":T.brd;
                const labelColor = e==="high"?"#B85030":e==="low"?"#4A7898":T.tSoft;
                const active = curEnergy===e;
                return (
                  <ActionBtn key={String(e)} variant={active?"tonal":"outlined"} outlineColor={brand}
                    containerColor={active?`${brand}20`:T.bgW} labelColor={labelColor}
                    height={40} labelSize={settingsType.control} onClick={()=>onSetEnergy(e)} style={{flex:1}}>
                    {e==="high"?"⚡ High":e==="low"?"🌊 Low":"All"}
                  </ActionBtn>
                );
              })}
            </div>

            {effectiveCount > overwhelmThreshold && <>
              <div style={{height:1,background:T.brdS,margin:"10px 0 14px"}}/>
              <div style={rowSB}>
                <div>
                  <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Focus mode</span>
                  <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Show only top {overwhelmThreshold} tasks (queue has {effectiveCount})</p>
                </div>
                <Switch selected={focusModeActive} onChange={onToggleFocusMode} style={switchVars} />
              </div>
            </>}
          </div>
        )}

        {/* ── APPEARANCE TAB ── */}
        {sTab === "appearance" && (
          <div>
            <h4 style={sh}>Theme</h4>
            <div style={{display:"flex",flexWrap:"wrap",gap:SP.sm,marginBottom:10}}>
              {Object.entries(SCHEMES).map(([k,v]) => (
                <ActionBtn key={k} variant="tonal" {...schemeBtnProps(k, v)} onClick={()=>setAS(p=>({...p,colorScheme:k}))}>{v.name}</ActionBtn>
              ))}
              {Object.entries(AS.customSchemes || {}).map(([k,v]) => {
                return (
                <div key={k} style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                  <ActionBtn variant="tonal" {...schemeBtnProps(k, v, true)} onClick={()=>setAS(p=>({...p,colorScheme:k}))}>{v.name}</ActionBtn>
                  <IconBtn icon="close" iconSize={12} color={v.tSoft || T.tSoft}
                    onClick={e=>{e.stopPropagation();setAS(p=>{const c={...(p.customSchemes||{})};delete c[k];return {...p,customSchemes:c,colorScheme:p.colorScheme===k?"claude":p.colorScheme};});}}
                    style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",opacity:0.6}} title="Remove theme" aria-label="Remove theme" />
                </div>);
              })}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <ActionBtn variant="outlined" outlineColor={T.brd} labelColor={T.tSoft} height={40} labelSize={settingsType.control}
                onClick={handleGenSchemes} disabled={schemeGenLoading}>
                {schemeGenLoading ? "Generating…" : "✦ Generate more themes"}
              </ActionBtn>
              {Object.keys(AS.customSchemes || {}).length > 0 && (
                <ActionBtn variant="outlined" outlineColor={T.brd} labelColor={T.tSoft} height={40} labelSize={settingsType.control}
                  onClick={()=>{
                    const n = Object.keys(AS.customSchemes || {}).length;
                    if (!window.confirm(`Remove all ${n} generated theme${n===1?"":"s"}? Your 8 built-in themes stay, and you can generate more anytime.`)) return;
                    setAS(p=>({...p, customSchemes:{}, colorScheme: SCHEMES[p.colorScheme] ? p.colorScheme : "claude"}));
                  }}>
                  Clear generated ({Object.keys(AS.customSchemes || {}).length})
                </ActionBtn>
              )}
              {schemeGenErr && <span style={{fontSize:settingsType.help,color:T.danger,fontFamily:"system-ui",lineHeight:settingsType.line}}>{schemeGenErr}</span>}
            </div>
            <div style={{height:1,background:T.brdS,margin:"18px 0 14px"}}/>
            <h4 style={sh}>Readability</h4>
            <div style={{display:"grid",gap:SP.sm,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:SP.md}}>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text,fontWeight:500}}>Font weight</span>
                <span style={{fontSize:settingsType.help,fontFamily:"system-ui",color:T.tFaint}}>{AS.fontWeightScale || 400}</span>
              </div>
              <Slider min={340} max={520} step={20} value={AS.fontWeightScale || 400}
                onInput={e=>setAS(p=>({...p,fontWeightScale:Number(e.target.value)}))}
                style={{width:"100%", '--md-slider-handle-color':T.primary || T.text, '--md-slider-active-track-color':T.primary || T.text}}
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
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"4px 0 0",lineHeight:settingsType.line}}>When on, Shamash Pro 4 pushes its active color scheme to DeskPhone. DeskPhone must also allow this in its Appearance settings.</p>
              </div>
              <Switch selected={deskPhoneThemeSync} onChange={onToggleDeskPhoneThemeSync} title={deskPhoneThemeSync ? "DeskPhone theme sync is on" : "DeskPhone theme sync is off"} style={switchVars} />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:SP.sm,flexWrap:"wrap"}}>
              <ActionBtn variant="tonal" containerColor={T.bgW} labelColor={T.tSoft} height={40} labelSize={settingsType.control}
                onClick={handleDeskPhoneThemeRefresh} disabled={!deskPhoneThemeSync || deskPhoneSyncBusy} style={{border:`1px solid ${T.brd}`}}>
                {deskPhoneSyncBusy ? "Refreshing..." : "Refresh sync"}
              </ActionBtn>
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
            <div style={{display:"flex",flexWrap:"wrap",gap:SP.sm,marginBottom:12}}>
              {ap.map(p => (
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:6,background:T.bgW,borderRadius:RADIUS.sm,padding:"6px 10px"}}>
                  <div style={{width:14,height:14,borderRadius:"50%",background:p.color}}/>
                  {p.id === BEFORE_SHAVUOS_PRIORITY_ID ? (
                    <TextField value={p.label || "Before Shavuos"} aria-label="Before Shavuos category title"
                      onInput={e=>renamePri(p.id, e.target.value)}
                      onBlur={e=>{ if (!e.target.value.trim()) renamePri(p.id, "Before Shavuos"); }}
                      style={{width:150, '--md-outlined-text-field-outline-color':`${p.color}66`, '--md-outlined-text-field-top-space':'2px', '--md-outlined-text-field-bottom-space':'2px'}}
                    />
                  ) : (
                    <span style={{fontSize:settingsType.body,fontFamily:"system-ui"}}>{p.label}{p.isShaila?" ⚡":""}</span>
                  )}
                  {p.id !== "shaila" && p.id !== BEFORE_SHAVUOS_PRIORITY_ID && ap.length > 1 && <IconBtn icon="close" iconSize={12} color={T.tFaint} onClick={()=>remPri(p.id)} title="Remove priority" aria-label="Remove priority" />}
                </div>
              ))}
            </div>
            <ActionBtn variant="outlined" icon="add" iconSize={14} outlineColor={T.brd} labelColor={T.tSoft} height={40} labelSize={settingsType.control}
              onClick={()=>setShowPE(true)} style={{marginBottom:4}}>Add Priority</ActionBtn>
            {showPE && <PriEditor T={T} onAdd={(l,c)=>{addPri(l,c);setShowPE(false);}} onClose={()=>setShowPE(false)}/>}

            <div style={{height:1,background:T.brdS,margin:"16px 0"}}/>

            <h4 style={sh}>Task Age Thresholds</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 12px",lineHeight:settingsType.line}}>Show age indicator after this many hours:</p>
            {ap.map(p => (
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:SP.md,marginBottom:10,minHeight:40}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                <span style={{flex:1,fontSize:settingsType.body,fontFamily:"system-ui"}}>{p.label}</span>
                <TextField type="number" min={1} max={720}
                  value={ageThresholds[p.id] ?? DEF_AGE_THRESHOLDS[p.id] ?? 72}
                  onInput={e=>setAS(prev=>({...prev,ageThresholds:{...(prev.ageThresholds||DEF_AGE_THRESHOLDS),[p.id]:parseInt(e.target.value)||24}}))}
                  style={{width:76, textAlign:'right', '--md-outlined-text-field-top-space':'6px', '--md-outlined-text-field-bottom-space':'6px'}}
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
              <select value={AS.overwhelmThreshold||7} onChange={e=>setAS(p=>({...p,overwhelmThreshold:parseInt(e.target.value)}))} style={{minHeight:40,padding:"6px 10px",borderRadius:RADIUS.sm,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:settingsType.control,fontFamily:"system-ui",outline:"none"}}>
                {[5,6,7,8,10,15,20].map(n=><option key={n} value={n}>{n} tasks</option>)}
              </select>
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Completion sound</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Chime + haptic when task done</p>
              </div>
              <Switch selected={!!AS.completionSound} onChange={()=>setAS(p=>({...p,completionSound:!p.completionSound}))} style={switchVars} />
            </div>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Legacy Complete UI</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Dedicated icon for completions without timestamps</p>
              </div>
              <Switch selected={!!AS.legacyCompleteUI} onChange={()=>setAS(p=>({...p,legacyCompleteUI:!p.legacyCompleteUI}))} style={switchVars} />
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
                <TextField type="time" value={mrsWWindows.monThu.start}
                  onInput={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,start:e.target.value}}}))}
                  style={{'--md-outlined-text-field-top-space':'6px', '--md-outlined-text-field-bottom-space':'6px'}}/>
                <span style={{fontSize:settingsType.help,color:T.tFaint}}>to</span>
                <TextField type="time" value={mrsWWindows.monThu.end}
                  onInput={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,monThu:{...mrsWWindows.monThu,end:e.target.value}}}))}
                  style={{'--md-outlined-text-field-top-space':'6px', '--md-outlined-text-field-bottom-space':'6px'}}/>
              </div>
            </div>

            <div style={{marginBottom:20}}>
              <span style={{fontSize:settingsType.help,fontFamily:"system-ui",color:T.tSoft,display:"block",marginBottom:8}}>Friday:</span>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <TextField type="time" value={mrsWWindows.fri.start}
                  onInput={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,start:e.target.value}}}))}
                  style={{'--md-outlined-text-field-top-space':'6px', '--md-outlined-text-field-bottom-space':'6px'}}/>
                <span style={{fontSize:settingsType.help,color:T.tFaint}}>to</span>
                <TextField type="time" value={mrsWWindows.fri.end}
                  onInput={e=>setAS(p=>({...p,mrsWWindows:{...mrsWWindows,fri:{...mrsWWindows.fri,end:e.target.value}}}))}
                  style={{'--md-outlined-text-field-top-space':'6px', '--md-outlined-text-field-bottom-space':'6px'}}/>
              </div>
            </div>
          </div>
        )}

        {/* ── ACCOUNT TAB ── */}
        {sTab === "account" && (
          <div>
            <h4 style={sh}>AI Model</h4>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",fontWeight:500,display:"block",marginBottom:6}}>Model</label>
              <select
                value={selectedModelKey}
                onChange={e=>{
                  const [provider, model] = e.target.value.split(":");
                  setAS(p=>({...p,aiProvider:provider || "",aiModel:model || ""}));
                }}
                style={{width:"100%",minHeight:42,padding:"8px 12px",borderRadius:RADIUS.sm,border:`1px solid ${T.brd}`,outline:"none",fontSize:settingsType.control,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}
              >
                <option value="">Server default ({aiConfig?.provider || "auto"} / {aiConfig?.model || aiConfig?.textModel || "auto"})</option>
                {["frontier","fast","budget"].map(tier => (
                  <optgroup key={tier} label={tier === "frontier" ? "Most capable" : tier === "fast" ? "Faster / cheaper" : "Lowest cost"}>
                    {modelCatalog.filter(m => m.tier === tier).map(m => {
                      const online = !!availableProviders[m.provider];
                      return <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                        {m.label} ({m.provider}{online ? "" : " key missing"})
                      </option>;
                    })}
                  </optgroup>
                ))}
              </select>
              <p style={{fontSize:settingsType.help,color:selectedProviderOnline?T.tFaint:T.danger,fontFamily:"system-ui",margin:"8px 0 0",lineHeight:settingsType.line}}>
                Gateway: {settingsHasAI ? `${selectedProvider} ${selectedProviderOnline ? "online" : "key missing"}` : "not configured"}
              </p>
            </div>
            {selectedProvider === "gemini" && (
              <div style={{marginBottom:16}}>
                <label style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",fontWeight:500,display:"block",marginBottom:6}}>Gemini key lane</label>
                <select
                  value={selectedGeminiCredential}
                  onChange={e=>setAS(p=>({...p,aiGeminiCredential:e.target.value}))}
                  style={{width:"100%",minHeight:42,padding:"8px 12px",borderRadius:RADIUS.sm,border:`1px solid ${T.brd}`,outline:"none",fontSize:settingsType.control,fontFamily:"system-ui",background:T.bgW,color:T.text,boxSizing:"border-box"}}
                >
                  <option value="auto">Auto failover</option>
                  {geminiCredentialLanes.map(lane => (
                    <option key={lane.id} value={lane.id}>
                      {lane.label}{lane.available ? "" : " key missing"}
                    </option>
                  ))}
                </select>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"8px 0 0",lineHeight:settingsType.line}}>
                  Daily quota failover uses the next available Gemini lane.
                </p>
              </div>
            )}

            <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
            <h4 style={{...sh, color:T.tSoft, margin:"0 0 10px"}}>Backup</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 12px",lineHeight:settingsType.line}}>
              Auto-backups save weekly to your selected folder. Without a folder, reloads use cloud/local recovery and do not create Downloads files.
            </p>
            <ActionBtn variant="outlined" outlineColor={backupFolderInfo.set ? "#4caf50" : T.brd}
              labelColor={backupFolderInfo.set ? "#4caf50" : T.tSoft}
              height={44} labelSize={settingsType.control}
              onClick={handleSetBackupFolder}
              disabled={backupFolderSetting || !backupFolderInfo.available}
              style={{width:"100%",marginBottom:8,opacity:backupFolderInfo.available?1:.6}}
            >
              {backupFolderSetting
                ? "Opening..."
                : backupFolderInfo.set
                  ? `Backup folder: ${backupFolderInfo.name || "selected"}`
                  : backupFolderInfo.available
                    ? "Choose backup folder..."
                    : "Folder backup unavailable in this browser"}
            </ActionBtn>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 16px",lineHeight:settingsType.line}}>
              {backupFolderInfo.set
                ? (backupFolderInfo.permission === "granted" ? "Automatic weekly backups can write there silently." : "Chrome/Edge may ask once before writing there again.")
                : "Manual Backup still asks where to save."}
            </p>

            {onSignOut && (
              <>
                <div style={{height:1,background:T.brdS,margin:"0 0 16px"}}/>
                {/* Switch account: signs out, so the next Google sign-in shows the
                    account picker (prompt=select_account) — the graceful way to
                    move between the rabbi and secondary Google accounts. */}
                <ActionBtn variant="outlined" outlineColor={T.brd} labelColor={T.text} height={44} labelSize={settingsType.control}
                  onClick={()=>{onClose();onSignOut();}} style={{width:"100%",marginBottom:10,'--md-outlined-button-label-text-weight':'600'}}>
                  Switch Google account…
                </ActionBtn>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 16px",lineHeight:settingsType.line}}>
                  Signs out here and returns to the sign-in screen, where you can pick a different Google account.
                </p>
                <ActionBtn variant="outlined" outlineColor={T.brd} labelColor={T.tSoft} height={44} labelSize={settingsType.control}
                  onClick={()=>{onClose();onSignOut();}} style={{width:"100%"}}>
                  Sign out
                </ActionBtn>
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
            <div style={{background:T.bgW,borderRadius:RADIUS.sm,border:`1px solid ${T.brd}`,padding:"14px 16px",marginBottom:16}}>
              <p style={{fontSize:settingsType.help,fontWeight:500,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 10px"}}>One-time setup:</p>
              <ol style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,paddingLeft:18,lineHeight:1.8}}>
                <li>Go to <span style={{fontWeight:700}}>console.cloud.google.com</span> → select your project</li>
                <li>APIs & Services → Enable <span style={{fontWeight:700}}>Google Calendar API</span> + <span style={{fontWeight:700}}>Gmail API</span></li>
                <li>Credentials → Create → OAuth 2.0 Client ID → Web Application</li>
                <li>Add origins: <span style={{fontFamily:"monospace",background:T.card,padding:"1px 4px",borderRadius:3}}>https://onetaskonly-app.firebaseapp.com</span></li>
                <li>Copy the Client ID and paste below</li>
              </ol>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",fontWeight:500,display:"block",marginBottom:6}}>OAuth 2.0 Client ID</label>
              <TextField
                value={AS.googleClientId||""}
                onInput={e=>setAS(p=>({...p,googleClientId:e.target.value.trim()}))}
                placeholder="1234567890-abc….apps.googleusercontent.com"
                style={{width:"100%", '--md-outlined-text-field-input-text-font':"monospace", '--md-outlined-text-field-input-text-size':`${NC_TYPE.meta}px`}}
              />
              <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",marginTop:6,lineHeight:settingsType.line}}>Stored only in your account — never sent to any server.</p>
            </div>
            {AS.googleClientId && (
              <div style={{padding:"12px 14px",borderRadius:RADIUS.sm,border:`1px solid #4CAF5040`,background:"rgba(76,175,80,0.06)",display:"flex",gap:10,alignItems:"center"}}>
                <span style={{fontSize:NC_TYPE.body}}>✓</span>
                <span style={{fontSize:settingsType.help,color:T.tSoft,fontFamily:"system-ui",lineHeight:settingsType.line}}>Client ID saved. Go to your launchpad and tap <strong>Connect Google</strong> to authorize.</span>
              </div>
            )}
          </div>
        )}

        {/* ── FEATURES TAB ── */}
        {sTab === "features" && (
          <div>
            <h4 style={sh}>Experimental Features</h4>
            <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 20px",lineHeight:settingsType.line}}>
              These features are paused or experimental. Toggle them on to re-enable.
            </p>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>AI move-up popup</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>When AI suggests moving a task above your pinned items, show a confirmation dialog</p>
              </div>
              <Switch selected={AS.features?.moveUpPopup===true} onChange={()=>setAS(p=>{const ft=p.features||{};return{...p,features:{...ft,moveUpPopup:!ft.moveUpPopup}};})} style={switchVars} />
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 18px"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Chief of Staff</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>AI-powered chief of staff — shows in the sidebar under Experimental</p>
              </div>
              <Switch selected={AS.features?.chief===true} onChange={()=>setAS(p=>{const ft=p.features||{};return{...p,features:{...ft,chief:!ft.chief}};})} style={switchVars} />
            </div>

            <div style={{height:1,background:T.brdS,margin:"0 0 18px"}}/>

            <div style={rowSB}>
              <div>
                <span style={{fontSize:settingsType.body,fontFamily:"system-ui",color:T.text}}>Health</span>
                <p style={{fontSize:settingsType.help,color:T.tFaint,fontFamily:"system-ui",margin:0,lineHeight:settingsType.line}}>Health tracking and wellness features — shows in the sidebar under Experimental</p>
              </div>
              <Switch selected={AS.features?.health===true} onChange={()=>setAS(p=>{const ft=p.features||{};return{...p,features:{...ft,health:!ft.health}};})} style={switchVars} />
            </div>
          </div>
        )}

        </div>{/* end scrollable settings content */}
      </div>
    </div>
  );
}


export { SettingsModal };
