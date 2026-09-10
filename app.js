(() => {
  'use strict';

  const BANK = window.QUESTION_BANK || [];
  const KB = window.BLACK_BELT_KNOWLEDGE || {topics:{},blueprint:{domains:{},totalQuestions:150}};
  // V3：needs_review 题不进任何抽题池；dupOf（跨套重复题）不进每日抽题池（章节练习题池不足时兜底回补）。
  const isBlocked = (q)=>q && q.review==='needs_review';
  const PRACTICE_BANK = BANK.filter(q=>!isBlocked(q));
  const DAILY_BANK = PRACTICE_BANK.filter(q=>!q.dupOf);
  const $ = (id) => document.getElementById(id);
  const letters = ['A','B','C','D'];
  const STORAGE = {
    history: 'bb_history_v1',
    nickname: 'bb_nickname_v1',
    examDate: 'bb_exam_date_v1',
    dailyCount: 'bb_daily_count_v3',
    difficulty: 'bb_difficulty_v3',
    theme: 'bb_theme_v25',
    newRatioPrefix: 'bb_new_ratio_v25_',
    activePrefix: 'bb_active_v251_',
    dailyPrefix: 'bb_dailyset_v251_',
    chapterActivePrefix: 'bb_active_chapter_v3_',
    aiConfig: 'bb_ai_config_v2',
    aiKeyLocal: 'bb_ai_key_local_v2',
    aiKeySession: 'bb_ai_key_session_v2',
    aiDiagnosisPrefix: 'bb_ai_diagnosis_',
    aiQuestionPrefix: 'bb_ai_question_'
  };

  const THEMES = {
    default: {label:'默认 · 专业蓝', bg1:'#0f172a',bg2:'#172554',bg3:'#1d4ed8',accent:'#2563eb',soft:'#93c5fd',ink:'#0f172a'},
    anime: {label:'二次元 · 轻快', bg1:'#5b4b8a',bg2:'#7c3aed',bg3:'#06b6d4',accent:'#ec4899',soft:'#f9a8d4',ink:'#3b0764'},
    scifi: {label:'科幻 · 霓虹', bg1:'#020617',bg2:'#082f49',bg3:'#0e7490',accent:'#06b6d4',soft:'#67e8f9',ink:'#082f49'},
    scholar: {label:'学霸 · 纸笔', bg1:'#172554',bg2:'#1e3a8a',bg3:'#ca8a04',accent:'#1d4ed8',soft:'#fde68a',ink:'#172554'},
    chinese: {label:'中国风 · 丹青', bg1:'#3f1d1d',bg2:'#7f1d1d',bg3:'#a16207',accent:'#b91c1c',soft:'#fca5a5',ink:'#3f1d1d'},
    nezha: {label:'哪吒 · 国潮神话', bg1:'#450a0a',bg2:'#991b1b',bg3:'#ea580c',accent:'#ef4444',soft:'#fdba74',ink:'#450a0a'},
    odyssey: {label:'古希腊 · 奥德赛', bg1:'#0c4a6e',bg2:'#075985',bg3:'#b45309',accent:'#0284c7',soft:'#fcd34d',ink:'#0c4a6e'}
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
  function getDailyCount(){
    const n=Number(localStorage.getItem(STORAGE.dailyCount)||10);
    return [5,10,15,20].includes(n)?n:10;
  }
  function getDifficulty(){
    const v=localStorage.getItem(STORAGE.difficulty)||'medium';
    return ['low','medium','high'].includes(v)?v:'medium';
  }
  function difficultyLabel(v=getDifficulty()){ return ({low:'低',medium:'中',high:'高'})[v]||'中'; }
  function difficultyText(v=getDifficulty()){ return ({low:'基础巩固',medium:'标准难度',high:'高难挑战'})[v]||'标准难度'; }
  function difficultyWeights(v){
    if(v==='low') return {1:12,2:4,3:1};
    if(v==='high') return {1:1,2:6,3:16};
    return {1:3,2:12,3:5};
  }
  function getTheme(){
    const v=localStorage.getItem(STORAGE.theme)||'default';
    return THEMES[v]?v:'default';
  }
  function applyTheme(v=getTheme()){
    const theme=THEMES[v]?v:'default';
    document.documentElement.dataset.theme=theme;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',THEMES[theme].bg1);
  }
  function themeLabel(v=getTheme()){ return (THEMES[v]||THEMES.default).label; }
  function ratioStorageKey(){ return STORAGE.newRatioPrefix+localDateKey(); }
  function getManualNewRatio(){
    const raw=localStorage.getItem(ratioStorageKey());
    if(raw===null || raw==='')return null;
    const n=Number(raw);
    return Number.isFinite(n)&&n>=0&&n<=100?Math.round(n/10)*10:null;
  }
  function saveManualNewRatio(n){ localStorage.setItem(ratioStorageKey(),String(Math.max(0,Math.min(100,Math.round(Number(n)/10)*10)))); }
  function getActiveState(){ try{return JSON.parse(localStorage.getItem(activeKey())||'null')}catch{return null} }
  function getTodayTargetCount(){
    const active=getActiveState(); if(active && Array.isArray(active.qids))return active.total||active.qids.length||getDailyCount();
    return getDailyCount();
  }
  function getExamDate(){
    const v=localStorage.getItem(STORAGE.examDate)||'';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  }
  function examPhase(days){
    if(days < 0) return {label:'考试日期已过', tone:'past'};
    if(days === 0) return {label:'今天考试', tone:'today'};
    if(days <= 6) return {label:'考前决战', tone:'final'};
    if(days <= 14) return {label:'冲刺期', tone:'sprint'};
    if(days <= 30) return {label:'强化训练期', tone:'intense'};
    return {label:'系统复习期', tone:'system'};
  }
  function examCountdown(){
    const key=getExamDate(); if(!key)return null;
    const today=dateFromKey(localDateKey());
    const exam=dateFromKey(key);
    const days=Math.round((exam-today)/86400000);
    return {key,days,phase:examPhase(days)};
  }
  function getTodayAnsweredCount(){
    const active=getActiveState();
    if(active && Array.isArray(active.answers)) return active.answers.filter(x=>x!==null&&x!==undefined).length;
    return 0;
  }
  function refreshCountdown(history,estimate){
    const cd=examCountdown();
    $('countdownUnset').hidden=!!cd;
    $('countdownActive').hidden=!cd;
    $('examDateBtn').textContent=cd?'修改日期':'设置考试日期';
    if(!cd)return;
    $('countdownDays').textContent=Math.abs(cd.days);
    $('countdownUnit').textContent=cd.days===0?'':'天';
    $('countdownMessage').textContent=cd.days>0?'距离考试':cd.days===0?'今天就是考试日':'考试日期已过去';
    $('countdownExamDate').textContent=formatDateCN(cd.key);
    $('countdownPhase').textContent=cd.phase.label;
    $('countdownPhase').className=`phase-pill ${cd.phase.tone}`;
    const active=getActiveState(), attempts=getTodayAttempts();
    $('countdownTodayProgress').textContent=active?`${getTodayAnsweredCount()}/${getTodayTargetCount()}`:(attempts.length?`${attempts.length}轮`:`0/${getTodayTargetCount()}`);
    $('countdownTotalQuestions').textContent=history.reduce((sum,h)=>sum+(h.total||10),0);
    $('countdownEstimate').textContent=estimate?estimate.score:'—';
  }
  function openExamDateModal(){
    const cd=getExamDate();
    $('examDateInput').min=localDateKey();
    $('examDateInput').value=cd||'';
    $('clearExamDateBtn').hidden=!cd;
    $('examDateModal').hidden=false;
    setTimeout(()=>{ try{$('examDateInput').focus();}catch{} },50);
  }
  function closeExamDateModal(){ $('examDateModal').hidden=true; }
  function saveExamDate(){
    const v=$('examDateInput').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){ showToast('请选择考试日期'); return; }
    if(dateFromKey(v) < dateFromKey(localDateKey())){ showToast('考试日期不能早于今天'); return; }
    localStorage.setItem(STORAGE.examDate,v);
    closeExamDateModal(); refreshHome(); showToast(`已设置考试日期：${formatDateCN(v)}`);
  }
  function clearExamDate(){
    localStorage.removeItem(STORAGE.examDate); closeExamDateModal(); refreshHome(); showToast('已清除考试日期');
  }
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
  function dailyKey(count=getDailyCount(),difficulty=getDifficulty(),attemptNo=1,newRatio=80){ return `${STORAGE.dailyPrefix}${localDateKey()}_${count}_${difficulty}_a${attemptNo}_r${newRatio}`; }
  function getTodayAttempts(){
    return getHistory().filter(h=>h.date===localDateKey()).sort((a,b)=>((a.attemptNo||1)-(b.attemptNo||1))||((a.completedAt||0)-(b.completedAt||0)));
  }
  function getBestToday(){
    const attempts=getTodayAttempts();
    if(!attempts.length)return null;
    return [...attempts].sort((a,b)=>(b.score-a.score)||((b.correct||0)-(a.correct||0))||((a.elapsed||Infinity)-(b.elapsed||Infinity)))[0];
  }
  function getLatestToday(){ const attempts=getTodayAttempts(); return attempts.length?attempts[attempts.length-1]:null; }
  function getCompletedToday(){ return getBestToday(); }
  function uniquePracticeDays(history=getHistory()){ return [...new Set(history.map(h=>h.date).filter(Boolean))]; }

  function weightedWrongCounts(history){
    const map={};
    history.forEach(h=>(h.items||[]).forEach(it=>{ if(!it.correct){ map[it.id]=(map[it.id]||0)+1; } }));
    return map;
  }
  function daysBetweenKeys(older,newer=localDateKey()){
    return Math.max(0,Math.round((dateFromKey(newer)-dateFromKey(older))/86400000));
  }
  function questionLastSeenMap(history=getHistory()){
    const map={};
    history.forEach(h=>{
      const ids=(h.qids&&h.qids.length)?h.qids:(h.items||[]).map(x=>x.id);
      ids.forEach(id=>{ if(!id)return; if(!map[id] || String(h.date)>map[id])map[id]=String(h.date); });
    });
    return map;
  }
  function questionExposure(q,lastSeenMap,asOf=localDateKey()){
    const last=lastSeenMap[q.id]||'';
    if(!last)return {kind:'new',never:true,last:'',days:Infinity};
    const days=daysBetweenKeys(last,asOf);
    return {kind:days>=28?'new':'old',never:false,last,days};
  }
  function recent7DailyAverage(history=getHistory()){
    const perDay={};
    history.forEach(h=>{ perDay[h.date]=(perDay[h.date]||0)+(h.total||0); });
    let total=0, activeDays=0;
    for(let i=1;i<=7;i++){
      const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-i); const key=localDateKey(d);
      const n=perDay[key]||0; total+=n; if(n>0)activeDays++;
    }
    if(!activeDays)return null;
    return total/7;
  }
  function globallySeenIds(history=getHistory()){
    return new Set(history.flatMap(h=>(h.qids&&h.qids.length)?h.qids:(h.items||[]).map(x=>x.id)).filter(Boolean));
  }
  function coveragePlan(count=getDailyCount(),history=getHistory()){
    const avg=recent7DailyAverage(history);
    let ratio=80;
    if(avg===null){
      ratio=count<=5?90:count===10?80:count===15?75:70;
    }else if(avg<7)ratio=90;
    else if(avg<10)ratio=85;
    else if(avg<=10)ratio=80;
    else if(avg<=15)ratio=75;
    else ratio=70;

    const seen=globallySeenIds(history);
    const remainingNever=Math.max(0,BANK.length-seen.size);
    const cd=examCountdown();
    let requiredNewPerDay=0, urgencyRaised=false;
    if(cd && cd.days>0 && remainingNever>0){
      requiredNewPerDay=Math.ceil(remainingNever/Math.max(1,cd.days));
      const requiredRatio=Math.min(100,Math.ceil((requiredNewPerDay/Math.max(1,count))*10)*10);
      if(requiredRatio>ratio){ ratio=requiredRatio; urgencyRaised=true; }
    }
    ratio=Math.max(50,Math.min(100,Math.round(ratio/5)*5));
    return {ratio,avg,seenCount:seen.size,remainingNever,requiredNewPerDay,urgencyRaised};
  }
  function targetNewRatio(count=getDailyCount(),attemptNo=1,history=getHistory()){
    const auto=coveragePlan(count,history);
    if(attemptNo>=2){
      const manual=getManualNewRatio();
      if(manual!==null)return {ratio:manual,mode:'manual',plan:auto};
    }
    return {ratio:auto.ratio,mode:'auto',plan:auto};
  }
  function balancedPick(pool,need,seed,scoreQ,selected,topicCounts,topicCap){
    if(need<=0 || !pool.length)return 0;
    const groups={2:[],3:[],4:[],5:[]};
    pool.forEach(q=>{ if(!selected.some(x=>x.id===q.id))(groups[q.set]||=[]).push(q); });
    Object.keys(groups).forEach(k=>groups[k].sort((a,b)=>scoreQ(b)-scoreQ(a)));
    const order=shuffle([2,3,4,5],seed);
    let added=0, guard=0;
    while(added<need && guard<1000){
      let progressed=false;
      for(const setNo of order){
        const arr=groups[setNo]||[];
        let idx=arr.findIndex(q=>(topicCounts[q.topic]||0)<topicCap && !selected.some(x=>x.id===q.id));
        if(idx<0)idx=arr.findIndex(q=>!selected.some(x=>x.id===q.id));
        if(idx>=0){
          const q=arr.splice(idx,1)[0]; selected.push(q);topicCounts[q.topic]=(topicCounts[q.topic]||0)+1;added++;progressed=true;
          if(added>=need)break;
        }
      }
      if(!progressed)break;
      guard++;
    }
    return added;
  }
  function buildDailySet(count=getDailyCount(),difficulty=getDifficulty(),attemptNo=1){
    const history=getHistory();
    const ratioInfo=targetNewRatio(count,attemptNo,history);
    const requestedNewRatio=ratioInfo.ratio;
    const strictNeverMode=requestedNewRatio===100;
    const globallySeen=globallySeenIds(history);
    const stored=localStorage.getItem(dailyKey(count,difficulty,attemptNo,requestedNewRatio));
    if(stored){
      try{
        const ids=JSON.parse(stored); const qs=ids.map(id=>BANK.find(q=>q.id===id)).filter(Boolean);
        const validLength=strictNeverMode?(qs.length>0 && qs.length<=count):(qs.length===count);
        const validStrict=!strictNeverMode || qs.every(q=>!globallySeen.has(q.id));
        if(validLength && validStrict){
          const lastSeen=questionLastSeenMap(history);
          const actualNew=strictNeverMode?qs.length:qs.filter(q=>questionExposure(q,lastSeen).kind==='new').length;
          qs._meta={requestedNewRatio,actualNewCount:actualNew,actualOldCount:qs.length-actualNew,ratioMode:ratioInfo.mode,plan:ratioInfo.plan,strictNeverMode,requestedCount:count,availableNeverSeen:DAILY_BANK.length-globallySeen.size,truncated:strictNeverMode&&qs.length<count};
          return qs;
        }
      }catch{}
    }
    const date=localDateKey();
    const seed=hashString(`${date}|blackbelt|${count}|${difficulty}|attempt:${attemptNo}|ratio:${requestedNewRatio}`);
    const wrong=weightedWrongCounts(history);
    const lastSeen=questionLastSeenMap(history);
    const weights=difficultyWeights(difficulty);
    const scoreQ=(q)=>{
      const exp=questionExposure(q,lastSeen,date);
      const novelty=exp.never?24:Math.min(8,Number.isFinite(exp.days)?exp.days/7:8);
      const review=exp.kind==='old'?Math.min(12,(wrong[q.id]||0)*3)+Math.min(4,exp.days/7):0;
      return (weights[q.difficulty||1]||1)+novelty+review+((hashString(`${seed}|${q.id}`)%1500)/1000);
    };

    // 100% 新题是严格模式：只允许“从未做过”的题，不足时减少本轮题量，绝不拿旧题补位。
    if(strictNeverMode){
      const strictPool=DAILY_BANK.filter(q=>!globallySeen.has(q.id));
      const target=Math.min(count,strictPool.length);
      const selected=[],topicCounts={},topicCap=count<=10?2:3;
      balancedPick(strictPool,target,seed+11,scoreQ,selected,topicCounts,topicCap);
      if(selected.length<target)balancedPick(strictPool,target-selected.length,seed+71,scoreQ,selected,topicCounts,999);
      if(selected.length<target){
        const fallback=strictPool.filter(q=>!selected.some(x=>x.id===q.id)).sort((a,b)=>scoreQ(b)-scoreQ(a));
        for(const q of fallback){ if(selected.length>=target)break; selected.push(q); }
      }
      const finalSet=shuffle(selected.slice(0,target),seed+313);
      finalSet._meta={requestedNewRatio,actualNewCount:finalSet.length,actualOldCount:0,ratioMode:ratioInfo.mode,plan:ratioInfo.plan,strictNeverMode:true,requestedCount:count,availableNeverSeen:strictPool.length,truncated:finalSet.length<count,newPoolSize:strictPool.length,oldPoolSize:DAILY_BANK.length-strictPool.length};
      localStorage.setItem(dailyKey(count,difficulty,attemptNo,requestedNewRatio),JSON.stringify(finalSet.map(q=>q.id)));
      return finalSet;
    }

    // 0%–90% 模式沿用“过去 4 周未出现 = 新题”的定义；池子充足时严格按目标比例抽取。
    const newPool=[],oldPool=[];
    DAILY_BANK.forEach(q=>{ (questionExposure(q,lastSeen,date).kind==='new'?newPool:oldPool).push(q); });
    const selected=[],topicCounts={},topicCap=count<=10?2:3;
    let desiredNew=Math.round(count*requestedNewRatio/100);
    desiredNew=Math.max(0,Math.min(count,desiredNew));
    const desiredOld=count-desiredNew;
    balancedPick(newPool,desiredNew,seed+11,scoreQ,selected,topicCounts,topicCap);
    balancedPick(oldPool,desiredOld,seed+37,scoreQ,selected,topicCounts,topicCap);
    if(selected.length<count){
      balancedPick(newPool,count-selected.length,seed+71,scoreQ,selected,topicCounts,999);
      balancedPick(oldPool,count-selected.length,seed+97,scoreQ,selected,topicCounts,999);
    }
    if(selected.length<count){
      const fallback=[...DAILY_BANK,...PRACTICE_BANK].filter(q=>!selected.some(x=>x.id===q.id)).sort((a,b)=>scoreQ(b)-scoreQ(a));
      for(const q of fallback){ if(selected.length>=count)break; selected.push(q); }
    }
    const finalSet=shuffle(selected.slice(0,count),seed+313);
    const actualNew=finalSet.filter(q=>questionExposure(q,lastSeen,date).kind==='new').length;
    finalSet._meta={requestedNewRatio,actualNewCount:actualNew,actualOldCount:finalSet.length-actualNew,ratioMode:ratioInfo.mode,plan:ratioInfo.plan,strictNeverMode:false,requestedCount:count,truncated:false,newPoolSize:newPool.length,oldPoolSize:oldPool.length};
    localStorage.setItem(dailyKey(count,difficulty,attemptNo,requestedNewRatio),JSON.stringify(finalSet.map(q=>q.id)));
    return finalSet;
  }

  // ===== V3 章节练习（按 BOK 大域选题）=====
  function domainNameByBok(bok){
    const domains=(KB.blueprint&&KB.blueprint.domains)||{};
    for(const [name,info] of Object.entries(domains)){ if(info.bok===bok)return name; }
    const hi=(KB.handbookIndex&&KB.handbookIndex[bok])||null;
    return hi?hi.name:'未知章节';
  }
  function chapterPool(bok){
    let pool=PRACTICE_BANK.filter(q=>(q.bok||'')===bok);
    if(pool.length)return pool;
    // bok 缺失时按知识点 → BOK 域兜底
    return PRACTICE_BANK.filter(q=>domainInfo(topicDomain(q.topic)).bok===bok);
  }
  function chapterActiveKey(bok){ return STORAGE.chapterActivePrefix+bok+'_'+localDateKey(); }
  function getChapterActiveState(bok){ try{return JSON.parse(localStorage.getItem(chapterActiveKey(bok))||'null')}catch{return null} }
  function buildChapterSet(bok,count){
    const history=getHistory();
    const seen=globallySeenIds(history);
    const wrong=weightedWrongCounts(history);
    const lastSeen=questionLastSeenMap(history);
    const seed=hashString(`chapter|${bok}|${localDateKey()}|${count}|a${getTodayAttempts().length+1}`);
    const full=chapterPool(bok);
    let pool=full.filter(q=>!q.dupOf);
    if(pool.length<count)pool=full; // 章节题池不足时允许跨套重复题兜底
    const scoreQ=(q)=>{
      const exp=questionExposure(q,lastSeen,localDateKey());
      const novelty=exp.never?10:Math.min(4,Number.isFinite(exp.days)?exp.days/14:4);
      const review=exp.kind==='old'?Math.min(8,(wrong[q.id]||0)*2):0;
      return novelty+review+((hashString(`${seed}|${q.id}`)%1200)/1000);
    };
    const selected=[],topicCounts={},topicCap=count<=10?3:4;
    balancedPick(pool.filter(q=>!seen.has(q.id)),count,seed+11,scoreQ,selected,topicCounts,topicCap);
    if(selected.length<count)balancedPick(pool,count-selected.length,seed+37,scoreQ,selected,topicCounts,topicCap);
    if(selected.length<count){ pool.sort((a,b)=>scoreQ(b)-scoreQ(a)).forEach(q=>{ if(selected.length<count&&!selected.some(x=>x.id===q.id))selected.push(q); }); }
    const finalSet=shuffle(selected.slice(0,Math.min(count,selected.length)),seed+313);
    localStorage.setItem(chapterActiveKey(bok),JSON.stringify(finalSet.map(q=>q.id)));
    return finalSet;
  }
  function startChapterQuiz(bok){
    const poolSize=chapterPool(bok).length;
    if(!poolSize){ showToast('该章节暂无可用题目'); return; }
    let saved=getChapterActiveState(bok);
    let qs=[];
    if(saved && Array.isArray(saved.qids) && saved.qids.length){
      qs=saved.qids.map(id=>PRACTICE_BANK.find(q=>q.id===id)).filter(Boolean);
    }
    if(!qs.length || qs.length!==saved.qids.length){
      const count=Math.min(getChapterCount(),poolSize);
      qs=buildChapterSet(bok,count);
    }
    quiz={questions:qs,answers:Array(qs.length).fill(null),index:0,startTime:Date.now(),difficulty:'chapter',attemptNo:getTodayAttempts().length+1,requestedNewRatio:null,ratioMode:'chapter',actualNewCount:null,actualOldCount:null,strictNeverMode:false,truncated:false,requestedCount:qs.length,mode:'chapter',domain:bok};
    persistQuiz();
    showView('quizView'); renderQuestion(); startTimer();
    showToast(`章节练习：${domainNameByBok(bok)} · ${qs.length} 题`);
  }
  function getChapterCount(){
    const v=Number(localStorage.getItem('bb_chapter_count_v3')||10);
    return [5,10,15,20].includes(v)?v:10;
  }
  function renderChapterGrid(){
    const grid=$('chapterGrid'); if(!grid)return;
    grid.innerHTML='';
    const boks=['I','II','III','IV','V','VI','VII','VIII','IX'];
    const weights=(KB.blueprint&&KB.blueprint.domains)||{};
    boks.forEach(bok=>{
      const pool=chapterPool(bok);
      const domainInfoEntry=Object.entries(weights).find(([n,i])=>i.bok===bok);
      const weight=domainInfoEntry?domainInfoEntry[1].weight:0;
      const btn=document.createElement('button'); btn.className='chapter-btn'; btn.type='button';
      btn.innerHTML=`<span class="chapter-bok">BOK ${bok}</span><span class="chapter-name">${escapeHtml(domainNameByBok(bok))}</span><span class="chapter-meta">约${weight}/150题 · 题库 ${pool.length} 题</span>`;
      btn.addEventListener('click',()=>startChapterQuiz(bok));
      grid.appendChild(btn);
    });
  }
  // ===== 章节练习结束 =====

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
  function aiDiagnosisKey(recordOrDate){ const date=typeof recordOrDate==='string'?recordOrDate:recordOrDate.date; const attempt=typeof recordOrDate==='string'?'':`_a${recordOrDate.attemptNo||1}`; return STORAGE.aiDiagnosisPrefix+date+attempt; }
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
    const history=getHistory(); const attempts=getTodayAttempts(); const best=getBestToday(); const estimate=computeEstimate(history);
    $('streakValue').textContent=calcStreak(history);
    $('estimateValue').textContent=estimate?estimate.score:'—';
    $('bankValue').textContent=BANK.length;
    $('daysDoneBadge').textContent=`${uniquePracticeDays(history).length} 天`;
    $('todayTitle').textContent=`${formatDateCN()} · 今日练习`;
    $('nicknameInput').value=getNickname()==='黑带冲刺学员'?'':getNickname();
    refreshCountdown(history,estimate);
    const activeState=getActiveState();
    const active=!!activeState;
    const settingsCount=activeState?(activeState.requestedCount||activeState.total||activeState.qids?.length||getDailyCount()):getDailyCount();
    const actualActiveCount=activeState?(activeState.total||activeState.qids?.length||settingsCount):settingsCount;
    const settingsDifficulty=activeState?(activeState.difficulty||getDifficulty()):getDifficulty();
    const activeAttempt=activeState?(activeState.attemptNo||attempts.length+1):attempts.length+1;
    const ratioInfo=activeState?{ratio:activeState.requestedNewRatio??targetNewRatio(settingsCount,activeAttempt,history).ratio,mode:activeState.ratioMode||'auto',plan:coveragePlan(settingsCount,history)}:targetNewRatio(settingsCount,activeAttempt,history);
    const plan=ratioInfo.plan||coveragePlan(settingsCount,history);

    $('dailyCountSelect').value=String(settingsCount);
    $('difficultySelect').value=settingsDifficulty;
    $('themeSelect').value=getTheme();
    $('dailyCountSelect').disabled=active;
    $('difficultySelect').disabled=active;
    $('themeSelect').disabled=false;

    const ratio=Math.max(0,Math.min(100,ratioInfo.ratio));
    $('smartMixBadge').textContent=ratio===100?'100% 从未做过':`${ratio}% 新题`;
    $('mixTrackNew').style.width=`${ratio}%`;
    $('coverageText').textContent=`题库覆盖 ${plan.seenCount}/${BANK.length}`;
    $('weekAvgText').textContent=plan.avg===null?'近7天日均 — 题':`近7天日均 ${plan.avg.toFixed(1)} 题`;
    let reason='默认按 80% 新题 / 20% 旧题推进';
    if(plan.avg!==null && plan.avg<10)reason='最近练习量偏少，提高新题比例，加快覆盖';
    if(plan.avg!==null && plan.avg>10)reason='最近练习量较高，适度增加旧题复习';
    if(plan.urgencyRaised)reason=`为考前覆盖全题库，已提高新题比例；建议每天至少 ${plan.requiredNewPerDay} 道新题`;
    if(ratioInfo.mode==='manual')reason=ratio===100?'严格新题模式：只抽从未做过的题，不足不补旧题':'第二轮起采用你手动设置的新旧题比例';
    $('smartMixReason').textContent=reason;

    const ratioControl=$('ratioControl');
    ratioControl.hidden=active || attempts.length<1;
    const manual=getManualNewRatio();
    const sliderValue=manual===null?coveragePlan(settingsCount,history).ratio:manual;
    $('newRatioRange').value=String(sliderValue);
    $('ratioValue').textContent=sliderValue===100?'100% 新 / 0% 旧（严格）':`${sliderValue}% 新 / ${100-sliderValue}% 旧`;

    if(active){
      const nr=activeState.requestedNewRatio??ratio;
      $('practiceSettingHint').textContent=nr===100?`第 ${activeAttempt} 轮进行中：严格 100% 新题 · 本轮 ${actualActiveCount} 题，只出从未做过的题。`:`第 ${activeAttempt} 轮进行中：${actualActiveCount}题 · ${difficultyText(settingsDifficulty)} · 目标 ${nr}% 新题。完成本轮后可再次调整。`;
    }else if(attempts.length>=1){
      $('practiceSettingHint').textContent=`准备第 ${activeAttempt} 轮：${settingsCount}题 · ${difficultyText(settingsDifficulty)}。第二轮起可用滚动条决定推进新题还是加强复习。`;
    }else{
      $('practiceSettingHint').textContent=`首轮自动推进：${settingsCount}题 · ${difficultyText(settingsDifficulty)} · 约 ${ratio}% 新题 / ${100-ratio}% 旧题。`;
    }
    $('startBtn').hidden=false;
    $('startBtn').textContent=active?`继续第 ${activeAttempt} 轮 · ${actualActiveCount}题`:`开始第 ${attempts.length+1} 轮 · ${settingsCount}题`;
    if(best){
      $('resumeBtn').hidden=false; $('resumeBtn').textContent=`查看今日最高分 · ${best.score}分`;
      $('todayDesc').textContent=`今天已完成 ${attempts.length} 轮，最高 ${best.score} 分。继续练习时可自行调节新旧题比例；打卡图自动采用当天最高分。`;
    }else{
      $('resumeBtn').hidden=true;
      const minM=Math.max(4,Math.round(settingsCount*.9)), maxM=Math.max(minM+2,Math.round(settingsCount*1.4));
      $('todayDesc').textContent=`首轮优先推进过去 4 周未出现的新题，约 ${minM}–${maxM} 分钟完成。`;
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
    let saved=getActiveState();
    let qs=[], count=getDailyCount(), difficulty=getDifficulty(), attemptNo=getTodayAttempts().length+1;
    let requestedNewRatio=80, ratioMode='auto', actualNewCount=null, actualOldCount=null, strictNeverMode=false, truncated=false, requestedCount=count;
    if(saved && Array.isArray(saved.qids) && saved.qids.length){
      qs=saved.qids.map(id=>BANK.find(q=>q.id===id)).filter(Boolean);
      if(qs.length===saved.qids.length){
        count=saved.total||qs.length; difficulty=saved.difficulty||difficulty; attemptNo=saved.attemptNo||attemptNo;
        requestedNewRatio=saved.requestedNewRatio??targetNewRatio(count,attemptNo).ratio;
        ratioMode=saved.ratioMode||'auto'; actualNewCount=saved.actualNewCount??null; actualOldCount=saved.actualOldCount??null; strictNeverMode=!!saved.strictNeverMode; truncated=!!saved.truncated; requestedCount=saved.requestedCount||count;
      }else saved=null;
    }
    if(!saved){
      attemptNo=getTodayAttempts().length+1;
      count=getDailyCount(); difficulty=getDifficulty();
      qs=buildDailySet(count,difficulty,attemptNo);
      const meta=qs._meta||{};
      requestedNewRatio=meta.requestedNewRatio??targetNewRatio(count,attemptNo).ratio;
      ratioMode=meta.ratioMode||'auto'; actualNewCount=meta.actualNewCount??null; actualOldCount=meta.actualOldCount??null; strictNeverMode=!!meta.strictNeverMode; truncated=!!meta.truncated; requestedCount=meta.requestedCount||count;
    }
    if(!qs.length){
      if(requestedNewRatio===100){ showToast('100% 新题模式：题库中已没有从未做过的题，请降低新题比例继续复习'); return; }
      showToast('题库加载失败，请强制刷新页面后重试'); return;
    }
    if(saved){
      quiz={questions:qs,answers:Array.isArray(saved.answers)?saved.answers:Array(qs.length).fill(null),index:Math.min(saved.index||0,qs.length-1),startTime:saved.startTime||Date.now(),difficulty,attemptNo,requestedNewRatio,ratioMode,actualNewCount,actualOldCount,strictNeverMode,truncated,requestedCount};
      if(quiz.answers.length!==qs.length)quiz.answers=Array(qs.length).fill(null);
    }else{
      quiz={questions:qs,answers:Array(qs.length).fill(null),index:0,startTime:Date.now(),difficulty,attemptNo,requestedNewRatio,ratioMode,actualNewCount,actualOldCount,strictNeverMode,truncated,requestedCount};
      persistQuiz();
    }
    showView('quizView'); renderQuestion(); startTimer();
    if(strictNeverMode && truncated)showToast(`严格 100% 新题：当前只剩 ${qs.length} 道从未做过的题，本轮不补旧题`);
  }
  function persistQuiz(){ if(!quiz)return; const payload={qids:quiz.questions.map(q=>q.id),answers:quiz.answers,index:quiz.index,startTime:quiz.startTime,total:quiz.questions.length,requestedCount:quiz.requestedCount||quiz.questions.length,difficulty:quiz.difficulty||getDifficulty(),attemptNo:quiz.attemptNo||1,requestedNewRatio:quiz.requestedNewRatio??80,ratioMode:quiz.ratioMode||'auto',actualNewCount:quiz.actualNewCount,actualOldCount:quiz.actualOldCount,strictNeverMode:!!quiz.strictNeverMode,truncated:!!quiz.truncated,mode:quiz.mode||'daily',domain:quiz.domain||null}; localStorage.setItem(quiz.mode==='chapter'?chapterActiveKey(quiz.domain):activeKey(),JSON.stringify(payload)); }
  function startTimer(){ clearInterval(timerHandle); const update=()=>{ if(!quiz)return; const sec=Math.floor((Date.now()-quiz.startTime)/1000); $('timerText').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }; update(); timerHandle=setInterval(update,1000); }
  function stopTimer(){clearInterval(timerHandle);timerHandle=null;}

  function renderQuestionFigure(q){
    const box=$('figureBox'); if(!box)return;
    const img=$('figureImg');
    const src=figureSrc(q);
    if(src){ box.hidden=false; img.src=src; img.onerror=()=>{box.hidden=true;}; }
    else box.hidden=true;
  }
  function figureSrc(q){ return q.figureImg || (q.figure?`figures/${q.id}.png`:null); }
  function reviewFigureHtml(q){
    const src=figureSrc(q);
    return src?`<figure class="question-figure"><img src="${src}" alt="题目图表" loading="lazy"/><figcaption class="figure-cap">图表</figcaption></figure>`:'';
  }
  function reviewEnHtml(q){
    if(!q.question_en)return '';
    const opts=q.options_en&&q.options_en.length?q.options_en.map((o,i)=>`<div class="en-opt"><span class="en-letter">${letters[i]}</span>${escapeHtml(o)}</div>`).join(''):'';
    return `<details class="en-contrast"><summary>English 英文原文（可选参考）</summary><p class="en-q">${escapeHtml(q.question_en)}</p>${opts}</details>`;
  }
  function renderQuestionEn(q){
    const box=$('enBox'); if(!box)return;
    const body=$('enBody');
    if(!q.question_en){ box.hidden=true; body.innerHTML=''; return; }
    box.hidden=false;
    const opts=q.options_en && q.options_en.length?q.options_en.map((o,i)=>`<div class="en-opt"><span class="en-letter">${letters[i]}</span>${escapeHtml(o)}</div>`).join(''):'';
    body.innerHTML=`<p class="en-q">${escapeHtml(q.question_en)}</p>${opts}`;
  }
  function renderQuestion(){
    if(!quiz || !quiz.questions || !quiz.questions.length){ showToast('当前没有可用题目，请刷新页面'); return; }
    const q=quiz.questions[quiz.index];
    const total=quiz.questions.length;
    $('progressText').textContent=`${quiz.index+1} / ${total}`;
    $('progressBar').style.width=`${((quiz.index+1)/total)*100}%`;
    $('questionTopic').textContent=quiz.mode==='chapter'?`${q.topic} · ${domainNameByBok(q.bok||'')}`:q.topic;
    $('questionSource').textContent=`模拟题${q.set} · 第${q.qno}题${q.figure?' · 图表题':''}`;
    $('questionText').textContent=q.question;
    renderQuestionFigure(q);
    renderQuestionEn(q);
    const box=$('optionsBox'); box.innerHTML='';
    q.options.forEach((opt,i)=>{
      const b=document.createElement('button'); b.className='option-btn'+(quiz.answers[quiz.index]===i?' selected':'');
      b.innerHTML=`<span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
      b.addEventListener('click',()=>{quiz.answers[quiz.index]=i;persistQuiz();renderQuestion();}); box.appendChild(b);
    });
    $('prevBtn').disabled=quiz.index===0; $('prevBtn').style.opacity=quiz.index===0?'.45':'1';
    const last=quiz.index===total-1; $('nextBtn').hidden=last; $('submitBtn').hidden=!last;
  }
  function go(delta){ quiz.index=Math.max(0,Math.min(quiz.questions.length-1,quiz.index+delta)); persistQuiz(); renderQuestion(); }

  function submitQuiz(){
    const unanswered=quiz.answers.reduce((a,x,i)=>{if(x===null||x===undefined)a.push(i+1);return a;},[]);
    if(unanswered.length){ showToast(`还有 ${unanswered.length} 题未作答`); quiz.index=unanswered[0]-1; renderQuestion(); return; }
    stopTimer();
    const items=quiz.questions.map((q,i)=>({id:q.id,answer:quiz.answers[i],correct:quiz.answers[i]===q.answer}));
    const correct=items.filter(x=>x.correct).length; const total=items.length; const score=Math.round(correct/Math.max(1,total)*100); const elapsed=Math.max(1,Math.round((Date.now()-quiz.startTime)/1000));
    const record={date:localDateKey(),attemptNo:quiz.attemptNo||getTodayAttempts().length+1,completedAt:Date.now(),score,correct,total,elapsed,difficulty:quiz.difficulty||getDifficulty(),requestedNewRatio:quiz.requestedNewRatio??80,ratioMode:quiz.ratioMode||'auto',actualNewCount:quiz.actualNewCount,actualOldCount:quiz.actualOldCount,mode:quiz.mode||'daily',domain:quiz.domain||null,theme:getTheme(),qids:quiz.questions.map(q=>q.id),items};
    const history=getHistory(); history.push(record); history.sort((a,b)=>a.date.localeCompare(b.date)||((a.attemptNo||1)-(b.attemptNo||1))||((a.completedAt||0)-(b.completedAt||0))); saveHistory(history);
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
    if(record.correct===record.total)return '今日全对。下一步不要只重复熟题，继续轮换 Measure、Analyze、Improve 等高权重模块，避免“熟题高分假象”。'+riskText;
    const prefix=record.score>=80?'基础已经比较稳，':'目前还有明显得分空间，';
    const detail=focus.length?`先把 ${focus.join('、')} 的错题重新做一遍，重点确认“为什么其他选项不对”。`:'先回看今日错题。';
    return prefix+detail+riskText+` 系统会按最近 7 天练习量和考试倒计时动态安排新旧题，优先确保考前把题库完整过一遍。`;
  }

  function renderKnowledgeReview(record){
    const box=$('knowledgeReviewList'); if(!box)return; box.innerHTML='';
    let topics=(record.items||[]).filter(x=>!x.correct).map(it=>{const q=BANK.find(x=>x.id===it.id);return q&&q.topic;}).filter(Boolean);
    topics=[...new Set(topics)];
    if(!topics.length)topics=['统计推断','DOE实验设计','SPC控制图'];
    topics=topics.sort((a,b)=>topicExamWeight(b)-topicExamWeight(a)).slice(0,4);
    $('kbCoverageBadge').textContent=record.correct===record.total?'高权重轮换':`${topics.length} 个重点`;
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
    $('correctCount').textContent=`${record.correct}/${record.total||10}`;
    if($('reviewCountBadge'))$('reviewCountBadge').textContent=`${record.total||10}题`;
    $('resultEstimate').textContent=estimate?estimate.score:'—';
    $('elapsedValue').textContent=formatElapsed(record.elapsed||0);
    $('resultHeadline').textContent=record.score>=90?'状态很好，保持手感':record.score>=70?'今天这轮过关':'今天的错题很值钱';
    const bestToday=getBestToday(); const attemptsToday=getTodayAttempts();
    const mixText=Number.isFinite(record.actualNewCount)?` 本轮新题 ${record.actualNewCount} 道、旧题 ${record.actualOldCount||0} 道。`:'';
    $('resultSummary').textContent=(estimate?`按 CSSBB BOK 模块权重校正后的滚动实考预估 ${estimate.score} 分，当前区间约 ${estimate.low}–${estimate.high}。`:'完成更多练习后会生成滚动预估。')+` 今日第 ${record.attemptNo||1} 轮；已完成 ${attemptsToday.length} 轮，最高 ${bestToday?bestToday.score:record.score} 分。`+mixText;
    renderChips($('resultFocusTags'),focus);
    $('reviewAdvice').textContent=adviceFor(record,focus);
    renderKnowledgeReview(record);

    const storedDiagnosis=localStorage.getItem(aiDiagnosisKey(record));
    if(storedDiagnosis){ $('aiDiagnosisBox').textContent=storedDiagnosis; $('aiDiagnosisBox').hidden=false; }
    else{ $('aiDiagnosisBox').hidden=true; $('aiDiagnosisBox').textContent=''; }

    const list=$('reviewList'); list.innerHTML='';
    (record.items||[]).forEach((it,idx)=>{
      const q=BANK.find(x=>x.id===it.id); if(!q)return;
      const div=document.createElement('div'); div.className=`review-item ${it.correct?'correct':'wrong'}`;
      div.innerHTML=`<div class="review-head"><span class="review-number">${idx+1}. ${escapeHtml(q.topic)} · 模拟题${q.set}-${q.qno}</span><span class="review-status">${it.correct?'✓ 正确':'✕ 错误'}</span></div>
      <div class="review-q">${escapeHtml(q.question)}</div>
      ${reviewFigureHtml(q)}
      <div class="answer-line">你的答案：${letters[it.answer]}　正确答案：<strong>${letters[q.answer]}</strong> ${escapeHtml(q.options[q.answer])}</div>
      <div class="explanation">${escapeHtml(q.explanation)}</div>${!it.correct?kbInlineHtml(q.topic):''}
      ${reviewEnHtml(q)}`;
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

  function handbookRefFor(q){
    const k=kbTopic(q.topic);
    if(k && k.ref && /Handbook/i.test(k.ref))return k.ref;
    const hi=(KB.handbookIndex&&KB.handbookIndex[q.bok])||null;
    if(hi)return `BOK ${q.bok} ${hi.name}；${KB.handbook&&KB.handbook.title||'Handbook 3e'}：${hi.chapters}`;
    return '';
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
        `  题库标准解析：${q.explanation}`,
        `  Handbook 参考：${handbookRefFor(q)||'（无对应章节映射）'}`
      ].join('\n');
    }).filter(Boolean).join('\n');
    const todayTopics=(record.items||[]).map(it=>{const q=BANK.find(x=>x.id===it.id);return q?`${q.topic}:${it.correct?'对':'错'}`:'';}).filter(Boolean).join('；');
    const kbContext=kbContextForTopics([...wrongTopics,...focus],5);
    return `今日日期：${record.date}
今日得分：${record.score}/100（${record.correct}/${record.total||10}）
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
3. 解释时可以参考每道错题附带的“Handbook 参考”章节（源自《The Certified Six Sigma Black Belt Handbook》第三版），帮助学员定位复习材料；只能引用这些明确给出的章节标题，不得编造未提供的章节或页码。教材引用只用于解释和定位，不改变题库标准答案。
4. CSSBB BOK 的模块题量（总计150题）可以用于判断复习优先级，但不要声称知道认证机构未提供的官方及格线或原始分到认证分的换算。应用的“实考预估”只是练习趋势。
5. 如果知识库与题库标准答案出现表述差异，以本题标准答案为判题依据，并用一句话提示“本题按题库口径”。
6. 输出中文，简洁、具体、可执行，不要写空泛鼓励。
7. 结构固定为：①今日判断；②最值得补的2-3个点（结合BOK权重）；③错题背后的思维漏洞；④今晚20-30分钟复习安排（可引用对应 Handbook 章节编号）；⑤明日做题提醒。
8. 如果今天全对，也要指出如何避免“熟题高分假象”，建议跨主题巩固。`;
    try{
      const text=await callAi(system,buildDiagnosisPrompt(currentResultRecord),1200);
      box.classList.remove('loading'); box.textContent=text;
      localStorage.setItem(aiDiagnosisKey(currentResultRecord),text);
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
    const system=`你是六西格玛黑带考试错题教练。必须把“题库标准答案”视为本题判题依据，不要改答案。优先依据随题提供的本地黑带知识库摘要解释；知识库按 CSSBB BOK 和黑带手册整理。你同时会收到本题对应的《The Certified Six Sigma Black Belt Handbook》（第三版）参考章节：只能引用这些明确给出的章节标题与编号来帮助学员定位复习材料，不得编造未提供的章节或页码；Handbook 引用只用于解释与定位，不改变题库标准答案。你的任务是帮助学员理解为什么自己的选项有诱惑力、关键概念是什么，以及下次如何快速判断。不要扩展到无关知识，不要虚构官方考试规则。输出中文，控制在300-500字。`;
    const user=`主题：${q.topic}\n来源：模拟题${q.set} 第${q.qno}题\n题目：${q.question}\n选项：\n${q.options.map((x,i)=>`${letters[i]}. ${x}`).join('\n')}\n学员答案：${letters[it.answer]} ${q.options[it.answer]}\n题库标准答案：${letters[q.answer]} ${q.options[q.answer]}\n题库标准解析：${q.explanation}\n\nHandbook 参考章节（仅限这些，不得虚构其他章节/页码）：${handbookRefFor(q)||'（本题无对应章节映射，请不要引用教材章节）'}\n\n本地黑带知识库摘要：\n${kbContextForTopics([q.topic],1)}\n\n请按以下格式解释：\n1. 我为什么容易选错；\n2. 正确判断的关键；\n3. 其他选项为什么不优；\n4. 一句话记忆钩子（可提示对应 Handbook 章节编号）；\n5. 给我1道不重复原题的口头自测题（最后单独给答案）。`;
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
    const history=getHistory(); const estimate=computeEstimate(history); const focus=resultFocus(record); const streak=calcStreak(history); const nick=getNickname(); const cd=examCountdown(); const activeTheme=getTheme(); const theme=THEMES[activeTheme]||THEMES.default;
    const c=document.createElement('canvas'); c.width=1080;c.height=1440; const ctx=c.getContext('2d');
    const g=ctx.createLinearGradient(0,0,1080,1440); g.addColorStop(0,theme.bg1);g.addColorStop(.62,theme.bg2);g.addColorStop(1,theme.bg3);ctx.fillStyle=g;ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,255,255,.08)'; for(let i=0;i<7;i++){ctx.beginPath();ctx.arc(920-i*145,180+i*180,110+i*16,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#fff';ctx.font='800 42px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('黑带备考冲刺 · 每日一练',76,105);
    ctx.fillStyle='#cbd5e1';ctx.font='500 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`${formatDateCN(record.date)}  ·  ${nick}`,76,153);
    if(cd){ ctx.fillStyle=theme.soft;ctx.font='700 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'; const cdText=cd.days>0?`距考试 ${cd.days} 天 · ${cd.phase.label} · ${formatDateCN(cd.key)}`:cd.days===0?`今天考试 · ${formatDateCN(cd.key)}`:`考试日期已过 ${Math.abs(cd.days)} 天`;ctx.fillText(cdText,76,192); }
    if(isAiReady()){
      ctx.font='800 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'; const label='AI 加持 · 已开启'; const w=ctx.measureText(label).width+40;
      ctx.fillStyle='rgba(124,58,237,.88)';roundRect(ctx,1004-w,82,w,42,21);ctx.fill();ctx.fillStyle='#fff';ctx.fillText(label,1024-w,110);
    }
    ctx.fillStyle='rgba(255,255,255,.10)';roundRect(ctx,76,220,928,410,42);ctx.fill();
    ctx.fillStyle=theme.soft;ctx.font='700 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('今日得分',130,300);
    ctx.fillStyle='#fff';ctx.font='900 150px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.fillText(String(record.score),122,465);
    ctx.font='700 34px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('分',360,463);
    ctx.fillStyle='#cbd5e1';ctx.font='600 27px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`答对 ${record.correct}/${record.total||10} · 今日最高分`,130,548);
    ctx.fillStyle='rgba(251,191,36,.18)';roundRect(ctx,130,570,330,54,27);ctx.fill();
    ctx.fillStyle='#fde68a';ctx.font='800 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`已连续打卡 ${streak} 天`,151,605);
    ctx.fillStyle='#fff';ctx.font='800 31px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('滚动实考预估',590,315);
    ctx.font='900 84px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.fillText(estimate?String(estimate.score):'—',590,420);
    ctx.font='600 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillStyle='#bfdbfe';ctx.fillText(estimate?`预计区间 ${estimate.low}–${estimate.high}`:'继续积累样本',590,468);
    ctx.fillStyle='#94a3b8';ctx.font='500 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('基于近期练习的趋势估计，非官方考试换算分',590,516);

    ctx.fillStyle='rgba(255,255,255,.97)';roundRect(ctx,76,690,928,440,38);ctx.fill();
    ctx.fillStyle='#0f172a';ctx.font='800 34px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('今天优先复习',126,770);
    const tags=focus.length?focus:['综合巩固']; let y=830;
    tags.forEach((t,i)=>{ctx.font='700 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillStyle=theme.soft;roundRect(ctx,126,y,Math.min(780,ctx.measureText(`${i+1}. ${t}`).width+70),62,31);ctx.fill();ctx.fillStyle=theme.accent;ctx.fillText(`${i+1}. ${t}`,153,y+40);y+=82;});
    ctx.fillStyle='#475569';ctx.font='500 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    wrapText(ctx,record.score===100?'今天全对。继续保持题感，同时把统计、DOE、SPC 等高区分度模块轮换复习。':'错题不是损失，是冲刺阶段最便宜的得分点。把原因弄清楚，明天再遇到就不丢分。',126,1070,810,38,3);
    ctx.fillStyle='#cbd5e1';ctx.font='600 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`四套模拟题600题 · 今日${record.total||10}题 · ${difficultyLabel(record.difficulty||'medium')}难度 · ${record.actualNewCount??'—'}新/${record.actualOldCount??'—'}旧`,76,1312);
    ctx.fillStyle=theme.soft;ctx.font='800 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText(`BLACK BELT SPRINT · V3.0 · ${themeLabel(activeTheme)}`,76,1352);
    ctx.fillStyle='rgba(255,255,255,.45)';ctx.font='500 19px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';ctx.fillText('关注小红书“AI带路党”，解锁更多skill',76,1396);
    return new Promise(resolve=>c.toBlob(b=>resolve({blob:b,url:URL.createObjectURL(b)}),'image/png',.95));
  }

  async function openCheckin(){
    const record=getBestToday(); if(!record){showToast('先完成至少一轮练习');return;}
    $('checkinBtn').disabled=true;$('checkinBtn').textContent='正在生成…';
    try{
      if(lastCheckinUrl)URL.revokeObjectURL(lastCheckinUrl);
      const out=await makeCheckin(record); lastCheckinBlob=out.blob; lastCheckinUrl=out.url; $('checkinPreview').src=out.url; $('shareModal').hidden=false;
      if(getTodayAttempts().length>1)showToast(`打卡图已采用今日最高分 ${record.score} 分`);
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
    $('resumeBtn').addEventListener('click',()=>{const r=getBestToday();if(r)renderResult(r)});
    $('prevBtn').addEventListener('click',()=>go(-1)); $('nextBtn').addEventListener('click',()=>go(1)); $('submitBtn').addEventListener('click',submitQuiz);
    $('quitQuizBtn').addEventListener('click',()=>{persistQuiz();stopTimer();showView('homeView');refreshHome();});
    $('backHomeBtn').addEventListener('click',()=>{showView('homeView');refreshHome();});
    if($('newAttemptBtn'))$('newAttemptBtn').addEventListener('click',()=>{showView('homeView');refreshHome();showToast('第二轮起可先调节新旧题比例，再开始练习');});
    $('dailyCountSelect').addEventListener('change',e=>{
      const n=Number(e.target.value); if([5,10,15,20].includes(n))localStorage.setItem(STORAGE.dailyCount,String(n));
      refreshHome(); showToast(`每日题量已设为 ${getDailyCount()} 题`);
    });
    $('difficultySelect').addEventListener('change',e=>{
      const v=e.target.value; if(['low','medium','high'].includes(v))localStorage.setItem(STORAGE.difficulty,v);
      refreshHome(); showToast(`练习难度已设为 ${difficultyLabel(getDifficulty())}`);
    });
    $('themeSelect').addEventListener('change',e=>{
      const v=e.target.value; if(THEMES[v])localStorage.setItem(STORAGE.theme,v);
      applyTheme(); refreshHome(); showToast(`界面主题：${themeLabel()}`);
    });
    $('newRatioRange').addEventListener('input',e=>{
      const n=Math.max(0,Math.min(100,Number(e.target.value)||0));
      saveManualNewRatio(n);
      $('ratioValue').textContent=n===100?'100% 新 / 0% 旧（严格）':`${n}% 新 / ${100-n}% 旧`;
      $('smartMixBadge').textContent=n===100?'100% 从未做过':`${n}% 新题`;
      $('mixTrackNew').style.width=`${n}%`;
      $('smartMixReason').textContent=n===100?'严格新题模式：只抽从未做过的题，不足不补旧题':'第二轮起采用你手动设置的新旧题比例';
    });
    $('saveNicknameBtn').addEventListener('click',()=>{const v=$('nicknameInput').value.trim();localStorage.setItem(STORAGE.nickname,v||'黑带冲刺学员');showToast('昵称已保存');});
    const chapterCountSel=$('chapterCountSelect');
    if(chapterCountSel){
      chapterCountSel.value=String(getChapterCount());
      chapterCountSel.addEventListener('change',e=>{const n=Number(e.target.value);if([5,10,15,20].includes(n)){localStorage.setItem('bb_chapter_count_v3',String(n));showToast(`章节练习题量已设为 ${n} 题`);}});
    }
    $('checkinBtn').addEventListener('click',openCheckin); $('shareImageBtn').addEventListener('click',shareImage); $('downloadImageBtn').addEventListener('click',downloadImage);
    document.querySelectorAll('[data-close-share]').forEach(el=>el.addEventListener('click',closeShareModal));

    $('examDateBtn').addEventListener('click',openExamDateModal);
    $('saveExamDateBtn').addEventListener('click',saveExamDate);
    $('clearExamDateBtn').addEventListener('click',clearExamDate);
    document.querySelectorAll('[data-close-exam-date]').forEach(el=>el.addEventListener('click',closeExamDateModal));

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
    applyTheme(); $('bankValue').textContent=BANK.length; bind();setupInstall();refreshHome();renderChapterGrid();
    if(!BANK.length){ showToast('题库未加载，请检查 questions.js 是否已部署并强制刷新'); $('startBtn').disabled=true; }
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
