import { useEffect, useRef, useState } from 'react';
import { callAI, gP } from '../../01-core.js';

export function useInsightsAi({ actT, aiOpts, hasAI, metrics, pris }) {
  const [aiInsight, setAiInsight] = useState(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatHistory, setAiChatHistory] = useState([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const chatBoxRef = useRef(null);

  const genAiInsight = async () => {
    if (!hasAI || !metrics) return;
    setAiInsightLoading(true);
    setAiInsight(null);
    const recentDone = metrics.cL.slice(0,10).map(t=>t.text).join("; ");
    const priTiers = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" -> ");
    const priBreakdownDetailed = metrics.pS.map(p=>`${p.l}: ${p.n} done, avg ${p.a}`).join("; ");
    const prompt = `You are a professional productivity analyst. Analyze this user's task completion data and provide a structured, data-driven summary.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN - different categories entirely. Treat each tier independently.
- Tone: professional and direct. Not critical or judgmental. Not overly enthusiastic or cheerleader-ish. Just clear, honest, useful.
- Surface real patterns from the data. If something is genuinely working well, note it factually.
- Each bullet must reference specific numbers or task names from the data.

Priority tiers (high urgency -> low urgency): ${priTiers}
Each tier has fundamentally different expected timeframes - this is by design.

Data:
- Total completed: ${metrics.total} tasks
- Current streak: ${metrics.sk} days
- Peak hour: ${metrics.pT || "unknown"}
- Best day: ${metrics.bD ? metrics.bD[0] : "unknown"} (${metrics.bD ? metrics.bD[1] + " tasks" : ""})
- By priority tier (completed): ${priBreakdownDetailed}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0}
- Recent completions: ${recentDone}

REQUIRED OUTPUT FORMAT - use this exact structure, no preamble, no extra text:
- [First observation - a specific pattern grounded in the data]
- [Second observation - a different angle, e.g. timing, energy, or tier consistency]
- [Third observation - something actionable or forward-looking]
TAKEAWAY: [The single most useful thing to know. One sentence. Specific.]`;
    const result = await callAI(prompt, aiOpts);
    setAiInsight(result || "Complete more tasks to generate a personalized insight.");
    setAiInsightLoading(false);
  };

  const sendAiChat = async (msg) => {
    if (!hasAI || !metrics || !msg.trim()) return;
    const userMsg = msg.trim();
    setAiChatHistory(h => {
      const updated = [...h, {role:"user", text:userMsg}];
      return updated.slice(-60);
    });
    setAiChatInput("");
    setAiChatLoading(true);
    const recentDone = metrics.cL.slice(0,20).map(t => `"${t.text}" (${t.priority}, ${t.completedAt?Math.round((t.completedAt-t.createdAt)/60000)+"min":"?"})`).join("; ");
    const priBreakdown = metrics.pS.map(p=>`${p.l}:${p.n} done, avg ${p.a}`).join("; ");
    const activeBreakdown = actT.map(t => `"${t.text}" [${gP(pris,t.priority).label}]${t.blocked?" BLOCKED":""}${t.pinned?" PINNED":""}`).join("; ");
    const prevChat = aiChatHistory.slice(-6).map(m => `${m.role}: ${m.text}`).join("\n");
    const priTiersChat = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" -> ");
    const sysPrompt = `You are a warm, expert ADHD productivity analyst. Give detailed, data-driven answers with specific numbers and patterns - always from a supportive, non-critical perspective.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN - they are a completely different category, like comparing a sprint to a marathon. Treat each tier independently and never present the difference as a problem.
- Never be critical, judgmental, or frame anything as a failure.
- Ground every insight in the user's actual data.
- Priority tiers (high urgency -> low): ${priTiersChat}

Data snapshot:
- Total completed: ${metrics.total} tasks
- Active queue: ${actT.length} tasks (${actT.filter(t=>t.pinned).length} pinned, ${actT.filter(t=>t.blocked).length} blocked)
- Current streak: ${metrics.sk} days
- Peak completion hour: ${metrics.pT||"unknown"}
- Best completion day: ${metrics.bD ? metrics.bD[0]+" ("+metrics.bD[1]+" tasks)" : "unknown"}
- Priority breakdown completed: ${priBreakdown}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0} of ${metrics.total} (${metrics.total?Math.round((metrics.goodEnoughCount||0)/metrics.total*100):0}%)
- Active tasks: ${activeBreakdown}
- Recent completions: ${recentDone}

${prevChat ? "Previous chat:\n" + prevChat + "\n" : ""}User question: ${userMsg}

Give a thorough, analytical response (4-8 sentences) with specific numbers and actionable insights. No bullet points or headers.`;
    const result = await callAI(sysPrompt, aiOpts);
    setAiChatHistory(h => {
      const updated = [...h, {role:"ai", text:result || "I couldn't analyze that. Try a different question."}];
      return updated.slice(-60);
    });
    setAiChatLoading(false);
  };

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [aiChatHistory, aiChatLoading]);

  return {
    aiChatHistory,
    aiChatInput,
    aiChatLoading,
    aiChatOpen,
    aiInsight,
    aiInsightLoading,
    chatBoxRef,
    genAiInsight,
    sendAiChat,
    setAiChatInput,
    setAiChatOpen,
  };
}
