// === 03-voice.js ===

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cleanYT, aiParseShailos, callAI, uid, textOnColor } from './01-core.js';
import { savePendingRecording, deletePendingRecording, updatePendingRecordingError, transcribePendingRecording, webmToWavBase64 } from './09-transcription-pen.js';
// VoiceInput: Web Speech (live preview) + MediaRecorder run together.
// Web Speech starts first to get mic priority; MediaRecorder starts 300ms later.
//
// Phases: recording -> gemini_wait -> reviewing.

let _activeMicId = null;
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

function VoiceInput({ onResult, onClose, onAddShailos, onExistingShailaAnswers, existingShailos, color, T, aiOpts }) {
  const [phase, setPhase]             = React.useState("recording");
  const [liveText, setLiveText]       = React.useState("");
  const [editText, setEditText]       = React.useState("");
  const [webText, setWebText]         = React.useState("");
  const [geminiStatus, setGeminiStatus] = React.useState("");
  const [err, setErr]                 = React.useState("");
  const [parsedShailas, setParsedShailas] = React.useState([]);
  const [shailaLoading, setShailaLoading] = React.useState(false);
  const [shailaMode, setShailaMode]       = React.useState(false);
  const [detectedAnswers, setDetectedAnswers] = React.useState([]); // [{shaila, answer, approved}]
  const [answerDetectLoading, setAnswerDetectLoading] = React.useState(false);

  const phaseRef    = React.useRef("recording");
  const liveRef     = React.useRef("");
  const segBufRef   = React.useRef("");
  const myId        = React.useRef(uid());
  const recogRef    = React.useRef(null);
  const streamRef   = React.useRef(null);
  const mediaRecRef = React.useRef(null);
  const chunksRef   = React.useRef([]);
  const mediaStopP  = React.useRef(null); // resolves when MediaRecorder onstop fires
  const shailaAutoFiredRef = React.useRef(false);

  function goPhase(p) { phaseRef.current = p; setPhase(p); }

  // ── Web Speech: always creates a fresh instance ────────────────────────────
  function startSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    recogRef.current = r;
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = "en-US";
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          segBufRef.current = (segBufRef.current + " " + e.results[i][0].transcript).trim();
        } else {
          interim = e.results[i][0].transcript;
        }
      }
      const full = (segBufRef.current + (interim ? " " + interim : "")).trim();
      liveRef.current = full;
      setLiveText(full);
    };
    r.onerror = e => {
      if (e.error === "not-allowed") setErr("Mic permission denied.");
      // "no-speech" / "audio-capture" — let onend auto-restart
    };
    r.onend = () => {
      if (phaseRef.current === "recording") startSpeech(); // fresh instance each restart
    };
    try { r.start(); } catch(e) {}
  }

  function stopSpeech() {
    if (recogRef.current) {
      try { recogRef.current.onend = null; recogRef.current.abort(); } catch(e) {}
      recogRef.current = null;
    }
  }

  function stopMedia() {
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      try { mediaRecRef.current.stop(); } catch(e) {}
    }
    mediaRecRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (_activeMicId === myId.current) _activeMicId = null;
  }

  const cleanup = React.useCallback(() => {
    stopSpeech();
    stopMedia();
  }, []); // eslint-disable-line

  // Mount: Web Speech first, MediaRecorder 300ms later so Speech gets mic priority
  React.useEffect(() => {
    if (_activeMicId && _activeMicId !== myId.current) {
      setErr("Another mic is already active."); return cleanup;
    }
    _activeMicId = myId.current;
    chunksRef.current = [];
    segBufRef.current = "";
    liveRef.current   = "";

    startSpeech(); // immediate — no getUserMedia call from our side

    const t = setTimeout(async () => {
      if (phaseRef.current !== "recording") return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        if (phaseRef.current !== "recording") { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm";
        const mr = new MediaRecorder(stream, { mimeType });
        mediaRecRef.current = mr;
        mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
        mr.start(200);
      } catch(e) {
        // MediaRecorder unavailable; browser transcript remains available.
      }
    }, 300);

    return () => { clearTimeout(t); cleanup(); };
  }, []); // eslint-disable-line

  // ── Auto-parse in shaila mode when transcript arrives ──────────────────────
  React.useEffect(() => {
    if (phase === "recording") { shailaAutoFiredRef.current = false; return; }
    if (!shailaMode || shailaAutoFiredRef.current) return;
    if (phase === "reviewing" && editText.trim()) {
      shailaAutoFiredRef.current = true;
      parseAsShailos(editText);
    }
  }, [phase, editText, shailaMode]); // eslint-disable-line

  // ── Auto-detect answers to existing shailos when transcript is ready ───────
  const answerDetectFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (phase === "recording") { answerDetectFiredRef.current = false; return; }
    if (answerDetectFiredRef.current) return;
    if (phase === "reviewing" && editText.trim() && existingShailos?.length) {
      if (true) {
        answerDetectFiredRef.current = true;
        detectAnswersInTranscript(editText);
      }
    }
  }, [phase, editText]); // eslint-disable-line

  // ── Stop recording ─────────────────────────────────────────────────────────
  function stopRec() {
    const captured = liveRef.current || segBufRef.current || "";
    const cleaned  = cleanYT(captured);
    stopSpeech();

    // Stop MediaRecorder and capture promise for final chunk
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      mediaStopP.current = new Promise(res => { mediaRecRef.current.onstop = res; });
      try { mediaRecRef.current.stop(); } catch(e) { mediaStopP.current = null; }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (_activeMicId === myId.current) _activeMicId = null;

    setWebText(cleaned);
    setEditText(cleaned); // shown as fallback while Gemini runs

    if (aiOpts) {
      // Central AI gateway handles transcription and Yeshivish wording in one shot.
      goPhase("gemini_wait");
      transcribeWithGemini(cleaned);
    } else {
      goPhase("reviewing");
    }
  }

  // ── Gemini audio transcription ─────────────────────────────────────────────
  async function transcribeWithGemini(webSpeechFallback) {
    setGeminiStatus("Processing audio…");
    let pending = null;
    try {
      if (mediaStopP.current) { await mediaStopP.current; mediaStopP.current = null; }
      const webmBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (webmBlob.size < 500) {
        // Audio too short — keep Web Speech fallback and go to reviewing
        goPhase("reviewing");
        return;
      }
      setGeminiStatus("Transcribing…");
      pending = await savePendingRecording(webmBlob, shailaMode ? 'main_shaila_voice' : 'main_voice', {
        source: 'main',
        label: shailaMode ? 'Main shaila voice' : 'Main voice input',
      });
      const transcriptRaw = await transcribePendingRecording(
        pending.id, aiOpts,
        `Transcribe this audio recording exactly verbatim. The speaker uses Yeshivish — Orthodox Jewish English with Hebrew and Yiddish terminology. Use these standard spellings for Jewish terms: shaila / shailos (question / questions), halacha (Jewish law), gemara (Talmud), Shabbos (Sabbath), davening (praying), daven, bracha (blessing), mutar (permitted), assur (forbidden), kashrus, Rashi, Rambam, Ramban, psak, teshuvah, beis din, shiur, kollel, bochur, yeshiva, Hashem, Baruch Hashem, kiddush, Yom Tov, Pesach, Sukkos, Shavuos, chavrusa, beis medrash, machlokes, pshat, tzaddik, tzedakah, chasuna, mazel tov, maariv, mincha, shacharis, tefillin, mezuzah, sukkah, mikvah, niddah, safeik, treif, fleishig, milchig, pareve, shidduch, simcha.\n\nDo not add punctuation beyond what is spoken. Do not summarize or rephrase. Return only the verbatim transcript.`
      );
      await deletePendingRecording(pending.id);
      if (transcriptRaw === null) throw new Error("AI transcription error");
      const transcript = transcriptRaw.trim();
      if (transcript) setEditText(cleanYT(transcript));
      goPhase("reviewing");
    } catch(e) {
      if (pending?.id) await updatePendingRecordingError(pending.id, e.message || String(e)).catch(() => {});
      setErr("AI transcription failed: " + e.message);
      goPhase("reviewing"); // fall back to Web Speech result already in editText
    }
  }

  // ── Parse transcript as shailos ────────────────────────────────────────────
  async function parseAsShailos(textOverride) {
    if (!aiOpts) { setErr("AI is not configured."); return; }
    const txt = (textOverride !== undefined ? textOverride : editText).trim();
    if (!txt) return;
    setShailaLoading(true); setErr("");
    try {
      const items = await aiParseShailos(txt, aiOpts);
      setParsedShailas(items);
      goPhase("shaila_review");
    } catch(e) { setErr("Parse error: " + e.message); }
    finally { setShailaLoading(false); }
  }

  // ── Detect answers to existing shailos in transcript ──────────────────────
  async function detectAnswersInTranscript(text) {
    if (!aiOpts || !existingShailos?.length || !text.trim()) return;
    setAnswerDetectLoading(true);
    setDetectedAnswers([]);
    try {
      const shailoList = existingShailos
        .filter(s => !s.shailaAnswer?.trim()) // only unanswered
        .slice(0, 20) // cap for prompt size
        .map((s, i) => `${i+1}. [ID:${s.id}] ${s.parsedShaila || s.content || s.synopsis || s.text || ""}`)
        .join("\n");
      if (!shailoList.trim()) { setAnswerDetectLoading(false); return; }
      const prompt = `You are analyzing a voice transcript of a call or shaila-recording session.

Existing open shailos (unanswered questions) that need answers:
${shailoList}

Transcript:
${text}

Identify any shailos from the list above that are answered in the transcript. For each match, return a JSON array of objects: {"id": "<exact ID>", "shaila": "<question text>", "answer": "<extracted answer>"}. If the answer is partial or implied, include it. Only return answers you are confident are present in the transcript. If none match, return []. Return only raw JSON, no markdown.`;
      const raw = (await callAI(prompt, aiOpts, { temperature: 0, maxOutputTokens: 2048 }) || "").trim();
      const clean = raw.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setDetectedAnswers(parsed.map(x => ({...x, approved: true})));
      }
    } catch(e) { /* silently fail — not critical */ }
    setAnswerDetectLoading(false);
  }

  const shailaParseBtn = (
    aiOpts ? (
      <button onClick={parseAsShailos} disabled={shailaLoading} style={{
        width:"100%", marginTop:6, padding:"8px",
        fontSize:12, fontWeight:600, background:"none",
        color:"#C8A84C", border:"1px solid #C8A84C60",
        borderRadius:8, cursor:"pointer", fontFamily:"system-ui",
        opacity: shailaLoading ? 0.6 : 1,
      }}>
        {shailaLoading ? "Parsing…" : "✡ Parse as shailos"}
      </button>
    ) : null
  );

  // ── Shared UI helpers ──────────────────────────────────────────────────────
  function useText(txt) { cleanup(); onResult(txt.trim()); }
  function dismiss()    { cleanup(); onClose(); }

  const shell = (brd) => ({
    position: "fixed", bottom: "clamp(60px,10vh,120px)",
    left: "50%", transform: "translateX(-50%)",
    width: "min(420px,90vw)", zIndex: 9000,
    background: T.card, border: `1.5px solid ${brd}`,
    borderRadius: 16, padding: 16,
    boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
    animation: "ot-fade 0.2s", fontFamily: "system-ui",
  });

  const editArea = (
    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{
      width: "100%", boxSizing: "border-box",
      background: T.bgW, color: T.text,
      border: `1px solid ${T.brd}`, borderRadius: 8,
      padding: "8px 10px", fontSize: 14,
      fontFamily: "Georgia,serif", lineHeight: 1.55,
      resize: "vertical", outline: "none",
    }} />
  );

  const useBtn = (bg) => (
    <button onClick={() => useText(editText)} disabled={!editText.trim()} style={{
      width: "100%", marginTop: 8, padding: "10px",
      fontSize: 13, fontWeight: 700, fontFamily: "system-ui",
      background: editText.trim() ? bg : "transparent",
      color: editText.trim() ? textOnColor(bg) : T.tFaint,
      border: `1px solid ${bg}`, borderRadius: 10,
      cursor: editText.trim() ? "pointer" : "default",
      opacity: editText.trim() ? 1 : .4,
    }}>✓ Use this</button>
  );

  const errLine = err
    ? <p style={{ margin: "8px 0 0", fontSize: 11, color: "#C94040" }}>{err}</p>
    : null;

  const closeBtn = (
    <button onClick={dismiss} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:T.tFaint, lineHeight:1, padding:"0 0 0 8px" }}>×</button>
  );

  // ── RECORDING ──────────────────────────────────────────────────────────────
  if (phase === "recording") return (
    <div style={shell(color)} data-voice-panel="true">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:10, color:"#C94040", fontWeight:800, letterSpacing:1.2 }}>🔴 LISTENING</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {aiOpts && (
            <button onClick={() => { shailaAutoFiredRef.current = false; setShailaMode(true); stopRec(); }} title="Stop and parse as shailos" style={{
              background:"#C8A84C", color:"#fff",
              border: "1.5px solid #C8A84C80", borderRadius:7,
              padding:"3px 9px", fontSize:13, cursor:"pointer",
              fontFamily:"system-ui", fontWeight:700, lineHeight:1,
              transition:"all 0.15s",
            }}>✡</button>
          )}
          {closeBtn}
          <button onClick={stopRec} style={{ background:"#C94040", color:"#fff", border:"none", borderRadius:7, padding:"5px 16px", fontSize:11, cursor:"pointer", fontWeight:700 }}>STOP</button>
        </div>
      </div>
      <div style={{
        minHeight:56, padding:"10px 12px", borderRadius:9,
        background:T.bgW, border:`1px solid ${T.brd}`,
        fontSize:14, color: liveText ? T.text : T.tFaint,
        fontFamily:"Georgia,serif", lineHeight:1.55, wordBreak:"break-word",
      }}>
        {liveText || <span style={{ fontSize:12, fontStyle:"italic" }}>Speak now…</span>}
      </div>
      {errLine}
    </div>
  );

  // ── GEMINI TRANSCRIBING ────────────────────────────────────────────────────
  if (phase === "gemini_wait") return (
    <div style={shell(color)} data-voice-panel="true">
      <div style={{ textAlign:"center", padding:"18px 0 20px" }}>
        <div style={{ width:28, height:28, border:`3px solid ${T.brd}`, borderTopColor:color, borderRadius:"50%", animation:"ot-spin 0.8s linear infinite", margin:"0 auto 14px" }} />
        <p style={{ margin:0, fontSize:13, color:T.tSoft, fontWeight:600, fontFamily:"system-ui" }}>{geminiStatus || "Transcribing..."}</p>
        <p style={{ margin:"6px 0 0", fontSize:11, color:T.tFaint, fontFamily:"system-ui" }}>Central AI gateway</p>
      </div>
      {editText.trim() && (
        <div style={{ padding:"8px 12px", borderRadius:9, background:T.bgW, border:`1px solid ${T.brd}`, fontSize:12, color:T.tFaint, fontFamily:"Georgia,serif", lineHeight:1.5, marginBottom:8, maxHeight:60, overflow:"hidden", opacity:0.7 }}>
          {editText.slice(0, 120)}{editText.length > 120 ? "…" : ""}
        </div>
      )}
      <button onClick={() => goPhase("reviewing")} style={{ width:"100%", padding:"7px", fontSize:11, background:"none", color:T.tFaint, border:`1px solid ${T.brd}`, borderRadius:8, cursor:"pointer", fontFamily:"system-ui" }}>
        Skip — use browser result
      </button>
      {errLine}
    </div>
  );

  // ── Detected-answers banner ────────────────────────────────────────────────
  const detectedAnswersBanner = (answerDetectLoading || detectedAnswers.some(x => x.approved !== false)) ? (
    <div style={{ marginTop:6 }}>
      {answerDetectLoading && (
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", background:T.bgW, borderRadius:8, border:`1px solid ${T.brd}` }}>
          <div style={{ width:10, height:10, border:`2px solid ${T.brd}`, borderTopColor:"#C8A84C", borderRadius:"50%", animation:"ot-spin 0.8s linear infinite", flexShrink:0 }}/>
          <span style={{ fontSize:11, color:T.tFaint, fontFamily:"system-ui" }}>Checking for answers to existing shailos…</span>
        </div>
      )}
      {detectedAnswers.filter(x => x.approved !== false).map((match, i) => (
        <div key={match.id || i} style={{ background:"#C8A84C0E", borderRadius:8, padding:"8px 10px", borderLeft:"3px solid #C8A84C", marginTop:4 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#C8A84C", fontFamily:"system-ui", marginBottom:2 }}>Answers existing shailo:</div>
          <div style={{ fontSize:12, fontFamily:"Georgia,serif", color:T.text, marginBottom:3, lineHeight:1.4 }}>{match.shaila}</div>
          <div style={{ fontSize:11, fontFamily:"Georgia,serif", color:T.tSoft, marginBottom:6, lineHeight:1.4 }}>{match.answer}</div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => {
              if (onExistingShailaAnswers) onExistingShailaAnswers(match.id, match.answer);
              setDetectedAnswers(p => p.map((x, j) => j===i ? {...x, approved:false} : x));
            }} style={{ flex:1, padding:"4px 8px", borderRadius:6, border:"none", background:"#C8A84C", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"system-ui" }}>✓ Save answer</button>
            <button onClick={() => setDetectedAnswers(p => p.map((x, j) => j===i ? {...x, approved:false} : x))}
              style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${T.brd}`, background:"none", color:T.tFaint, cursor:"pointer", fontSize:11, fontFamily:"system-ui" }}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  // ── REVIEWING ──────────────────────────────────────────────────────────────
  if (phase === "reviewing") return (
    <div style={shell(T.brd)} data-voice-panel="true">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <span style={{ fontSize:9, color:T.tFaint, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase" }}>
          {aiOpts ? "AI transcript" : "Browser transcript"}
        </span>
        {closeBtn}
      </div>
      {editArea}
      {useBtn(color)}
      {shailaParseBtn}
      {detectedAnswersBanner}
      {errLine}
    </div>
  );

  // ── SHAILA REVIEW ──────────────────────────────────────────────────────────
  if (phase === "shaila_review") return (
    <div style={{...shell("#C8A84C"), maxHeight:"80vh", display:"flex", flexDirection:"column"}} data-voice-panel="true">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexShrink:0 }}>
        <span style={{ fontSize:11, color:"#C8A84C", fontWeight:700, letterSpacing:1 }}>✡ {parsedShailas.length} SHAILO{parsedShailas.length!==1?"S":""} DETECTED</span>
        {closeBtn}
      </div>
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:10 }}>
        {/* ── Detected answers to existing shailos ── */}
        {answerDetectLoading && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:T.bgW, borderRadius:10, border:`1px solid ${T.brd}` }}>
            <div style={{ width:12, height:12, border:`2px solid ${T.brd}`, borderTopColor:"#C8A84C", borderRadius:"50%", animation:"ot-spin 0.8s linear infinite", flexShrink:0 }}/>
            <span style={{ fontSize:11, color:T.tFaint, fontFamily:"system-ui" }}>Checking for answers to existing shailos…</span>
          </div>
        )}
        {detectedAnswers.length > 0 && (
          <div style={{ background:"#C8A84C14", borderRadius:10, border:"1px solid #C8A84C50", padding:"8px 10px", display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:9, fontWeight:800, color:"#C8A84C", letterSpacing:1.2, marginBottom:2 }}>POSSIBLE ANSWERS TO EXISTING SHAILOS</div>
            {detectedAnswers.filter(x => x.approved !== false).map((match, i) => (
              <div key={match.id || i} style={{ background:T.bgW, borderRadius:8, padding:"8px 10px", borderLeft:"3px solid #C8A84C" }}>
                <div style={{ fontSize:11, color:T.tSoft, fontFamily:"system-ui", marginBottom:3 }}>Answers existing shailo:</div>
                <div style={{ fontSize:12, fontFamily:"Georgia,serif", color:T.text, marginBottom:4, lineHeight:1.4 }}>{match.shaila}</div>
                <div style={{ fontSize:9, fontWeight:700, color:"#C8A84C", letterSpacing:1, marginBottom:2 }}>ANSWER FOUND:</div>
                <div style={{ fontSize:12, fontFamily:"Georgia,serif", color:T.tSoft, marginBottom:8, lineHeight:1.4 }}>{match.answer}</div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={() => {
                    if (onExistingShailaAnswers) onExistingShailaAnswers(match.id, match.answer);
                    setDetectedAnswers(p => p.map((x, j) => j===i ? {...x, approved:false} : x));
                  }} style={{ flex:1, padding:"5px 8px", borderRadius:7, border:"none", background:"#C8A84C", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"system-ui" }}>✓ Yes, save this answer</button>
                  <button onClick={() => setDetectedAnswers(p => p.map((x, j) => j===i ? {...x, approved:false} : x))}
                    style={{ padding:"5px 8px", borderRadius:7, border:`1px solid ${T.brd}`, background:"none", color:T.tFaint, cursor:"pointer", fontSize:11, fontFamily:"system-ui" }}>Skip</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {parsedShailas.map((item, i) => (
          <div key={item.id} style={{ background:T.bgW, borderRadius:10, padding:"10px 12px", borderLeft:"3px solid #C8A84C" }}>
            <textarea
              value={item.shaila}
              onChange={e => setParsedShailas(p => p.map((x,j) => j===i ? {...x, shaila:e.target.value} : x))}
              rows={2}
              style={{ width:"100%", boxSizing:"border-box", fontSize:13, fontFamily:"Georgia,serif", border:"none", background:"transparent", color:T.text, resize:"vertical", outline:"none", lineHeight:1.55 }}
            />
            {item.answer !== null && (
              <div style={{ borderTop:`1px solid ${T.brd}`, marginTop:6, paddingTop:6 }}>
                <div style={{ fontSize:9, color:"#C8A84C", fontWeight:800, letterSpacing:1.2, marginBottom:3 }}>ANSWER</div>
                <textarea
                  value={item.answer || ""}
                  onChange={e => setParsedShailas(p => p.map((x,j) => j===i ? {...x, answer:e.target.value} : x))}
                  rows={2}
                  style={{ width:"100%", boxSizing:"border-box", fontSize:12, fontFamily:"Georgia,serif", border:"none", background:"transparent", color:T.tSoft, resize:"vertical", outline:"none", lineHeight:1.55 }}
                />
              </div>
            )}
            {item.answer === null && (
              <button onClick={() => setParsedShailas(p => p.map((x,j) => j===i ? {...x, answer:""} : x))}
                style={{ marginTop:4, fontSize:10, color:T.tFaint, background:"none", border:`1px solid ${T.brd}`, borderRadius:6, padding:"2px 8px", cursor:"pointer", fontFamily:"system-ui" }}>
                + add answer
              </button>
            )}
            <div style={{ display:"flex", gap:8, marginTop:6 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:T.tFaint, fontWeight:700, letterSpacing:1, marginBottom:2 }}>ASKED BY</div>
                <input value={item.askedBy || ""} onChange={e => setParsedShailas(p => p.map((x,j) => j===i ? {...x, askedBy:e.target.value} : x))}
                  placeholder="Name…" style={{ width:"100%", boxSizing:"border-box", fontSize:11, fontFamily:"system-ui", border:`1px solid ${T.brd}`, borderRadius:6, padding:"3px 7px", background:T.bgW, color:T.text, outline:"none" }} />
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:T.tFaint, fontWeight:700, letterSpacing:1, marginBottom:2 }}>ANSWERED BY</div>
                <input value={item.answeredBy || ""} onChange={e => setParsedShailas(p => p.map((x,j) => j===i ? {...x, answeredBy:e.target.value} : x))}
                  placeholder="Name…" style={{ width:"100%", boxSizing:"border-box", fontSize:11, fontFamily:"system-ui", border:`1px solid ${T.brd}`, borderRadius:6, padding:"3px 7px", background:T.bgW, color:T.text, outline:"none" }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flexShrink:0, display:"flex", flexDirection:"column", gap:6 }}>
        <button onClick={() => { if (onAddShailos) onAddShailos(parsedShailas); cleanup(); onClose(); }} style={{
          width:"100%", padding:"10px", fontSize:13, fontWeight:700,
          background:"#C8A84C", color:textOnColor("#C8A84C"),
          border:"none", borderRadius:10, cursor:"pointer", fontFamily:"system-ui",
        }}>+ Add {parsedShailas.length} shailo{parsedShailas.length!==1?"s":""}</button>
        <button onClick={() => goPhase("reviewing")} style={{
          width:"100%", padding:"7px", fontSize:11, background:"none",
          color:T.tFaint, border:`1px solid ${T.brd}`, borderRadius:8, cursor:"pointer", fontFamily:"system-ui",
        }}>← Back</button>
      </div>
      {errLine}
    </div>
  );

  return null;
}


export { VoiceInput, webmToWavBase64, _activeMicId };
