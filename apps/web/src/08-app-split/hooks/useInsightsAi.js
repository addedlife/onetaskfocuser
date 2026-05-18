import { useEffect, useRef, useState } from 'react';
import { runAIJob, gP } from '../../01-core.js';

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
    const job = await runAIJob("analytics.insight.v1", {
      priorityTiers: priTiers,
      data: {
        totalCompleted: metrics.total,
        currentStreak: metrics.sk,
        peakHour: metrics.pT || "unknown",
        bestDay: metrics.bD ? `${metrics.bD[0]} (${metrics.bD[1]} tasks)` : "unknown",
        byPriorityTier: priBreakdownDetailed,
        overallAverage: metrics.avg,
        goodEnoughCompletions: metrics.goodEnoughCount || 0,
        recentCompletions: recentDone,
      },
    }, aiOpts);
    const result = job?.text || "";
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
    const job = await runAIJob("analytics.chat.v1", {
      question: userMsg,
      previousChat: prevChat,
      data: {
        totalCompleted: metrics.total,
        activeQueue: actT.length,
        pinned: actT.filter(t=>t.pinned).length,
        blocked: actT.filter(t=>t.blocked).length,
        currentStreak: metrics.sk,
        peakCompletionHour: metrics.pT || "unknown",
        bestCompletionDay: metrics.bD ? `${metrics.bD[0]} (${metrics.bD[1]} tasks)` : "unknown",
        priorityTiers: priTiersChat,
        priorityBreakdown: priBreakdown,
        overallAverage: metrics.avg,
        goodEnoughCompletions: metrics.goodEnoughCount || 0,
        activeTasks: activeBreakdown,
        recentCompletions: recentDone,
      },
    }, aiOpts);
    const result = job?.text || "";
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
