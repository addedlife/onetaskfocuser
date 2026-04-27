// === 05-modals.js ===

import React, { useState, useRef } from 'react';
import { uid, callGeminiAudio, callAI, textOnColor, gP, pBg } from './01-core.js';
import { IC } from './02-icons.jsx';
import { CTX_TAG_COLORS } from './04-components.jsx';
import { webmToWavBase64 } from './03-voice.jsx';

const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

function BulkAdd({pris, T, onAddAll, onClose}) {
  const ap = pris.filter(p => !p.deleted);
  const defPri = pris.find(p => p.id === "today" && !p.deleted)?.id || ap[2]?.id || ap[0]?.id;
  const [rows, setRows] = useState([{id:uid(), pri:defPri, text:""}]);
  const [pm, setPm] = useState(false);
  const [pt, setPt] = useState("");

  const addRow = () => setRows(r => [...r, {id:uid(), pri:defPri, text:""}]);

  // B9 fix: match by priority label (case-insensitive) not hardcoded names
  const handlePaste = () => {
    const txt = pt.trim();
    let lines;
    if (txt.includes('\n')) {
      lines = txt.split('\n').map(l => l.replace(/^\s*(?:\d+[.)]\s*|[•\-\*]\s*)/, '').trim()).filter(Boolean);
    } else {
      const byNum = txt.split(/\d+[.)]\s+/).map(s=>s.trim()).filter(Boolean);
      const byBullet = txt.split(/[•\-\*]\s+/).map(s=>s.trim()).filter(Boolean);
      const bySep = txt.split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
      if (byNum.length > 1) lines = byNum;
      else if (byBullet.length > 1) lines = byBullet;
      else if (bySep.length > 1) lines = bySep;
      else lines = [txt];
    }
    const nr = lines.map(line => {
      // Try "PriorityName: task" or "PriorityName - task"
      const m = line.match(/^([^:\-]+)[:\-]+\s*(.+)/);
      if (m) {
        const priLabel = m[1].trim().toLowerCase();
        const p = ap.find(p => p.label.toLowerCase() === priLabel);
        if (p) return {id:uid(), pri:p.id, text:m[2].trim()};
      }
      return {id:uid(), pri:defPri, text:line.trim()};
    });
    setRows(r => [...r.filter(x => x.text.trim()), ...nr]);
    setPm(false); setPt("");
  };

  const sub = () => {
    const v = rows.filter(r => r.text.trim());
    if (!v.length) return;
    onAddAll(v.map(r => ({text: r.text.trim(), priority: r.pri})));
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s",overflowY:"auto",padding:20}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"24px 20px",maxWidth:520,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 12px 48px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,margin:0}}>Bulk Add Tasks</h3><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft}}>✕</button></div>
        {pm ? (
          <div style={{marginBottom:16}}>
            <p style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 8px"}}>Paste a list — newlines, numbered, bullets, or comma-separated. Optional: "Priority: task"</p>
            <textarea value={pt} onChange={e=>setPt(e.target.value)} rows={8} placeholder={"Now: Review contract\nShaila: Bishul akum\nToday: Call plumber"} style={{width:"100%",padding:12,borderRadius:10,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"system-ui",background:T.bgW,color:T.text,resize:"vertical"}}/>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>setPm(false)} style={{flex:1,padding:10,borderRadius:10,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.tSoft}}>Cancel</button>
              <button onClick={handlePaste} style={{flex:1,padding:10,borderRadius:10,border:"none",background:ap[0]?.color,color:textOnColor(ap[0]?.color||"#5A9E7C"),cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui"}}>Parse</button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setPm(true)} style={{width:"100%",padding:10,borderRadius:10,border:`1px dashed ${T.brd}`,background:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.tSoft,marginBottom:12}}>Paste a list</button>
        )}
        <div style={{display:"grid",gridTemplateColumns:"auto 1fr 32px",gap:"6px 8px",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",fontWeight:700}}>Pri</span><span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",fontWeight:700}}>Task</span><span/>
          {rows.map(row => (
            <React.Fragment key={row.id}>
              <select value={row.pri} onChange={e=>setRows(r=>r.map(x=>x.id===row.id?{...x,pri:e.target.value}:x))} style={{padding:"7px 4px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:11,fontFamily:"system-ui",outline:"none"}}>
                {ap.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={row.text} onChange={e=>setRows(r=>r.map(x=>x.id===row.id?{...x,text:e.target.value}:x))} placeholder="Task..." style={{padding:"8px 10px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"Georgia,serif",background:T.bgW,color:T.text}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addRow();}}}/>
              <button onClick={()=>setRows(r=>r.filter(x=>x.id!==row.id))} style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.4}}><IC.Trash s={12} c={T.tFaint}/></button>
            </React.Fragment>
          ))}
        </div>
        <button onClick={addRow} style={{width:"100%",padding:8,borderRadius:10,border:`1px dashed ${T.brd}`,background:"transparent",cursor:"pointer",fontSize:12,color:T.tSoft,fontFamily:"system-ui",marginBottom:16}}>+ Add row</button>
        <button onClick={sub} style={{width:"100%",padding:13,borderRadius:14,border:"none",background:ap[0]?.color,color:textOnColor(ap[0]?.color||"#5A9E7C"),cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"system-ui"}}>Add {rows.filter(r=>r.text.trim()).length} Tasks</button>
      </div>
    </div>
  );
}

function TaskBD({task, pris, T, onConfirm, onClose, aiOpts}) {
  const [inp, setInp] = useState(task ? task.text : "");
  const [subs, setSubs] = useState([]);
  const [ld, setLd] = useState(false);
  const [cm, setCm] = useState("");
  const [ch, setCh] = useState([]);
  const [err, setErr] = useState("");
  const [micRec, setMicRec] = useState(false);
  const bdMicRef = useRef(null);
  const bdChunks = useRef([]);

  const startBdMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const mr = new MediaRecorder(stream);
      bdChunks.current = [];
      mr.ondataavailable = e => bdChunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(bdChunks.current, {type:"audio/webm"});
        if (!aiOpts) { setErr("AI is not configured for mic transcription."); return; }
        setLd(true);
        try {
          let b64, mimeType;
          try {
            b64 = await webmToWavBase64(blob);
            mimeType = "audio/wav";
          } catch(e) {
            b64 = await blobToBase64(blob);
            mimeType = "audio/webm";
          }
          const txt = await callGeminiAudio(
            aiOpts, b64, mimeType,
            "Transcribe this audio exactly verbatim. The speaker uses Yeshivish English. Return ONLY the transcript, nothing else.",
            { maxOutputTokens: 2048 }
          );
          if (txt) setInp(prev => prev ? prev + " " + txt.trim() : txt.trim());
          else setErr("Couldn't transcribe.");
        } catch(e) { setErr("Mic transcribe failed."); }
        setLd(false);
      };
      mr.start();
      bdMicRef.current = mr;
      setMicRec(true);
      // Auto-stop after 30s
      setTimeout(() => { if (mr.state === "recording") { mr.stop(); setMicRec(false); } }, 30000);
    } catch(e) { setErr("Mic access denied."); }
  };

  const stopBdMic = () => {
    if (bdMicRef.current?.state === "recording") { bdMicRef.current.stop(); setMicRec(false); }
  };

  const callG = async (pr) => {
    if (!aiOpts) { setErr("AI server is not configured."); return null; }
    setLd(true); setErr("");
    const r = await callAI(pr, aiOpts);
    setLd(false);
    if (!r) setErr("API error");
    return r;
  };

  const bd = async () => {
    const r = await callG(`You are a productivity assistant for ADHD. Shatter this task into 3-7 crystals — small concrete action steps. No time estimates. Task: "${inp}"\nReturn ONLY a JSON array of strings.`);
    if (!r) return;
    try {
      const m = r.match(/\[[\s\S]*\]/);
      if (m) setSubs(JSON.parse(m[0]).map(t => ({id:uid(), text:t, on:true})));
      else setErr("Parse error.");
    } catch(e) { setErr("Parse error."); }
  };

  const chat = async () => {
    if (!cm.trim()) return;
    const nh = [...ch, {r:"user", t:cm}]; setCh(nh); setCm("");
    const r = await callG(`You are a productivity assistant helping shatter a task. Task: "${inp}"\nCurrent crystals (JSON): ${JSON.stringify(subs.filter(s=>s.on).map(s=>s.text))}\nUser says: "${nh[nh.length-1].t}"\nIMPORTANT: Respond with an updated crystal list as a JSON array. First a short explanation, then the JSON array.`);
    if (!r) return;
    try {
      const jm = r.match(/\[[\s\S]*\]/);
      if (jm) setSubs(JSON.parse(jm[0]).map(t => ({id:uid(), text:t, on:true})));
      const explain = r.replace(/\[[\s\S]*\]/, '').trim();
      setCh([...nh, {r:"ai", t:explain||"Updated."}]);
    } catch(e) { setCh([...nh, {r:"ai", t:r.trim()}]); }
  };

  // B12 fix: step text is just the step itself, not "Step N of parent: text"
  const confirmSteps = () => {
    onConfirm(inp, subs.filter(s=>s.on).map(s=>s.text));
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s",overflowY:"auto",padding:20}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"24px 20px",maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 12px 48px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,margin:0,display:"flex",alignItems:"center",gap:8}}><IC.Split s={18} c={T.text}/> Shatter Task</h3><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft}}>✕</button></div>
        <div style={{marginBottom:16}}><label style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",fontWeight:700}}>Big task:</label><div style={{display:"flex",gap:6,alignItems:"center",marginTop:6}}><input value={inp} onChange={e=>setInp(e.target.value)} placeholder="e.g. Prepare shiur" style={{flex:1,padding:"10px 14px",borderRadius:10,border:`1px solid ${T.brd}`,outline:"none",fontSize:14,fontFamily:"Georgia,serif",background:T.bgW,color:T.text}} onKeyDown={e=>{if(e.key==="Enter")bd();}}/><button onClick={micRec?stopBdMic:startBdMic} title={micRec?"Stop recording":"Speak your task"} style={{width:38,height:38,borderRadius:10,border:`1px solid ${micRec?"#B87A5A":T.brd}`,background:micRec?"#B87A5A20":T.bgW,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>{micRec?<div style={{width:10,height:10,borderRadius:2,background:"#B87A5A"}}/>:<IC.Mic s={16} c={T.tSoft}/>}</button></div></div>
        <button onClick={bd} disabled={ld||!inp.trim()} style={{width:"100%",padding:12,borderRadius:12,border:"none",background:ld?"#aaa":pris[0]?.color,color:ld?"#fff":textOnColor(pris[0]?.color||"#5A9E7C"),cursor:ld?"wait":"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {ld&&<span style={{display:"inline-block",width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"ot-spin 0.8s linear infinite"}}/>}
          {ld?"Thinking...":"Shatter with AI ✦"}
        </button>
        {err&&<p style={{color:"#C94040",fontSize:12,fontFamily:"system-ui",margin:"0 0 12px"}}>{err}</p>}
        {subs.length>0&&(
          <div style={{marginBottom:16}}>
            <h4 style={{fontSize:12,fontWeight:700,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 10px",textTransform:"uppercase",letterSpacing:1}}>Crystals</h4>
            {subs.map((st, i) => (
              <div key={st.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.brdS}`}}>
                <button onClick={()=>setSubs(s=>s.map(x=>x.id===st.id?{...x,on:!x.on}:x))} style={{width:20,height:20,borderRadius:4,border:`1.5px solid ${st.on?pris[0]?.color:T.brd}`,background:st.on?pris[0]?.color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{st.on&&<IC.Check s={12} c="#fff"/>}</button>
                <input value={st.text} onChange={e=>setSubs(s=>s.map(x=>x.id===st.id?{...x,text:e.target.value}:x))} style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:"none",outline:"none",background:"transparent",color:st.on?T.text:T.tFaint,textDecoration:st.on?"none":"line-through"}}/>
                <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>#{i+1}</span>
              </div>
            ))}
          </div>
        )}
        {subs.length>0&&(
          <div style={{marginBottom:16}}>
            {ch.length>0&&(
              <div style={{maxHeight:140,overflowY:"auto",marginBottom:10,background:T.bgW,borderRadius:10,padding:10}}>
                {ch.map((m,i)=>(
                  <div key={i} style={{marginBottom:6,textAlign:m.r==="user"?"right":"left"}}>
                    <span style={{display:"inline-block",padding:"6px 10px",borderRadius:10,fontSize:12,fontFamily:"system-ui",background:m.r==="user"?pris[0]?.color+"20":T.card,color:T.text,maxWidth:"85%",textAlign:"left"}}>{m.t}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:"flex",gap:6}}>
              <input value={cm} onChange={e=>setCm(e.target.value)} placeholder="Adjust..." style={{flex:1,padding:"8px 12px",borderRadius:10,border:`1px solid ${T.brd}`,outline:"none",fontSize:12,fontFamily:"system-ui",background:T.bgW,color:T.text}} onKeyDown={e=>{if(e.key==="Enter")chat();}}/>
              <button onClick={chat} disabled={ld} style={{padding:"8px 14px",borderRadius:10,border:"none",background:pris[0]?.color,color:textOnColor(pris[0]?.color||"#5A9E7C"),cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui"}}>Send</button>
            </div>
          </div>
        )}
        {subs.length>0&&subs.some(s=>s.on)&&(
          <button onClick={confirmSteps} style={{width:"100%",padding:13,borderRadius:14,border:"none",background:"#4CAF50",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"system-ui"}}>Plant {subs.filter(s=>s.on).length} Crystals</button>
        )}
      </div>
    </div>
  );
}

// Blocked/partial completion modal (F8)
const BLOCKED_DURATIONS = [
  { label: "3 hours",  ms: 3 * 3600000 },
  { label: "6 hours",  ms: 6 * 3600000 },
  { label: "1 day",    ms: 24 * 3600000 },
  { label: "1 week",   ms: 7 * 24 * 3600000 },
  { label: "1 month",  ms: 30 * 24 * 3600000 },
  { label: "Custom…",  ms: null },
];

function BlockedModal({task, T, pris, onBlock, onClose}) {
  const [note, setNote] = useState("");
  const [durIdx, setDurIdx] = useState(0);
  const [customVal, setCustomVal] = useState("");
  const [customUnit, setCustomUnit] = useState("hours"); // hours | days | weeks
  const p = gP(pris, task.priority);

  const isCustom = BLOCKED_DURATIONS[durIdx].ms === null;
  const unitMs = customUnit === 'weeks' ? 7*24*3600000 : customUnit === 'days' ? 24*3600000 : 3600000;
  const resolvedMs = isCustom
    ? (parseFloat(customVal) > 0 ? parseFloat(customVal) * unitMs : null)
    : BLOCKED_DURATIONS[durIdx].ms;

  return (
    <div style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:20,padding:"24px 20px",maxWidth:400,width:"90%",boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}}>
        <h3 style={{fontSize:15,fontWeight:600,margin:"0 0 6px",display:"flex",alignItems:"center",gap:7}}><IC.Pause s={16} c={T.text}/>Mark as Blocked</h3>
        <p style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 14px"}}>Task moves to the bottom. You'll get a nudge after the selected time asking if it's still blocked.</p>
        <div style={{background:pBg(p.color),borderRadius:10,padding:"10px 12px",marginBottom:14,border:`1px solid ${p.color}40`}}>
          <p style={{fontSize:13,margin:0,color:T.text}}>{task.text}</p>
        </div>
        <textarea
          value={note}
          onChange={e=>setNote(e.target.value)}
          placeholder="What's blocking you? (optional)"
          rows={2}
          style={{width:"100%",padding:"9px 12px",borderRadius:10,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"Georgia,serif",background:T.bgW,color:T.text,marginBottom:12,resize:"none",boxSizing:"border-box"}}
        />
        <p style={{fontSize:11,fontWeight:600,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 6px",textTransform:"uppercase",letterSpacing:.5}}>Remind me in</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:isCustom?10:14}}>
          {BLOCKED_DURATIONS.map((d, i) => (
            <button key={i} onClick={()=>setDurIdx(i)} style={{
              padding:"5px 11px",borderRadius:20,border:`1.5px solid ${i===durIdx?"#C49040":T.brd}`,
              background:i===durIdx?"rgba(196,144,64,0.12)":"none",
              color:i===durIdx?"#C49040":T.tSoft,
              fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"system-ui"
            }}>{d.label}</button>
          ))}
        </div>
        {isCustom && (
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <input
              type="number" min="1" step="1"
              value={customVal}
              onChange={e=>setCustomVal(e.target.value)}
              placeholder="#"
              style={{width:64,padding:"7px 10px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"system-ui",background:T.bgW,color:T.text}}
            />
            <select
              value={customUnit}
              onChange={e=>setCustomUnit(e.target.value)}
              style={{padding:"7px 10px",borderRadius:8,border:`1px solid ${T.brd}`,outline:"none",fontSize:13,fontFamily:"system-ui",background:T.bgW,color:T.text,cursor:"pointer"}}
            >
              <option value="hours">hours</option>
              <option value="days">days</option>
              <option value="weeks">weeks</option>
            </select>
            <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui"}}>from now</span>
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:10,borderRadius:10,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>Cancel</button>
          <button
            onClick={()=>{ if (resolvedMs) onBlock(task.id, note.trim(), resolvedMs); }}
            disabled={!resolvedMs}
            style={{flex:1,padding:10,borderRadius:10,border:"none",background:resolvedMs?"#C49040":"#aaa",color:"#fff",cursor:resolvedMs?"pointer":"default",fontSize:12,fontWeight:600,fontFamily:"system-ui"}}
          >Mark Blocked</button>
        </div>
      </div>
    </div>
  );
}

// Context tag picker (S9)
const ALL_CTX_TAGS = ["@home","@computer","@phone","@outside","@errand"];

function ContextTagPicker({current, T, onSelect, onClose}) {
  const [sel, setSel] = useState(current || []);
  const toggle = (tag) => setSel(s => s.includes(tag) ? s.filter(x=>x!==tag) : [...s, tag]);
  return (
    <div style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:18,padding:"20px 18px",maxWidth:320,width:"90%",boxShadow:"0 6px 24px rgba(0,0,0,0.15)"}}>
        <h4 style={{fontSize:13,fontWeight:600,margin:"0 0 12px",fontFamily:"system-ui"}}>Context Tags</h4>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
          {ALL_CTX_TAGS.map(tag => {
            const on = sel.includes(tag);
            const c = CTX_TAG_COLORS[tag];
            return (
              <button key={tag} onClick={()=>toggle(tag)} style={{padding:"6px 12px",borderRadius:8,border:`1.5px solid ${c}`,background:on?c+"30":"transparent",color:c,fontSize:12,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>
                {tag}
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:9,borderRadius:10,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>Cancel</button>
          <button onClick={()=>{onSelect(sel);onClose();}} style={{flex:1,padding:9,borderRadius:10,border:"none",background:T.text,color:T.bg||"#fff",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui"}}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// List Manager modal
function ListManager({AS, setAS, T, onClose}) {
  const lists = AS.lists;
  const addList = () => { const n = prompt("New list name:"); if (!n?.trim()) return; const id = uid(); setAS(p=>({...p,lists:[...p.lists,{id,name:n.trim(),tasks:[]}]})); };
  const renList = (id) => { const l = lists.find(x=>x.id===id); const n = prompt("Rename:",l?.name); if (!n?.trim()) return; setAS(p=>({...p,lists:p.lists.map(x=>x.id===id?{...x,name:n.trim()}:x)})); };
  const delList = (id) => { if (lists.length<=1){alert("Can't delete last list.");return;} if(!confirm(`Delete "${lists.find(l=>l.id===id)?.name}"?`))return; setAS(p=>{const nl=p.lists.filter(l=>l.id!==id);return{...p,lists:nl,activeListId:p.activeListId===id?nl[0].id:p.activeListId};}); };
  const mergeList = (fromId, toId) => { setAS(p=>{const from=p.lists.find(l=>l.id===fromId);const merged=p.lists.map(l=>l.id===toId?{...l,tasks:[...l.tasks,...(from?.tasks||[])]}:l).filter(l=>l.id!==fromId);return{...p,lists:merged,activeListId:p.activeListId===fromId?toId:p.activeListId};}); };
  const downloadList = (ids) => { const data=lists.filter(l=>ids.includes(l.id));const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`onetaskonly-export-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url); };
  const [mergeFrom, setMergeFrom] = useState(null);

  return (
    <div style={{position:"fixed",inset:0,zIndex:8500,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",overflowY:"auto",padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"24px 20px",maxWidth:480,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:`0 6px 24px rgba(0,0,0,0.15)`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{fontSize:16,fontWeight:600,margin:0}}>Manage Lists</h3><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft}}>✕</button></div>
        {lists.map(l => {
          const act = l.tasks.filter(t=>!t.completed).length;
          const comp = l.tasks.filter(t=>t.completed).length;
          return (
            <div key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 0",borderBottom:`1px solid ${T.brdS}`}}>
              <IC.Folder s={16} c={l.id===AS.activeListId?T.text:T.tSoft}/>
              <div style={{flex:1}}><span style={{fontSize:14,fontWeight:l.id===AS.activeListId?600:400,fontFamily:"system-ui"}}>{l.name}</span><span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginLeft:8}}>{act} pending · {comp} done</span></div>
              <button onClick={()=>renList(l.id)} title="Rename" style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.5}}><span style={{fontSize:13}}>✏️</span></button>
              {mergeFrom===l.id?(<span style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui"}}>Select target ↓</span>):(<button onClick={()=>setMergeFrom(l.id)} title="Merge into..." style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.5}}><IC.Merge s={13} c={T.tSoft}/></button>)}
              {mergeFrom&&mergeFrom!==l.id&&(<button onClick={()=>{mergeList(mergeFrom,l.id);setMergeFrom(null);}} style={{padding:"4px 8px",borderRadius:6,border:"none",background:"#4CAF50",color:"#fff",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"system-ui"}}>Merge here</button>)}
              <button onClick={()=>downloadList([l.id])} title="Download" style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.5}}><IC.Download s={13} c={T.tSoft}/></button>
              {lists.length>1&&<button onClick={()=>delList(l.id)} title="Delete" style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.4}}><IC.Trash s={13} c={T.tFaint}/></button>}
            </div>
          );
        })}
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={addList} style={{flex:1,padding:12,borderRadius:12,border:`1px dashed ${T.brd}`,background:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><IC.Plus s={12} c={T.tSoft}/> New List</button>
          <button onClick={()=>downloadList(lists.map(l=>l.id))} style={{flex:1,padding:12,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><IC.Download s={12} c={T.tSoft}/> Export All</button>
        </div>
      </div>
    </div>
  );
}


export { BulkAdd, TaskBD, BLOCKED_DURATIONS, BlockedModal, ALL_CTX_TAGS, ContextTagPicker, ListManager };
