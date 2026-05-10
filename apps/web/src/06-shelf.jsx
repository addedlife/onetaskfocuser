// === 06-shelf.js ===

import React, { useState, useEffect, useRef } from 'react';
import { IC } from './02-icons.jsx';
import { gP, textOnColor, _lum, pBg } from './01-core.js';
import { ShailaMiniPill } from './04-components.jsx';

// TaskActions: defined OUTSIDE ShelfView (B13 fix) - used in fanned view
const TaskActionsShelf = ({t, onUncomp, onClone, onDel, iconColor}) => {
  const ic = iconColor || "#fff";
  return (
  <div style={{display:"flex",gap:2,flexShrink:0}}>
    <button onClick={e=>{e.stopPropagation();onUncomp(t.id);}} title="Return to queue" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.5}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.5}><IC.Undo s={11} c={ic}/></button>
    <button onClick={e=>{e.stopPropagation();onClone(t);}} title="Clone" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.5}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.5}><IC.Clone s={11} c={ic}/></button>
    <button onClick={e=>{e.stopPropagation();onDel(t.id);}} title="Delete" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.4}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.4}><IC.Trash s={11} c={ic}/></button>
  </div>
  );
};

function ShelfView({allComp, compT, pris, T, onDel, onUncomp, onClone}) {
  const [fanned, setFanned] = useState(false);
  const n = allComp.length;
  // F5: trophy pile - stacked post-its, full size, grows with count
  const stackH = Math.min(n * 4 + 30, 120);

  // Fanned view: F5 - full size post-it notes with actual task text
  if (fanned) return (
    <div style={{position:"fixed",inset:0,zIndex:8000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.3s",overflowY:"auto",padding:20}} onClick={e=>{if(e.target===e.currentTarget)setFanned(false);}}>
      <div style={{maxWidth:680,width:"100%",maxHeight:"85vh",overflowY:"auto",padding:20,display:"flex",flexWrap:"wrap",gap:14,justifyContent:"center"}}>
        {allComp.slice().reverse().map((t, i) => {
          const pri = gP(pris, t.priority);
          const rot = ((i*7+3)%11) - 5;
          const _sc = textOnColor(pri.color);
          const _sc50 = _lum(pri.color) > 0.35 ? "rgba(45,37,32,0.50)" : "rgba(255,255,255,0.5)";
          return (
            <div key={t.id}
              style={{width:190,minHeight:130,background:pri.color,borderRadius:8,padding:"16px 14px 10px",boxShadow:"2px 4px 14px rgba(0,0,0,0.2)",transform:`rotate(${rot}deg)`,transition:"transform 0.2s",cursor:"default",display:"flex",flexDirection:"column",justifyContent:"space-between"}}
              onMouseEnter={e=>e.currentTarget.style.transform=`rotate(0deg) scale(1.04)`}
              onMouseLeave={e=>e.currentTarget.style.transform=`rotate(${rot}deg)`}
            >
              {/* F5: real task text */}
              <p style={{fontSize:13,color:_sc,lineHeight:1.45,margin:0,fontFamily:"Georgia,serif",opacity:.95,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:5,WebkitBoxOrient:"vertical"}}>
                {t.goodEnough && <span style={{fontSize:9,marginRight:4,opacity:.7}}>≈</span>}
                {t.text}
              </p>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
                <span style={{fontSize:9,color:_sc50,fontFamily:"system-ui"}}>{t.completedAt?new Date(t.completedAt).toLocaleDateString():""}</span>
                <TaskActionsShelf t={t} onUncomp={onUncomp} onClone={onClone} onDel={onDel} iconColor={_sc}/>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={e=>{e.stopPropagation();setFanned(false);}} style={{position:"fixed",top:20,right:20,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:12,padding:"8px 16px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",zIndex:9000}}>Close</button>
    </div>
  );

  return (
    <div style={{animation:"ot-fade 0.3s",marginTop:24,textAlign:"center"}}>
      <h2 style={{fontSize:18,fontWeight:500,margin:"0 0 4px"}}>Trophy Shelf</h2>
      <p style={{fontSize:13,color:T.tSoft,margin:"0 0 20px"}}>Every task conquered</p>
      {n > 0 ? (
        <>
          {/* F5: stacked post-it notes with actual priority colors */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,cursor:"pointer",padding:"12px 0"}} onClick={()=>setFanned(true)} title={`${n} completed`}>
            <div style={{position:"relative",width:120,height:stackH}}>
              {allComp.slice(-Math.min(n, 16)).map((t, i, arr) => {
                const pri = gP(pris, t.priority);
                const off = (arr.length-1-i) * 4;
                const rot = ((i*5+2)%7) - 3;
                const topOffset = Math.max(0, stackH - 40 - off);
                const _mc = _lum(pri.color) > 0.35 ? "rgba(45,37,32,0.85)" : "rgba(255,255,255,0.85)";
                return (
                  <div key={t.id} style={{
                    position:"absolute", bottom:off, left:4+((i%3)-1)*4,
                    width:112, height:42, background:pri.color,
                    borderRadius:4, boxShadow:"0 2px 6px rgba(0,0,0,0.18)",
                    transform:`rotate(${rot}deg)`, transition:"all 0.3s",
                    padding:"6px 8px", overflow:"hidden"
                  }}>
                    <p style={{fontSize:9,color:_mc,margin:0,fontFamily:"Georgia,serif",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.text}</p>
                  </div>
                );
              })}
            </div>
            <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>{n} done — tap to browse</span>
          </div>

          {/* Current list completed tasks */}
          {compT.length > 0 && (
            <div style={{marginTop:16,background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow,textAlign:"left"}}>
              <h4 style={{fontSize:11,fontWeight:700,color:T.tFaint,padding:"12px 14px 8px",margin:0,fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1}}>This list ({compT.length})</h4>
              <div style={{maxHeight:260,overflowY:"auto"}}>
                {compT.map(t => {
                  const tp = gP(pris, t.priority);
                  return (
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderTop:`1px solid ${T.brdS}`}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:tp.color,flexShrink:0,opacity:.6}}/>
                      <span style={{flex:1,fontSize:13,color:T.tFaint,textDecoration:"line-through"}}>
                        {t.goodEnough && <span title="Good enough" style={{marginRight:4,fontSize:9,opacity:.7}}>≈</span>}
                        {t.text}
                      </span>
                      <button onClick={()=>onUncomp(t.id)} title="Return" style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.4}}><IC.Undo s={11} c={T.tSoft}/></button>
                      <button onClick={()=>onClone(t)} title="Clone" style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.4}}><IC.Clone s={11} c={T.tSoft}/></button>
                      <button onClick={()=>onDel(t.id)} title="Delete" style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.3}}><IC.Trash s={11} c={T.tFaint}/></button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{background:T.card,borderRadius:16,padding:"40px 20px",border:`1px solid ${T.brd}`,boxShadow:T.shadow}}><p style={{color:T.tFaint,fontSize:14,margin:0}}>Complete tasks to build your stack</p></div>
      )}
    </div>
  );
}

// Subtask group view (C06) - collapsible single-row in Queue tab
// Counts as ONE item in the queue. Click to expand subtask list.
function SubtaskGroup({parentTask, tasks, pris, T, onMoveTop, onComp, onDel, onEdit, onAdd, onReorder, onChgPri, searchQ, onLegacyComp, shailaNumberMap, onShailaGotBack}) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editTx, setEditTx] = useState("");
  const [adding, setAdding] = useState(false);
  const [addTx, setAddTx] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const addRef = React.useRef(null);
  const editRef = React.useRef(null);

  const steps = tasks.filter(t => t.parentTask === parentTask && !t.completed).sort((a,b)=>(a.stepIndex||0)-(b.stepIndex||0));
  const doneSteps = tasks.filter(t => t.parentTask === parentTask && t.completed);
  const total = steps.length + doneSteps.length;
  if (!steps.length) return null;
  const pct = total > 0 ? doneSteps.length / total : 0;
  const pri = gP(pris, steps[0]?.priority);

  // Auto-open if search matches
  const sq = (searchQ||"").toLowerCase().trim();
  const hasMatch = sq && (parentTask.toLowerCase().includes(sq) || steps.some(s=>s.text.toLowerCase().includes(sq)));
  React.useEffect(() => { if (hasMatch) setOpen(true); }, [hasMatch]);

  const startEdit = (st) => { setEditId(st.id); setEditTx(st.text); setTimeout(()=>editRef.current?.focus(),40); };
  const saveEdit = (id) => { const tx=editTx.trim(); if(tx&&onEdit) onEdit(id,tx); setEditId(null); };

  const submitAdd = () => {
    const tx = addTx.trim();
    if (tx && onAdd) onAdd(tx);
    setAddTx(""); setAdding(false);
  };

  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const order = steps.map(s => s.id);
    const fromIdx = order.indexOf(dragId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setDragOverId(null); return; }
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragId);
    if (onReorder) onReorder(order);
    setDragId(null); setDragOverId(null);
  };

  return (
    <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow}}>
      {/* Collapsed row — looks just like a regular task row, chevron is the ONE extra icon */}
      <div onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",gap:6,padding:"12px 10px",cursor:"pointer",borderLeft:`3px solid ${pri.color}`,background:"transparent"}}>
        <span style={{padding:"2px",opacity:.35,flexShrink:0}}><IC.Grab s={12} c={T.tFaint}/></span>
        <span style={{width:20,height:20,borderRadius:"50%",border:`1.5px solid ${T.tFaint}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <IC.Split s={9} c={T.tFaint}/>
        </span>
        <span style={{flex:1,fontSize:14,fontWeight:400,color:T.tSoft,fontFamily:"Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{parentTask}</span>
        <div style={{width:8,height:8,borderRadius:"50%",background:pri.color,flexShrink:0,opacity:.7}}/>
        <IC.Chev d={open?"up":"down"} s={12} c={T.tSoft}/>
      </div>
      {/* Progress bar (subtle) */}
      <div style={{background:T.brd,height:2,overflow:"hidden"}}>
        <div style={{width:`${pct*100}%`,height:"100%",background:pri.color,transition:"width 0.4s"}}/>
      </div>
      {/* Expanded */}
      {open && (
        <div style={{padding:"6px 0",animation:"ot-fade 0.15s"}}>
          {steps.map((st, i) => {
            const isMatch = sq && st.text.toLowerCase().includes(sq);
            const isDragging = dragId === st.id;
            const isOver = dragOverId === st.id && dragId !== st.id;
            return (
              <div key={st.id}
                draggable
                onDragStart={()=>setDragId(st.id)}
                onDragEnd={()=>{setDragId(null);setDragOverId(null);}}
                onDragOver={e=>{e.preventDefault();setDragOverId(st.id);}}
                onDrop={()=>handleDrop(st.id)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px 7px 12px",borderBottom:i<steps.length-1?`1px solid ${T.brdS}`:"none",background:isOver?pri.color+"22":isMatch?pri.color+"12":"transparent",opacity:isDragging?0.4:1,borderTop:isOver?`2px solid ${pri.color}60`:"2px solid transparent",transition:"background 0.1s, border-color 0.1s"}}>
                {/* Drag handle */}
                <span style={{cursor:"grab",padding:"2px",opacity:.3,flexShrink:0}} title="Drag to reorder"><IC.Grab s={11} c={T.tFaint}/></span>
                <button onClick={e=>{e.stopPropagation(); if(e.altKey) onLegacyComp?.(st.id); else onComp(st.id);}} style={{width:18,height:18,borderRadius:"50%",border:`1.5px solid ${pri.color}`,background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Complete (Alt+Click for Legacy)">
                  <IC.Check s={10} c={pri.color}/>
                </button>
                {editId === st.id ? (
                  <input ref={editRef} value={editTx} onChange={e=>setEditTx(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")saveEdit(st.id);if(e.key==="Escape")setEditId(null);}}
                    onBlur={()=>saveEdit(st.id)}
                    style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${pri.color}80`,borderRadius:6,padding:"3px 7px",outline:"none",color:T.text,background:T.bgW}}/>
                ) : (
                  <span onClick={()=>startEdit(st)} style={{flex:1,fontSize:13,color:isMatch?T.text:T.tSoft,cursor:"text",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:isMatch?500:400}}
                    title="Click to edit">
                    {st.stepIndex && <span style={{fontSize:10,color:T.tFaint,marginRight:4,fontFamily:"system-ui"}}>#{st.stepIndex}</span>}
                    {st.text}
                  </span>
                )}
                {/* Mini got-back pill on "Get back to asker" step */}
                {st.isGetBackStep && st.shailaId && shailaNumberMap && (
                  <ShailaMiniPill
                    status={(() => {
                      const siblings = tasks.filter(t => t.shailaId === st.shailaId && !t.isGetBackStep);
                      const researchTask = siblings.find(t => !t.completed);
                      if (st.gotBackToAsker) return "got_back";
                      if (!researchTask) return "have_answer";
                      return "researching";
                    })()}
                    shailaNum={shailaNumberMap[st.shailaId]}
                    onToggle={() => onShailaGotBack && onShailaGotBack(st.shailaId, !st.gotBackToAsker)}
                    answerSnippet={(() => {
                      const siblings = tasks.filter(t => t.shailaId === st.shailaId && !t.isGetBackStep);
                      const sibling = siblings.find(t => t.shailaAnswer);
                      const summary = sibling?.answerSummary;
                      if (summary?.trim()) return summary.trim();
                      const ans = (sibling?.shailaAnswer || '').trim();
                      if (!ans) return null;
                      const words = ans.split(/\s+/).filter(Boolean);
                      return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
                    })()}
                  />
                )}
                <button onClick={e=>{e.stopPropagation();if(onChgPri)onChgPri(st.id);}} title="Change priority" style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.5,flexShrink:0,display:"flex",alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.5}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:gP(pris,st.priority).color,boxShadow:`0 0 0 1.5px ${gP(pris,st.priority).color}60`}}/>
                </button>
                <button onClick={e=>{e.stopPropagation();onDel(st.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.3}} title="Delete"><IC.Trash s={11} c={T.tFaint}/></button>
              </div>
            );
          })}
          {doneSteps.length > 0 && (
            <div style={{padding:"4px 12px 4px 20px",fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>{doneSteps.length} crystal{doneSteps.length!==1?"s":""} completed</div>
          )}
          {/* Add new crystal */}
          {adding ? (
            <div style={{display:"flex",gap:6,padding:"6px 12px 6px 20px",alignItems:"center"}}>
              <input ref={addRef} value={addTx} onChange={e=>setAddTx(e.target.value)} placeholder="New step…" autoFocus
                onKeyDown={e=>{if(e.key==="Enter")submitAdd();if(e.key==="Escape"){setAdding(false);setAddTx("");}}}
                onBlur={()=>{if(!addTx.trim())setAdding(false);}}
                style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${pri.color}80`,borderRadius:8,padding:"5px 10px",outline:"none",background:T.bgW,color:T.text}}/>
              <button onClick={submitAdd} disabled={!addTx.trim()} style={{background:pri.color,border:"none",borderRadius:7,padding:"5px 10px",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:textOnColor(pri.color),opacity:addTx.trim()?1:.4}}>Add</button>
            </div>
          ) : (
            <button onClick={()=>setAdding(true)} style={{width:"100%",textAlign:"left",padding:"5px 12px 5px 20px",background:"none",border:"none",cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:pri.color,opacity:.7,display:"flex",alignItems:"center",gap:4}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.7}>
              <IC.Plus s={10} c={pri.color}/> Add step
            </button>
          )}
          <div style={{display:"flex",gap:6,padding:"6px 12px 4px"}}>
            <button onClick={()=>onMoveTop(steps[0]?.id)} style={{flex:1,padding:"5px 8px",borderRadius:7,border:`1px solid ${pri.color}50`,background:pBg(pri.color),cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"system-ui",color:pri.color}}>↑ Next crystal to top</button>
            <button onClick={e=>{if(e.altKey) steps.forEach(s=>onLegacyComp?.(s.id)); else steps.forEach(s=>onComp(s.id));}} style={{flex:1,padding:"5px 8px",borderRadius:7,border:"none",background:pri.color+"20",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"system-ui",color:pri.color}}>✓ All done</button>
          </div>
        </div>
      )}
    </div>
  );
}


export { TaskActionsShelf, ShelfView, SubtaskGroup };