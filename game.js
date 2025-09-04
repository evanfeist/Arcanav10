// game.js — Arcana core rules + UI wiring (Stage 1–3) with Joker Cost drawer
(function(){
  const el = (id)=>document.getElementById(id);
  const logEl = el('log');

  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const RVAL  = (r)=>({A:1,J:11,Q:12,K:13}[r]||parseInt(r,10));
  const rnd = (n)=>Math.floor(Math.random()*n);

  const G = {
    deck: [], discard: [],
    players: [{ hand:[], score:0 },{ hand:[], score:0 }],
    turn: 0, started: false, extraChain: 0,
    localSide: 'P1',
    selected: new Set(),
    pendingConstruct: null // { baseAction, requiredN, excludedIds }
  };

  // API for net layer
  window.arcana = { startNew, serialize, hydrate, applyTurn, render, hasAce, spendAce,
    describe:(a)=>`${a.type}${a.payload? ' '+JSON.stringify(a.payload):''}` };

  function startNew(){
    G.deck = buildDeck(); G.discard = [];
    G.players = [{hand:[],score:0},{hand:[],score:0}];
    G.turn = 0; G.started = true; G.extraChain = 0; G.selected.clear();
    drawCards(0,7); drawCards(1,7);
    log('New game. P1 starts.'); render();
  }
  function serialize(){ return { deck:G.deck, discard:G.discard, players:G.players, turn:G.turn, started:G.started, extraChain:G.extraChain }; }
  function hydrate(state){ G.deck=state.deck; G.discard=state.discard; G.players=state.players; G.turn=state.turn; G.started=state.started; G.extraChain=state.extraChain||0; G.selected.clear(); }
  window.arcana_setRole = (role)=>{ G.localSide = role==='host' ? 'P1' : 'P2'; };

  // Deck
  function buildDeck(){
    const cards=[]; let id=1;
    for(let d=0; d<2; d++){
      for(const s of SUITS){ for(const r of RANKS){ cards.push({ id:id++, suit:s, rank:r }); } }
      cards.push({id:id++, suit:'★', rank:'Joker', joker:true});
      cards.push({id:id++, suit:'☆', rank:'Joker', joker:true});
    }
    for(let i=cards.length-1;i>0;i--){ const j=rnd(i+1); [cards[i],cards[j]]=[cards[j],cards[i]]; }
    return cards;
  }

  // Render
  function render(){
    el('drawTag').textContent = G.deck.length;
    el('discardTag').textContent = G.discard.length;
    el('score1').textContent = G.players[0].score;
    el('score2').textContent = G.players[1].score;
    el('turnTag').textContent = G.started ? (G.turn===0?'P1':'P2') : '—';

    const meIdx = (G.localSide==='P1')?0:1;
    const oppIdx = 1-meIdx;

    const meHand = el('playerHand'); meHand.innerHTML='';
    G.players[meIdx].hand.forEach(c=>{ meHand.appendChild(cardNode(c,true)); });
    el('youCount').textContent = G.players[meIdx].hand.length;

    const opHand = el('opponentHand'); opHand.innerHTML='';
    G.players[oppIdx].hand.forEach(()=>{ opHand.appendChild(backNode()); });
    el('oppCount').textContent = G.players[oppIdx].hand.length;
  }
  function cardNode(c, selectable){
    const d = document.createElement('div'); d.className='cardui'; d.dataset.id=String(c.id);
    const rr=document.createElement('div'); rr.className='rank'; rr.textContent=c.rank; d.appendChild(rr);
    const ss=document.createElement('div'); ss.className='suit'; ss.textContent=c.suit; d.appendChild(ss);
    if(selectable){ if(G.selected.has(c.id)) d.classList.add('selected'); d.addEventListener('click', ()=>toggleSelect(c.id,d)); }
    const t=inferType(c); if(t!=='Normal'){ const tag=document.createElement('div'); tag.className='type'; tag.textContent=t; d.appendChild(tag); }
    return d;
  }
  function backNode(){ const d=document.createElement('div'); d.className='cardui back'; d.style.border='1px solid #2a3a4e'; return d; }
  function toggleSelect(id,node){ if(G.turn!==((G.localSide==='P1')?0:1)) return; if(G.selected.has(id)){G.selected.delete(id);node.classList.remove('selected');} else {G.selected.add(id);node.classList.add('selected');} }
  function log(s){ const p=document.createElement('div'); p.textContent=s; logEl.appendChild(p); logEl.scrollTop=logEl.scrollHeight; if(window.pushLog) window.pushLog(s); }

  // Helpers
  const isJoker = (c)=>!!c.joker || c.rank==='Joker';
  function inferType(c){ if(isJoker(c))return'Joker'; if(c.rank==='A')return'Ace'; if(c.rank==='6'||c.rank==='7'||c.rank==='9')return'Action'; if(c.rank==='J'||c.rank==='Q'||c.rank==='K')return'Sigil'; return'Normal'; }
  const me = ()=> (G.localSide==='P1')?0:1; const them = ()=> 1-me();

  // Draw/Discard
  function drawCards(pidx,n){ const take=Math.min(n,G.deck.length); for(let i=0;i<take;i++){ const c=G.deck.pop(); G.players[pidx].hand.push(c); } }
  function discardCard(pidx,id){ const h=G.players[pidx].hand; const i=h.findIndex(c=>c.id===id); if(i>=0){ const c=h.splice(i,1)[0]; G.discard.push(c); return c; } return null; }
  function removeFromHandByIds(pidx,ids){ const h=G.players[pidx].hand, list=[]; ids.forEach(id=>{ const j=h.findIndex(c=>c.id===id); if(j>=0) list.push(h.splice(j,1)[0]); }); return list; }

  // Turn flow
  function startTurnIfNeeded(){ const p=G.turn; if(G.players[p].hand.length<=1){ drawCards(p,3); log((p===0?'P1':'P2')+' drew 3 (safety).'); } }
  function endTurn(extra=false){
    drawCards(G.turn,1);
    if(extra){ G.extraChain=Math.min(2,G.extraChain+1); log((G.turn===0?'P1':'P2')+' takes an extra turn.'); }
    else { G.extraChain=0; G.turn=1-G.turn; }
    G.selected.clear(); startTurnIfNeeded();
  }
  function currentSelected(pidx){ const ids=[...G.selected]; return G.players[pidx].hand.filter(c=>ids.includes(c.id)); }

  // Validation
  function validateConstruct(cards){
    const res={valid:false,kind:'',points:0,suit:null,suitBonus:null,jokersUsed:0,bonus:null,reason:''};
    const jokers=cards.filter(isJoker), nonj=cards.filter(c=>!isJoker(c));
    if(nonj.length===0){
      if(jokers.length===2){ res.valid=true; res.kind='JOKER_ONLY'; res.points=4; return res; }
      if(jokers.length===3){ res.valid=true; res.kind='JOKER_ONLY'; res.points=7; res.bonus={draw:3}; return res; }
      if(jokers.length===4){ res.valid=true; res.kind='JOKER_ONLY'; res.points=15; res.bonus={refill:true}; return res; }
      res.reason='Need 2–4 Jokers'; return res;
    }
    const sameSuit=nonj.every(c=>c.suit===nonj[0].suit); const suit=sameSuit?nonj[0].suit:null;
    res.suit=suit; res.jokersUsed=jokers.length;

    // Pair / True Pair (no jokers)
    if(cards.length===2 && jokers.length===0 && nonj[0].rank===nonj[1].rank){
      const base=(nonj[0].suit===nonj[1].suit)?5:2; res.valid=true; res.kind=(base===5?'TRUE_PAIR':'PAIR'); res.points=base;
      if(base===5) applySuitBonusPreview(res,false); return res;
    }

    // Sets (no jokers)  — incl. special 4-suits (4×rank), 5+ => 3×rank+2
    if(jokers.length===0 && nonj.every(c=>c.rank===nonj[0].rank) && cards.length>=3){
      const r=RVAL(nonj[0].rank), n=cards.length; let pts;
      if(n===3) pts=2*r+2;
      else if(n===4){ const sset=new Set(nonj.map(c=>c.suit)); pts=(sset.size===4)?4*r:3*r; }
      else if(n>=5) pts=3*r+2;
      res.valid=true; res.kind='SET'; res.points=pts; if(suit) applySuitBonusPreview(res,false); return res;
    }

    // Sets with jokers — 4 => 3×rank; 5+ => 3×rank+2; 6+ allow suit bonus; nerf -1 each joker
    if(nonj.length>=2 && nonj.every(c=>c.rank===nonj[0].rank) && cards.length>=3 && jokers.length>0){
      const r=RVAL(nonj[0].rank), n=cards.length; let pts=(n===4?3*r:3*r+2);
      res.valid=true; res.kind='SET'; res.points=pts;
      if(suit && n>=6) applySuitBonusPreview(res,true);
      res.points -= jokers.length; return res;
    }

    // Runs (same suit, jokers fill gaps); score sum(vals)+len; no suit bonus if jokers
    if(sameSuit && cards.length>=3){
      const vals=nonj.map(c=>RVAL(c.rank)).sort((a,b)=>a-b); let gaps=0;
      for(let i=1;i<vals.length;i++){ const diff=vals[i]-vals[i-1]; if(diff<=0){res.reason='Dupes in run';return res;} gaps+=diff-1; }
      if(gaps<=jokers.length){
        res.valid=true; res.kind='RUN';
        const sumVals=nonj.reduce((s,c)=>s+RVAL(c.rank),0), len=cards.length;
        res.points=sumVals+len; if(jokers.length===0) applySuitBonusPreview(res,false); else res.points-=jokers.length; return res;
      }
    }
    res.reason='Not a valid Pair/Set/Run'; return res;
  }
  function applySuitBonusPreview(res, allowWithJokers){
    if(!res.suit) return; if(res.jokersUsed>0 && !allowWithJokers) return;
    if(res.suit==='♥'){ res.points+=2; res.suitBonus='HEARTS'; }
    if(res.suit==='♣'){ res.suitBonus='CLUBS'; }
    if(res.suit==='♦'){ res.suitBonus='DIAMONDS'; }
    if(res.suit==='♠'){ res.suitBonus='SPADES'; }
  }

  // Attempt construct
  function attemptConstructFromSelection(){
    const pidx=me(); if(G.turn!==pidx){ log('Not your turn'); return null; }
    const cards=currentSelected(pidx); if(cards.length<2){ log('Select 2+ cards for a construct'); return null; }
    const res=validateConstruct(cards); if(!res.valid){ log(res.reason||'Invalid'); return null; }
    if(res.kind!=='JOKER_ONLY' && res.jokersUsed>0){
      openJokerDrawer(res.jokersUsed, cards.map(c=>c.id), { type:'CONSTRUCT', from:(pidx===0?'P1':'P2'), payload:{ ids: cards.map(c=>c.id), info: res } });
      return null;
    }
    return { type:'CONSTRUCT', from:(pidx===0?'P1':'P2'), payload:{ ids: cards.map(c=>c.id), info: res } };
  }

  // Apply turn (host authority)
  function applyTurn(action){
    const actor=(action.from==='P1')?0:1, target=1-actor;
    switch(action.type){
      case 'START': startNew(); return;
      case 'CONSTRUCT': {
        const ids=action.payload.ids, cards=removeFromHandByIds(actor,ids), check=validateConstruct(cards);
        if(!check.valid){ G.players[actor].hand.push(...cards); log('Invalid construct (host)'); return; }
        if(check.kind!=='JOKER_ONLY' && check.jokersUsed>0){
          const extras=(action.payload.info&&action.payload.info.extraDiscards)||[];
          const extraCards=removeFromHandByIds(actor,extras);
          if(extraCards.length!==check.jokersUsed){ G.players[actor].hand.push(...cards,...extraCards); log('Joker cost mismatch'); return; }
          G.discard.push(...extraCards);
        }
        G.players[actor].score+=check.points; G.discard.push(...cards);
        log((actor===0?'P1':'P2')+` played ${check.kind} +${check.points}.`);
        if(check.kind==='JOKER_ONLY'){
          if(check.bonus?.draw){ drawCards(actor,check.bonus.draw); log(`Drew ${check.bonus.draw}.`); }
          if(check.bonus?.refill){ const need=Math.max(0,7-G.players[actor].hand.length); if(need>0){ drawCards(actor,need); log('Refilled to 7.'); } }
        }
        let extraTurn=false;
        if(check.suitBonus==='DIAMONDS'){
          const roll=1+Math.floor(Math.random()*6); const steal=(roll<=2)?1:(roll<=4)?2:3;
          const give=Math.min(steal,G.players[target].score); G.players[target].score-=give; G.players[actor].score+=give;
          log(`♦ d6=${roll} → stole ${give}.`);
        }
        if(check.suitBonus==='SPADES'){
          const opp=G.players[target].hand; for(let i=0;i<2&&opp.length>0;i++){ const j=rnd(opp.length); const c=opp.splice(j,1)[0]; G.players[actor].hand.push(c); }
          log('♠ stole up to 2 cards.');
        }
        if(check.suitBonus==='CLUBS') extraTurn=true;
        if(G.players[actor].score>=60){ log((actor===0?'P1':'P2')+' wins (60)!'); G.started=false; return; }
        endTurn(extraTurn && G.extraChain<1); return;
      }
      case 'ACTION_6': { discardCard(actor,action.payload.cardId); drawCards(actor,2); log((actor===0?'P1':'P2')+' played 6 (Draw2).'); endTurn(); return; }
      case 'ACTION_7': {
        if(action.payload?.blocked){ log('7 blocked by Ace.'); endTurn(); return; }
        discardCard(actor,action.payload.cardId);
        const opp=G.players[target].hand; if(opp.length>0){ const j=rnd(opp.length); const c=opp.splice(j,1)[0]; G.players[actor].hand.push(c); log('7: stole 1 random.'); }
        else log('7: opponent empty.');
        endTurn(); return;
      }
      case 'ACTION_9': {
        if(action.payload?.blocked){ log('9 blocked by Ace.'); endTurn(); return; }
        discardCard(actor,action.payload.cardId);
        const g=discardCard(actor,action.payload.giveId); if(g) G.players[target].hand.push(g);
        const opp=G.players[target].hand; if(opp.length>0){ const j=rnd(opp.length); const c=opp.splice(j,1)[0]; G.players[actor].hand.push(c); log('9: swapped 1.'); }
        else log('9: opponent empty.');
        endTurn(); return;
      }
      case 'ACE_REACT': {
        if(action.payload?.used){ spendAce(target); const giv=Math.min(1,G.players[actor].score); G.players[actor].score-=giv; G.players[target].score+=giv; log('Ace block: +1 counter.'); }
        else log('Ace not used.');
        return;
      }
      case 'SIGIL': {
        const r=action.payload.rank, id=action.payload.cardId; discardCard(actor,id);
        if(r==='J'){ G.players[actor].score+=2; drawCards(actor,1); log('J: +2, draw 1.'); }
        if(r==='Q'){ G.players[actor].score+=3; drawCards(actor,1); log('Q: +3, draw 1.'); }
        if(r==='K'){ G.players[actor].score+=5; drawCards(actor,2); log('K: +5, draw 2.'); }
        if(G.players[actor].score>=60){ log((actor===0?'P1':'P2')+' wins (60)!'); G.started=false; return; }
        endTurn(); return;
      }
      case 'DISCARD': { const c=discardCard(actor,action.payload.cardId); log((actor===0?'P1':'P2')+` discarded ${c?(c.rank+c.suit):'—'}.`); endTurn(); return; }
    }
  }
  function hasAce(pid){ const idx=(pid==='P1')?0:1; return G.players[idx].hand.some(c=>c.rank==='A'); }
  function spendAce(pi){ const idx=(typeof pi==='number')?pi:(pi==='P1'?0:1); const i=G.players[idx].hand.findIndex(c=>c.rank==='A'); if(i>=0){ const c=G.players[idx].hand.splice(i,1)[0]; G.discard.push(c); return true;} return false; }

  // Buttons & drawers
  const btnConstruct=el('btnConstruct'), btnAction=el('btnAction'), btnSigil=el('btnSigil'), btnDiscard=el('btnDiscard');
  const giveDrawer=el('giveDrawer'), giveList=el('giveList'), giveClose=el('giveClose'), giveCancel=el('giveCancel');
  function openGiveDrawer(nine){ const p=me(); giveList.innerHTML=''; const mine=G.players[p].hand.filter(c=>c.id!==nine.id);
    mine.forEach(c=>{ const n=cardNode(c,true); n.addEventListener('click',()=>{ window.sendTurn({type:'ACTION_9',from:(p===0?'P1':'P2'),payload:{cardId:nine.id,giveId:c.id}}); G.selected.clear(); closeGiveDrawer(); },{once:true}); giveList.appendChild(n); });
    giveDrawer.classList.add('open'); }
  function closeGiveDrawer(){ giveDrawer.classList.remove('open'); }
  giveClose.addEventListener('click',closeGiveDrawer); giveCancel.addEventListener('click',closeGiveDrawer);

  const jokerDrawer=el('jokerDrawer'), jokerList=el('jokerList'), jokerInfo=el('jokerInfo'), jokerClose=el('jokerClose'), jokerCancel=el('jokerCancel'), jokerConfirm=el('jokerConfirm');
  let JSEL=new Set();
  function openJokerDrawer(nReq,excludedIds,baseAction){
    const p=me(); G.pendingConstruct={baseAction,requiredN:nReq,excludedIds:new Set(excludedIds)}; JSEL.clear();
    jokerInfo.textContent=`Select ${nReq} extra card(s) from your hand to discard (Joker cost).`; jokerList.innerHTML='';
    const mine=G.players[p].hand.filter(c=>!G.pendingConstruct.excludedIds.has(c.id));
    mine.forEach(c=>{ const n=cardNode(c,false); n.addEventListener('click',()=>{ if(JSEL.has(c.id)){JSEL.delete(c.id);n.classList.remove('selected');} else if(JSEL.size<nReq){JSEL.add(c.id);n.classList.add('selected');} }); jokerList.appendChild(n); });
    jokerDrawer.classList.add('open');
  }
  function closeJokerDrawer(){ jokerDrawer.classList.remove('open'); G.pendingConstruct=null; JSEL.clear(); }
  jokerClose.addEventListener('click',closeJokerDrawer); jokerCancel.addEventListener('click',closeJokerDrawer);
  jokerConfirm.addEventListener('click',()=>{ if(!G.pendingConstruct) return closeJokerDrawer(); if(JSEL.size!==G.pendingConstruct.requiredN) return;
    const extras=[...JSEL]; const act=G.pendingConstruct.baseAction; act.payload.info.extraDiscards=extras; window.sendTurn(act); G.selected.clear(); closeJokerDrawer(); render(); });

  // Buttons
  btnConstruct.addEventListener('click',()=>{ if(!G.started){log('Start the game.');return;} const a=attemptConstructFromSelection(); if(!a) return; window.sendTurn(a); G.selected.clear(); render(); });
  btnAction.addEventListener('click',()=>{ if(!G.started){log('Start the game.');return;} const p=me(); if(G.turn!==p){log('Not your turn');return;}
    const sel=currentSelected(p); if(sel.length===0){log('Select 6/7/9 (for 9 pick a give card or use drawer).');return;}
    if(sel.length===1 && sel[0].rank==='6'){ window.sendTurn({type:'ACTION_6',from:(p===0?'P1':'P2'),payload:{cardId:sel[0].id}}); G.selected.clear(); render(); return; }
    if(sel.length===1 && sel[0].rank==='7'){ window.sendTurn({type:'ACTION_7',from:(p===0?'P1':'P2'),payload:{cardId:sel[0].id}}); G.selected.clear(); render(); return; }
    if(sel.length===1 && sel[0].rank==='9'){ openGiveDrawer(sel[0]); return; }
    if(sel.length===2 && sel.some(c=>c.rank==='9')){ const nine=sel.find(c=>c.rank==='9'); const give=sel.find(c=>c.id!==nine.id);
      window.sendTurn({type:'ACTION_9',from:(p===0?'P1':'P2'),payload:{cardId:nine.id,giveId:give.id}}); G.selected.clear(); render(); return; }
    log('Bad selection for action.');
  });
  btnSigil.addEventListener('click',()=>{ if(!G.started){log('Start the game.');return;} const p=me(); if(G.turn!==p){log('Not your turn');return;}
    const sel=currentSelected(p); if(sel.length!==1){log('Select one J/Q/K.');return;} const c=sel[0]; if(!['J','Q','K'].includes(c.rank)){log('Not a Sigil.');return;}
    window.sendTurn({type:'SIGIL',from:(p===0?'P1':'P2'),payload:{rank:c.rank,cardId:c.id}}); G.selected.clear(); render(); });
  btnDiscard.addEventListener('click',()=>{ if(!G.started){log('Start the game.');return;} const p=me(); if(G.turn!==p){log('Not your turn');return;}
    const sel=currentSelected(p); if(sel.length!==1){log('Select 1 to discard.');return;} window.sendTurn({type:'DISCARD',from:(p===0?'P1':'P2'),payload:{cardId:sel[0].id}}); G.selected.clear(); render(); });

  // Signal ready for app.js
  document.dispatchEvent(new Event('arcana:ready'));
})();