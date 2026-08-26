(() => {
  'use strict';

  const BANK = window.QUESTION_BANK || [];
  const KB = window.BLACK_BELT_KNOWLEDGE || {topics:{},blueprint:{domains:{},totalQuestions:150}};
  const $ = (id) => document.getElementById(id);
  const letters = ['A','B','C','D'];
  const STORAGE = {
    history: 'bb_history_v1',
    nickname: 'bb_nickname_v1',
    activePrefix: 'bb_active_',
    dailyPrefix: 'bb_dailyset_',
    aiConfig: 'bb_ai_config_v2',
    aiKeyLocal: 'bb_ai_key_local_v2',
    aiKeySession: 'bb_ai_key_session_v2',
    aiDiagnosisPrefix: 'bb_ai_diagnosis_',
    aiQuestionPrefix: 'bb_ai_question_'
  };

  const AI_PRESETS = {
    deepseek: {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiStyle: 'chat'
    },
    openai: {
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-luna',
      apiStyle: 'responses'
    },
    qwen: {
      label: '通义千问 / 阿里云百炼',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.6-flash',
      apiStyle: 'chat'
    },
    custom: {
      label: '自定义 OpenAI-compatible',
      baseUrl: '',
      model: '',
      apiStyle: 'chat'
    }
  };

  let deferredInstallPrompt = null;
  let quiz = null;
  let timerHandle = null;
  let lastCheckinBlob = null;
  let lastCheckinUrl = null;
  let currentResultRecord = null;
  let currentAiQuestion = null;

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function formatDateCN(key = localDateKey()) {
    const [y,m,d] = key.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  }
  function dateFromKey(key){ const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d); }
  function getHistory(){ try{return JSON.parse(localStorage.getItem(STORAGE.history)||'[]')}catch{return[]} }
  function saveHistory(h){ localStorage.setItem(STORAGE.history,JSON.stringify(h)); }
  function getNickname(){ return localStorage.getItem(STORAGE.nickname)||'黑带冲刺学员'; }
  function showToast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(t._h); t._h=setTimeout(()=>t.hidden=true,2200); }
  function showView(id){ ['homeView','quizView','resultView'].forEach(v=>$(v).classList.toggle('active',v===id)); window.scrollTo({top:0,behavior:'smooth'}); }
  function hashString(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)} return h>>>0; }
  function rng(seed){ let x=seed||123456789; return ()=>{ x ^= x<<13; x ^= x>>>17; x ^= x<<5; return ((x>>>0)%1000000)/1000000; }; }
  function shuffle(arr,seed){ const a=[...arr],r=rng(seed); for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function escapeHtml(str){ return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function kbTopic(topic){ return (KB.topics && KB.topics[topic]) || null; }
  function domainInfo(domain){ return (KB.blueprint && KB.blueprint.domains && KB.blueprint.domains[domain]) || {weight:0,bok:'',cognition:''}; }
  function topicDomain(topic){ const k=kbTopic(topic); return k ? k.domain : ''; }
  function topicExamWeight(topic){ const d=topicDomain(topic); return domainInfo(d).weight || 0; }
  function domainStats(history){
    const domains=(KB.blueprint && KB.blueprint.domains)||{};
    const map={};
    Object.entries(domains).forEach(([name,info])=>map[name]={domain:name,weight:info.weight||0,bok:info.bok||'',correct:0,total:0});
    history.forEach(h=>(h.items||[]).forEach(it=>{
      const q=BANK.find(x=>x.id===it.id); if(!q)return; const d=topicDomain(q.topic); if(!d)return;
      if(!map[d])map[d]={domain:d,weight:0,bok:'',correct:0,total:0};
      map[d].total++; if(it.correct)map[d].correct++;
    }));
    return Object.values(map).map(x=>({...x,rate:x.total?x.correct/x.total:null}));
  }
  function kbContextForTopics(topics,limit=5){
    const unique=[...new Set((topics||[]).filter(Boolean))].slice(0,limit);
    return unique.map(topic=>{
      const k=kbTopic(topic); if(!k)return ''; const d=domainInfo(k.domain);
      return [`【${topic}｜${k.domain}｜BOK ${d.bok||''}｜约${d.weight||0}/150题｜认知层级 ${k.level||d.cognition||''}】`,
        `核心：${k.summary||''}`,
        `抓手：${(k.keyPoints||[]).join('；')}`,
        `易错：${(k.traps||[]).join('；')}`,
        `参考：${k.ref||''}`].join('\n');
    }).filter(Boolean).join('\n\n');
  }
  function topDomainRisks(history,limit=4){
    const priorP=.70, priorN=6;
    return domainStats(history).map(x=>{
      const posterior=(x.correct+priorP*priorN)/(x.total+priorN);
      const confidence=Math.min(1,x.total/10);
      const risk=(1-posterior)*x.weight*(.45+.55*confidence);
      return {...x,posterior,risk};
    }).sort((a,b)=>b.risk-a.risk).slice(0,limit);
  }

  function activeKey(){ return STORAGE.activePrefix + localDateKey(); }
  function dailyKey(){ return STORAGE.dailyPrefix + localDateKey(); }
  function getCompletedToday(){ return getHistory().find(h=>h.date===localDateKey()); }

  function weightedWrongCounts(history){
    const map={};
    history.forEach(h=>(h.items||[]).forEach(it=>{ if(!it.correct){ map[it.id]=(map[it.id]||0)+1; } }));
    return map;
  }

  function buildDailySet(){
    const stored=localStorage.getItem(dailyKey());
    if(stored){
      try{ const ids=JSON.parse(stored); const qs=ids.map(id=>BANK.find(q=>q.id===id)).filter(Boolean); if(qs.length===10)return qs; }catch{}
    }
    const date=localDateKey();
    const seed=hashString(date+'blackbelt');
    const history=getHistory();
    const seen=new Set(history.flatMap(h=>h.qids||[]));
    const unseen=BANK.filter(q=>!seen.has(q.id));
    let pool=unseen.length>=10 ? unseen : BANK;
    const groups={2:[],3:[],4:[],5:[]};
    pool.forEach(q=>(groups[q.set]||=[]).push(q));
    Object.keys(groups).forEach(s=>groups[s]=shuffle(groups[s],seed+Number(s)*997));
    const setOrder=shuffle([2,3,4,5],seed+77);
    const quotas={2:2,3:2,4:2,5:2}; setOrder.slice(0,2).forEach(s=>quotas[s]++);
    const selected=[]; const topicCounts={};
    const tryPush=(q)=>{
      if(selected.some(x=>x.id===q.id))return false;
      if((topicCounts[q.topic]||0)>=2)return false;
      selected.push(q); topicCounts[q.topic]=(topicCounts[q.topic]||0)+1; return true;
    };
    for(const s of [2,3,4,5]){
      let need=quotas[s];
      for(const q of groups[s]){ if(need<=0)break; if(tryPush(q))need--; }
      if(need>0){ for(const q of groups[s]){ if(need<=0)break; if(!selected.some(x=>x.id===q.id)){selected.push(q);need--;} } }
    }
    if(selected.length<10){
      const wrong=weightedWrongCounts(history);
      const fallback=shuffle(BANK,seed+131).sort((a,b)=>(wrong[b.id]||0)-(wrong[a.id]||0));
      for(const q of fallback){ if(selected.length>=10)break; if(!selected.some(x=>x.id===q.id))selected.push(q); }
    }
    const finalSet=selected.slice(0,10);
    localStorage.setItem(dailyKey(),JSON.stringify(finalSet.map(q=>q.id)));
    return finalSet;
  }

  function calcStreak(history){
    const dates=[...new Set(history.map(h=>h.date))].sort();
    if(!dates.length)return 0;
    let cursor=localDateKey();
    if(!dates.includes(cursor)){
      const d=new Date(); d.setDate(d.getDate()-1); cursor=localDateKey(d);
      if(!dates.includes(cursor))return 0;
    }
    let streak=0;
    while(dates.includes(cursor)){
      streak++;
      const d=dateFromKey(cursor); d.setDate(d.getDate()-1); cursor=localDateKey(d);
    }
    return streak;
  }

  function computeEstimate(history){
    if(!history.length)return null;
    const totalN=history.reduce((sum,h)=>sum+(h.total||10),0);
    const totalCorrect=history.reduce((sum,h)=>sum+(h.correct||0),0);
    const globalPriorN=20, globalPriorP=.70;
    const globalBayes=(totalCorrect+globalPriorN*globalPriorP)/(totalN+globalPriorN);

    const ds=domainStats(history);
    const totalWeight=(KB.blueprint&&KB.blueprint.totalQuestions)||150;
    const domainPriorN=6, domainPriorP=.70;
    let weighted=0, coveredWeight=0;
    ds.forEach(d=>{
      const p=(d.correct+domainPriorN*domainPriorP)/(d.total+domainPriorN);
      weighted += p*(d.weight||0);
      if(d.total>0)coveredWeight += (d.weight||0);
    });
    const bokP=weighted/Math.max(1,totalWeight);

    const recent=[...history].sort((a,b)=>a.date.localeCompare(b.date)).slice(-5);
    let num=0,den=0;
    recent.forEach((h,i)=>{ const w=Math.pow(1.35,i); num+=(h.score/100)*w; den+=w; });
    const recentP=den?num/den:globalBayes;
    const p=Math.max(.35,Math.min(.98,.60*bokP+.25*globalBayes+.15*recentP));
    const se=Math.sqrt(p*(1-p)/(totalN+globalPriorN));
    const uncovered=1-Math.min(1,coveredWeight/Math.max(1,totalWeight));
    const half=Math.max(5,Math.min(18,1.645*se*100+2+uncovered*4));
    return {score:Math.round(p*100),low:Math.max(0,Math.round(p*100-half)),high:Math.min(100,Math.round(p*100+half)),n:totalN,bokWeighted:true,coveredWeight};
  }

  function topicFocus(history, limit=3){
    const score={};
    history.forEach(h=>(h.items||[]).forEach(it=>{
      if(!it.correct){ const q=BANK.find(x=>x.id===it.id); if(q){ const wf=1+(topicExamWeight(q.topic)/25); score[q.topic]=(score[q.topic]||0)+(q.difficulty||1)*wf; } }
    }));
    return Object.entries(score).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(x=>x[0]);
  }

  function topicStats(history){
    const m={};
    history.forEach(h=>(h.items||[]).forEach(it=>{
      const q=BANK.find(x=>x.id===it.id); if(!q)return;
      if(!m[q.topic])m[q.topic]={correct:0,total:0};
      m[q.topic].total++;
      if(it.correct)m[q.topic].correct++;
    }));
    return Object.entries(m).map(([topic,v])=>({topic,correct:v.correct,total:v.total,rate:v.total?v.correct/v.total:0}));
  }

  function renderChips(container,arr,hot=true){
    container.innerHTML='';
    (arr.length?arr:['保持综合复习']).forEach(t=>{ const s=document.createElement('span'); s.className='chip'+(hot?' hot':''); s.textContent=t; container.appendChild(s); });
  }

  function getAiConfig(){
    let cfg={provider:'deepseek',baseUrl:AI_PRESETS.deepseek.baseUrl,model:AI_PRESETS.deepseek.model,enabled:false,remember:false};
    try{ cfg={...cfg,...JSON.parse(localStorage.getItem(STORAGE.aiConfig)||'{}')}; }catch{}
    if(!AI_PRESETS[cfg.provider])cfg.provider='custom';
    return cfg;
  }
  function getAiKey(){
    const cfg=getAiConfig();
    if(cfg.remember){ return localStorage.getItem(STORAGE.aiKeyLocal)||sessionStorage.getItem(STORAGE.aiKeySession)||''; }
    return sessionStorage.getItem(STORAGE.aiKeySession)||'';
  }
  function isAiReady(){
    const cfg=getAiConfig();
    return !!(cfg.enabled && cfg.baseUrl && cfg.model && getAiKey());
  }
  function providerLabel(cfg=getAiConfig()){
    return (AI_PRESETS[cfg.provider]&&AI_PRESETS[cfg.provider].label)||'自定义服务商';
  }
  function aiDiagnosisKey(date){ return STORAGE.aiDiagnosisPrefix+date; }
  function aiQuestionKey(date,qid){ return STORAGE.aiQuestionPrefix+date+'_'+qid; }
  function clearAiKey(){
    localStorage.removeItem(STORAGE.aiKeyLocal);
    sessionStorage.removeItem(STORAGE.aiKeySession);
  }

  function refreshAiUi(){
    const ready=isAiReady(); const cfg=getAiConfig();
    $('aiStatusDot').classList.toggle('on',ready);
    $('aiHomeBadge').textContent=ready?'已开启':'未开启'; $('aiHomeBadge').classList.toggle('on',ready);
    $('aiResultBadge').textContent=ready?'已开启':'未开启'; $('aiResultBadge').classList.toggle('on',ready);
    $('aiHomeSummary').textContent=ready?`${providerLabel(cfg)} · ${cfg.model}。AI 只在你主动点击诊断/追问时调用。`:'未开启。每日练习、评分、解析、预估与打卡均可正常使用。';
    $('aiHomeActionBtn').textContent=ready?'管理 AI 设置':'设置 AI 加持';
    $('generateAiDiagnosisBtn').textContent=ready?'生成今日 AI 诊断':'开启 AI 加持';
    $('aiResultStatus').textContent=ready?`${providerLabel(cfg)} 已就绪。可基于今日错题与近期表现生成个性化冲刺建议。`:'开启后，AI 会结合今天错题和近期表现给出冲刺建议。';
    document.querySelectorAll('.ask-ai-btn').forEach(btn=>{ btn.disabled=!ready; btn.textContent=ready?'🤖 问 AI：为什么我会错？':'🤖 开启 AI 后可追问'; });
  }

  function refreshHome(){
    const history=getHistory(); const done=getCompletedToday(); const estimate=computeEstimate(history);
    $('streakValue').textContent=calcStreak(history);
    $('estimateValue').textContent=estimate?estimate.score:'—';
    $('bankValue').textContent=BANK.length;
    $('daysDoneBadge').textContent=`${history.length} 天`;
    $('todayTitle').textContent=`${formatDateCN()} · 今日一练`;
    $('nicknameInput').value=getNickname()==='黑带冲刺学员'?'':getNickname();
    const active=localStorage.getItem(activeKey());
    if(done){
      $('startBtn').hidden=true; $('resumeBtn').hidden=false; $('resumeBtn').textContent=`查看今日结果 · ${done.score}分`;
      $('todayDesc').textContent='今天已经完成。建议先看错题解析，再把打卡图发到学习群。';
    }else{
      $('startBtn').hidden=false; $('resumeBtn').hidden=true;
      $('startBtn').textContent=active?'继续今日 10 题':'开始今日 10 题';
      $('todayDesc').textContent='从四套模拟题中抽取 10 道，约 10–15 分钟完成。';
    }
    if(!estimate){ $('trendEmpty').hidden=false; $('trendContent').hidden=true; }
    else{
      $('trendEmpty').hidden=true; $('trendContent').hidden=false;
      $('estimateMain').textContent=estimate.score;
      $('estimateRange').textContent=`预计区间 ${estimate.low}–${estimate.high}`;
      $('estimateLabel').textContent=estimate.n<30?'BOK加权 · 样本积累中':estimate.n<70?'BOK加权 · 趋势开始稳定':'BOK加权 · 参考价值较高';
      renderChips($('focusTags'),topicFocus(history));
    }
    refreshAiUi();
  }

  function startQuiz(){
    if(getCompletedToday()){ renderResult(getCompletedToday()); return; }
    const qs=buildDailySet();
    let saved=null; try{saved=JSON.parse(localStorage.getItem(activeKey())||'null')}catch{}
    if(saved && Array.isArray(saved.qids) && saved.qids.join(',')===qs.map(q=>q.id).join(',')){
      quiz={questions:qs,answers:saved.answers||Array(10).fill(null),index:saved.index||0,startTime:saved.startTime||Date.now()};
    }else{
      quiz={questions:qs,answers:Array(10).fill(null),index:0,startTime:Date.now()};
      persistQuiz();
    }
    showView('quizView'); renderQuestion(); startTimer();
  }
  function persistQuiz(){ if(!quiz)return; localStorage.setItem(activeKey(),JSON.stringify({qids:quiz.questions.map(q=>q.id),answers:quiz.answers,index:quiz.index,startTime:quiz.startTime})); }
  function startTimer(){ clearInterval(timerHandle); const update=()=>{ if(!quiz)return; const sec=Math.floor((Date.now()-quiz.startTime)/1000); $('timerText').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }; update(); timerHandle=setInterval(update,1000); }
  function stopTimer(){clearInterval(timerHandle);timerHandle=null;}

  function renderQuestion(){
    const q=quiz.questions[quiz.index];
    $('progressText').textContent=`${quiz.index+1} / 10`;
    $('progressBar').style.width=`${(quiz.index+1)*10}%`;
    $('questionTopic').textContent=q.topic;
    $('questionSource').textContent=`模拟题${q.set} · 第${q.qno}题`;
    $('questionText').textContent=q.question;
    const box=$('optionsBox'); box.innerHTML='';
    q.options.forEach((opt,i)=>{
      const b=document.createElement('button'); b.className='option-btn'+(quiz.answers[quiz.index]===i?' selected':'');
      b.innerHTML=`<span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
      b.addEventListener('click',()=>{quiz.answers[quiz.index]=i;persistQuiz();renderQuestion();}); box.appendChild(b);
    });
    $('prevBtn').disabled=quiz.index===0; $('prevBtn').style.opacity=quiz.index===0?'.45':'1';
    const last=quiz.index===9; $('nextBtn').hidden=last; $('submitBtn').hidden=!last;
  }
  function go(delta){ quiz.index=Math.max(0,Math.min(9,quiz.index+delta)); persistQuiz(); renderQuestion(); }

  function submitQuiz(){
    const unanswered=quiz.answers.reduce((a,x,i)=>{if(x===null||x===undefined)a.push(i+1);return a;},[]);
    if(unanswered.length){ showToast(`还有 ${unanswered.length} 题未作答`); quiz.index=unanswered[0]-1; renderQuestion(); return; }
    stopTimer();
    const items=quiz.questions.map((q,i)=>({id:q.id,answer:quiz.answers[i],correct:quiz.answers[i]===q.answer}));
    const correct=items.filter(x=>x.correct).length; const score=correct*10; const elapsed=Math.max(1,Math.round((Date.now()-quiz.startTime)/1000));
    const record={date:localDateKey(),score,correct,total:10,elapsed,qids:quiz.questions.map(q=>q.id),items};
    const history=getHistory().filter(h=>h.date!==record.date); history.push(record); history.sort((a,b)=>a.date.localeCompare(b.date)); saveHistory(history);
    localStorage.removeItem(activeKey());
    renderResult(record);
  }

  function resultFocus(record){
    const m={};
    (record.items||[]).forEach(it=>{if(!it.correct){const q=BANK.find(x=>x.id===it.id);if(q){const wf=1+(topicExamWeight(q.topic)/25);m[q.topic]=(m[q.topic]||0)+(q.difficulty||1)*wf;}}});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  }
  function adviceFor(record,focus){
    const risks=topDomainRisks(getHistory(),2).filter(x=>x.total>0);
    const riskText=risks.length?` 当前累计风险较高的 BOK 模块是 ${risks.map(x=>`${x.domain}（${x.weight}/150题）`).join('、')}。`:'';
    if(record.correct===10)return '今日全对。下一步不要只重复熟题，继续轮换 Measure、Analyze、Improve 等高权重模块，避免“熟题高分假象”。'+riskText;
    const prefix=record.score>=80?'基础已经比较稳，':'目前还有明显得分空间，';
    const detail=focus.length?`先把 ${focus.join('、')} 的错题重新做一遍，重点确认“为什么其他选项不对”。`:'先回看今日错题。';
    return prefix+detail+riskText+' 明天的 10 题会优先覆盖未做题；题库轮完后会提高历史错题的出现概率。';
  }

  function renderKnowledgeReview(record){
    const box=$('knowledgeReviewList'); if(!box)return; box.innerHTML='';
    let topics=(record.items||[]).filter(x=>!x.correct).map(it=>{const q=BANK.find(x=>x.id===it.id);return q&&q.topic;}).filter(Boolean);
    topics=[...new Set(topics)];
    if(!topics.length)topics=['统计推断','DOE实验设计','SPC控制图'];
    topics=topics.sort((a,b)=>topicExamWeight(b)-topicExamWeight(a)).slice(0,4);
    $('kbCoverageBadge').textContent=record.correct===10?'高权重轮换':`${topics.length} 个重点`;
    topics.forEach(topic=>{
      const k=kbTopic(topic); if(!k)return; const d=domainInfo(k.domain); const card=document.createElement('article'); card.className='kb-card';
      card.innerHTML=`<div class="kb-card-head"><div><div class="kb-card-title">${escapeHtml(topic)}</div><div class="kb-meta">BOK ${escapeHtml(d.bok||'')} · 约 ${d.weight||0}/150 题 · ${escapeHtml(k.level||d.cognition||'')}</div></div><span class="kb-domain">${escapeHtml(k.domain)}</span></div>
        <div class="kb-card-summary">${escapeHtml(k.summary||'')}</div>
        <div class="kb-block"><strong>考试抓手</strong><ul>${(k.keyPoints||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
        <div class="kb-block"><strong>常见陷阱</strong><ul class="kb-trap">${(k.traps||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
        <div class="kb-ref">参考：${escapeHtml(k.ref||'')}</div>`;
      box.appendChild(card);
    });
  }

  function kbInlineHtml(topic){
    const k=kbTopic(topic); if(!k)return ''; const d=domainInfo(k.domain);
    return `<details class="kb-inline"><summary>知识库补充 · ${escapeHtml(k.domain)} · BOK约${d.weight||0}/150题</summary><div class="kb-inline-body"><b>核心：</b>${escapeHtml(k.summary||'')}<br><b>易错：</b>${escapeHtml((k.traps||[]).join('；'))}<br><b>参考：</b>${escapeHtml(k.ref||'')}</div></details>`;
  }

  function renderResult(record){
    currentResultRecord=record;
    stopTimer(); showView('resultView');
    const history=getHistory(); const estimate=computeEstimate(history); const focus=resultFocus(record);
    $('scoreValue').textContent=record.score;
    $('correctCount').textContent=`${record.correct}/10`;
    $('resultEstimate').textContent=estimate?estimate.score:'—';
    $('elapsedValue').textContent=formatElapsed(record.elapsed||0);
    $('resultHeadline').textContent=record.score>=90?'状态很好，保持手感':record.score>=70?'今天这轮过关':'今天的错题很值钱';
    $('resultSummary').textContent=estimate?`按 CSSBB BOK 模块权重校正后的滚动实考预估 ${estimate.score} 分，当前区间约 ${estimate.low}–${estimate.high}。`:'完成更多练习后会生成滚动预估。';
    renderChips($('resultFocusTags'),focus);
    $('reviewAdvice').textContent=adviceFor(record,focus);
    renderKnowledgeReview(record);

    const storedDiagnosis=localStorage.getItem(aiDiagnosisKey(record.date));
    if(storedDiagnosis){ $('aiDiagnosisBox').textContent=storedDiagnosis; $('aiDiagnosisBox').hidden=false; }
    else{ $('aiDiagnosisBox').hidden=true; $('aiDiagnosisBox').textContent=''; }

    const list=$('reviewList'); list.innerHTML='';
    (record.items||[]).forEach((it,idx)=>{
      const q=BANK.find(x=>x.id===it.id); if(!q)return;
      const div=document.createElement('div'); div.className=`review-item ${it.correct?'correct':'wrong'}`;
      div.innerHTML=`<div class="review-head"><span class="review-number">${idx+1}. ${escapeHtml(q.topic)} · 模拟题${q.set}-${q.qno}</span><span class="review-status">${it.correct?'✓ 正确':'✕ 错误'}</span></div>
      <div class="review-q">${escapeHtml(q.question)}</div>
      <div class="answer-line">你的答案：${letters[it.answer]}　正确答案：<strong>${letters[q.answer]}</strong> ${escapeHtml(q.options[q.answer])}</div>
      <div class="explanation">${escapeHtml(q.explanation)}</div>${!it.correct?kbInlineHtml(q.topic):''}`;
      if(!it.correct){
        const aiBtn=document.createElement('button'); aiBtn.className='ask-ai-btn'; aiBtn.disabled=!isAiReady();
        aiBtn.textContent=isAiReady()?'🤖 问 AI：为什么我会错？':'🤖 开启 AI 后可追问';
        aiBtn.addEventListener('click',()=>{ if(!isAiReady()){openAiSettings();return;} openAiQuestion(record,it,idx); });
        div.appendChild(aiBtn);
      }
      list.appendChild(div);
    });
    refreshAiUi();
  }
  function formatElapsed(sec){ if(!sec)return '—'; const m=Math.floor(sec/60),s=sec%60; return m?`${m}分${String(s).padStart(2,'0')}秒`:`${s}秒`; }

  function normalizeBaseUrl(url){ return String(url||'').trim().replace(/\/+$/,''); }
  function endpointFor(cfg){
    const base=normalizeBaseUrl(cfg.baseUrl);
    if(cfg.provider==='openai')return /\/responses$/i.test(base)?base:`${base}/responses`;
    if(/\/chat\/completions$/i.test(base))return base;
    return `${base}/chat/completions`;
  }
  function parseAiText(data){
    if(!data)return '';
    if(typeof data.output_text==='string' && data.output_text.trim())return data.output_text.trim();
    if(Array.isArray(data.output)){
      const parts=[];
      data.output.forEach(item=>{
        (item.content||[]).forEach(c=>{ if(typeof c.text==='string')parts.push(c.text); else if(typeof c.output_text==='string')parts.push(c.output_text); });
      });
      if(parts.length)return parts.join('\n').trim();
    }
    const content=data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if(typeof content==='string')return content.trim();
    if(Array.isArray(content))return content.map(x=>x.text||x.content||'').join('\n').trim();
    return '';
  }
  function friendlyAiError(err){
    const msg=String(err && err.message ? err.message : err || '未知错误');
    if(/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg))return '网络请求失败或服务商阻止了浏览器跨域访问（CORS）。请检查网络、Base URL，或改用允许浏览器直接调用的服务商。';
    if(/401|unauthorized|invalid.*key|authentication/i.test(msg))return '认证失败：请检查 API Key 是否正确、是否属于当前服务商/区域。';
    if(/429|rate limit|quota|insufficient/i.test(msg))return '调用额度或频率受限：请检查账户余额、配额或稍后再试。';
    return msg.length>300?msg.slice(0,300)+'…':msg;
  }

  async function callAi(systemPrompt,userPrompt,maxTokens=900){
    const cfg=getAiConfig(); const apiKey=getAiKey();
    if(!isAiReady())throw new Error('AI 尚未配置完成');
    const url=endpointFor(cfg);
    if(location.protocol==='https:' && url.startsWith('http://'))throw new Error('GitHub Pages 使用 HTTPS，不能调用 HTTP 接口。请使用 HTTPS Base URL。');
    const headers={'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`};
    let body;
    if(cfg.provider==='openai'){
      body={model:cfg.model,instructions:systemPrompt,input:userPrompt,max_output_tokens:maxTokens};
    }else{
      body={model:cfg.model,messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],temperature:0.2,max_tokens:maxTokens};
    }
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const resp=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
      const raw=await resp.text();
      let data=null; try{data=JSON.parse(raw)}catch{}
      if(!resp.ok){
        const detail=(data && data.error && (data.error.message||data.error.code)) || raw || `HTTP ${resp.status}`;
        throw new Error(`HTTP ${resp.status}: ${String(detail).slice(0,500)}`);
      }
      const text=parseAiText(data);
      if(!text)throw new Error('AI 已返回结果，但没有解析到文本内容。请检查模型或接口格式。');
      return text;
    }catch(err){
      if(err && err.name==='AbortError')throw new Error('AI 请求超时（45秒）。请稍后重试或更换模型。');
      throw err;
    }finally{ clearTimeout(timeout); }
  }

  function buildDiagnosisPrompt(record){
    const history=getHistory(); const estimate=computeEstimate(history); const focus=resultFocus(record);
    const recent=[...history].sort((a,b)=>a.date.localeCompare(b.date)).slice(-7);
    const stats=topicStats(history).filter(x=>x.total>=1).sort((a,b)=>a.rate-b.rate || b.total-a.total).slice(0,8);
    const risks=topDomainRisks(history,5);
    const wrongTopics=[];
    const wrong=(record.items||[]).filter(x=>!x.correct).map(it=>{
      const q=BANK.find(x=>x.id===it.id); if(!q)return ''; wrongTopics.push(q.topic);
      const k=kbTopic(q.topic); const d=k?domainInfo(k.domain):null;
      return [
        `- ${q.topic}｜${k?`${k.domain} / BOK ${d.bok} / 约${d.weight}/150题`:'未映射'}｜模拟题${q.set}-${q.qno}`,
        `  题目：${q.question}`,
        `  学员选择：${letters[it.answer]} ${q.options[it.answer]}`,
        `  题库标准答案：${letters[q.answer]} ${q.options[q.answer]}`,
        `  题库标准解析：${q.explanation}`
      ].join('\n');
    }).filter(Boolean).join('\n');
    const todayTopics=(record.items||[]).map(it=>{const q=BANK.find(x=>x.id===it.id);return q?`${q.topic}:${it.correct?'对':'错'}`:'';}).filter(Boolean).join('；');
    const kbContext=kbContextForTopics([...wrongTopics,...focus],5);
    return `今日日期：${record.date}
今日得分：${record.score}/100（${record.correct}/10）
用时：${formatElapsed(record.elapsed)}
BOK加权滚动实考预估：${estimate?`${estimate.score}分，区间${estimate.low}-${estimate.high}`:'样本不足'}
今日建议关注：${focus.join('、')||'综合巩固'}
今日各题主题结果：${todayTopics}

最近7次成绩：${recent.map(x=>`${x.date}:${x.score}`).join('；')}

BOK模块风险（权重/150题；累计答题表现）：
${risks.map(x=>`- ${x.domain}: ${x.weight}/150，${x.correct}/${x.total}${x.total?`（${Math.round(x.correct/x.total*100)}%）`:'（暂无样本）'}`).join('\n')}

累计薄弱主题（正确/总题数）：
${stats.map(x=>`- ${x.topic}: ${x.correct}/${x.total}（${Math.round(x.rate*100)}%）`).join('\n')||'- 暂无'}

今日错题详情：
${wrong||'今天没有错题。'}

本地黑带知识库摘要（请优先据此解释，不要与标准答案冲突）：
${kbContext||'今天无错题，按高权重模块做综合巩固。'}

请给出针对冲刺阶段的学习诊断。`;
  }

  async function generateAiDiagnosis(){
    if(!currentResultRecord)return;
    if(!isAiReady()){openAiSettings();return;}
    const box=$('aiDiagnosisBox'); box.hidden=false; box.classList.add('loading'); box.textContent='AI 正在读取今天的错题和近期表现…';
    $('generateAiDiagnosisBtn').disabled=true; $('generateAiDiagnosisBtn').textContent='正在生成…';
    const system=`你是一名六西格玛黑带考试冲刺教练。请严格遵守以下规则：
1. 用户提供的“题库标准答案”和“题库标准解析”是本应用的判题依据，不要擅自改答案。
2. 解释优先使用用户消息中的“本地黑带知识库摘要”。该知识库按 CSSBB Body of Knowledge 组织，并结合黑带手册整理。不要补造教材没有支持的规则。
3. CSSBB BOK 的模块题量（总计150题）可以用于判断复习优先级，但不要声称知道认证机构未提供的官方及格线或原始分到认证分的换算。应用的“实考预估”只是练习趋势。
4. 如果知识库与题库标准答案出现表述差异，以本题标准答案为判题依据，并用一句话提示“本题按题库口径”。
5. 输出中文，简洁、具体、可执行，不要写空泛鼓励。
6. 结构固定为：①今日判断；②最值得补的2-3个点（结合BOK权重）；③错题背后的思维漏洞；④今晚20-30分钟复习安排；⑤明日做题提醒。
7. 如果今天全对，也要指出如何避免“熟题高分假象”，建议跨主题巩固。`;
    try{
      const text=await callAi(system,buildDiagnosisPrompt(currentResultRecord),1200);
      box.classList.remove('loading'); box.textContent=text;
      localStorage.setItem(aiDiagnosisKey(currentResultRecord.date),text);
      $('generateAiDiagnosisBtn').textContent='重新生成 AI 诊断';
      showToast('AI 今日诊断已生成');
    }catch(err){
      box.classList.remove('loading'); box.textContent='AI 调用失败：'+friendlyAiError(err);
      $('generateAiDiagnosisBtn').textContent='重试 AI 诊断';
    }finally{ $('generateAiDiagnosisBtn').disabled=false; }
  }

  function openAiQuestion(record,it,idx){
    const q=BANK.find(x=>x.id===it.id); if(!q)return;
    currentAiQuestion={record,it,idx,q};
    $('aiQuestionContext').textContent=`第${idx+1}题 · ${q.topic}\n你的答案：${letters[it.answer]} ${q.options[it.answer]}\n标准答案：${letters[q.answer]} ${q.options[q.answer]}`;
    $('aiQuestionModal').hidden=false;
    const cached=localStorage.getItem(aiQuestionKey(record.date,q.id));
    if(cached){ $('aiQuestionOutput').classList.remove('loading'); $('aiQuestionOutput').textContent=cached; }
    else{ runAiQuestionAnalysis(); }
  }

  async function runAiQuestionAnalysis(){
    if(!currentAiQuestion || !isAiReady())return;
    const {record,it,q}=currentAiQuestion;
    const out=$('aiQuestionOutput'); out.classList.add('loading'); out.textContent='AI 正在分析这道错题…';
    $('regenerateAiQuestionBtn').disabled=true;
    const system=`你是六西格玛黑带考试错题教练。必须把“题库标准答案”视为本题判题依据，不要改答案。优先依据随题提供的本地黑带知识库摘要解释；知识库按 CSSBB BOK 和黑带手册整理。你的任务是帮助学员理解为什么自己的选项有诱惑力、关键概念是什么，以及下次如何快速判断。不要扩展到无关知识，不要虚构官方考试规则。输出中文，控制在300-500字。`;
    const user=`主题：${q.topic}\n来源：模拟题${q.set} 第${q.qno}题\n题目：${q.question}\n选项：\n${q.options.map((x,i)=>`${letters[i]}. ${x}`).join('\n')}\n学员答案：${letters[it.answer]} ${q.options[it.answer]}\n题库标准答案：${letters[q.answer]} ${q.options[q.answer]}\n题库标准解析：${q.explanation}\n\n本地黑带知识库摘要：\n${kbContextForTopics([q.topic],1)}\n\n请按以下格式解释：\n1. 我为什么容易选错；\n2. 正确判断的关键；\n3. 其他选项为什么不优；\n4. 一句话记忆钩子；\n5. 给我1道不重复原题的口头自测题（最后单独给答案）。`;
    try{
      const text=await callAi(system,user,800);
      out.classList.remove('loading'); out.textContent=text;
      localStorage.setItem(aiQuestionKey(record.date,q.id),text);
    }catch(err){ out.classList.remove('loading'); out.textContent='AI 调用失败：'+friendlyAiError(err); }
    finally{ $('regenerateAiQuestionBtn').disabled=false; }
  }

  function openAiSettings(){
    const cfg=getAiConfig();
    $('aiProviderSelect').value=cfg.provider;
    $('aiModelInput').value=cfg.model||'';
    $('aiBaseUrlInput').value=cfg.baseUrl||'';
    $('aiKeyInput').value=getAiKey();
    $('rememberAiKeyCheckbox').checked=!!cfg.remember;
    $('aiKeyInput').type='password'; $('toggleAiKeyBtn').textContent='显示';
    $('aiTestResult').hidden=true; $('aiTestResult').className='connection-result'; $('aiTestResult').textContent='';
    $('aiSettingsModal').hidden=false;
  }
  function closeAiSettings(){ $('aiSettingsModal').hidden=true; }
  function applyPreset(provider){
    const p=AI_PRESETS[provider]||AI_PRESETS.custom;
    $('aiModelInput').value=p.model;
    $('aiBaseUrlInput').value=p.baseUrl;
  }
  function readAiForm(){
    return {
      provider:$('aiProviderSelect').value,
      model:$('aiModelInput').value.trim(),
      baseUrl:normalizeBaseUrl($('aiBaseUrlInput').value),
      key:$('aiKeyInput').value.trim(),
      remember:$('rememberAiKeyCheckbox').checked
    };
  }
  function validateAiForm(form){
    if(!form.baseUrl)return '请填写 Base URL';
    if(!/^https?:\/\//i.test(form.baseUrl))return 'Base URL 需要以 http:// 或 https:// 开头';
    if(!form.model)return '请填写模型名称';
    if(!form.key)return '请填写 API Key';
    return '';
  }
  function persistAiForm(form,enabled=true){
    localStorage.setItem(STORAGE.aiConfig,JSON.stringify({provider:form.provider,model:form.model,baseUrl:form.baseUrl,remember:form.remember,enabled}));
    clearAiKey();
    if(form.remember)localStorage.setItem(STORAGE.aiKeyLocal,form.key);
    else sessionStorage.setItem(STORAGE.aiKeySession,form.key);
  }
  async function testAiConnection(){
    const form=readAiForm(); const err=validateAiForm(form);
    if(err){ showAiTest(false,err); return; }
    persistAiForm(form,true);
    $('testAiBtn').disabled=true; $('testAiBtn').textContent='连接中…';
    showAiTest(true,'正在测试连接…');
    try{
      const text=await callAi('你是连接测试助手。','只回复“OK”，不要添加其他内容。',48);
      showAiTest(true,`连接成功 · ${text.replace(/\s+/g,' ').slice(0,80)}`);
    }catch(e){ showAiTest(false,friendlyAiError(e)); }
    finally{ $('testAiBtn').disabled=false; $('testAiBtn').textContent='测试连接'; refreshAiUi(); }
  }
  function showAiTest(ok,msg){ const el=$('aiTestResult'); el.hidden=false; el.className='connection-result '+(ok?'ok':'err'); el.textContent=msg; }
  function saveAiSettings(){
    const form=readAiForm(); const err=validateAiForm(form);
    if(err){showAiTest(false,err);return;}
    persistAiForm(form,true); closeAiSettings(); refreshAiUi();
    if(currentResultRecord)renderResult(currentResultRecord);
    showToast(form.remember?'AI 已开启，Key 已保存在本设备':'AI 已开启，Key 仅保存在本次会话');
  }
  function disableAi(){
    const cfg=getAiConfig(); localStorage.setItem(STORAGE.aiConfig,JSON.stringify({...cfg,enabled:false,remember:false})); clearAiKey(); closeAiSettings(); refreshAiUi();
    if(currentResultRecord)renderResult(currentResultRecord);
    showToast('AI 已关闭，API Key 已清除');
  }

  function wrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines=99){
    const chars=[...text]; let line='',lines=[];
    for(const ch of chars){ const test=line+ch; if(ctx.measureText(test).width>maxWidth && line){lines.push(line);line=ch;}else line=test; }
    if(line)lines.push(line); lines=lines.slice(0,maxLines);
    lines.forEach((l,i)=>ctx.fillText(l,x,y+i*lineHeight));
    return y+lines.length*lineHeight;
  }
  function roundRect(ctx,x,y,w,h,r){ r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath(); }

  async function makeCheckin(record){
    const history=getHistory(); const estimate=computeEstimate(history); const focus=resultFocus(record); const streak=calcStreak(history); const nick=getNickname();
    const c=document.createElement('canvas'); c.width=1080;c.height=1440; const ctx=c.getContext('2d');
    const g=ctx.createLinearGradient(0,0,1080,1440); g.addColorStop(0,'#0f172a');g.addColorStop(.62,'#172554');g.addColorStop(1,'#1d4ed8');ctx.fillStyle=g;ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,255,255,.08)'; for(let i=0;i<7;i++){ctx.beginPath();ctx.arc(920-i*145,180+i*180,110+i*16,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#fff';ctx.font='800 42px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('黑带备考冲刺 · 每日一练',76,105);
    ctx.fillStyle='#cbd5e1';ctx.font='500 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`${formatDateCN(record.date)}  ·  ${nick}`,76,153);
    if(isAiReady()){
      ctx.font='800 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'; const label='AI 加持 · 已开启'; const w=ctx.measureText(label).width+40;
      ctx.fillStyle='rgba(124,58,237,.88)';roundRect(ctx,1004-w,82,w,42,21);ctx.fill();ctx.fillStyle='#fff';ctx.fillText(label,1024-w,110);
    }
    ctx.fillStyle='rgba(255,255,255,.10)';roundRect(ctx,76,220,928,410,42);ctx.fill();
    ctx.fillStyle='#93c5fd';ctx.font='700 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('今日得分',130,300);
    ctx.fillStyle='#fff';ctx.font='900 150px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.fillText(String(record.score),122,465);
    ctx.font='700 34px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('分',360,463);
    ctx.fillStyle='#cbd5e1';ctx.font='600 27px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`答对 ${record.correct}/10  ·  连续打卡 ${streak} 天`,130,548);
    ctx.fillStyle='#fff';ctx.font='800 31px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('滚动实考预估',590,315);
    ctx.font='900 84px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.fillText(estimate?String(estimate.score):'—',590,420);
    ctx.font='600 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillStyle='#bfdbfe';ctx.fillText(estimate?`预计区间 ${estimate.low}–${estimate.high}`:'继续积累样本',590,468);
    ctx.fillStyle='#94a3b8';ctx.font='500 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('基于近期练习的趋势估计，非官方考试换算分',590,516);

    ctx.fillStyle='rgba(255,255,255,.97)';roundRect(ctx,76,690,928,440,38);ctx.fill();
    ctx.fillStyle='#0f172a';ctx.font='800 34px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('今天优先复习',126,770);
    const tags=focus.length?focus:['综合巩固']; let y=830;
    tags.forEach((t,i)=>{ctx.font='700 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillStyle='#eff6ff';roundRect(ctx,126,y,Math.min(780,ctx.measureText(`${i+1}. ${t}`).width+70),62,31);ctx.fill();ctx.fillStyle='#1d4ed8';ctx.fillText(`${i+1}. ${t}`,153,y+40);y+=82;});
    ctx.fillStyle='#475569';ctx.font='500 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    wrapText(ctx,record.score===100?'今天全对。继续保持题感，同时把统计、DOE、SPC 等高区分度模块轮换复习。':'错题不是损失，是冲刺阶段最便宜的得分点。把原因弄清楚，明天再遇到就不丢分。',126,1070,810,38,3);
    ctx.fillStyle='#cbd5e1';ctx.font='600 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('四套模拟题 · CSSBB BOK加权复盘 · 每日10题',76,1312);
    ctx.fillStyle='#93c5fd';ctx.font='800 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('BLACK BELT SPRINT · V2.1 KNOWLEDGE',76,1352);
    return new Promise(resolve=>c.toBlob(b=>resolve({blob:b,url:URL.createObjectURL(b)}),'image/png',.95));
  }

  async function openCheckin(){
    const record=getCompletedToday(); if(!record){showToast('先完成今日练习');return;}
    $('checkinBtn').disabled=true;$('checkinBtn').textContent='正在生成…';
    try{
      if(lastCheckinUrl)URL.revokeObjectURL(lastCheckinUrl);
      const out=await makeCheckin(record); lastCheckinBlob=out.blob; lastCheckinUrl=out.url; $('checkinPreview').src=out.url; $('shareModal').hidden=false;
    }finally{$('checkinBtn').disabled=false;$('checkinBtn').textContent='生成打卡图片';}
  }
  function closeShareModal(){ $('shareModal').hidden=true; }
  async function shareImage(){
    if(!lastCheckinBlob)return;
    const file=new File([lastCheckinBlob],`黑带冲刺打卡-${localDateKey()}.png`,{type:'image/png'});
    try{
      if(navigator.canShare && navigator.canShare({files:[file]}) && navigator.share){
        await navigator.share({title:'黑带备考冲刺打卡',text:'今日黑带备考冲刺打卡',files:[file]});
      }else{ downloadImage(); showToast('已保存图片，请分享到微信学习群'); }
    }catch(e){ if(e && e.name!=='AbortError')showToast('系统分享未完成，可先保存图片'); }
  }
  function downloadImage(){
    if(!lastCheckinUrl)return; const a=document.createElement('a');a.href=lastCheckinUrl;a.download=`黑带冲刺打卡-${localDateKey()}.png`;document.body.appendChild(a);a.click();a.remove();
  }

  function setupInstall(){
    const btn=$('installBtn'); btn.hidden=false;
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;btn.textContent='安装';});
    btn.addEventListener('click',async()=>{
      if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return;}
      const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
      alert(isiOS?'iPhone 安装：用 Safari 打开本页 → 点击底部“分享” → 选择“添加到主屏幕”。':'如果浏览器没有弹出安装提示，请打开浏览器菜单并选择“安装应用”或“添加到主屏幕”。');
    });
  }

  function bind(){
    $('startBtn').addEventListener('click',startQuiz);
    $('resumeBtn').addEventListener('click',()=>{const r=getCompletedToday();if(r)renderResult(r)});
    $('prevBtn').addEventListener('click',()=>go(-1)); $('nextBtn').addEventListener('click',()=>go(1)); $('submitBtn').addEventListener('click',submitQuiz);
    $('quitQuizBtn').addEventListener('click',()=>{persistQuiz();stopTimer();showView('homeView');refreshHome();});
    $('backHomeBtn').addEventListener('click',()=>{showView('homeView');refreshHome();});
    $('saveNicknameBtn').addEventListener('click',()=>{const v=$('nicknameInput').value.trim();localStorage.setItem(STORAGE.nickname,v||'黑带冲刺学员');showToast('昵称已保存');});
    $('checkinBtn').addEventListener('click',openCheckin); $('shareImageBtn').addEventListener('click',shareImage); $('downloadImageBtn').addEventListener('click',downloadImage);
    document.querySelectorAll('[data-close-share]').forEach(el=>el.addEventListener('click',closeShareModal));

    $('aiSettingsBtn').addEventListener('click',openAiSettings); $('aiHomeActionBtn').addEventListener('click',openAiSettings);
    document.querySelectorAll('[data-close-ai-settings]').forEach(el=>el.addEventListener('click',closeAiSettings));
    $('aiProviderSelect').addEventListener('change',e=>applyPreset(e.target.value));
    $('toggleAiKeyBtn').addEventListener('click',()=>{ const inp=$('aiKeyInput'); const show=inp.type==='password'; inp.type=show?'text':'password'; $('toggleAiKeyBtn').textContent=show?'隐藏':'显示'; });
    $('testAiBtn').addEventListener('click',testAiConnection); $('saveAiBtn').addEventListener('click',saveAiSettings); $('disableAiBtn').addEventListener('click',disableAi);
    $('generateAiDiagnosisBtn').addEventListener('click',generateAiDiagnosis);
    document.querySelectorAll('[data-close-ai-question]').forEach(el=>el.addEventListener('click',()=>{$('aiQuestionModal').hidden=true;}));
    $('regenerateAiQuestionBtn').addEventListener('click',runAiQuestionAnalysis);
  }

  function init(){
    $('bankValue').textContent=BANK.length; bind();setupInstall();refreshHome();
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
