// === 03-voice.js ===

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cleanYT, callGemini, aiParseShailos, callAI, uid, textOnColor } from './01-core.js';
// VoiceInput: Web Speech (live preview) + MediaRecorder run together.
// Web Speech starts first to get mic priority; MediaRecorder starts 300ms later.
//
// Phases: recording → gemini_wait → reviewing      (when geminiKey set — fast Gemini transcription)
//         recording → reviewing → soferai_wait → soferai_done  (fallback when no geminiKey)

let _activeMicId = null;

// Convert a WebM/Opus blob → 16 kHz mono WAV base64 (universally accepted by transcription APIs)
async function webmToWavBase64(webmBlob) {
  const arrayBuf = await webmBlob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try { decoded = await audioCtx.decodeAudioData(arrayBuf); }
  finally { audioCtx.close(); }

  const SR = 16000;
  const frameCount = Math.ceil(decoded.duration * SR);
  const offline = new OfflineAudioContext(1, frameCount, SR);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);

  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0,  "RIFF"); v.setUint32(4,  36 + dataLen, true);
  str(8,  "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2,  true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++)
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, pcm[i] * 32768 | 0)), true);

  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload  = () => res(fr.result.split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(new Blob([buf], { type: "audio/wav" }));
  });
}

function VoiceInput({ onResult, onClose, onAddShailos, onExistingShailaAnswers, existingShailos, color, T, soferaiKey, geminiKey }) {
  const [phase, setPhase]             = React.useState("recording");
  const [liveText, setLiveText]       = React.useState("");
  const [editText, setEditText]       = React.useState("");
  const [webText, setWebText]         = React.useState("");
  const [soferStatus, setSoferStatus] = React.useState("");
  const [geminiStatus, setGeminiStatus] = React.useState("");
  const [err, setErr]                 = React.useState("");
  const [minimized, setMinimized]     = React.useState(false);
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
  const pollRef     = React.useRef(null);
  const mediaStopP  = React.useRef(null); // resolves when MediaRecorder onstop fires
  const bgJobRef    = React.useRef(null); // Promise<jobId> — background upload started on STOP
  const bgStageRef  = React.useRef("idle"); // "converting" | "uploading" | "submitted" | "error"
  const elapsedRef  = React.useRef(0);
  const elapsedTmr  = React.useRef(null);
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

  function startElapsed() {
    elapsedRef.current = 0;
    clearInterval(elapsedTmr.current);
    elapsedTmr.current = setInterval(() => {
      elapsedRef.current += 1;
      setSoferStatus(`Sofer.ai processing… ${elapsedRef.current}s`);
    }, 1000);
  }
  function stopElapsed() { clearInterval(elapsedTmr.current); }

  const cleanup = React.useCallback(() => {
    clearTimeout(pollRef.current);
    clearInterval(elapsedTmr.current);
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (phaseRef.current !== "recording") { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm";
        const mr = new MediaRecorder(stream, { mimeType });
        mediaRecRef.current = mr;
        mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
        mr.start(200);
      } catch(e) {
        // MediaRecorder unavailable — Sofer.ai button will show error if attempted
      }
    }, 300);

    return () => { clearTimeout(t); cleanup(); };
  }, []); // eslint-disable-line

  // ── Auto-parse in shaila mode when transcript arrives ──────────────────────
  React.useEffect(() => {
    if (phase === "recording") { shailaAutoFiredRef.current = false; return; }
    if (!shailaMode || shailaAutoFiredRef.current) return;
    if ((phase === "reviewing" || phase === "soferai_done") && editText.trim()) {
      shailaAutoFiredRef.current = true;
      parseAsShailos(editText);
    }
  }, [phase, editText, shailaMode]); // eslint-disable-line

  // ── Auto-detect answers to existing shailos when transcript is ready ───────
  const answerDetectFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (phase === "recording") { answerDetectFiredRef.current = false; return; }
    if (answerDetectFiredRef.current) return;
    if ((phase === "reviewing" || phase === "soferai_done") && editText.trim() && existingShailos?.length) {
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

    if (geminiKey) {
      // Fast path: Gemini handles transcription + Yeshivish in one shot
      goPhase("gemini_wait");
      transcribeWithGemini(cleaned);
    } else {
      // Fallback: Web Speech result, optional Sofer.ai improvement
      goPhase("reviewing");
      if (soferaiKey) bgJobRef.current = kickBgUpload();
    }
  }

  // ── Gemini audio transcription ─────────────────────────────────────────────
  async function transcribeWithGemini(webSpeechFallback) {
    setGeminiStatus("Processing audio…");
    try {
      if (mediaStopP.current) { await mediaStopP.current; mediaStopP.current = null; }
      const webmBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (webmBlob.size < 500) {
        // Audio too short — keep Web Speech fallback and go to reviewing
        goPhase("reviewing");
        return;
      }
      setGeminiStatus("Transcribing…");
      const base64 = await webmToWavBase64(webmBlob);
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: "audio/wav", data: base64 } },
                { text: `Transcribe this audio recording exactly verbatim. The speaker uses Yeshivish — Orthodox Jewish English with Hebrew and Yiddish terminology. Use these standard spellings for Jewish terms: shaila / shailos (question / questions), halacha (Jewish law), gemara (Talmud), Shabbos (Sabbath), davening (praying), daven, bracha (blessing), mutar (permitted), assur (forbidden), kashrus, Rashi, Rambam, Ramban, psak, teshuvah, beis din, shiur, kollel, bochur, yeshiva, Hashem, Baruch Hashem, kiddush, Yom Tov, Pesach, Sukkos, Shavuos, chavrusa, beis medrash, machlokes, pshat, tzaddik, tzedakah, chasuna, mazel tov, maariv, mincha, shacharis, tefillin, mezuzah, sukkah, mikvah, niddah, safeik, treif, fleishig, milchig, pareve, shidduch, simcha.

Do not add punctuation beyond what is spoken. Do not summarize or rephrase. Return only the verbatim transcript.` }
              ]
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192 }
          })
        }
      );
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message || "Gemini API error");
      const transcript = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (transcript) setEditText(cleanYT(transcript));
      goPhase("reviewing");
    } catch(e) {
      setErr("Gemini transcription failed: " + e.message);
      goPhase("reviewing"); // fall back to Web Speech result already in editText
    }
  }

  // Runs in background after STOP — awaits final chunk, converts, uploads
  async function kickBgUpload() {
    bgStageRef.current = "converting";
    if (mediaStopP.current) { await mediaStopP.current; mediaStopP.current = null; }
    const webmBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (webmBlob.size < 500) { bgStageRef.current = "error"; throw new Error("Audio capture failed or recording too short. Check mic permissions."); }
    const base64 = await webmToWavBase64(webmBlob);
    bgStageRef.current = "uploading";
    const postResp = await fetch("/.netlify/functions/soferai-proxy", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Soferai-Key": soferaiKey },
      body: JSON.stringify({
        audio_file: base64,
        info: { model: "v1", primary_language: "en", hebrew_word_format: ["en"] },
      }),
    });
    if (!postResp.ok) {
      bgStageRef.current = "error";
      const d = await postResp.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${postResp.status}`);
    }
    const jobId = await postResp.json();
    if (!jobId || typeof jobId !== "string") { bgStageRef.current = "error"; throw new Error("Unexpected response from Sofer.ai."); }
    bgStageRef.current = "submitted";
    return jobId;
  }

  // ── Send captured audio to Sofer.ai — reuses background upload if ready ────
  async function sendToSoferai() {
    if (!soferaiKey) { setErr("Add your Sofer.ai key in Settings."); return; }
    goPhase("soferai_wait");
    setErr("");
    try {
      let jobId;
      if (bgJobRef.current) {
        // Background upload already started — show live stage while awaiting
        const stageInterval = setInterval(() => {
          const s = bgStageRef.current;
          if (s === "converting") setSoferStatus("Converting audio to WAV…");
          else if (s === "uploading") setSoferStatus("Uploading to Sofer.ai…");
          else setSoferStatus("Sending to Sofer.ai…");
        }, 150);
        try { jobId = await bgJobRef.current; } finally { clearInterval(stageInterval); }
        bgJobRef.current = null;
      } else {
        // Fallback: upload now
        setSoferStatus("Converting audio to WAV…");
        if (mediaStopP.current) { await mediaStopP.current; mediaStopP.current = null; }
        const webmBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (webmBlob.size < 500) throw new Error("Audio capture failed or recording too short. Check mic permissions.");
        const base64 = await webmToWavBase64(webmBlob);
        setSoferStatus("Uploading to Sofer.ai…");
        const postResp = await fetch("/.netlify/functions/soferai-proxy", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "X-Soferai-Key": soferaiKey },
          body: JSON.stringify({
            audio_file: base64,
            info: { model: "v1", primary_language: "en", hebrew_word_format: ["en"] },
          }),
        });
        if (!postResp.ok) {
          const d = await postResp.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${postResp.status}`);
        }
        jobId = await postResp.json();
        if (!jobId || typeof jobId !== "string") throw new Error("Unexpected response from Sofer.ai.");
      }
      setSoferStatus("Sofer.ai processing… 0s");
      startElapsed();
      schedulePoll(jobId);
    } catch(e) {
      stopElapsed();
      setErr(e.message);
      goPhase("reviewing");
    }
  }

  // ── Poll for Sofer.ai result ───────────────────────────────────────────────
  function schedulePoll(jobId) {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => doPoll(jobId), 1500);
  }

  async function doPoll(jobId) {
    try {
      const stResp = await fetch(
        `/.netlify/functions/soferai-proxy?job_id=${encodeURIComponent(jobId)}&check=status`,
        { headers: { "X-Soferai-Key": soferaiKey } }
      );
      const st = (await stResp.json()).status;
      if (st === "COMPLETED") {
        stopElapsed();
        setSoferStatus("Receiving result…");
        const resResp = await fetch(
          `/.netlify/functions/soferai-proxy?job_id=${encodeURIComponent(jobId)}`,
          { headers: { "X-Soferai-Key": soferaiKey } }
        );
        const raw = ((await resResp.json()).text || "")
          .replace(/<i>(.*?)<\/i>/g, "$1")
          .replace(/<[^>]+>/g, "")
          .trim();
        setEditText(cleanYT(raw));
        setMinimized(false);
        goPhase("soferai_done");
      } else if (["FAILED","CANCELLED","INSUFFICIENT_FUNDS"].includes(st)) {
        stopElapsed();
        setErr(`Sofer.ai: ${st}`);
        setMinimized(false);
        goPhase("reviewing");
      } else {
        setSoferStatus(`Processing… (${st})`);
        schedulePoll(jobId);
      }
    } catch(e) {
      stopElapsed();
      setErr("Poll error: " + e.message);
      goPhase("reviewing");
    }
  }

  // ── Parse transcript as shailos ────────────────────────────────────────────
  async function parseAsShailos(textOverride) {
    if (!geminiKey) { setErr("Add your Gemini key in Settings to parse shailos."); return; }
    const txt = (textOverride !== undefined ? textOverride : editText).trim();
    if (!txt) return;
    setShailaLoading(true); setErr("");
    try {
      const items = await aiParseShailos(txt, geminiKey);
      setParsedShailas(items);
      goPhase("shaila_review");
    } catch(e) { setErr("Parse error: " + e.message); }
    finally { setShailaLoading(false); }
  }

  // ── Detect answers to existing shailos in transcript ──────────────────────
  async function detectAnswersInTranscript(text) {
    if (!geminiKey || !existingShailos?.length || !text.trim()) return;
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
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
        { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0,maxOutputTokens:2048} })
        }
      );
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      const raw = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      const clean = raw.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setDetectedAnswers(parsed.map(x => ({...x, approved: true})));
      }
    } catch(e) { /* silently fail — not critical */ }
    setAnswerDetectLoading(false);
  }

  const shailaParseBtn = (
    geminiKey ? (
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
          {geminiKey && (
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
        <p style={{ margin:0, fontSize:13, color:T.tSoft, fontWeight:600, fontFamily:"system-ui" }}>{geminiStatus || "Transcribing…"}</p>
        <p style={{ margin:"6px 0 0", fontSize:11, color:T.tFaint, fontFamily:"system-ui" }}>Gemini · Yeshivish dialect</p>
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

  // ── Detected-answers banner (shown in reviewing + soferai_done) ────────────
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
          {geminiKey ? "Gemini transcript" : "Browser transcript"}
        </span>
        {closeBtn}
      </div>
      {editArea}
      {useBtn(color)}
      {!geminiKey && soferaiKey && (
        <button onClick={sendToSoferai} style={{
          width:"100%", marginTop:6, padding:"8px",
          fontSize:12, fontWeight:600, background:"none",
          color:T.tSoft, border:`1px solid ${T.brd}`,
          borderRadius:8, cursor:"pointer",
        }}>
          🎤 Improve with Sofer.ai
        </button>
      )}
      {shailaParseBtn}
      {detectedAnswersBanner}
      {errLine}
    </div>
  );

  // ── SOFER.AI WAITING — minimized pill ─────────────────────────────────────
  if (phase === "soferai_wait" && minimized) return (
    <div
      data-voice-panel="true"
      onClick={() => setMinimized(false)}
      style={{
        position:"fixed", bottom:"clamp(60px,10vh,120px)",
        left:"50%", transform:"translateX(-50%)",
        background:T.card, border:`1.5px solid ${T.brd}`,
        borderRadius:24, padding:"9px 18px",
        boxShadow:"0 4px 20px rgba(0,0,0,0.18)",
        display:"flex", alignItems:"center", gap:10,
        cursor:"pointer", zIndex:9000, fontFamily:"system-ui",
        animation:"ot-fade 0.2s",
      }}
    >
      <div style={{ width:14, height:14, border:`2px solid ${T.brd}`, borderTopColor:color, borderRadius:"50%", animation:"ot-spin 0.8s linear infinite", flexShrink:0 }} />
      <span style={{ fontSize:12, color:T.tSoft, whiteSpace:"nowrap" }}>Sofer.ai processing…</span>
      <span style={{ fontSize:11, color:T.tFaint }}>↑</span>
    </div>
  );

  // ── SOFER.AI WAITING — full panel ─────────────────────────────────────────
  if (phase === "soferai_wait") return (
    <div style={shell(T.brd)} data-voice-panel="true">
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:2 }}>
        <button onClick={() => setMinimized(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:T.tFaint, padding:"2px 4px", fontFamily:"system-ui" }}>— minimize</button>
      </div>
      <div style={{ textAlign:"center", padding:"10px 0 14px" }}>
        <div style={{ width:28, height:28, border:`3px solid ${T.brd}`, borderTopColor:color, borderRadius:"50%", animation:"ot-spin 0.8s linear infinite", margin:"0 auto 12px" }} />
        <p style={{ margin:0, fontSize:13, color:T.tSoft, fontWeight:600 }}>{soferStatus}</p>
      </div>
      <button
        onClick={() => { clearTimeout(pollRef.current); stopElapsed(); goPhase("reviewing"); setErr(""); setMinimized(false); }}
        style={{ width:"100%", padding:"7px", fontSize:11, background:"none", color:T.tFaint, border:`1px solid ${T.brd}`, borderRadius:8, cursor:"pointer" }}
      >Cancel — use browser result</button>
      {errLine}
    </div>
  );

  // ── SOFER.AI DONE ──────────────────────────────────────────────────────────
  if (phase === "soferai_done") return (
    <div style={shell("#5A9E7C")} data-voice-panel="true">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <span style={{ fontSize:9, color:"#5A9E7C", fontWeight:700, letterSpacing:1.2, textTransform:"uppercase" }}>✦ Sofer.ai result</span>
        {closeBtn}
      </div>
      {editArea}
      {useBtn("#5A9E7C")}
      {webText && (
        <button onClick={() => setEditText(webText)} style={{
          width:"100%", marginTop:6, padding:"7px", fontSize:11, background:"none",
          color:T.tFaint, border:`1px solid ${T.brd}`, borderRadius:8, cursor:"pointer",
        }}>← Use browser result instead</button>
      )}
      {shailaParseBtn}
      {detectedAnswersBanner}
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