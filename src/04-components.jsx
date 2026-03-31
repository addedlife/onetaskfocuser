// === 04-components.js ===

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { IC } from './02-icons.jsx';
import { isTaskAged, getTaskAgeHours, gP, pBg, textOnColor, _lum, priText, callGemini, callAI, uid, db, Store, DEF_PRI, PALETTE, cleanYT, aiDetectShailaAnswers } from './01-core.js';

function Ripple({color}) {
  return <div style={{position:"absolute",inset:0,zIndex:0,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:"100%",height:"100%",borderRadius:"clamp(22px,4vw,36px)",border:`2px solid ${color}`,animation:"ot-ripple 0.6s ease-out forwards"}}/>
  </div>;
}

function Confetti({colors}) {
  const p = useMemo(() => Array.from({length:30}, (_,i) => ({
    id:i, l:Math.random()*100, d:Math.random()*1.5,
    u:1.5+Math.random()*2, c:colors[i%colors.length], z:4+Math.random()*8
  })), []);
  return <div style={{position:"fixed",inset:0,zIndex:10000,pointerEvents:"none"}}>
    {p.map(x => <div key={x.id} style={{position:"absolute",left:`${x.l}%`,top:-10,width:x.z,height:x.z*0.6,background:x.c,borderRadius:2,animation:`ot-confetti ${x.u}s ease-in ${x.d}s forwards`}}/>)}
  </div>;
}

// Completion sound (S8) - Web Audio API, soft chime
function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch(e) {}
  // Haptic feedback on mobile
  try { if (navigator.vibrate) navigator.vibrate([30, 20, 60]); } catch(e) {}
}

// AutoFitText: CSS clamp-based, no reflow loop (fixes B15)
function AutoFitText({text, minSize=16, maxSize=56, color="#fff", style={}}) {
  const len = text?.length || 1;
  // Smoother scaling: 4 breakpoints
  const fs = len < 25 ? maxSize
           : len < 50  ? Math.max(minSize, maxSize * 0.80)
           : len < 90  ? Math.max(minSize, maxSize * 0.65)
           : len < 140 ? Math.max(minSize, maxSize * 0.52)
           : Math.max(minSize, maxSize * 0.42);
  return <div style={{
    fontSize: fs,
    fontWeight: 400,
    color,
    lineHeight: 1.3,
    margin: 0,
    fontFamily: "Georgia,serif",
    textShadow: "0 1px 3px rgba(0,0,0,0.08)",
    opacity: .95,
    overflow: "hidden",
    maxHeight: "100%",
    wordBreak: "break-word",
    ...style
  }}>{text}</div>;
}

// Toast notification
function Toast({message, color, onDismiss}) {
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
      background: color || "#333", color: "#fff", borderRadius: 10,
      padding: "9px 12px 9px 18px", fontSize: 12, fontFamily: "system-ui", fontWeight: 600,
      zIndex: 99999, animation: "ot-fade 0.3s ease", pointerEvents: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.25)", whiteSpace: "nowrap",
      display: "flex", alignItems: "center", gap: 10
    }}>
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:15,padding:"0 2px",lineHeight:1,flexShrink:0,fontWeight:400}}>✕</button>
      )}
    </div>
  );
}

// Task age badge
function AgeBadge({task, pris, thresholds, T}) {
  if (!isTaskAged(task, pris, thresholds)) return null;
  const hours = Math.floor(getTaskAgeHours(task));
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days}d` : `${hours}h`;
  return <span title={`${hours}h old`} style={{
    display: "inline-flex", alignItems: "center", gap: 2,
    fontSize: 9, color: "#B85030", fontFamily: "system-ui", fontWeight: 700,
    animation: "ot-age-pulse 2s ease-in-out infinite", flexShrink: 0
  }}>
    <IC.Clock s={9} c="#B85030"/>{label}
  </span>;
}

// Energy tag badge
function EnergyBadge({energy, T}) {
  if (!energy) return null;
  const isHigh = energy === "high";
  return <span style={{
    fontSize: 8, fontFamily: "system-ui", fontWeight: 700,
    color: isHigh ? "#B85030" : "#4A7898",
    border: `1px solid ${isHigh ? "#B85030" : "#4A7898"}`,
    borderRadius: 4, padding: "1px 4px", flexShrink: 0
  }}>{isHigh ? "⚡" : "🌊"}</span>;
}

// Context tag badge
const CTX_TAG_COLORS = {
  "@home": "#9BD4A0", "@computer": "#7EB0DE", "@phone": "#E09AB8",
  "@outside": "#E0B472", "@errand": "#D4A0D8"
};
const CTX_TAG_TEXT = {
  "@home": "#3A7A42", "@computer": "#3A6A8A", "@phone": "#8B5F72",
  "@outside": "#826842", "@errand": "#7A4A7E"
};
function ContextBadges({tags, T}) {
  if (!tags?.length) return null;
  return <span style={{display:"inline-flex",gap:3,flexShrink:0,flexWrap:"wrap"}}>
    {tags.map(tag => (
      <span key={tag} style={{
        fontSize: 8, fontFamily: "system-ui", fontWeight: 600,
        background: CTX_TAG_COLORS[tag] + "40", color: CTX_TAG_TEXT[tag] || priText(CTX_TAG_COLORS[tag] || "#666"),
        borderRadius: 4, padding: "1px 4px"
      }}>{tag}</span>
    ))}
  </span>;
}

// Mrs W badge
function MrsWBadge({T}) {
  return <span style={{
    fontSize: 8, fontFamily: "system-ui", fontWeight: 700,
    background: "#D4A0D840", color: "#7A3A7E",
    border: "1px solid #D4A0D8", borderRadius: 5, padding: "1px 5px", flexShrink: 0
  }}>Mrs. W</span>;
}

// Blocked state badge
function BlockedBadge({task, T}) {
  if (!task.blocked) return null;
  let ageLabel = "";
  if (task.blockedAt) {
    const hrs = Math.floor((Date.now() - task.blockedAt) / 3600000);
    ageLabel = hrs < 1 ? " <1h" : hrs < 24 ? ` ${hrs}h` : ` ${Math.floor(hrs/24)}d`;
  }
  return <span title={task.blockedNote ? `Blocked: ${task.blockedNote}` : "blocked"} style={{
    fontSize: 8, fontFamily: "system-ui", fontWeight: 700,
    background: "#E0B47240", color: "#8A5A10",
    borderRadius: 4, padding: "1px 5px", flexShrink: 0
  }}>⏸ blocked{ageLabel}</span>;
}

// Good Enough badge
function GoodEnoughBadge({task}) {
  if (!task.goodEnough) return null;
  return <span title="Good enough completion" style={{
    fontSize: 8, fontFamily: "system-ui", fontWeight: 700,
    background: "#9BD4A040", color: "#3A7242",
    borderRadius: 4, padding: "1px 5px", flexShrink: 0
  }}>≈ good enough</span>;
}

// Zen mode — Click anywhere to exit EXCEPT the done button
// Done button: completes task with celebration effect, stays in zen for next task
function ZenMode({task, pris, onExit, onDone, T, justStartId, curTaskId, onDoneJustStart, jsMinimized, onRestoreJs, showBodyDouble, bdMinimized, onRestoreBd, onCloseBd, onCapture, zenDumpParsing, onOpenShailos}) {
  const p = gP(pris, task.priority);
  const [showEffect, setShowEffect] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [cursorVis, setCursorVis] = useState(true);
  const [zenClock, setZenClock] = useState(() => new Date());
  const [showDump, setShowDump] = useState(false);
  const [dumpText, setDumpText] = useState("");
  const [dumpConfirmed, setDumpConfirmed] = useState(false);
  const idleRef = useRef(null);
  const zenRef = useRef(null);
  const clockRef = useRef(null);

  useEffect(() => {
    clockRef.current = setInterval(() => setZenClock(new Date()), 1000);
    return () => clearInterval(clockRef.current);
  }, []);

  // Mouse/cursor fade after 5s inactivity
  const resetFade = useCallback(() => {
    setShowUI(true);
    setCursorVis(true);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => { setShowUI(false); setCursorVis(false); }, 5000);
  }, []);

  useEffect(() => {
    resetFade();
    const el = zenRef.current;
    if (!el) return;
    const h = () => resetFade();
    el.addEventListener("mousemove", h);
    el.addEventListener("touchstart", h);
    return () => { clearTimeout(idleRef.current); el.removeEventListener("mousemove", h); el.removeEventListener("touchstart", h); };
  }, [resetFade]);

  // Keyboard: Enter = complete, any other key = exit (dump overlay intercepts when open)
  useEffect(() => {
    const h = (e) => {
      if (showDump) {
        if (e.key === "Escape") setShowDump(false);
        return; // all other keys handled by textarea
      }
      if (e.key === "Enter") { e.preventDefault(); handleDone(e); }
      else { onExit(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [task.id, showDump]); // eslint-disable-line

  const handleDone = (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    const isLegacy = e?.altKey;
    if (!isLegacy) setShowEffect(true);
    setTimeout(() => {
      onDone(isLegacy);
      if (!isLegacy) setShowEffect(false);
    }, isLegacy ? 0 : 700);
  };

  // Subtask info
  const isSub = !!task.parentTask;
  const stepInfo = isSub ? `Step ${task.stepIndex||1} of ${task.totalSteps||"?"} of ${task.parentTask}` : null;

  // ─── Shabbos mode (Friday or ?shabbosTimer=1) ───────────────────────
  const isShabbosMode = (() => {
    const now = new Date();
    const isFriday = now.getDay() === 5;
    const params = new URLSearchParams(window.location.search);
    return isFriday || !!params.get("shabbosTimer");
  })();

  // Shabbos 24h countdown — starts when zen mode opens
  const [shabbosStart] = useState(() => isShabbosMode ? Date.now() : null);
  const shabbosMs = shabbosStart ? Math.max(0, (shabbosStart + 24*60*60*1000) - zenClock.getTime()) : null;
  const sHrs = shabbosMs != null ? Math.floor(shabbosMs / 3600000) : null;
  const sMins = shabbosMs != null ? Math.floor((shabbosMs % 3600000) / 60000) : null;

  // If Shabbos mode — render a completely clean, black, peaceful screen
  if (isShabbosMode) {
    return (
      <div
        style={{position:"fixed",inset:0,zIndex:9999,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-zen 2s ease forwards",cursor:"pointer"}}
        onClick={onExit}
      >
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"clamp(16px,3vh,28px)",animation:"ot-reveal 2.5s ease 0.3s both"}}>
          <div style={{fontSize:"clamp(80px,18vw,140px)",lineHeight:1}}>🕯️🕯️</div>
          <p style={{margin:0,fontSize:"clamp(15px,2.5vw,20px)",fontFamily:"Georgia,serif",fontStyle:"italic",fontWeight:400,color:"rgba(255,255,255,0.35)",letterSpacing:"0.05em",textAlign:"center"}}>
            All you have to do now is…
          </p>
          <p style={{margin:0,fontSize:"clamp(28px,5vw,44px)",fontFamily:"Georgia,serif",fontWeight:400,color:"rgba(255,255,255,0.7)",letterSpacing:"0.04em",textAlign:"center"}}>
            enjoy Shabbos
          </p>
          {sHrs != null && shabbosMs > 0 && (
            <p style={{margin:0,marginTop:8,fontSize:"clamp(13px,2vw,17px)",fontFamily:"system-ui",fontWeight:300,color:"rgba(255,255,255,0.2)",letterSpacing:2}}>
              {sHrs}h {sMins}m
            </p>
          )}
          {/* Shaila button — subtle, always accessible */}
          <button
            onClick={(e) => { e.stopPropagation(); if(onOpenShailos) onOpenShailos(); }}
            style={{marginTop:"clamp(20px,4vh,40px)",background:"none",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"10px 22px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"border-color 0.3s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.3)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.12)"}
          >
            <span style={{fontSize:16}}>🎙️</span>
            <span style={{fontSize:"clamp(12px,1.8vw,15px)",fontFamily:"system-ui",fontWeight:300,color:"rgba(255,255,255,0.35)",letterSpacing:"0.03em"}}>Record Shaila</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={zenRef}
      style={{position:"fixed",inset:0,zIndex:9999,background:"#201E22",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-zen 1.2s ease forwards",overflow:"hidden",cursor:cursorVis?"pointer":"none"}}
      onClick={onExit}
    >
      {/* Clock — always visible */}
      <div style={{position:"absolute",top:"clamp(18px,3vh,32px)",left:"50%",transform:"translateX(-50%)",zIndex:10,pointerEvents:"none"}}>
        <span style={{fontSize:"clamp(22px,4vw,34px)",fontFamily:"system-ui",fontWeight:300,color:"rgba(255,255,255,0.55)",letterSpacing:2}}>
          {zenClock.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
        </span>
      </div>

      {/* Glow blob */}
      <div style={{position:"absolute",width:"60vw",height:"50vh",borderRadius:"25%",background:p.isShaila?"#2ECC71":p.color,opacity:.2,filter:"blur(60px)",animation:"ot-glow 5s ease-in-out infinite",pointerEvents:"none"}}/>

      {/* Completion celebration effect */}
      {showEffect && (
        <div style={{position:"absolute",inset:0,zIndex:20,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:120,height:120,borderRadius:"50%",background:p.isShaila?"#2ECC71":p.color,opacity:.5,animation:"ot-ripple 0.7s ease-out forwards"}}/>
          <span style={{position:"absolute",fontSize:48,animation:"ot-fade 0.5s"}}>✓</span>
        </div>
      )}

      {/* Task card */}
      {(()=>{const zenColor=p.isShaila?"#2ECC71":p.color; return (
      <div style={{position:"relative",zIndex:2,display:"flex",flexDirection:"column",alignItems:"center",gap:"clamp(14px,2.5vh,24px)"}}>
        {/* Calming title above card */}
        <p style={{margin:0,fontSize:"clamp(14px,2.2vw,19px)",fontFamily:"Georgia,serif",fontStyle:"italic",fontWeight:400,color:"rgba(255,255,255,0.42)",letterSpacing:"0.05em",textAlign:"center",animation:"ot-reveal 1.4s ease 0.15s both",pointerEvents:"none"}}>
          All you have to do now is…
        </p>
        {/* Task card */}
        <div
          style={{background:zenColor,borderRadius:"clamp(22px,4vw,36px)",padding:"clamp(30px,6vw,80px) clamp(24px,5vw,72px)",width:"min(85vw,600px)",maxHeight:"70vh",display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center",animation:"ot-reveal 1.4s ease 0.4s both",boxShadow:`0 0 80px ${zenColor}30, 0 20px 60px rgba(0,0,0,0.3)`,cursor:cursorVis?"pointer":"none"}}
        >
          <AutoFitText text={task.text} maxSize={56} minSize={18} color={textOnColor(zenColor)} style={{maxHeight:"55vh"}}/>
        </div>
      </div>
      );})()}

      {/* Subtask parent info — fades with mouse */}
      {stepInfo && <p style={{position:"absolute",bottom:"clamp(48px,8vh,80px)",fontSize:13,color:"rgba(255,255,255,0.35)",fontFamily:"system-ui",zIndex:3,transition:"opacity 0.5s",opacity:showUI?.6:0}}>{stepInfo}</p>}

      {/* Timers overlay — actual live timers in zen, click-safe */}
      {((justStartId === curTaskId && !jsMinimized) || (showBodyDouble && !bdMinimized)) && (
        <div style={{position:"absolute",bottom:120,left:"50%",transform:"translateX(-50%)",zIndex:10,transition:"opacity 0.5s",opacity:showUI?1:0.3,minWidth:280,maxWidth:"85vw"}}
          onClick={e=>e.stopPropagation()}>
          {justStartId === curTaskId && !jsMinimized && (
            <div style={{marginBottom:showBodyDouble&&!bdMinimized?8:0}}>
              <JustStartTimer color={gP(pris,task.priority).color} T={T} onMinimize={onRestoreJs?()=>onRestoreJs():undefined} onDone={onDoneJustStart}/>
            </div>
          )}
          {showBodyDouble && !bdMinimized && (
            <div style={{background:"rgba(30,30,40,0.9)",borderRadius:12,padding:"10px 14px",border:"1px solid rgba(255,255,255,0.1)"}}>
              <BodyDoubleTimer T={{...T,card:"rgba(30,30,40,0.95)",bgW:"rgba(255,255,255,0.08)",text:"#fff",tSoft:"rgba(255,255,255,0.6)",tFaint:"rgba(255,255,255,0.3)",brd:"rgba(255,255,255,0.12)",brdS:"rgba(255,255,255,0.08)"}} minimized={false} onMinimize={onRestoreBd} onRestore={onRestoreBd} onClose={onCloseBd}/>
            </div>
          )}
        </div>
      )}
      {/* Minimized pills in zen */}
      {jsMinimized && justStartId === curTaskId && (
        <div onClick={e=>{e.stopPropagation();onRestoreJs?.();}} style={{position:"absolute",bottom:70,left:"50%",transform:"translateX(-50%)",zIndex:10,background:gP(pris,task.priority).color,borderRadius:20,padding:"5px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",opacity:showUI?1:0.2,transition:"opacity 0.5s"}}>
          <IC.Timer s={11} c="#fff"/><span style={{fontSize:11,color:"#fff",fontFamily:"system-ui",fontWeight:700}}>Just Start</span>
        </div>
      )}
      {bdMinimized && showBodyDouble && (
        <div onClick={e=>{e.stopPropagation();onRestoreBd?.();}} style={{position:"absolute",bottom:40,left:"50%",transform:"translateX(-50%)",zIndex:10,background:"#3A7098",borderRadius:20,padding:"5px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",opacity:showUI?1:0.2,transition:"opacity 0.5s"}}>
          <IC.Timer s={11} c="#fff"/><span style={{fontSize:11,color:"#fff",fontFamily:"system-ui",fontWeight:700}}>Body Double</span>
        </div>
      )}

      {/* Done check — minimal, fades with mouse */}
      <div style={{position:"absolute",bottom:"clamp(60px,10vh,100px)",left:"50%",transform:"translateX(-50%)",zIndex:10,transition:"opacity 0.5s",opacity:showUI?.8:0}}>
        <button
          onClick={handleDone}
          style={{
            background:"rgba(255,255,255,0.15)", border:"1.5px solid rgba(255,255,255,0.3)",
            color:"#fff", borderRadius:"50%", width:48, height:48,
            cursor:cursorVis?"pointer":"none", display:"flex", alignItems:"center", justifyContent:"center",
            fontFamily:"system-ui", transition:"opacity 0.3s"
          }}
        >
          <IC.Check s={22} c="#fff"/>
        </button>
      </div>

      {/* Record Shaila — bottom left, subtle */}
      <div
        onClick={e=>{e.stopPropagation();if(onOpenShailos)onOpenShailos();}}
        title="Record a shaila"
        style={{position:"absolute",bottom:"clamp(60px,10vh,100px)",left:24,zIndex:10,width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.13)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"opacity 0.5s",opacity:showUI?0.55:0.08}}
        onMouseEnter={e=>e.currentTarget.style.opacity=1}
        onMouseLeave={e=>e.currentTarget.style.opacity=showUI?0.55:0.08}
      >
        <span style={{fontSize:14}}>🎙️</span>
      </div>

      {/* Brain dump icon — bottom right, subtle */}
      <div
        onClick={e=>{e.stopPropagation();setShowDump(true);}}
        title="Brain dump — capture tasks that come to mind"
        style={{position:"absolute",bottom:"clamp(60px,10vh,100px)",right:24,zIndex:10,width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.13)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"opacity 0.5s",opacity:showUI?0.55:0.08}}
        onMouseEnter={e=>e.currentTarget.style.opacity=1}
        onMouseLeave={e=>e.currentTarget.style.opacity=showUI?0.55:0.08}
      >
        {zenDumpParsing
          ? <div style={{width:12,height:12,borderRadius:"50%",border:"1.5px solid rgba(255,255,255,0.7)",borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>
          : <IC.Brain s={15} c="rgba(255,255,255,0.75)"/>
        }
      </div>

      {/* Brain dump overlay — appears within zen, doesn't exit it */}
      {showDump && (
        <div style={{position:"absolute",inset:0,zIndex:30,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)"}} onClick={e=>e.stopPropagation()}>
          <div style={{width:"min(90vw,540px)",display:"flex",flexDirection:"column",gap:10}} onClick={e=>e.stopPropagation()}>
            <p style={{margin:0,textAlign:"center",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:"rgba(255,255,255,0.4)",letterSpacing:"0.12em",textTransform:"uppercase"}}>Brain Dump</p>
            {dumpConfirmed
              ? <div style={{textAlign:"center",fontSize:32,color:"rgba(255,255,255,0.9)",fontFamily:"system-ui",animation:"ot-fade 0.3s",padding:"24px 0"}}>✓ Captured</div>
              : <textarea
                  autoFocus
                  value={dumpText}
                  onChange={e=>setDumpText(e.target.value)}
                  onKeyDown={e=>{
                    if (e.key==="Escape"){e.stopPropagation();setShowDump(false);return;}
                    if (e.key==="Enter"&&!e.shiftKey){
                      e.preventDefault();e.stopPropagation();
                      if(!dumpText.trim())return;
                      onCapture?.(dumpText.trim());
                      setDumpConfirmed(true);setDumpText("");
                      setTimeout(()=>{setDumpConfirmed(false);setShowDump(false);},900);
                      return;
                    }
                  }}
                  placeholder={"Everything on your mind…\none thing per line, or just stream it out"}
                  style={{width:"100%",minHeight:160,background:"rgba(12,12,20,0.96)",border:"1.5px solid rgba(255,255,255,0.18)",borderRadius:16,padding:"18px 20px",fontSize:15,fontFamily:"system-ui",color:"#f0ece4",resize:"none",outline:"none",lineHeight:1.65,boxSizing:"border-box"}}
                />
            }
            {!dumpConfirmed && <p style={{margin:0,textAlign:"center",fontSize:11,fontFamily:"system-ui",color:"rgba(255,255,255,0.28)"}}>Enter to capture · Esc to close · Shift+Enter for new line</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ZenDumpReview({tasks, pris, T, onSubmit, onDismiss, parsing}) {
  const [items, setItems] = useState(() => tasks.map(t=>({...t})));
  const activePris = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight);
  const updItem = (id,field,val) => setItems(prev=>prev.map(i=>i.id===id?{...i,[field]:val}:i));
  const remItem = (id) => setItems(prev=>prev.filter(i=>i.id!==id));
  return (
    <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,0.68)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}} onClick={onDismiss}>
      <div style={{width:"min(92vw,540px)",maxHeight:"80vh",display:"flex",flexDirection:"column",background:T.card,borderRadius:20,border:`1px solid ${T.brd}`,boxShadow:"0 12px 48px rgba(0,0,0,0.35)",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:"16px 20px 12px",borderBottom:`1px solid ${T.brd}`}}>
          <p style={{margin:0,fontSize:14,fontWeight:700,fontFamily:"system-ui",color:T.text}}>Brain Dump Review</p>
          <p style={{margin:"3px 0 0",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>
            {parsing?"AI is still parsing…":`${items.length} task${items.length===1?"":"s"} captured — adjust priorities and submit`}
          </p>
        </div>
        {/* Task list */}
        <div style={{overflowY:"auto",flex:1,padding:"6px 12px"}}>
          {items.map(item=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 4px",borderBottom:`1px solid ${T.brd}`}}>
              <input value={item.text} onChange={e=>updItem(item.id,'text',e.target.value)}
                style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:13,fontFamily:"system-ui",color:T.text,padding:"2px 0"}}/>
              <select value={item.priority} onChange={e=>updItem(item.id,'priority',e.target.value)}
                style={{background:T.bg,border:`1px solid ${T.brd}`,borderRadius:8,padding:"3px 6px",fontSize:11,fontFamily:"system-ui",color:T.text,cursor:"pointer",flexShrink:0}}>
                {activePris.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button onClick={()=>remItem(item.id)} style={{background:"none",border:"none",cursor:"pointer",color:T.tFaint,fontSize:18,padding:"0 2px",lineHeight:1,flexShrink:0}}>×</button>
            </div>
          ))}
          {items.length===0&&<p style={{textAlign:"center",color:T.tFaint,fontSize:13,fontFamily:"system-ui",padding:"24px 0"}}>No tasks to add</p>}
        </div>
        {/* Footer */}
        <div style={{padding:"12px 20px",borderTop:`1px solid ${T.brd}`,display:"flex",gap:10}}>
          <button onClick={onDismiss} style={{flex:1,padding:"10px",borderRadius:12,border:`1px solid ${T.brd}`,background:"transparent",fontSize:13,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,cursor:"pointer"}}>Dismiss</button>
          <button onClick={()=>onSubmit(items)} disabled={items.length===0}
            style={{flex:2,padding:"10px",borderRadius:12,border:"none",background:items.length>0?T.text:T.brd,fontSize:13,fontFamily:"system-ui",fontWeight:700,color:items.length>0?T.bg:T.tFaint,cursor:items.length>0?"pointer":"default"}}>
            Add {items.length} to Queue
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({active, onClick, icon, label, T}) {
  return <button onClick={onClick} style={{flex:1,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"10px 6px",border:"none",borderRadius:14,background:active?T.card:"transparent",boxShadow:active?"0 2px 12px rgba(0,0,0,0.06)":"none",color:active?T.text:T.tSoft,fontSize:11,fontWeight:active?600:400,cursor:"pointer",fontFamily:"system-ui",transition:"all 0.25s",whiteSpace:"nowrap"}}>{icon}{label}</button>;
}

function PriEditor({T, onAdd, onClose}) {
  const [l, setL] = useState("");
  const [c, setC] = useState(PALETTE[4]);
  return (
    <div style={{marginTop:12,background:T.bgW,borderRadius:12,padding:16,border:`1px solid ${T.brd}`}}>
      <input value={l} onChange={e=>setL(e.target.value)} placeholder="Priority name" style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1px solid ${T.brd}`,outline:"none",fontSize:14,fontFamily:"system-ui",background:T.card,color:T.text,marginBottom:12}}/>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
        {PALETTE.map(x => <button key={x} onClick={()=>setC(x)} style={{width:28,height:28,borderRadius:"50%",background:x,border:c===x?`3px solid ${T.text}`:"2px solid transparent",cursor:"pointer"}}/>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,borderRadius:10,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.tSoft}}>Cancel</button>
        <button onClick={()=>{if(l.trim()) onAdd(l.trim(), c);}} style={{flex:1,padding:10,borderRadius:10,border:"none",background:c,color:textOnColor(c),cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",opacity:l.trim()?1:.4}}>Add</button>
      </div>
    </div>
  );
}

// Just Start timer (S3)
function JustStartTimer({color, T, onDone, onMinimize}) {
  const [secs, setSecs] = useState(120);
  const [running, setRunning] = useState(true);
  const tickRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) { clearInterval(tickRef.current); setRunning(false); onDone?.(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [running]);

  const pct = secs / 120;
  const r = 22, circ = 2 * Math.PI * r;

  return (
    <div style={{display:"flex",alignItems:"center",gap:10,background:pBg(color),borderRadius:12,padding:"10px 14px",border:`1px solid ${color}40`}}>
      <svg width={54} height={54} style={{flexShrink:0}}>
        <circle cx={27} cy={27} r={r} fill="none" stroke={color+"30"} strokeWidth={4}/>
        <circle cx={27} cy={27} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" transform="rotate(-90 27 27)"/>
        <text x={27} y={27} textAnchor="middle" dominantBaseline="central"
          fontSize={11} fill={color} fontFamily="system-ui" fontWeight={700}>
          {secs >= 60 ? `${Math.floor(secs/60)}:${String(secs%60).padStart(2,"0")}` : secs + "s"}
        </text>
      </svg>
      <div>
        <p style={{fontSize:12,fontWeight:700,color,margin:0,fontFamily:"system-ui"}}>Just start — 2 minutes</p>
        <p style={{fontSize:11,color:T.tSoft,margin:0,fontFamily:"system-ui"}}>{secs > 0 ? "You only have to do this long." : "Great start! Keep going 🎉"}</p>
      </div>
      <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",gap:4}}>
        {onMinimize && <button onClick={onMinimize} style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.5}} title="Minimize">–</button>}
        <button onClick={()=>{clearInterval(tickRef.current);onDone?.();}} style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.5}} title="Dismiss"><span style={{fontSize:14}}>✕</span></button>
      </div>
    </div>
  );
}

// Body Double timer (S4)
function BodyDoubleTimer({T, minimized, onMinimize, onRestore, onClose}) {
  const PRESETS = [25*60, 45*60, 90*60];
  const LABELS = ["25 min", "45 min", "90 min"];
  const [dur, setDur] = useState(null);
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const tickRef = useRef(null);

  const start = (d) => { setDur(d); setSecs(d); setRunning(true); setDone(false); };
  const startCustom = () => { const m = parseInt(customMin); if (m > 0 && m <= 480) start(m * 60); };

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) { clearInterval(tickRef.current); setRunning(false); setDone(true); playCompletionSound(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [running]);

  const pct = dur ? secs / dur : 0;
  const R = 56, circ = 2 * Math.PI * R;
  const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  // Minimized: floating pill bottom-left
  if (minimized) {
    return (
      <div onClick={onRestore} style={{position:"fixed",bottom:16,left:16,zIndex:9200,background:"#3A7098",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",boxShadow:"0 2px 12px rgba(0,0,0,0.25)",animation:"ot-fade 0.2s"}}>
        <IC.Timer s={12} c="#fff"/>
        {dur && running && <span style={{fontSize:11,color:"#fff",fontFamily:"system-ui",fontWeight:700,letterSpacing:.5}}>{fmt(secs)}</span>}
        <span style={{fontSize:11,color:"rgba(255,255,255,0.8)",fontFamily:"system-ui"}}>Body Double</span>
        <button onClick={e=>{e.stopPropagation();onClose();}} style={{background:"none",border:"none",cursor:"pointer",padding:0,opacity:.7,marginLeft:2,fontSize:12,color:"#fff"}}>✕</button>
      </div>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:8600,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}}
      onClick={e=>{if(e.target===e.currentTarget) onMinimize?.();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"28px 24px",maxWidth:340,width:"100%",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h3 style={{fontSize:15,fontWeight:600,margin:0,display:"flex",alignItems:"center",gap:7}}><IC.Timer s={16} c={T.text}/>Body Double</h3>
          <div style={{display:"flex",gap:6}}>
            <button onClick={onMinimize} style={{background:"none",border:"none",cursor:"pointer",fontSize:17,color:T.tSoft,opacity:.6}} title="Minimize">–</button>
            <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:17,color:T.tSoft}}>✕</button>
          </div>
        </div>

        {!dur ? (
          <>
            <p style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 16px"}}>Work alongside a virtual partner. Pick your session length:</p>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:12}}>
              {PRESETS.map((o, i) => (
                <button key={o} onClick={()=>start(o)} style={{flex:1,padding:"12px 8px",borderRadius:12,border:`1.5px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",color:T.text}}>{LABELS[i]}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input type="number" min="1" max="480" value={customMin} onChange={e=>setCustomMin(e.target.value)} placeholder="Custom minutes" onKeyDown={e=>{if(e.key==="Enter")startCustom();}} style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,fontSize:13,fontFamily:"system-ui",outline:"none"}}/>
              <button onClick={startCustom} disabled={!customMin||parseInt(customMin)<1} style={{padding:"10px 16px",borderRadius:10,border:"none",background:customMin&&parseInt(customMin)>0?"#3A7098":T.brd,color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",opacity:customMin&&parseInt(customMin)>0?1:.4}}>Go</button>
            </div>
          </>
        ) : (
          <>
            <svg width={140} height={140} style={{margin:"0 auto 12px",display:"block"}}>
              <circle cx={70} cy={70} r={R} fill="none" stroke={T.brdS} strokeWidth={8}/>
              <circle cx={70} cy={70} r={R} fill="none" stroke={done?"#9BD4A0":"#7EB0DE"} strokeWidth={8}
                strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
                strokeLinecap="round" transform="rotate(-90 70 70)" style={{transition:"stroke-dashoffset 1s linear"}}/>
              <text x={70} y={66} textAnchor="middle" fontSize={22} fill={T.text} fontFamily="system-ui" fontWeight={700}>{fmt(secs)}</text>
              <text x={70} y={84} textAnchor="middle" fontSize={10} fill={T.tFaint} fontFamily="system-ui">{done?"Complete!":"remaining"}</text>
            </svg>
            <p style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 14px"}}>{done ? "Session complete! Great work 🎉" : "You're not alone. Keep going."}</p>
            <div style={{display:"flex",gap:8}}>
              {!done && <button onClick={()=>{clearInterval(tickRef.current);setRunning(p=>!p);}} style={{flex:1,padding:10,borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>{running?"Pause":"Resume"}</button>}
              <button onClick={()=>{clearInterval(tickRef.current);setDur(null);setDone(false);}} style={{flex:1,padding:10,borderRadius:10,border:"none",background:T.bgW,cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>Reset</button>
              <button onClick={onClose} style={{flex:1,padding:10,borderRadius:10,border:"none",background:"#3A7098",color:"#fff",cursor:"pointer",fontSize:12,fontFamily:"system-ui",fontWeight:600}}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// Brain Dump — stream of consciousness, AI-parsed (upgraded from S1)
function BrainDump({T, pris, onCapture, onClose}) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) return;
    onCapture(text.trim());
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:8600,background:"rgba(0,0,0,0.48)",display:"flex",alignItems:"center",justifyContent:"center",animation:"ot-fade 0.2s"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"24px 20px",maxWidth:480,width:"90%",maxHeight:"86vh",overflowY:"auto",boxShadow:"0 8px 40px rgba(0,0,0,0.22)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <h3 style={{fontSize:15,fontWeight:600,margin:0,fontFamily:"system-ui",display:"flex",alignItems:"center",gap:7}}><IC.Brain s={16} c={T.text}/>Brain Dump</h3>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:17,color:T.tSoft}}>✕</button>
        </div>
        <p style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",margin:"0 0 14px",lineHeight:1.5}}>
          Stream of consciousness — just type everything on your mind. AI will sort, prioritize, and break it into tasks.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") { onClose(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
          }}
          placeholder={"Call Dr. Weiss\nPrepare the shiur\nEmail Rav about the eruv question\nGroceries before Shabbos\n…just dump everything"}
          rows={9}
          style={{width:"100%",padding:"14px 16px",borderRadius:12,border:`1.5px solid ${T.brd}`,outline:"none",fontSize:14,fontFamily:"Georgia,serif",background:T.bgW,color:T.text,lineHeight:1.65,resize:"none",boxSizing:"border-box"}}
        />
        <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",margin:"8px 0 12px",textAlign:"center"}}>
          Enter to send · Shift+Enter for new line · Esc to close
        </p>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:11,borderRadius:12,border:`1px solid ${T.brd}`,background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft}}>Cancel</button>
          <button onClick={handleSubmit} disabled={!text.trim()} style={{flex:2,padding:11,borderRadius:12,border:"none",background:T.text,color:T.bg||"#fff",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",opacity:text.trim()?1:.4}}>
            Send to AI ✦
          </button>
        </div>
      </div>
    </div>
  );
}

// Overwhelm mode (S7) - shown when queue > threshold
function OverwhelmBanner({count, threshold, onShowAll, T}) {
  if (count <= threshold) return null;
  return (
    <div style={{background:pBg("#E0B472"),border:"1px solid #E0B47280",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:18}}>🌊</span>
      <div style={{flex:1}}>
        <p style={{fontSize:12,fontWeight:700,margin:0,fontFamily:"system-ui",color:"#8A6020"}}>Overwhelm mode</p>
        <p style={{fontSize:11,margin:0,fontFamily:"system-ui",color:"#8A6020"}}>Showing top 3 of {count}. Just focus on these.</p>
      </div>
      <button onClick={onShowAll} style={{fontSize:10,fontFamily:"system-ui",color:"#8A6020",background:"none",border:"1px solid #8A602040",borderRadius:6,padding:"4px 8px",cursor:"pointer"}}>Show all</button>
    </div>
  );
}

// PostItStack — completed task trophies
// Cards use PRIORITY COLORS only — no text label needed, color conveys priority
function PostItStack({tasks, pris, T, open, onToggle, onUncomp, onClone}) {
  const [sortBy, setSortBy] = useState("completed");
  const [viewMode, setViewMode] = useState("stack"); // "stack" | "board"
  const [fanned, setFanned] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selCard, setSelCard] = useState(null);
  const btnRef = useRef(null);
  const [btnRect, setBtnRect] = useState(null);

  const sortedTasks = useMemo(() => {
    const arr = [...tasks];
    switch(sortBy) {
      case "priority": return arr.sort((a,b) => {
        const pa = pris.findIndex(p=>p.id===a.priority), pb = pris.findIndex(p=>p.id===b.priority);
        return pa - pb;
      });
      case "entered": return arr.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      case "speed": return arr.sort((a,b) => {
        const da = (a.completedAt||0)-(a.createdAt||0), db = (b.completedAt||0)-(b.createdAt||0);
        return da - db;
      });
      default: return arr.sort((a,b) => (b.completedAt||0) - (a.completedAt||0));
    }
  }, [tasks, sortBy, pris]);
  const recent = sortedTasks.slice(0, 30);

  const openFan = () => {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    setFanned(true); setSelCard(null); setPaused(false);
  };
  const closeFan = () => { setFanned(false); setSelCard(null); };
  const handleStackClick = () => {
    if (open) { onToggle(); return; }
    if (fanned) { closeFan(); return; }
    openFan();
  };

  // Fan: vertical marquee column to left of stack button
  const cardW = 130, cardH = 80, cardGap = 10;
  const colHeight = window.innerHeight;
  // Cards doubled for seamless loop
  const fanCards = [...sortedTasks, ...sortedTasks];
  const totalScroll = sortedTasks.length * (cardH + cardGap);
  // Duration: ~40s for all, min 12s
  const scrollDur = Math.max(12, sortedTasks.length * 1.4);

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleStackClick}
        title={open ? "Close trophies" : `${tasks.length} completed ✦`}
        style={{position:"relative",background:"none",border:"none",cursor:"pointer",width:56,height:48,padding:0,flexShrink:0}}
      >
        {[...Array(Math.min(4, recent.length))].map((_, i) => {
          const tp = gP(pris, recent[i]?.priority);
          const isTop = i === 0;
          return (
            <div key={i} style={{position:"absolute",right:i*3,top:i*3,width:50,height:38,borderRadius:6,background:tp.color,border:"1px solid rgba(0,0,0,0.08)",boxShadow:"0 1px 4px rgba(0,0,0,0.1)",transform:`rotate(${(i-1)*3}deg)`,zIndex:4-i,transition:"all 0.3s",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 4px"}}>
              {isTop && <span style={{fontSize:7,color:textOnColor(tp.color),fontFamily:"system-ui",fontWeight:500,lineHeight:1.2,textAlign:"center",overflow:"hidden",maxHeight:"100%",wordBreak:"break-word"}}>{recent[0]?.text?.slice(0,24)}{recent[0]?.text?.length>24?"…":""}</span>}
            </div>
          );
        })}
        <span style={{position:"absolute",bottom:-4,left:-4,background:T.text,color:T.bg||"#fff",borderRadius:10,fontSize:11,fontFamily:"system-ui",fontWeight:700,padding:"1px 5px",zIndex:10,lineHeight:1.4}}>{tasks.length}</span>
      </button>

      {/* View toggle — visible on launchpad below the stacked cards */}
      {!open && (
        <div style={{display:"flex",gap:0,marginTop:3,justifyContent:"center"}}>
          <div onClick={e=>{e.stopPropagation();setViewMode("stack");onToggle();}} title="Stack view"
            style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",opacity:viewMode==="stack"?1:0.4,transition:"opacity 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=viewMode==="stack"?1:0.4}>
            <IC.Stack s={13} c={T.tSoft}/>
          </div>
          <div onClick={e=>{e.stopPropagation();setViewMode("board");onToggle();}} title="Board view"
            style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",opacity:viewMode==="board"?1:0.4,transition:"opacity 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=viewMode==="board"?1:0.4}>
            <IC.Bulk s={13} c={T.tSoft}/>
          </div>
        </div>
      )}

      {/* Marquee fan column */}
      {fanned && !open && btnRect && (
        <>
          <div onClick={closeFan} style={{position:"fixed",inset:0,zIndex:3500}}/>
          {/* "View all" pill above column */}
          <div style={{position:"fixed",left:btnRect.left - cardW - 14, top:btnRect.top - 36, zIndex:3600, animation:"ot-fan-out 0.3s both"}}>
            <button onClick={e=>{e.stopPropagation();closeFan();onToggle();}} style={{background:T.card||"#fff",border:`1px solid ${T.brd}`,borderRadius:18,padding:"5px 14px",cursor:"pointer",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:T.text,boxShadow:"0 2px 8px rgba(0,0,0,0.15)",whiteSpace:"nowrap"}}>
              View all {tasks.length} ✦
            </button>
          </div>
          {/* Scrolling column */}
          <div
            onClick={e=>e.stopPropagation()}
            onMouseEnter={()=>setPaused(true)}
            onMouseLeave={()=>{if(!selCard)setPaused(false);}}
            style={{
              position:"fixed",
              left: Math.max(8, btnRect.left - cardW - 14),
              top: 0,
              width: cardW,
              height: "100vh",
              overflow: "hidden",
              zIndex: 3510,
              pointerEvents:"auto",
            }}
          >
            {/* The scrolling strip — doubled cards for seamless loop */}
            <div style={{
              display:"flex",flexDirection:"column",gap:cardGap,
              animation:`ot-postit-scroll ${scrollDur}s linear infinite`,
              animationPlayState: paused ? "paused" : "running",
              paddingTop: cardH, // start below viewport edge
            }}>
              {fanCards.map((task, i) => {
                const p = gP(pris, task.priority);
                const isSel = selCard === task.id;
                return (
                  <div key={`${task.id}-${i}`}
                    onClick={e=>{e.stopPropagation(); setSelCard(isSel?null:task.id); setPaused(true);}}
                    style={{
                      width:cardW, minHeight:cardH, borderRadius:10,
                      border:`2px solid ${p.color}60`,
                      borderLeft:`4px solid ${p.color}`,
                      background: p.color + (isSel?"40":"22"),
                      boxShadow: isSel?`0 6px 20px ${p.color}50`:"0 2px 8px rgba(0,0,0,0.12)",
                      padding:"8px 9px",
                      display:"flex",flexDirection:"column",justifyContent:"space-between",
                      cursor:"pointer",
                      transform: isSel?"scale(1.05)":"scale(1)",
                      transition:"transform 0.2s,box-shadow 0.2s",
                      flexShrink:0,
                    }}>
                    <span style={{fontSize:11,lineHeight:1.35,color:T.text,fontFamily:"Georgia,serif",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",fontWeight:isSel?500:400}}>
                      {task.goodEnough&&<span style={{fontSize:9,opacity:.6,marginRight:2}}>≈</span>}
                      {task.text}
                    </span>
                    {isSel ? (
                      <div style={{display:"flex",gap:5,marginTop:5}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>{onClone&&onClone(task);closeFan();}} style={{flex:1,background:p.color+"40",border:"none",borderRadius:5,padding:"3px 0",cursor:"pointer",fontSize:10,fontFamily:"system-ui",color:T.text,fontWeight:600}}>↗ Clone</button>
                        <button onClick={()=>{onUncomp(task.id);closeFan();}} style={{flex:1,background:p.color+"60",border:"none",borderRadius:5,padding:"3px 0",cursor:"pointer",fontSize:10,fontFamily:"system-ui",color:T.text,fontWeight:600}}>↩ Undo</button>
                      </div>
                    ) : (
                      <span style={{fontSize:9,color:T.tFaint,fontFamily:"system-ui",textAlign:"right",marginTop:3}}>
                        {task.completedAt?new Date(task.completedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Full drawer */}
      {open && (
        <div style={{position:"fixed",inset:0,zIndex:3000,display:"flex",justifyContent:"flex-end"}}>
          <div onClick={onToggle} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.22)",animation:"ot-fade 0.2s"}}/>
          <div onClick={e=>e.stopPropagation()} style={{position:"relative",width:"min(460px, 92vw)",height:"100vh",background:T.bg||"#f5f0e8",boxShadow:"-4px 0 24px rgba(0,0,0,0.12)",overflowY:"auto",overflowX:"hidden",padding:"20px 18px 40px",animation:"ot-fade 0.25s",zIndex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,position:"sticky",top:0,background:T.bg||"#f5f0e8",paddingBottom:8,zIndex:5}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:600,margin:0,fontFamily:"Georgia,serif"}}>Completed</h3>
                <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",margin:0}}>{tasks.length} task{tasks.length!==1?"s":""} conquered</p>
              </div>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <button onClick={()=>setViewMode("stack")} title="Stack view" style={{background:viewMode==="stack"?T.text:(T.card||"#fff"),border:`1px solid ${T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:11,fontFamily:"system-ui",fontWeight:600,color:viewMode==="stack"?(T.bg||"#fff"):T.tSoft,transition:"all 0.15s"}}><IC.Stack s={12} c={viewMode==="stack"?(T.bg||"#fff"):T.tSoft}/>Stack</button>
                <button onClick={()=>setViewMode("board")} title="Board view" style={{background:viewMode==="board"?T.text:(T.card||"#fff"),border:`1px solid ${T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:11,fontFamily:"system-ui",fontWeight:600,color:viewMode==="board"?(T.bg||"#fff"):T.tSoft,transition:"all 0.15s"}}><IC.Bulk s={12} c={viewMode==="board"?(T.bg||"#fff"):T.tSoft}/>Board</button>
                <button onClick={onToggle} style={{background:T.bgW,border:`1px solid ${T.brd}`,borderRadius:10,padding:"6px 14px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",fontWeight:600,color:T.tSoft}}>Close</button>
              </div>
            </div>
            <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap",position:"sticky",top:48,background:T.bg||"#f5f0e8",paddingBottom:6,zIndex:4}}>
              {[["completed","Recent"],["priority","Priority"],["speed","Fastest"],["entered","Date added"]].map(([k,l])=>(
                <button key={k} onClick={()=>setSortBy(k)} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${sortBy===k?T.text:T.brd}`,background:sortBy===k?T.text:"transparent",color:sortBy===k?(T.bg||"#fff"):T.tSoft,fontSize:11,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>{l}</button>
              ))}
            </div>
            {viewMode === "board" ? (
              <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {sortedTasks.map((task, i) => {
                  const p = gP(pris, task.priority);
                  const compTime = task.completedAt && task.createdAt ? Math.round((task.completedAt - task.createdAt) / 60000) : null;
                  const compLabel = compTime !== null ? (compTime < 60 ? `${compTime}m` : compTime < 1440 ? `${Math.round(compTime/60)}h` : `${Math.round(compTime/1440)}d`) : "";
                  return (
                    <div key={task.id}
                      style={{background:p.color+"20",borderRadius:10,padding:"14px 14px 10px",borderTop:`4px solid ${p.color}`,boxShadow:"0 2px 8px rgba(0,0,0,0.08)",display:"flex",flexDirection:"column",gap:8,animation:`ot-postit-in 0.25s cubic-bezier(.22,1.2,.36,1) ${i*15}ms both`,minHeight:90,gridColumn:i===sortedTasks.length-1&&sortedTasks.length%2!==0?"span 2":"auto"}}
                    >
                      <p style={{fontSize:13,lineHeight:1.5,margin:0,color:T.text,fontFamily:"Georgia,serif",wordBreak:"break-word",flex:1}}>
                        {task.goodEnough && <span style={{fontSize:9,opacity:.6,marginRight:3}}>≈</span>}
                        {task.text}
                      </p>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontSize:8,color:T.tFaint,fontFamily:"system-ui"}}>{task.completedAt?new Date(task.completedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}</span>
                          {compLabel && <span style={{fontSize:8,color:T.tFaint,fontFamily:"system-ui",opacity:.7}}>({compLabel})</span>}
                        </div>
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          <button onClick={()=>onClone&&onClone(task)} title="Clone" style={{background:"none",border:"none",cursor:"pointer",padding:"2px 3px",borderRadius:4,display:"flex",alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW||"rgba(0,0,0,0.06)"} onMouseLeave={e=>e.currentTarget.style.background="none"}><IC.Clone s={10} c={T.tFaint}/></button>
                          <button onClick={()=>onUncomp(task.id)} title="Undo" style={{fontSize:10,color:T.tFaint,background:"none",border:"none",cursor:"pointer",padding:"2px 3px",borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW||"rgba(0,0,0,0.06)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>↩</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {sortedTasks.length > 0 && (
                <p style={{textAlign:"center",fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:10,padding:"4px 8px"}}>
                  {sortedTasks.length} task{sortedTasks.length===1?"":"s"} completed ✦
                </p>
              )}
              </>
            ) : (
              <div style={{position:"relative"}}>
                {recent.map((task, i) => {
                  const p = gP(pris, task.priority);
                  const xShift = (i % 3 - 1) * 4;
                  const rot = ((i % 5) - 2) * 1.0;
                  const compTime = task.completedAt && task.createdAt ? Math.round((task.completedAt - task.createdAt) / 60000) : null;
                  const compLabel = compTime !== null ? (compTime < 60 ? `${compTime}m` : compTime < 1440 ? `${Math.round(compTime/60)}h` : `${Math.round(compTime/1440)}d`) : "";
                  return (
                    <div key={task.id}
                      style={{position:"relative",marginTop:i===0?0:-8,marginLeft:xShift,background:p.color+"25",borderRadius:12,boxShadow:"0 2px 10px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)",padding:"18px 18px 14px",borderLeft:`5px solid ${p.color}`,transform:`rotate(${rot}deg)`,transition:"all 0.2s",cursor:"default",zIndex:i+1,minHeight:70,animation:`ot-postit-in 0.3s cubic-bezier(.22,1.2,.36,1) ${i*20}ms both`}}
                      onMouseEnter={e=>{e.currentTarget.style.transform="rotate(0deg) scale(1.02)";e.currentTarget.style.zIndex=100;e.currentTarget.style.marginTop=i===0?"0":"0";}}
                      onMouseLeave={e=>{e.currentTarget.style.transform=`rotate(${rot}deg)`;e.currentTarget.style.zIndex=i+1;e.currentTarget.style.marginTop=i===0?"0":"-8px";}}
                    >
                      <p style={{fontSize:15,lineHeight:1.55,margin:"0 0 10px",color:T.text,fontFamily:"Georgia,serif",wordBreak:"break-word"}}>
                        {task.goodEnough && <span style={{fontSize:10,opacity:.6,marginRight:3}}>≈</span>}
                        {task.text}
                      </p>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>{task.completedAt?new Date(task.completedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}</span>
                          {compLabel && <span style={{fontSize:8,color:T.tFaint,fontFamily:"system-ui",opacity:.7}}>({compLabel})</span>}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <button onClick={()=>onClone&&onClone(task)} title="Clone" style={{fontSize:11,color:T.tFaint,background:"none",border:"none",cursor:"pointer",fontFamily:"system-ui",padding:"2px 4px",borderRadius:4,display:"flex",alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW||"rgba(0,0,0,0.06)"} onMouseLeave={e=>e.currentTarget.style.background="none"}><IC.Clone s={11} c={T.tFaint}/></button>
                          <button onClick={()=>onUncomp(task.id)} title="Undo" style={{fontSize:10,color:T.tFaint,background:"none",border:"none",cursor:"pointer",fontFamily:"system-ui",padding:"2px 4px",borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW||"rgba(0,0,0,0.06)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>↩</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {tasks.length > 30 && (
                  <p style={{textAlign:"center",fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:16,padding:8}}>Showing most recent 30 of {tasks.length}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}


// ──────────────────────────────────────────────────────────────────
// BlockReflectModal — "What's in the way?" + Gemini AI suggestions
// ──────────────────────────────────────────────────────────────────
function BlockReflectModal({task, T, aiOpts, onClose}) {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [selReason, setSelReason] = React.useState(null);
  const [freeText, setFreeText] = React.useState("");
  const reasons = [
    {label:"Too vague",            emoji:"🌫️", desc:"Not sure what to actually do"},
    {label:"Too big",              emoji:"🏔️", desc:"It feels overwhelming"},
    {label:"Waiting on something", emoji:"🔗", desc:"Something else must happen first"},
    {label:"Just not starting",    emoji:"⚡", desc:"Starting is the hard part"},
  ];

  async function analyze(reason) {
    setSelReason(reason); setLoading(true); setResult(null);
    const d = task.createdAt ? Math.floor(getTaskAgeHours(task) / 24) : 0;
    const ageStr = d > 0 ? ` that has been waiting ${d} day${d !== 1 ? "s" : ""}` : "";
    const obstacleStr = reason.isFreewrite
      ? `"${reason.desc}"`
      : `"${reason.label} — ${reason.desc}"`;
    const prompt = `An ADHD user is stuck on a task${ageStr}: "${task.text}"\n\nThe obstacle they described: ${obstacleStr}\n\nGive exactly 3 concrete, practical suggestions to get unstuck. Each under 2 sentences. Be direct and specific to this task. Format exactly as:\n1. ...\n2. ...\n3. ...`;
    try {
      const r = await callAI(prompt, aiOpts);
      setResult(r || "1. Break it into the single smallest next action.\n2. Set a 5-minute timer and start anywhere — just begin.\n3. Tell someone what you're about to do right now.");
    } catch(e) {
      setResult("1. Break it into the single smallest next action.\n2. Set a 5-minute timer and start anywhere — just begin.\n3. Tell someone what you're about to do right now.");
    }
    setLoading(false);
  }

  function submitFreewrite() {
    if (!freeText.trim()) return;
    analyze({label:"Your description", emoji:"✍️", desc:freeText.trim(), isFreewrite:true});
  }

  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10010,animation:"ot-fade 0.2s"}}/>
      <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",zIndex:10011,background:T.card,borderRadius:24,padding:"28px 28px 24px",width:"min(480px,92vw)",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,0.18)",animation:"ot-reveal 0.25s",fontFamily:"system-ui"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <h3 style={{margin:"0 0 4px",fontSize:17,fontWeight:600,color:T.text}}>What's in the way?</h3>
            <p style={{margin:0,fontSize:11,color:T.tFaint,maxWidth:340,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.text}</p>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:T.tFaint,padding:"0 0 0 12px",lineHeight:1}}>×</button>
        </div>

        {!selReason && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {reasons.map(r => (
                <button key={r.label} onClick={()=>analyze(r)}
                  style={{background:T.bg,border:`1px solid ${T.brd}`,borderRadius:14,padding:"16px 14px",cursor:"pointer",textAlign:"left",transition:"all 0.15s",fontFamily:"system-ui"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,0.08)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.boxShadow="none";}}>
                  <div style={{fontSize:22,marginBottom:6}}>{r.emoji}</div>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:3}}>{r.label}</div>
                  <div style={{fontSize:11,color:T.tFaint,lineHeight:1.4}}>{r.desc}</div>
                </button>
              ))}
            </div>

            <div style={{marginTop:14,borderTop:`1px solid ${T.brd}`,paddingTop:14}}>
              <p style={{margin:"0 0 8px",fontSize:11,color:T.tFaint,fontWeight:500,letterSpacing:.3}}>OR — DESCRIBE IT YOURSELF</p>
              <textarea
                value={freeText}
                onChange={e=>setFreeText(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))submitFreewrite();}}
                placeholder="What's actually stopping you? Write it out…"
                rows={3}
                style={{width:"100%",boxSizing:"border-box",background:T.bg,border:`1px solid ${T.brd}`,borderRadius:12,padding:"10px 12px",fontSize:13,color:T.text,fontFamily:"Georgia,serif",resize:"vertical",outline:"none",lineHeight:1.6}}
              />
              <button onClick={submitFreewrite} disabled={!freeText.trim()}
                style={{marginTop:8,width:"100%",padding:"9px 0",fontSize:12,fontFamily:"system-ui",fontWeight:600,background:freeText.trim()?T.brdS:"none",color:freeText.trim()?T.card:T.tFaint,border:`1px solid ${freeText.trim()?T.brdS:T.brd}`,borderRadius:10,cursor:freeText.trim()?"pointer":"default",transition:"all 0.15s",letterSpacing:.3}}>
                ✍️ Analyze this
              </button>
            </div>
          </>
        )}

        {selReason && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"10px 14px",background:T.bg,borderRadius:10,border:`1px solid ${T.brd}`}}>
              <span style={{fontSize:18}}>{selReason.emoji}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.tSoft}}>{selReason.isFreewrite ? `"${selReason.desc.length > 60 ? selReason.desc.slice(0,60)+"…" : selReason.desc}"` : selReason.label}</span>
            </div>

            {loading && (
              <div style={{textAlign:"center",padding:"28px 0"}}>
                <div style={{width:28,height:28,border:`3px solid ${T.brd}`,borderTopColor:T.tSoft,borderRadius:"50%",animation:"ot-spin 0.8s linear infinite",margin:"0 auto 10px"}}/>
                <p style={{color:T.tFaint,fontSize:12,margin:0}}>Thinking of ways around this…</p>
              </div>
            )}

            {result && !loading && (
              <div style={{animation:"ot-fade 0.3s"}}>
                <div style={{background:T.bg,borderRadius:14,padding:"16px 18px",marginBottom:14,border:`1px solid ${T.brd}`}}>
                  {result.split("\n").filter(l=>l.trim()).map((line, i) => (
                    <p key={i} style={{margin:i===0?"0":"10px 0 0",fontSize:13,color:T.text,lineHeight:1.65,fontFamily:"system-ui"}}>{line}</p>
                  ))}
                </div>
                <button onClick={()=>{setSelReason(null);setResult(null);}}
                  style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:T.tFaint,padding:0,textDecoration:"underline",fontFamily:"system-ui"}}>
                  ← Try a different reason
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// ShailaManager — bullet list: date, Q, A, askedBy, answeredBy, got-back status
// ──────────────────────────────────────────────────────────────────
// Statuses: researching | have_answer | got_back
// ──────────────────────────────────────────────────────────────────
function ShailaManager({AS, T, aiOpts, onSaveField, onGotBack, onAddManual, onClose}) {
  const pris = AS?.priorities || DEF_PRI;
  const GOLD = "#C8A84C";
  // Status palette
  const CLR_RESEARCHING = "#C87C6E"; // soft terracotta — no answer yet
  const CLR_HAVE_ANSWER = "#C8A84C"; // gold — answered, waiting to get back
  const CLR_GOT_BACK    = "#6AB87D"; // soft green — answered and got back

  // All shaila-priority tasks across all lists
  const allShailaTasks = (AS?.lists || []).flatMap(l =>
    l.tasks.filter(t => pris.find(x => x.id === t.priority)?.isShaila)
  );

  // Master list sorted by createdAt ascending — used for permanent numbering
  const allShailasByAge = allShailaTasks
    .filter(t => !t.isGetBackStep)
    .sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

  // Index map: id → 1-based number (stable, by submission order)
  const shailaNumberMap = React.useMemo(() => {
    const m = {};
    allShailasByAge.forEach((s, i) => { m[s.id] = i + 1; });
    return m;
  }, [allShailaTasks.length]);

  // Display list (newest first by default)
  const allShailas = [...allShailasByAge].reverse();

  const [localEdits, setLocalEdits]   = React.useState({});
  const [copyDone, setCopyDone]       = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);
  // "researching" | "have_answer" | both (null = default newest-first, non-status sort)
  const [sortFirst, setSortFirst]     = React.useState(null); // null | "researching" | "have_answer"
  const [statusFilter, setStatusFilter] = React.useState(null); // null | "researching" | "have_answer" | "got_back"
  const [confettiActive, setConfettiActive] = React.useState(false);
  // Manual add form — opens with blank fields, no Save button (autosave on blur)
  const [addingNew, setAddingNew]     = React.useState(false);
  const [newForm, setNewForm]         = React.useState({text:"", shailaAnswer:"", askedBy:"", answeredBy:""});
  const [micField, setMicField]       = React.useState(null); // which field has active mic
  const micRecRef                     = React.useRef(null);

  function getF(s, field) {
    return localEdits[s.id]?.[field] !== undefined
      ? localEdits[s.id][field]
      : (s[field] || "");
  }
  function setF(id, field, val) {
    setLocalEdits(p => ({...p, [id]: {...(p[id]||{}), [field]: val}}));
  }

  // Q text: subtask entries store the question in shailaQuestion (or parentTask), old tasks in text
  function getQ(s) {
    const override = localEdits[s.id]?.shailaQuestion;
    if (override !== undefined) return override;
    return s.shailaQuestion || (s.parentTask && s.parentTask !== s.text ? s.parentTask : null) || s.text || "";
  }
  function saveQ(s, val) {
    const field = (s.parentTask) ? "shailaQuestion" : "text";
    setF(s.id, "shailaQuestion", val);
    onSaveField(s.id, field, val);
  }

  // Derive got-back status: explicit field OR step-2 subtask completed
  function isGotBack(s) {
    if (getF(s, "gotBackToAsker") === true || s.gotBackToAsker === true) return true;
    if (s.parentTask) {
      const step2 = allShailaTasks.find(t => t.parentTask === s.parentTask && t.isGetBackStep);
      return step2?.completed || false;
    }
    return false;
  }

  // 3-state status: "researching" | "have_answer" | "got_back"
  function shailaStatus(s) {
    if (isGotBack(s)) return "got_back";
    if (getF(s, "shailaAnswer").trim()) return "have_answer";
    return "researching";
  }

  function statusSortWeight(s, first) {
    const st = shailaStatus(s);
    if (first === "researching") {
      // researching (latest first within group) / have_answer / got_back
      if (st === "researching") return 0;
      if (st === "have_answer") return 1;
      return 2;
    } else {
      // have_answer / researching / got_back
      if (st === "have_answer") return 0;
      if (st === "researching") return 1;
      return 2;
    }
  }

  const sorted = (() => {
    let base;
    if (sortFirst) {
      base = [...allShailas].sort((a,b) => {
        const wA = statusSortWeight(a, sortFirst), wB = statusSortWeight(b, sortFirst);
        if (wA !== wB) return wA - wB;
        // Within same group: researching = latest first, others = newest first too
        return (b.createdAt||0) - (a.createdAt||0);
      });
    } else {
      base = allShailas; // newest-first default
    }
    return statusFilter ? base.filter(s => shailaStatus(s) === statusFilter) : base;
  })();

  const statusLabel = {
    researching: "Researching",
    have_answer: "Have answer — not yet got back",
    got_back:    "Got back to asker ✓"
  };
  const statusShort = { researching: "researching", have_answer: "have answer", got_back: "got back" };
  const statusColor = { researching: CLR_RESEARCHING, have_answer: CLR_HAVE_ANSWER, got_back: CLR_GOT_BACK };

  function cycleGotBack(s) {
    const st = shailaStatus(s);
    if (st === "researching") return; // need an answer first
    const next = st === "have_answer"; // have_answer→true, got_back→false (undo)
    setF(s.id, "gotBackToAsker", next);
    if (onGotBack) onGotBack(s.id, next);
    if (next) {
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 2800);
      if (AS?.completionSound !== false) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = "sine"; osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.13;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t); osc.stop(t + 0.6);
          });
        } catch(e) {}
      }
    }
  }

  // ── Voice capture for manual-add form fields ──
  function startFieldMic(fieldName) {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Rec();
    r.lang = "en-US"; r.continuous = false; r.interimResults = false;
    r.onresult = e => {
      const transcript = cleanYT(e.results[0][0].transcript || "");
      setNewForm(p => ({...p, [fieldName]: (p[fieldName] ? p[fieldName] + " " : "") + transcript}));
      setMicField(null);
    };
    r.onerror = () => setMicField(null);
    r.onend   = () => setMicField(null);
    micRecRef.current = r;
    r.start();
    setMicField(fieldName);
  }
  function stopFieldMic() {
    micRecRef.current?.stop();
    setMicField(null);
  }

  function submitNewShaila() {
    // Called on blur of last field — only submits if the question has content
    if (!newForm.text.trim()) return;
    if (onAddManual) onAddManual({...newForm});
    setNewForm({text:"", shailaAnswer:"", askedBy:"", answeredBy:""});
    setAddingNew(false);
  }

  // Auto-submit when user blurs out of any field (if question is filled)
  function handleNewFormBlur(field, val) {
    const updated = {...newForm, [field]: val};
    setNewForm(updated);
    // Commit if question is filled (don't need all fields)
    if (updated.text.trim() && onAddManual) {
      // Wait a tick to see if focus moves to another field in the same form
      setTimeout(() => {
        // Check if focus stayed in form — use document.activeElement
        const active = document.activeElement;
        const inForm = active && active.closest('[data-new-shaila-form]');
        if (!inForm) {
          onAddManual({...updated});
          setNewForm({text:"", shailaAnswer:"", askedBy:"", answeredBy:""});
          setAddingNew(false);
        }
      }, 120);
    }
  }

  function buildText() {
    const out = ["SHAILA LOG", "==========", ""];
    // Use age-sorted list for numbered output
    allShailasByAge.forEach((s, i) => {
      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}) : "unknown date";
      const askedBy   = getF(s,"askedBy");
      const answeredBy= getF(s,"answeredBy");
      const st = shailaStatus(s);
      out.push(`${i+1}. [${dateStr}] — ${statusShort[st]}`);
      if (askedBy)    out.push(`   Asked by: ${askedBy}`);
      if (answeredBy) out.push(`   Answered by: ${answeredBy}`);
      out.push(`   Q: ${getQ(s)}`);
      const a = getF(s,"shailaAnswer");
      if (a) out.push(`   A: ${a}`);
      out.push("");
    });
    return out.join("\n");
  }

  function downloadAll() {
    const blob = new Blob([buildText()], {type:"text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "shaila-log.txt"; a.click();
    URL.revokeObjectURL(url);
  }

  function copyAll() {
    navigator.clipboard.writeText(buildText()).then(()=>{
      setCopyDone(true); setTimeout(()=>setCopyDone(false), 2000);
    }).catch(()=>{});
  }

  async function detectAllAnswers() {
    if (!aiOpts || bulkLoading) return;
    const unanswered = allShailas.filter(s => !getF(s,"shailaAnswer").trim());
    if (!unanswered.length) return;
    setBulkLoading(true);
    try {
      const results = await aiDetectShailaAnswers(unanswered, aiOpts);
      results.forEach(({id, answer}) => {
        setF(id,"shailaAnswer",answer);
        onSaveField(id,"shailaAnswer",answer);
      });
    } catch(e) {}
    setBulkLoading(false);
  }

  const inputSt = (extra) => ({
    width:"100%", boxSizing:"border-box",
    fontSize:12, fontFamily:"Georgia,serif",
    border:`1px solid ${T.brd}`, borderRadius:6,
    padding:"5px 8px", background:T.bgW||T.bg, color:T.text,
    outline:"none", resize:"vertical", lineHeight:1.5,
    ...extra,
  });
  const labelSt = {fontSize:9,color:T.tFaint,fontWeight:700,letterSpacing:1,marginBottom:2,fontFamily:"system-ui"};
  const micBtnSt = (active) => ({
    width:28, height:28, borderRadius:"50%",
    border:`1px solid ${active?"#B87A5A":T.brd}`,
    background:active?"#B87A5A20":T.bgW||T.bg, flexShrink:0,
    display:"flex", alignItems:"center", justifyContent:"center",
    cursor:"pointer",
  });

  return (
    <>
      {confettiActive && <Confetti colors={["#2ECC71","#C8A84C","#27AE60","#F1C40F","#1ABC9C","#58D68D"]}/>}
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:10010,animation:"ot-fade 0.2s"}}/>
      <div style={{position:"fixed",top:0,right:0,height:"100vh",width:"min(560px,100vw)",background:T.bg,zIndex:10011,boxShadow:"-4px 0 32px rgba(0,0,0,0.15)",display:"flex",flexDirection:"column",animation:"ot-slide-in-right 0.3s cubic-bezier(.22,1,.36,1)",fontFamily:"system-ui"}}>

        {/* Header */}
        <div style={{padding:"18px 20px 12px",borderBottom:`1px solid ${T.brd}`,flexShrink:0,background:T.card}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <h3 style={{margin:"0 0 1px",fontSize:16,fontWeight:600,color:T.text}}>&#x2721; Shaila Log</h3>
              <p style={{margin:0,fontSize:11,color:T.tFaint}}>{allShailas.length} shailo{allShailas.length!==1?"s":""}</p>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              {/* Sort buttons */}
              <button onClick={()=>setSortFirst(f=>f==="researching"?null:"researching")}
                style={{fontSize:11,color:sortFirst==="researching"?CLR_RESEARCHING:T.tFaint,background:"none",border:`1px solid ${sortFirst==="researching"?CLR_RESEARCHING:T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"system-ui",transition:"color 0.2s,border-color 0.2s"}}>
                ↕ Researching first
              </button>
              <button onClick={()=>setSortFirst(f=>f==="have_answer"?null:"have_answer")}
                style={{fontSize:11,color:sortFirst==="have_answer"?CLR_HAVE_ANSWER:T.tFaint,background:"none",border:`1px solid ${sortFirst==="have_answer"?CLR_HAVE_ANSWER:T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"system-ui",transition:"color 0.2s,border-color 0.2s"}}>
                ↕ Have answer first
              </button>
              {aiOpts && (
                <button onClick={detectAllAnswers} disabled={bulkLoading} style={{fontSize:11,color:GOLD,background:"none",border:`1px solid ${GOLD}60`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"system-ui",opacity:bulkLoading?0.6:1}}>
                  {bulkLoading ? "Detecting..." : "&#x2721; Detect answers"}
                </button>
              )}
              <button onClick={copyAll} style={{fontSize:11,color:copyDone?"#2ECC71":T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"system-ui",transition:"color 0.2s"}}>
                {copyDone ? "Copied!" : "Copy all"}
              </button>
              <button onClick={downloadAll} style={{fontSize:11,color:T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"system-ui"}}>Download</button>
              <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:T.tFaint,padding:"0 0 0 6px",lineHeight:1}}>&times;</button>
            </div>
          </div>
          {/* "New Shaila" toggle button */}
          <button
            onClick={()=>setAddingNew(p=>!p)}
            style={{width:"100%",padding:"8px 0",borderRadius:10,border:`1.5px dashed ${addingNew?T.text:T.brd}`,background:addingNew?T.bgW:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:addingNew?T.text:T.tSoft,display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all 0.15s"}}>
            {addingNew ? "✕ Cancel new shaila" : "+ Add shaila manually"}
          </button>
        </div>

        {/* Manual-add form (slides open under header) — autosaves on blur, no Save button */}
        {addingNew && (
          <div data-new-shaila-form="true" style={{padding:"14px 20px 16px",borderBottom:`1px solid ${T.brd}`,background:T.bgW||T.bg,flexShrink:0}}>
            <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:T.tSoft,fontFamily:"system-ui",letterSpacing:.5}}>NEW SHAILA — fill in what you have, click away when done</p>

            {/* Question */}
            <div style={{marginBottom:10}}>
              <div style={labelSt}>Q — SHAILA</div>
              <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                <textarea value={newForm.text} rows={2}
                  onChange={e=>setNewForm(p=>({...p,text:e.target.value}))}
                  onBlur={e=>handleNewFormBlur("text",e.target.value)}
                  placeholder="Write or speak the shaila…"
                  style={inputSt({flex:1,minHeight:48})}
                />
                <button onClick={micField==="text"?stopFieldMic:()=>startFieldMic("text")} style={micBtnSt(micField==="text")} title={micField==="text"?"Stop recording":"Speak question"}>
                  {micField==="text" ? <div style={{width:8,height:8,borderRadius:2,background:"#B87A5A"}}/> : <IC.Mic s={13} c={T.tSoft}/>}
                </button>
              </div>
            </div>

            {/* Answer */}
            <div style={{marginBottom:10}}>
              <div style={labelSt}>A — ANSWER (optional)</div>
              <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                <textarea value={newForm.shailaAnswer} rows={2}
                  onChange={e=>setNewForm(p=>({...p,shailaAnswer:e.target.value}))}
                  onBlur={e=>handleNewFormBlur("shailaAnswer",e.target.value)}
                  placeholder="Answer (optional)…"
                  style={inputSt({flex:1,minHeight:48})}
                />
                <button onClick={micField==="shailaAnswer"?stopFieldMic:()=>startFieldMic("shailaAnswer")} style={micBtnSt(micField==="shailaAnswer")} title={micField==="shailaAnswer"?"Stop":"Speak answer"}>
                  {micField==="shailaAnswer" ? <div style={{width:8,height:8,borderRadius:2,background:"#B87A5A"}}/> : <IC.Mic s={13} c={T.tSoft}/>}
                </button>
              </div>
            </div>

            {/* Asked by / Answered by */}
            <div style={{display:"flex",gap:8,marginBottom:4}}>
              <div style={{flex:1}}>
                <div style={labelSt}>ASKED BY</div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input value={newForm.askedBy} placeholder="Name…"
                    onChange={e=>setNewForm(p=>({...p,askedBy:e.target.value}))}
                    onBlur={e=>handleNewFormBlur("askedBy",e.target.value)}
                    style={inputSt({resize:"none",flex:1})}
                  />
                  <button onClick={micField==="askedBy"?stopFieldMic:()=>startFieldMic("askedBy")} style={micBtnSt(micField==="askedBy")} title="Speak">
                    {micField==="askedBy"?<div style={{width:8,height:8,borderRadius:2,background:"#B87A5A"}}/>:<IC.Mic s={11} c={T.tSoft}/>}
                  </button>
                </div>
              </div>
              <div style={{flex:1}}>
                <div style={labelSt}>ANSWERED BY</div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input value={newForm.answeredBy} placeholder="Rabbi…"
                    onChange={e=>setNewForm(p=>({...p,answeredBy:e.target.value}))}
                    onBlur={e=>handleNewFormBlur("answeredBy",e.target.value)}
                    style={inputSt({resize:"none",flex:1})}
                  />
                  <button onClick={micField==="answeredBy"?stopFieldMic:()=>startFieldMic("answeredBy")} title="Speak" style={micBtnSt(micField==="answeredBy")}>
                    {micField==="answeredBy"?<div style={{width:8,height:8,borderRadius:2,background:"#B87A5A"}}/>:<IC.Mic s={11} c={T.tSoft}/>}
                  </button>
                </div>
              </div>
            </div>
            <p style={{margin:"6px 0 0",fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>Fields save automatically when you click away</p>
          </div>
        )}

        {/* Status legend / filter */}
        <div style={{padding:"8px 20px",borderBottom:`1px solid ${T.brd}`,background:T.card,display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
          <span style={{fontSize:9,color:T.tFaint,fontFamily:"system-ui",fontWeight:700,letterSpacing:.5,marginRight:4}}>FILTER:</span>
          {[["researching",CLR_RESEARCHING,"Researching"],["have_answer",CLR_HAVE_ANSWER,"Have answer"],["got_back",CLR_GOT_BACK,"Got back"]].map(([k,c,lbl])=>{
            const active = statusFilter === k;
            return (
              <button key={k} onClick={()=>setStatusFilter(p=>p===k?null:k)}
                style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontFamily:"system-ui",cursor:"pointer",padding:"3px 8px",borderRadius:10,border:`1px solid ${active?c:T.brd}`,background:active?`${c}22`:"transparent",color:active?c:T.tFaint,transition:"all 0.15s",fontWeight:active?700:400}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block",flexShrink:0}}/>
                {lbl}
              </button>
            );
          })}
          {statusFilter && (
            <button onClick={()=>setStatusFilter(null)}
              style={{fontSize:10,color:T.tFaint,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",fontFamily:"system-ui",marginLeft:2,opacity:.7}}>
              ✕ clear
            </button>
          )}
        </div>

        {/* Bullet list */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 20px 20px"}}>
          {sorted.length === 0 && (
            <p style={{color:T.tFaint,fontSize:13,textAlign:"center",marginTop:40,lineHeight:1.8}}>
              {statusFilter ? `No "${statusShort[statusFilter]}" shailos.` : <>No shailos yet.<br/>Add tasks with the Shaila priority{onAddManual?", or use \"+ Add shaila manually\" above":""}.</>}
            </p>
          )}
          {sorted.map((s) => {
            const shailaNum = shailaNumberMap[s.id] || "?";
            const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
            const st = shailaStatus(s);
            const stColor = statusColor[st];
            const stTip = statusLabel[st];
            const canCycle = st !== "researching";
            return (
              <div key={s.id} style={{display:"flex",gap:10,paddingBottom:18,marginBottom:18,borderBottom:`1px solid ${T.brd}`}}>
                {/* Number + status dot */}
                <div style={{flexShrink:0,width:28,paddingTop:2,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
                  <span style={{fontSize:12,color:GOLD,fontWeight:700,fontFamily:"system-ui"}}>{shailaNum}.</span>
                  <button
                    title={canCycle ? (st==="have_answer" ? "Mark: got back to asker" : "Undo: not yet got back") : "Add an answer first"}
                    onClick={()=>cycleGotBack(s)}
                    style={{
                      width:13,height:13,borderRadius:"50%",border:"none",padding:0,cursor:canCycle?"pointer":"default",
                      background:stColor,flexShrink:0,
                      boxShadow:`0 0 0 2px ${stColor}40`,
                      opacity:canCycle?1:0.75,
                      transition:"background 0.2s,box-shadow 0.2s",
                    }}
                    aria-label={stTip}
                  />
                </div>
                {/* Content */}
                <div style={{flex:1,minWidth:0}}>
                  {/* Date + status label */}
                  {dateStr && (
                    <div style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",marginBottom:5}}>
                      #{shailaNum} · {dateStr}
                      {s.completed ? " · completed" : ""}
                      {" · "}
                      <span style={{color:stColor,fontWeight:600}}>{stTip}</span>
                    </div>
                  )}
                  {/* Got back pill — prominent, above Q/A */}
                  {(st === "have_answer" || st === "got_back") && (
                    <ShailaMiniPill
                      size="full"
                      status={st}
                      shailaNum={shailaNum}
                      onToggle={() => cycleGotBack(s)}
                      answerSnippet={(() => {
                        const summary = getF(s, "answerSummary") || s.answerSummary;
                        if (summary?.trim()) return summary.trim();
                        const ans = getF(s, "shailaAnswer").trim();
                        if (!ans) return null;
                        const words = ans.split(/\s+/).filter(Boolean);
                        return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
                      })()}
                    />
                  )}
                  {/* Q */}
                  <div style={labelSt}>Q</div>
                  <textarea value={getQ(s)} rows={2}
                    onChange={e=>setF(s.id,"shailaQuestion",e.target.value)}
                    onBlur={e=>saveQ(s,e.target.value)}
                    style={inputSt({minHeight:40,marginBottom:8})}
                  />
                  {/* A */}
                  <div style={labelSt}>A</div>
                  <textarea value={getF(s,"shailaAnswer")} rows={2} placeholder="No answer recorded..."
                    onChange={e=>setF(s.id,"shailaAnswer",e.target.value)}
                    onBlur={e=>onSaveField(s.id,"shailaAnswer",e.target.value)}
                    style={inputSt({minHeight:40,marginBottom:6})}
                  />
                  {/* Asked by / Answered by */}
                  <div style={{display:"flex",gap:8}}>
                    <div style={{flex:1}}>
                      <div style={labelSt}>ASKED BY</div>
                      <input value={getF(s,"askedBy")} placeholder="Name..."
                        onChange={e=>setF(s.id,"askedBy",e.target.value)}
                        onBlur={e=>onSaveField(s.id,"askedBy",e.target.value)}
                        style={inputSt({resize:"none"})}
                      />
                    </div>
                    <div style={{flex:1}}>
                      <div style={labelSt}>ANSWERED BY</div>
                      <input value={getF(s,"answeredBy")} placeholder="Name..."
                        onChange={e=>setF(s.id,"answeredBy",e.target.value)}
                        onBlur={e=>onSaveField(s.id,"answeredBy",e.target.value)}
                        style={inputSt({resize:"none"})}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}


// ─── ShailaMiniPill ──────────────────────────────────────────────────────────
// Got-back pill, two sizes:
//   size="mini"  (default) — compact, for SubtaskGroup "get back" rows
//   size="full"            — full-width pill for ShailaManager rows
// Props: status ("researching"|"have_answer"|"got_back"), shailaNum, onToggle, size
// ─────────────────────────────────────────────────────────────────────────────
function ShailaMiniPill({status, shailaNum, onToggle, size="mini", answerSnippet}) {
  const isGotBack = status === "got_back";
  const hasAnswer = status === "have_answer" || isGotBack;
  // Don't render anything for "researching" — no answer yet, pill doesn't apply
  if (!hasAnswer) return null;

  const accentColor = isGotBack ? "#6AB87D" : "#C8A84C";

  if (size === "full") {
    return (
      <div style={{
        display:"flex", alignItems:"center", gap:8,
        background: isGotBack ? "#6AB87D18" : "#C8A84C18",
        border: `1.5px solid ${accentColor}`,
        borderRadius: 24,
        padding: "7px 14px 7px 16px",
        transition: "background 0.35s, border-color 0.35s",
        margin: "6px 0 10px",
      }}>
        {shailaNum && (
          <span style={{fontSize:11,fontWeight:700,fontFamily:"system-ui",color:"#C8A84C",flexShrink:0}}>#{shailaNum}</span>
        )}
        <div style={{flex:1,minWidth:0}}>
          <span style={{fontSize:13,fontFamily:"system-ui",fontWeight:600,color:accentColor}}>
            {isGotBack ? "Got back to asker! ✓" : "Got back to asker?"}
          </span>
          {answerSnippet && (
            <div style={{fontSize:10,fontFamily:"system-ui",color:accentColor,opacity:.75,fontStyle:"italic",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {answerSnippet}
            </div>
          )}
        </div>
        {!isGotBack && (
          <button onClick={e=>{e.stopPropagation();onToggle?.();}} title="Mark: got back to asker"
            style={{width:30,height:30,borderRadius:"50%",border:"none",background:"#C8A84C",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:700,flexShrink:0,transition:"background 0.2s"}}>
            ✓
          </button>
        )}
        {isGotBack && (
          <button onClick={e=>{e.stopPropagation();onToggle?.();}} title="Undo: not yet got back"
            style={{background:"none",border:"1px solid #6AB87D60",borderRadius:8,padding:"3px 7px",cursor:"pointer",fontSize:10,color:"#6AB87D",fontFamily:"system-ui"}}>
            ↩
          </button>
        )}
      </div>
    );
  }

  // size="mini"
  return (
    <div
      onClick={e => { e.stopPropagation(); onToggle?.(); }}
      title={isGotBack ? "Undo: not yet got back" : "Mark: got back to asker"}
      style={{
        display:"inline-flex", alignItems:"center", gap:4,
        background: isGotBack ? "#6AB87D18" : "#C8A84C18",
        border: `1px solid ${accentColor}`,
        borderRadius: 20,
        padding: "2px 8px 2px 6px",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      {shailaNum && (
        <span style={{fontSize:9,fontWeight:700,fontFamily:"system-ui",color:"#C8A84C",marginRight:1}}>#{shailaNum}</span>
      )}
      <span style={{fontSize:10,fontWeight:600,fontFamily:"system-ui",color:accentColor}}>
        {isGotBack ? "Got back! ✓" : "Got back?"}
      </span>
      {answerSnippet && (
        <span style={{fontSize:9,fontFamily:"system-ui",color:accentColor,opacity:.7,fontStyle:"italic",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {answerSnippet}
        </span>
      )}
      {isGotBack
        ? <span style={{fontSize:9,color:"#6AB87D",opacity:.7}}>↩</span>
        : <span style={{fontSize:10,background:"#C8A84C",color:"#fff",borderRadius:"50%",width:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>✓</span>
      }
    </div>
  );
}

export { Ripple, Confetti, playCompletionSound, AutoFitText, Toast, AgeBadge, EnergyBadge, CTX_TAG_COLORS, CTX_TAG_TEXT, ContextBadges, MrsWBadge, BlockedBadge, GoodEnoughBadge, ZenMode, ZenDumpReview, TabBtn, PriEditor, JustStartTimer, BodyDoubleTimer, BrainDump, OverwhelmBanner, PostItStack, BlockReflectModal, ShailaManager, ShailaMiniPill };