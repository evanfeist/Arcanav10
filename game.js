// game.js — Arcana core rules + UI wiring (Stage 1–3) with Joker Cost drawer
// Drop-in replacement. Works with your current index.html + app.js.
// Includes: Sets (incl. 4/5/6+ rules), Runs, Joker-only, Joker cost drawer,
// 6/7/9 actions, Ace reaction (fixed: defender spends ace, action consumes turn),
// Suit bonuses (♥ +2, ♣ extra turn (max chain 2), ♦ d6 steal 1–3, ♠ steal 2 random),
// End-of-turn draw + safety net, Sigils J/Q/K.

(function(){
  const el = (id)=>document.getElementById(id);
  const logEl = el('log');

  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const RVAL  = (r)=>({A:1,J:11,Q:12,K:13}[r]||parseInt(r,10));
  const rnd = (n)=>Math.floor(Math.random()*n);

  const G = {
    deck: [],
    discard: [],
    players: [
      { hand:[], score:0 },
      { hand:[], score:0 }
    ],
    turn: 0,
    started: false,
    extraChain: 0,
    localSide: 'P1',
    selected: new Set(),
    // === JOKER COST drawer state
    pendingConstruct: null // { baseAction, requiredN, excludedIds }
  };

  // ---------- Public API for transport ----------
  window.arcana = {
    startNew,
    serialize,
    hydrate,
    applyTurn,
    render,
    hasAce,
    spendAce,
    describe:(a)=>`${a.type}${a.payload? ' '+JSON.stringify(a.payload):''}`
  };

  function startNew(){
    G.deck = buildDeck();
    G.discard = [];
    G.players = [{hand:[],score:0},{hand:[],score:0}];
    G.turn = 0; G.started = true; G.extraChain = 0; G.selected.clear();
    drawCards(0,7); drawCards(1,7);
    log('New game. P1 starts.');
    render();
  }

  function serialize(){
    return {
      deck: G.deck, discard: G.discard,
      players: G.players, turn: G.turn,
      started: G.started, extraChain: G.extraChain
    };
  }

  function hydrate(state){
    G.deck = state.deck; G.discard = state.discard;
    G.players = state.players; G.turn = state.turn;
    G.started = state.started; G.extraChain = state.extraChain||0;
    G.selected.clear();
  }

  function setLocalSideFromRole(role){
    G.localSide = role==='host' ? 'P1' : 'P2';
  }
  window.arcana_setRole = setLocalSideFromRole;

  // ---------- Deck ----------
  function buildDeck(){
    const cards=[]; let id=1;
    for(let d=0; d<2; d++){
      for(const s of SUITS){ for(const r of RANKS){ cards.push({ id:id++, suit:s, rank:r }); } }
      cards.push({id:id++, suit:'★', rank:'Joker', joker:true});
      cards.push({id:id++, suit:'☆', rank:'Joker', joker:true});
    }
    shuffle(cards); return cards;
  }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=rnd(i+1); [a[i],a[j]]=[a[j],a[i]]; } }

  // ---------- Rendering ----------
  function render(){
    el('drawTag').textContent = G.deck.length;
    el('discardTag').textContent = G.discard.length;
    el('score1').textContent = G.players[0].score;
    el('score2').textContent = G.players[1].score;
    el('turnTag').textContent = G.started ? (G.turn===0?'P1':'P2') : '—';

    const meIdx = (G.localSide==='P1')?0:1;
    const oppIdx = 1-meIdx;

    const meHand = el('playerHand'); meHand.innerHTML='';
    G.players[meIdx].hand.forEach(c=>{
      const n = cardNode(c,true);
      meHand.appendChild(n);
    });
    el('youCount').textContent = G.players[meIdx].hand.length;

    const opHand = el('opponentHand'); opHand.innerHTML='';
    G.players[oppIdx].hand.forEach(_=>{
      const n = backNode();
      opHand.appendChild(n);
    });
    el('oppCount').textContent = G.players[oppIdx].hand.length;
  }

  function cardNode(c, selectable){
    const d = document.createElement('div');
    d.className = 'cardui';
    d.dataset.id = String(c.id);
    d.dataset.suit = c.suit; // enables CSS suit watermark

    const rr = document.createElement('div'); rr.className='rank'; rr.textContent = c.rank; d.appendChild(rr);
    const ss = document.createElement('div'); ss.className='suit'; ss.textContent = c.suit; d.appendChild(ss);

    if(selectable){
      if(G.selected.has(c.id)) d.classList.add('selected');
      d.addEventListener('click', ()=> toggleSelect(c.id, d));
    }
    const t = inferType(c);
    if(t!=='Normal'){ const tag=document.createElement('div'); tag.className='type'; tag.textContent=t; d.appendChild(tag); }
    return d;
  }
  function backNode(){
    const d = document.createElement('div'); d.className='cardui back';
    d.style.background='linear-gradient(180deg,#151e2a,#0f1620)';
    d.style.border='1px solid #2a3a4e';
    return d;
  }

  function toggleSelect(id, node){
    if(G.turn !== ((G.localSide==='P1')?0:1)) return;
    if(G.selected.has(id)){ G.selected.delete(id); node.classList.remove('selected'); }
    else { G.selected.add(id); node.classList.add('selected'); }
  }

  function log(s){
    const p=document.createElement('div'); p.textContent=s; logEl.appendChild(p); logEl.scrollTop=logEl.scrollHeight;
    if(window.pushLog) window.pushLog(s); // app.js can mirror into P2 log
  }

  // ---------- Helpers ----------
  function isJoker(c){ return !!c.joker || c.rank==='Joker'; }
  function inferType(c){
    if(isJoker(c)) return 'Joker';
    if(c.rank==='A') return 'Ace';
    if(c.rank==='6' || c.rank==='7' || c.rank==='9') return 'Action';
    if(c.rank==='J' || c.rank==='Q' || c.rank==='K') return 'Sigil';
    return 'Normal';
  }
  function me(){ return (G.localSide==='P1')?0:1; }
  function them(){ return 1-me(); }

  // ---------- Draw / Discard ----------
  function drawCards(pidx, n){
    const take = Math.min(n, G.deck.length);
    for(let i=0;i<take;i++){ const c=G.deck.pop(); G.players[pidx].hand.push(c); }
  }
  function discardCard(pidx, cardId){
    const hand = G.players[pidx].hand;
    const i = hand.findIndex(c=>c.id===cardId);
    if(i>=0){ const c = hand.splice(i,1)[0]; G.discard.push(c); return c; }
    return null;
  }
  function removeFromHandByIds(pidx, ids){
    const hand = G.players[pidx].hand, list=[];
    ids.forEach(id=>{ const j=hand.findIndex(c=>c.id===id); if(j>=0) list.push(hand.splice(j,1)[0]); });
    return list;
  }

  // ---------- Turn flow ----------
  function startTurnIfNeeded(){
    const pidx = G.turn;
    if(G.players[pidx].hand.length <= 1){
      drawCards(pidx, 3);
      log((pidx===0?'P1':'P2')+' drew 3 (safety net).');
    }
  }
  function endTurn(extra=false){
    // End-of-turn draw
    drawCards(G.turn,1);
    if(extra){
      G.extraChain = Math.min(2, G.extraChain+1);
      log((G.turn===0?'P1':'P2')+' takes an extra turn.');
    }else{
      G.extraChain = 0;
      G.turn = 1-G.turn;
    }
    G.selected.clear();
    startTurnIfNeeded();
  }

  function currentSelected(pidx){
    const ids = Array.from(G.selected);
    const hand = G.players[pidx].hand;
    return hand.filter(c=>ids.includes(c.id));
  }

  // ---------- Construct validation ----------
  function validateConstruct(cards){
    const res = { valid:false, kind:'', points:0, suit:null, suitBonus:null, jokersUsed:0, bonus:null, reason:'' };
    const jokers = cards.filter(isJoker);
    const nonj = cards.filter(c=>!isJoker(c));

    // Joker-only constructs
    if(nonj.length===0){
      if(jokers.length===2){ res.valid=true; res.kind='JOKER_ONLY'; res.points=4; return res; }
      if(jokers.length===3){ res.valid=true; res.kind='JOKER_ONLY'; res.points=7; res.bonus={draw:3}; return res; }
      if(jokers.length===4){ res.valid=true; res.kind='JOKER_ONLY'; res.points=15; res.bonus={refill:true}; return res; }
      res.reason='Need 2–4 Jokers for Joker-only'; return res;
    }

    const sameSuit = nonj.every(c=>c.suit===nonj[0].suit);
    const suit = sameSuit ? nonj[0].suit : null;
    res.suit = suit;
    res.jokersUsed = jokers.length;

    // Pair / True Pair (no jokers)
    if(cards.length===2 && jokers.length===0){
      if(nonj[0].rank===nonj[1].rank){
        const base = (nonj[0].suit===nonj[1].suit) ? 5 : 2;
        res.valid=true; res.kind = (base===5?'TRUE_PAIR':'PAIR'); res.points=base;
        if(base===5){ applySuitBonusPreview(res,false); }
        return res;
      }
    }

    // Sets (no jokers)
    if (jokers.length === 0 && nonj.every(c => c.rank === nonj[0].rank) && cards.length >= 3) {
      const r = RVAL(nonj[0].rank), n = cards.length;
      let pts;
      if (n === 3) pts = 2 * r + 2;
      else if (n === 4) {
        const suitsSet = new Set(nonj.map(c => c.suit));
        pts = (suitsSet.size === 4) ? (4 * r) : (3 * r);     // 4-of-a-kind all suits = 4x rank
      } else if (n >= 5) {
        pts = 3 * r + 2;                                     // 5+ of a kind = 3x rank + 2
      }
      res.valid=true; res.kind='SET'; res.points=pts;
      if (suit) applySuitBonusPreview(res,false);
      return res;
    }

    // Sets with jokers
    if (nonj.length >= 2 && nonj.every(c => c.rank === nonj[0].rank) && cards.length >= 3 && jokers.length > 0) {
      const r = RVAL(nonj[0].rank), n = cards.length;
      let pts = (n === 4 ? 3 * r : 3 * r + 2);               // 4 with jokers = 3x rank; 5 with jokers = 3x rank + 2
      res.valid=true; res.kind='SET'; res.points=pts;
      if (suit && n >= 6) applySuitBonusPreview(res,true);   // 6+ allow suit bonus even with jokers
      res.points -= jokers.length;                           // joker nerf
      return res;
    }

    // Runs (same suit, jokers can fill gaps)
    if(sameSuit && cards.length>=3){
      const vals = nonj.map(c=>RVAL(c.rank)).sort((a,b)=>a-b);
      let gaps = 0;
      for(let i=1;i<vals.length;i++){
        const diff = vals[i]-vals[i-1];
        if(diff<=0){ res.reason='Duplicates in run'; return res; }
        gaps += (diff-1);
      }
      if(gaps<=jokers.length){
        res.valid=true; res.kind='RUN';
        const sumVals = nonj.reduce((s,c)=>s+RVAL(c.rank),0);
        const len = cards.length;
        res.points = sumVals + len;
        if(jokers.length===0) applySuitBonusPreview(res,false);
        else res.points -= jokers.length; // joker nerf
        return res;
      }
    }

    res.reason='Not a valid Pair/Set/Run';
    return res;
  }

  function applySuitBonusPreview(res, allowWithJokers){
    if(!res.suit) return;
    if(res.jokersUsed>0 && !allowWithJokers) return;
    if(res.suit==='♥'){ res.points += 2; res.suitBonus='HEARTS'; }
    if(res.suit==='♣'){ res.suitBonus='CLUBS'; }
    if(res.suit==='♦'){ res.suitBonus='DIAMONDS'; }
    if(res.suit==='♠'){ res.suitBonus='SPADES'; }
  }

  // ---------- Attempt Construct ----------
  function attemptConstructFromSelection(){
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return null; }
    const cards = currentSelected(pidx);
    if(cards.length<2){ log('Select 2+ cards for a construct'); return null; }

    const res = validateConstruct(cards);
    if(!res.valid){ log(res.reason || 'Invalid construct'); return null; }

    // If Joker cost required (non-JOKER_ONLY)
    if(res.kind!=='JOKER_ONLY' && res.jokersUsed>0){
      // Open drawer to pick exactly res.jokersUsed extra discards (not in construct)
      openJokerDrawer(res.jokersUsed, cards.map(c=>c.id), {
        type:'CONSTRUCT',
        from:(pidx===0?'P1':'P2'),
        payload:{ ids: cards.map(c=>c.id), info: res }
      });
      return null; // do not send yet
    }

    return { type:'CONSTRUCT', from: (pidx===0?'P1':'P2'), payload:{ ids: cards.map(c=>c.id), info:res } };
  }

  // ---------- Apply Turn (host authority) ----------
  function applyTurn(action){
    const actor = (action.from==='P1')?0:1;
    const target = 1-actor;

    switch(action.type){

      case 'START': startNew(); return;

      case 'CONSTRUCT': {
        const ids = action.payload.ids;
        const cards = removeFromHandByIds(actor, ids);
        const check = validateConstruct(cards);
        if(!check.valid){
          G.players[actor].hand.push(...cards);
          log('Invalid construct (host check).'); return;
        }
        // Joker cost extra discards (not for JOKER_ONLY)
        if(check.kind!=='JOKER_ONLY' && check.jokersUsed>0){
          const extras = action.payload.info && action.payload.info.extraDiscards || [];
          const extraCards = removeFromHandByIds(actor, extras);
          if(extraCards.length !== check.jokersUsed){
            G.players[actor].hand.push(...cards, ...extraCards);
            log('Joker cost mismatch.'); return;
          }
          G.discard.push(...extraCards);
        }

        G.players[actor].score += check.points;
        G.discard.push(...cards);
        log((actor===0?'P1':'P2')+` played ${check.kind} for +${check.points}.`);

        if(check.kind==='JOKER_ONLY'){
          if(check.bonus?.draw){ drawCards(actor, check.bonus.draw); log(`Drew ${check.bonus.draw}.`); }
          if(check.bonus?.refill){
            const need = Math.max(0, 7 - G.players[actor].hand.length);
            if(need>0){ drawCards(actor, need); log(`Refilled to 7.`); }
          }
        }

        let extraTurn=false;
        if(check.suitBonus==='DIAMONDS'){
          const roll = 1+Math.floor(Math.random()*6);
          const steal = (roll<=2)?1:(roll<=4)?2:3;
          const give = Math.min(steal, G.players[target].score);
          G.players[target].score -= give; G.players[actor].score += give;
          log(`♦ bonus d6=${roll} → stole ${give} point(s).`);
        }
        if(check.suitBonus==='SPADES'){
          const opp = G.players[target].hand;
          for(let i=0;i<2 && opp.length>0;i++){
            const j = rnd(opp.length);
            const c = opp.splice(j,1)[0];
            G.players[actor].hand.push(c);
          }
          log(`♠ bonus: stole up to 2 random card(s).`);
        }
        if(check.suitBonus==='CLUBS'){ extraTurn=true; }

        if(G.players[actor].score>=60){ log((actor===0?'P1':'P2')+' wins (60)!'); G.started=false; return; }
        endTurn(extraTurn && G.extraChain<1); return;
      }

      case 'ACTION_6': {
        discardCard(actor, action.payload.cardId);
        drawCards(actor, 2);
        log((actor===0?'P1':'P2')+' played 6 (Draw2).');
        endTurn(); return;
      }

      case 'ACTION_7': {
        if(action.payload?.blocked){ log('7 was blocked by Ace.'); endTurn(); return; }
        discardCard(actor, action.payload.cardId);
        const opp = G.players[target].hand;
        if(opp.length>0){
          const j = rnd(opp.length);
          const c = opp.splice(j,1)[0];
          G.players[actor].hand.push(c);
          log('7: stole a random card.');
        }else{ log('7: opponent had no cards.'); }
        endTurn(); return;
      }

      case 'ACTION_9': {
        if(action.payload?.blocked){ log('9 was blocked by Ace.'); endTurn(); return; }
        discardCard(actor, action.payload.cardId);
        const g = discardCard(actor, action.payload.giveId);
        if(g){ G.players[target].hand.push(g); }
        const opp = G.players[target].hand;
        if(opp.length>0){
          const j = rnd(opp.length);
          const c = opp.splice(j,1)[0];
          G.players[actor].hand.push(c);
          log('9: swapped one card.');
        }else{ log('9: opponent had no cards to swap.'); }
        endTurn(); return;
      }

      case 'ACE_REACT': {
        // 'from' is the DEFENDER (the player deciding to use the Ace)
        const used = !!(action.payload && action.payload.used);
        if (used) {
          // Spend the Ace from the DEFENDER (actor)
          spendAce(actor);
          // Counter: defender steals 1 point from the aggressor (target)
          const steal = Math.min(1, G.players[target].score);
          G.players[target].score -= steal;
          G.players[actor].score  += steal;
          log('Ace block: action canceled. Defender steals 1 point.');
        } else {
          log('Ace not used.');
        }
        // Actions (7/9) consume the turn even when blocked
        endTurn();
        return;
      }

      case 'SIGIL': {
        const r = action.payload.rank; const cardId = action.payload.cardId;
        discardCard(actor, cardId);
        if(r==='J'){ G.players[actor].score += 2; drawCards(actor,1); log('J: +2, draw 1.'); }
        if(r==='Q'){ G.players[actor].score += 3; drawCards(actor,1); log('Q: +3, draw 1.'); }
        if(r==='K'){ G.players[actor].score += 5; drawCards(actor,2); log('K: +5, draw 2.'); }
        if(G.players[actor].score>=60){ log((actor===0?'P1':'P2')+' wins (60)!'); G.started=false; return; }
        endTurn(); return;
      }

      case 'DISCARD': {
        const c = discardCard(actor, action.payload.cardId);
        log((actor===0?'P1':'P2')+` discarded ${c? (c.rank+c.suit) : '—'}.`);
        endTurn(); return;
      }
    }
  }

  function hasAce(playerId){
    const idx = (playerId==='P1')?0:1;
    return G.players[idx].hand.some(c=>c.rank==='A');
  }
  function spendAce(playerIdxOrId){
    const idx = (typeof playerIdxOrId==='number')? playerIdxOrId : (playerIdxOrId==='P1'?0:1);
    const i = G.players[idx].hand.findIndex(c=>c.rank==='A');
    if(i>=0){ const c=G.players[idx].hand.splice(i,1)[0]; G.discard.push(c); return true; }
    return false;
  }

  // ---------- Buttons & Drawers ----------
  const btnConstruct = el('btnConstruct');
  const btnAction = el('btnAction');
  const btnSigil = el('btnSigil');
  const btnDiscard = el('btnDiscard');

  // 9: Give drawer
  const giveDrawer = el('giveDrawer');
  const giveList = el('giveList');
  const giveClose = el('giveClose');
  const giveCancel = el('giveCancel');

  function openGiveDrawer(nineCard){
    const pidx = me();
    giveList.innerHTML='';
    const mine = G.players[pidx].hand.filter(c=>c.id!==nineCard.id);
    mine.forEach(c=>{
      const n = cardNode(c,true);
      n.addEventListener('click', ()=>{
        window.sendTurn({ type:'ACTION_9', from:(pidx===0?'P1':'P2'), payload:{ cardId:nineCard.id, giveId:c.id } });
        G.selected.clear(); closeGiveDrawer();
      }, { once:true });
      giveList.appendChild(n);
    });
    giveDrawer.classList.add('open');
  }
  function closeGiveDrawer(){ giveDrawer.classList.remove('open'); }
  giveClose.addEventListener('click', closeGiveDrawer);
  giveCancel.addEventListener('click', closeGiveDrawer);

  // === JOKER COST drawer
  const jokerDrawer = el('jokerDrawer');
  const jokerList = el('jokerList');
  const jokerInfo = el('jokerInfo');
  const jokerClose = el('jokerClose');
  const jokerCancel = el('jokerCancel');
  const jokerConfirm = el('jokerConfirm');
  let JSEL = new Set();

  function openJokerDrawer(nRequired, excludedIds, baseAction){
    const pidx = me();
    G.pendingConstruct = { baseAction, requiredN: nRequired, excludedIds: new Set(excludedIds) };
    JSEL.clear();
    jokerInfo.textContent = `Select ${nRequired} extra card(s) from your hand to discard (Joker cost).`;
    jokerList.innerHTML = '';

    const mine = G.players[pidx].hand.filter(c=>!G.pendingConstruct.excludedIds.has(c.id));
    mine.forEach(c=>{
      const n = cardNode(c,false);
      n.addEventListener('click', ()=>{
        if(JSEL.has(c.id)){ JSEL.delete(c.id); n.classList.remove('selected'); }
        else {
          if(JSEL.size < nRequired){ JSEL.add(c.id); n.classList.add('selected'); }
        }
      });
      jokerList.appendChild(n);
    });

    jokerDrawer.classList.add('open');
  }
  function closeJokerDrawer(){ jokerDrawer.classList.remove('open'); G.pendingConstruct=null; JSEL.clear(); }
  jokerClose.addEventListener('click', closeJokerDrawer);
  jokerCancel.addEventListener('click', closeJokerDrawer);
  jokerConfirm.addEventListener('click', ()=>{
    if(!G.pendingConstruct) return closeJokerDrawer();
    if(JSEL.size !== G.pendingConstruct.requiredN){ return; } // ignore until exact
    const extras = Array.from(JSEL);
    // attach extraDiscards and send turn
    const act = G.pendingConstruct.baseAction;
    act.payload.info.extraDiscards = extras;
    window.sendTurn(act);
    G.selected.clear();
    closeJokerDrawer();
    render();
  });

  // ---------- Button handlers ----------
  btnConstruct.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const action = attemptConstructFromSelection();
    if(!action) return; // could be waiting for Joker drawer
    window.sendTurn(action); G.selected.clear(); render();
  });

  btnAction.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return; }
    const sel = currentSelected(pidx);
    if(sel.length===0){ log('Select an action card (6/7/9). For 9, either also select the give card OR choose from drawer.'); return; }

    if(sel.length===1 && sel[0].rank==='6'){
      window.sendTurn({ type:'ACTION_6', from:(pidx===0?'P1':'P2'), payload:{ cardId: sel[0].id } });
      G.selected.clear(); render(); return;
    }
    if(sel.length===1 && sel[0].rank==='7'){
      window.sendTurn({ type:'ACTION_7', from:(pidx===0?'P1':'P2'), payload:{ cardId: sel[0].id } });
      G.selected.clear(); render(); return;
    }
    if(sel.length===1 && sel[0].rank==='9'){ openGiveDrawer(sel[0]); return; }
    if(sel.length===2 && sel.some(c=>c.rank==='9')){
      const nine = sel.find(c=>c.rank==='9'); const give = sel.find(c=>c.id!==nine.id);
      window.sendTurn({ type:'ACTION_9', from:(pidx===0?'P1':'P2'), payload:{ cardId:nine.id, giveId: give.id } });
      G.selected.clear(); render(); return;
    }
    log('Bad selection for action.');
  });

  btnSigil.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return; }
    const sel = currentSelected(pidx);
    if(sel.length!==1){ log('Select exactly one J/Q/K to play as a Sigil.'); return; }
    const c = sel[0];
    if(c.rank!=='J' && c.rank!=='Q' && c.rank!=='K'){ log('That is not a Sigil.'); return; }
    window.sendTurn({ type:'SIGIL', from:(pidx===0?'P1':'P2'), payload:{ rank:c.rank, cardId:c.id } });
    G.selected.clear(); render();
  });

  btnDiscard.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return; }
    const sel = currentSelected(pidx);
    if(sel.length!==1){ log('Select exactly one card to discard.'); return; }
    window.sendTurn({ type:'DISCARD', from:(pidx===0?'P1':'P2'), payload:{ cardId: sel[0].id } });
    G.selected.clear(); render();
  });

  // Let app.js know engine is ready
  document.dispatchEvent(new Event('arcana:ready'));
})();