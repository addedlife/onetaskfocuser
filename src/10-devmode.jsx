// === 10-devmode.js ===

import React from 'react';
// In-app Claude dev assistant — floating chat panel for live code changes.
// Visible to any authenticated user who has a Claude API key saved.

const DM_STORAGE_KEY = 'onetask_devmode_history';

function DevModePanel({ AS, T, ap }) {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [history, setHistory] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(DM_STORAGE_KEY) || '[]'); }
    catch { return []; }
  });
  const [loading, setLoading] = React.useState(false);
  const [pendingChanges, setPendingChanges] = React.useState(null); // { fileChanges, changedFiles }
  const [deployState, setDeployState] = React.useState(null); // null | 'deploying' | 'success' | {error}
  const [showKey, setShowKey] = React.useState(false);
  const messagesEndRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const claudeKey = AS?.claudeApiKey || '';
  const hasKey = !!claudeKey;

  // Persist history to localStorage whenever it changes
  React.useEffect(() => {
    try { localStorage.setItem(DM_STORAGE_KEY, JSON.stringify(history)); }
    catch {}
  }, [history]);

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, open, loading]);

  // Focus input when panel opens
  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  async function sendMessage() {
    const msg = input.trim();
    if (!msg || loading || !hasKey) return;

    const newUserMsg = { role: 'user', content: msg };
    const updatedHistory = [...history, newUserMsg];
    setHistory(updatedHistory);
    setInput('');
    setLoading(true);
    setPendingChanges(null);
    setDeployState(null);

    // Build conversation history for the API (exclude system messages, keep role/content only)
    const apiHistory = updatedHistory.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    try {
      const res = await fetch('/.netlify/functions/claude-dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          message: msg,
          claudeApiKey: claudeKey,
          history: apiHistory,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setHistory(h => [...h, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      } else {
        const responseText = data.response || '(no response)';
        const assistantMsg = {
          role: 'assistant',
          content: responseText,
          fileChanges: data.fileChanges || null,
          changedFiles: data.changedFiles || [],
        };
        setHistory(h => [...h, assistantMsg]);
        if (data.fileChanges) {
          setPendingChanges({ fileChanges: data.fileChanges, changedFiles: data.changedFiles });
        }
      }
    } catch (err) {
      setHistory(h => [...h, { role: 'assistant', content: `⚠️ Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function deployChanges() {
    if (!pendingChanges || !claudeKey) return;
    setDeployState('deploying');

    try {
      const res = await fetch('/.netlify/functions/claude-dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deploy',
          claudeApiKey: claudeKey,
          fileChanges: pendingChanges.fileChanges,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setDeployState({ error: data.error });
      } else {
        setDeployState('success');
        setPendingChanges(null);
        // Give user 2s to see success, then reload
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (err) {
      setDeployState({ error: err.message });
    }
  }

  function clearHistory() {
    setHistory([]);
    setPendingChanges(null);
    setDeployState(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const accentColor = ap?.[0]?.color || '#7C5CBF';
  const panelBg = T?.card || '#fff';
  const textColor = T?.text || '#1a1a1a';
  const softColor = T?.tSoft || '#666';
  const faintColor = T?.tFaint || '#999';
  const borderColor = T?.brd || '#ddd';
  const bgW = T?.bgW || '#f8f8f8';

  // ── Floating button ────────────────────────────────────────────────────────
  const floatBtn = (
    <button
      onClick={() => setOpen(o => !o)}
      title="Dev Mode — Claude"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: 'none',
        background: open ? accentColor : (T?.bgW || '#fff'),
        boxShadow: open
          ? `0 4px 20px ${accentColor}66`
          : '0 2px 12px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    >
      {open
        ? <span style={{color:'#fff',fontSize:16,lineHeight:1}}>✕</span>
        : <span style={{color:accentColor,fontSize:18,lineHeight:1,fontFamily:'monospace'}}>{'</>'}</span>
      }
    </button>
  );

  if (!open) return floatBtn;

  // ── Panel ──────────────────────────────────────────────────────────────────
  return (
    <>
      {floatBtn}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(420px, 100vw)',
        background: panelBg,
        boxShadow: '-4px 0 32px rgba(0,0,0,0.18)',
        zIndex: 8900,
        display: 'flex',
        flexDirection: 'column',
        animation: 'ot-slide-in-right 0.22s ease',
        fontFamily: 'system-ui, sans-serif',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 18px 14px',
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <span style={{fontSize:16,fontFamily:'monospace',color:accentColor}}>{'</>'}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:textColor}}>Dev Mode</div>
            <div style={{fontSize:10,color:faintColor,marginTop:1}}>
              {hasKey ? 'Claude Sonnet 4.6 · Sees full codebase' : 'Add Claude API key in Settings → Account'}
            </div>
          </div>
          <button onClick={clearHistory} title="Clear conversation" style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:faintColor,padding:'4px 6px',borderRadius:6}}>
            Clear
          </button>
        </div>

        {/* No key warning */}
        {!hasKey && (
          <div style={{padding:'16px 18px',background:`${accentColor}10`,borderBottom:`1px solid ${borderColor}`}}>
            <p style={{fontSize:12,color:softColor,margin:0,lineHeight:1.5}}>
              Go to <strong>Settings → Account</strong> and paste your Claude API key to enable Dev Mode.
            </p>
          </div>
        )}

        {/* Messages */}
        <div style={{flex:1,overflowY:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10}}>
          {history.length === 0 && (
            <div style={{textAlign:'center',paddingTop:40}}>
              <div style={{fontSize:28,marginBottom:12}}>{'</>'}</div>
              <p style={{fontSize:13,color:softColor,lineHeight:1.6,margin:0}}>
                Ask me to fix bugs, add features, or change anything in the app.<br/>
                I can see all the source files and deploy changes live.
              </p>
              <div style={{marginTop:20,display:'flex',flexDirection:'column',gap:6}}>
                {[
                  'Add a dark mode toggle',
                  'Fix the task sorting bug',
                  'Make the focus tab font larger',
                  'Add a "snooze 1 hour" button to tasks',
                ].map(s => (
                  <button key={s} onClick={() => setInput(s)} style={{
                    background: bgW,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 8,
                    padding: '7px 12px',
                    fontSize: 11,
                    color: softColor,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'system-ui',
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((msg, i) => (
            <div key={i} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
            }}>
              <div style={{
                background: msg.role === 'user' ? accentColor : bgW,
                color: msg.role === 'user' ? '#fff' : textColor,
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '9px 13px',
                fontSize: 13,
                lineHeight: 1.55,
                border: msg.role === 'assistant' ? `1px solid ${borderColor}` : 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
              {/* File changes badge on the last assistant message */}
              {msg.role === 'assistant' && msg.changedFiles?.length > 0 && (
                <div style={{marginTop:6,display:'flex',flexWrap:'wrap',gap:4}}>
                  {msg.changedFiles.map(f => (
                    <span key={f} style={{
                      fontSize:10,
                      background:`${accentColor}18`,
                      color:accentColor,
                      borderRadius:5,
                      padding:'2px 7px',
                      fontFamily:'monospace',
                    }}>{f}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{alignSelf:'flex-start',display:'flex',alignItems:'center',gap:6,padding:'8px 12px',background:bgW,borderRadius:12,border:`1px solid ${borderColor}`}}>
              <span style={{fontSize:12,color:faintColor,fontStyle:'italic'}}>Claude is thinking…</span>
            </div>
          )}

          <div ref={messagesEndRef}/>
        </div>

        {/* Pending deploy bar */}
        {pendingChanges && (
          <div style={{
            padding: '12px 16px',
            background: `${accentColor}0e`,
            borderTop: `1px solid ${accentColor}33`,
            flexShrink: 0,
          }}>
            {deployState === 'deploying' ? (
              <div style={{fontSize:12,color:accentColor,textAlign:'center',padding:'4px 0'}}>
                ⏳ Deploying changes…
              </div>
            ) : deployState === 'success' ? (
              <div style={{fontSize:12,color:'#4caf50',textAlign:'center',padding:'4px 0'}}>
                ✓ Deployed! Reloading…
              </div>
            ) : deployState?.error ? (
              <div>
                <div style={{fontSize:11,color:'#c94040',marginBottom:6,lineHeight:1.4}}>{deployState.error}</div>
                <button onClick={() => setDeployState(null)} style={{fontSize:11,color:faintColor,background:'none',border:'none',cursor:'pointer',padding:0}}>Dismiss</button>
              </div>
            ) : (
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:textColor,marginBottom:2}}>
                    {pendingChanges.changedFiles.length} file{pendingChanges.changedFiles.length!==1?'s':''} ready to deploy
                  </div>
                  <div style={{fontSize:10,color:faintColor}}>
                    {pendingChanges.changedFiles.join(', ')}
                  </div>
                </div>
                <button
                  onClick={deployChanges}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 9,
                    border: 'none',
                    background: accentColor,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                    fontFamily: 'system-ui',
                  }}
                >
                  Deploy →
                </button>
                <button
                  onClick={() => setPendingChanges(null)}
                  style={{background:'none',border:'none',cursor:'pointer',fontSize:13,color:faintColor,padding:'4px 6px'}}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '10px 14px 14px',
          borderTop: pendingChanges ? 'none' : `1px solid ${borderColor}`,
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || !hasKey}
            placeholder={hasKey ? 'Ask Claude to change anything… (Enter to send, Shift+Enter for newline)' : 'Add Claude API key in Settings to use Dev Mode'}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: `1px solid ${borderColor}`,
              background: bgW,
              color: textColor,
              fontSize: 13,
              fontFamily: 'system-ui',
              outline: 'none',
              resize: 'none',
              minHeight: 38,
              maxHeight: 120,
              lineHeight: 1.45,
              opacity: hasKey ? 1 : 0.5,
            }}
            rows={1}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || !hasKey}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: 'none',
              background: loading || !input.trim() || !hasKey ? borderColor : accentColor,
              color: '#fff',
              fontSize: 16,
              cursor: loading || !input.trim() || !hasKey ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            ↑
          </button>
        </div>

      </div>
    </>
  );
}


export { DevModePanel };