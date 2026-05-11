import { useMemo } from 'react';
import { fmtMs } from '../../01-core.js';

export function useInsightsMetrics({ allComp, pris }) {
  const metrics = useMemo(() => {
    const validTime = value => Number.isFinite(Number(value)) && Number(value) > 0;
    const c = allComp.filter(t => validTime(t.completedAt) && validTime(t.createdAt)).map(t => ({ ...t, completedAt: Number(t.completedAt), createdAt: Number(t.createdAt) }));
    if (!c.length) return null;
    const byP = {};
    pris.forEach(p => { byP[p.id] = {ts:[], c:p.color, l:p.label}; });
    let tot = 0;
    c.forEach(t => { const ms = t.completedAt - t.createdAt; tot += ms; if (byP[t.priority]) byP[t.priority].ts.push(ms); });
    const pS = Object.entries(byP).filter(([,v])=>v.ts.length>0).map(([k,v])=>({id:k,l:v.l,c:v.c,n:v.ts.length,a:fmtMs(v.ts.reduce((a,b)=>a+b,0)/v.ts.length)}));
    const byH = {};
    c.forEach(t => { const h = new Date(t.completedAt).getHours(); byH[h]=(byH[h]||0)+1; });
    const bH = Object.entries(byH).sort((a,b)=>b[1]-a[1])[0];
    const pT = bH ? (parseInt(bH[0])===0?"12:00 AM":parseInt(bH[0])<12?`${bH[0]}:00 AM`:parseInt(bH[0])===12?"12:00 PM":`${parseInt(bH[0])-12}:00 PM`) : null;
    const byD = {};
    c.forEach(t => { const d = new Date(t.completedAt).toLocaleDateString("en-US",{weekday:"long"}); byD[d]=(byD[d]||0)+1; });
    const bD = Object.entries(byD).sort((a,b)=>b[1]-a[1])[0];
    const ds = new Set(c.map(t=>new Date(t.completedAt).toDateString()));
    let sk = 0; const td = new Date();
    for (let i=0; i<365; i++) { const d=new Date(td); d.setDate(d.getDate()-i); if(ds.has(d.toDateString()))sk++;else break; }
    const goodEnoughCount = c.filter(t => t.goodEnough).length;
    return {total:c.length, avg:fmtMs(tot/c.length), pS, bD, pT, sk, cL:c.sort((a,b)=>b.completedAt-a.completedAt), goodEnoughCount};
  }, [allComp, pris]);

  const chartData = useMemo(() => {
    if (!metrics) return null;
    const cL = metrics.cL;
    const now = Date.now();
    const DAY = 86400000;
    const fmtH = h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`;
    const h24 = Array.from({length:24}, (_,i) => ({h:i, n:0, label:fmtH(i)}));
    cL.filter(t => now - t.completedAt < DAY).forEach(t => { h24[new Date(t.completedAt).getHours()].n++; });
    const days7 = Array.from({length:7}, (_,i) => {
      const d = new Date(now - (6-i)*DAY);
      return {date:d.toDateString(), label:d.toLocaleDateString('en-US',{weekday:'short'}).slice(0,2), n:0};
    });
    cL.filter(t => now - t.completedAt < 7*DAY).forEach(t => {
      const entry = days7.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });
    const days30 = Array.from({length:30}, (_,i) => {
      const d = new Date(now - (29-i)*DAY);
      return {date:d.toDateString(), label:i%5===0?String(d.getDate()):'', n:0, dow:d.getDay()};
    });
    cL.filter(t => now - t.completedAt < 30*DAY).forEach(t => {
      const entry = days30.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });
    const allHours = Array.from({length:24}, (_,i) => ({h:i, n:0, label:fmtH(i)}));
    cL.forEach(t => { allHours[new Date(t.completedAt).getHours()].n++; });
    const donut = metrics.pS.filter(p => p.n > 0);
    const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dow = Array.from({length:7}, (_,i) => ({h:i, n:0, label:DOW_NAMES[i]}));
    cL.forEach(t => { dow[new Date(t.completedAt).getDay()].n++; });
    const speedBuckets = [
      {label:'< 1h',  max:3600000,      n:0},
      {label:'< 1d',  max:86400000,     n:0},
      {label:'< 1w',  max:7*86400000,   n:0},
      {label:'< 1mo', max:30*86400000,  n:0},
      {label:'1mo+',  max:Infinity,     n:0},
    ];
    cL.filter(t => t.createdAt).forEach(t => {
      const ms = t.completedAt - t.createdAt;
      const b = speedBuckets.find(b => ms < b.max);
      if (b) b.n++;
    });
    const trend30 = days30.map(d => ({...d}));
    const cum90raw = Array.from({length:90}, (_,i) => {
      const d = new Date(now - (89-i)*DAY);
      return {date:d.toDateString(), label: i%15===0 ? `${d.getMonth()+1}/${d.getDate()}` : '', n:0, cum:0};
    });
    cL.filter(t => now - t.completedAt < 90*DAY).forEach(t => {
      const entry = cum90raw.find(d => d.date === new Date(t.completedAt).toDateString());
      if (entry) entry.n++;
    });
    let running = 0;
    cum90raw.forEach(d => { running += d.n; d.cum = running; });
    const cum90 = cum90raw.map(d => ({...d, n: d.cum}));
    return {h24, days7, days30, allHours, donut, dow, speedBuckets, trend30, cum90};
  }, [metrics]);

  const advice = useMemo(() => {
    if (!metrics) return [];
    const a = [];
    if (metrics.pT) a.push(`Your peak hour is ${metrics.pT} - schedule your hardest tasks then.`);
    if (metrics.bD) a.push(`Best day: ${metrics.bD[0]}s (${metrics.bD[1]} tasks). Try to batch difficult work then.`);
    if (metrics.sk >= 3) a.push(`${metrics.sk}-day streak! That's real momentum.`);
    if (!metrics.sk) a.push("No completions today. Try the 5-minute rule: just start for five minutes.");
    if (metrics.goodEnoughCount > 0) a.push(`${metrics.goodEnoughCount} task${metrics.goodEnoughCount!==1?"s":""} marked "good enough" - that's smart ADHD energy management.`);
    if (!a.length) a.push("Keep going!");
    return a;
  }, [metrics]);

  return { advice, chartData, metrics };
}
