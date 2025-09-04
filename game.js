// game.js — Arcana core rules + UI wiring (Stage 1–3)
// - Two decks incl. 4 Jokers (108 cards total)
// - One move per turn (Construct OR Action 6/7/9 OR Sigil J/Q/K OR Discard)
// - End of turn: draw 1; Safety net: if start turn with <=1 card, draw 3
// - Actions: 6=Draw2, 7=Steal 1 random card, 9=Swap (play 9 + choose a card to give; take 1 random)
// - Ace reaction vs 7/9: player may spend Ace; roll d6 (1–3 fail, action succeeds; 4–6 block + counter +1 point)
// - Constructs: Pair / True Pair / Sets / Straights (runs) with optional Jokers; Joker nerf -1/used; Joker-only sets (2/3/4) have special payouts
// - Suit bonuses (no Jokers; BUT sets of 6+ allow suit bonus even if Jokers present):
//    ♠ steal 2 random cards; ♥ +2 points; ♦ roll d6 → steal 1/2/3 points; ♣ extra turn (max chain 2)
// - Set 4 (no Jokers) = 3×rank (+ suit bonus if all one suit)
// - Set 5 (no Jokers) = 3×rank + 2 (+ suit bonus if all one suit)
// - Sets of 6+ = 3×rank + 2 (suit bonus allowed even if Jokers present)
// - Set 4 with one of each suit = 4×rank (no Jokers); overrides 3×rank
// - Only see your own hand; opponent hand shown as backs

(function(){
  const el = (id)=>document.getElementById(id);
  const logEl = el('log');

  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const RVAL  = (r)=>({A:1,J:11,Q:12,K:13}[r]||parseInt(r,10));
  const rnd = (n)=>Math.floor(Math.random()*n);
  const clone = (x)=>JSON.parse(JSON.stringify(x));

  const G = {
    deck: [],
    discard: [],
    players: [
      { hand:[], score:0 },
      { hand:[], score:0 }
    ],
    turn: 0,
    started: false,
    extraChain: 0,           // for clubs bonus (max chain 2)
    localSide: 'P1',         // 'P1' if host, 'P2' if guest (set by app.js)
    selected: new Set(),     // selected card ids (from local player's hand)
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
    // initial draw 7 each
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
  // app.js sets this on role change
  window.arcana_setRole = setLocalSideFromRole;

  // ---------- Deck ----------
  function buildDeck(){
    const cards=[];
    let id=1;
    for(let d=0; d<2; d++){ // two decks
      for(const s of SUITS){
        for(const r of RANKS){
          const c = { id:id++, suit:s, rank:r };
          cards.push(c);
        }
      }
      // two jokers per deck
      cards.push({id:id++, suit:'★', rank:'Joker', joker:true});
      cards.push({id:id++, suit:'☆', rank:'Joker', joker:true});
    }
    shuffle(cards);
    return cards;
  }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=rnd(i+1); [a[i],a[j]]=[a[j],a[i]]; } }

  // ---------- Rendering ----------
  function render(){
    // counts
    el('drawTag').textContent = G.deck.length;
    el('discardTag').textContent = G.discard.length;
    el('score1').textContent = G.players[0].score;
    el('score2').textContent = G.players[1].score;
    el('turnTag').textContent = G.started ? (G.turn===0?'P1':'P2') : '—';

    // who am I?
    const meIdx = (G.localSide==='P1')?0:1;
    const oppIdx = 1-meIdx;

    // your hand
    const meHand = el('playerHand'); meHand.innerHTML='';
    G.players[meIdx].hand.forEach(c=>{
      const n = cardNode(c,true);
      meHand.appendChild(n);
    });
    el('youCount').textContent = G.players[meIdx].hand.length;

    // opponent hand (backs)
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
    // face
    const rr = document.createElement('div'); rr.className='rank'; rr.textContent = c.rank; d.appendChild(rr);
    const ss = document.createElement('div'); ss.className='suit'; ss.textContent = c.suit; d.appendChild(ss);
    if(selectable){
      if(G.selected.has(c.id)) d.classList.add('selected');
      d.addEventListener('click', ()=> toggleSelect(c.id, d));
    }
    // type tag
    const type = inferType(c);
    if(type!=='Normal'){
      const t = document.createElement('div'); t.className='type'; t.textContent = type; d.appendChild(t);
    }
    return d;
  }
  function backNode(){
    const d = document.createElement('div'); d.className='cardui back';
    d.style.background='linear-gradient(180deg,#151e2a,#0f1620)';
    d.style.border='1px solid #2a3a4e';
    return d;
  }

  function toggleSelect(id, node){
    if(G.turn !== ((G.localSide==='P1')?0:1)) return; // only act on your turn
    if(G.selected.has(id)){ G.selected.delete(id); node.classList.remove('selected'); }
    else { G.selected.add(id); node.classList.add('selected'); }
  }

  function log(s){ const p=document.createElement('div'); p.textContent=s; logEl.appendChild(p); logEl.scrollTop=logEl.scrollHeight; }

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
    for(let i=0;i<take;i++){
      const c = G.deck.pop();
      G.players[pidx].hand.push(c);
      // We implement Joker cost at PLAY time (not on draw) for simplicity & P2P fairness
    }
  }
  function discardCard(pidx, cardId){
    const hand = G.players[pidx].hand;
    const i = hand.findIndex(c=>c.id===cardId);
    if(i>=0){ const c = hand.splice(i,1)[0]; G.discard.push(c); return c; }
    return null;
  }
  function removeFromHandByIds(pidx, ids){
    const hand = G.players[pidx].hand;
    const list = [];
    ids.forEach(id=>{
      const j = hand.findIndex(c=>c.id===id);
      if(j>=0) list.push(hand.splice(j,1)[0]);
    });
    return list;
  }

  // ---------- Turn flow ----------
  function startTurnIfNeeded(){
    // Safety net: if start with <=1 card, draw 3 immediately
    const pidx = G.turn;
    if(G.players[pidx].hand.length <= 1){
      drawCards(pidx, 3);
      log((pidx===0?'P1':'P2')+' drew 3 (safety net).');
    }
  }
  function endTurn(nextPlayerSame=false){
    // End-of-turn draw 1
    drawCards(G.turn,1);
    // Switch or extra turn
    if(nextPlayerSame){
      G.extraChain = Math.min(2, G.extraChain+1);
      log((G.turn===0?'P1':'P2')+' takes an extra turn.');
    }else{
      G.extraChain = 0;
      G.turn = 1-G.turn;
    }
    G.selected.clear();
    startTurnIfNeeded();
  }

  // ---------- Validation / Scoring ----------
  function attemptConstructFromSelection(){
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return null; }
    const cards = currentSelected(pidx);
    if(cards.length<2){ log('Select 2+ cards for a construct'); return null; }

    const res = validateConstruct(cards, pidx);
    if(!res.valid){ log(res.reason || 'Invalid construct'); return null; }

    // Joker cost at PLAY time (not for Joker-only constructs)
    if(res.kind!=='JOKER_ONLY' && res.jokersUsed>0){
      // Must discard exactly jokersUsed extra cards from hand (not part of construct)
      const nNeeded = res.jokersUsed;
      const extra = pickExtraDiscards(pidx, nNeeded, cards.map(c=>c.id));
      if(!extra){ log(`Select ${nNeeded} extra card(s) (not in construct) to discard for Joker cost.`); return null; }
      res.extraDiscards = extra;
    }

    return { type:'CONSTRUCT', from: (pidx===0?'P1':'P2'), payload:{ ids: cards.map(c=>c.id), info:res } };
  }

  function pickExtraDiscards(pidx, nNeeded, excludedIds){
    // Use current selection: any selected not in excludedIds count as extra discards
    const extras = Array.from(G.selected).filter(id=>!excludedIds.includes(id));
    if(extras.length !== nNeeded) return null;
    // Verify they belong to pidx
    const mine = G.players[pidx].hand.map(c=>c.id);
    if(!extras.every(id=>mine.includes(id))) return null;
    return extras;
  }

  function currentSelected(pidx){
    const ids = Array.from(G.selected);
    const hand = G.players[pidx].hand;
    return hand.filter(c=>ids.includes(c.id));
  }

  function validateConstruct(cards, pidx){
    const res = { valid:false, kind:'', points:0, suit:null, jokersUsed:0, reason:'' };
    const jokers = cards.filter(isJoker);
    const nonj = cards.filter(c=>!isJoker(c));

    // Joker-only constructs
    if(nonj.length===0){
      if(jokers.length===2){ res.valid=true; res.kind='JOKER_ONLY'; res.points=4; return res; }
      if(jokers.length===3){ res.valid=true; res.kind='JOKER_ONLY'; res.points=7; res.bonus={draw:3}; return res; }
      if(jokers.length===4){ res.valid=true; res.kind='JOKER_ONLY'; res.points=15; res.bonus={refill:true}; return res; }
      res.reason='Need 2–4 Jokers for Joker-only'; return res;
    }

    // Determine suit uniformity (for bonuses)
    const sameSuit = nonj.every(c=>c.suit===nonj[0].suit);
    const suit = sameSuit ? nonj[0].suit : null;
    res.suit = suit;
    res.jokersUsed = jokers.length;

    // Pair / True Pair
    if(cards.length===2 && jokers.length===0){
      if(nonj[0].rank===nonj[1].rank){
        const base = (nonj[0].suit===nonj[1].suit) ? 5 : 2;
        res.valid=true; res.kind = (base===5?'TRUE_PAIR':'PAIR'); res.points=base;
        // Suit bonus if same suit
        if(base===5) applySuitBonusPreview(res);
        return res;
      }
    }

    // Set (3+ of a kind)
    if(jokers.length===0 && nonj.every(c=>c.rank===nonj[0].rank) && cards.length>=3){
      const r = RVAL(nonj[0].rank), n=cards.length;
      let pts = 2*r + 2; // default for 3+
      if(n===4){
        // special cases
        const suitsSet = new Set(nonj.map(c=>c.suit));
        pts = (suitsSet.size===4) ? (4*r) : (3*r); // one of each suit → 4×rank
      } else if(n>=5){
        pts = 3*r + 2;
      }
      res.valid=true; res.kind='SET'; res.points=pts;
      // Suit bonus if all one suit
      if(suit) applySuitBonusPreview(res, n>=6 /* allow even if jokers? here no jokers */);
      return res;
    }

    // Set with Jokers (3+ including jokers)
    if(nonj.length>=2 && nonj.every(c=>c.rank===nonj[0].rank) && cards.length>=3){
      const r = RVAL(nonj[0].rank), n=cards.length;
      let pts = (n===4 ? 3*r : 3*r+2); // 4→3r, 5+→3r+2
      res.valid=true; res.kind='SET'; res.points=pts;
      // suit bonus only for n>=6 (even with jokers)
      if(suit && n>=6) applySuitBonusPreview(res, true);
      // joker nerf
      res.points -= jokers.length;
      return res;
    }

    // Straight (Run): same suit, consecutive ranks, jokers can fill gaps
    if(sameSuit && cards.length>=3){
      // treat A as 1 or 14; use greedy gaps with jokers
      const vals = nonj.map(c=>RVAL(c.rank)).sort((a,b)=>a-b);
      // consider Ace high transformation (if K and A both present)
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
        res.points = sumVals + len; // +1 per card (including jokers)
        if(jokers.length===0) applySuitBonusPreview(res);
        else res.points -= jokers.length; // nerf
        return res;
      }
    }

    res.reason='Not a valid Pair/Set/Run';
    return res;
  }

  function applySuitBonusPreview(res, allowWithJokers=false){
    // This function *adds* the bonus to res.points; used in preview/result.
    if(!res.suit) return;
    if(res.jokersUsed>0 && !allowWithJokers) return;

    if(res.suit==='♥'){ res.points += 2; res.suitBonus='HEARTS'; }
    if(res.suit==='♣'){ res.suitBonus='CLUBS'; /* applied as extra turn at resolution */ }
    if(res.suit==='♦'){ res.suitBonus='DIAMONDS'; /* dice at resolution adds/subtracts later */ }
    if(res.suit==='♠'){ res.suitBonus='SPADES'; /* steal cards at resolution */ }
  }

  // ---------- Apply Turn (host authority) ----------
  function applyTurn(action){
    const actor = (action.from==='P1')?0:1;
    const target = 1-actor;

    switch(action.type){

      case 'START':
        startNew();
        return;

      case 'CONSTRUCT': {
        const ids = action.payload.ids;
        const cards = removeFromHandByIds(actor, ids);
        // base points & metadata were computed by actor, recompute on host for trust
        const check = validateConstruct(cards, actor);
        if(!check.valid){ // put back (host sanity)
          G.players[actor].hand.push(...cards);
          log('Invalid construct (host check).');
          return;
        }
        // Joker cost extra discards (not for JOKER_ONLY)
        if(check.kind!=='JOKER_ONLY' && check.jokersUsed>0){
          const extras = action.payload.info && action.payload.info.extraDiscards || [];
          const extraCards = removeFromHandByIds(actor, extras);
          if(extraCards.length !== check.jokersUsed){
            // restore everything if mismatch
            G.players[actor].hand.push(...cards, ...extraCards);
            log('Joker cost mismatch.');
            return;
          }
          G.discard.push(...extraCards);
        }

        // Score
        G.players[actor].score += check.points;
        G.discard.push(...cards);
        log((actor===0?'P1':'P2')+` played ${check.kind} for +${check.points}.`);

        // Joker-only bonuses
        if(check.kind==='JOKER_ONLY'){
          if(check.bonus?.draw){ drawCards(actor, check.bonus.draw); log(`Drew ${check.bonus.draw}.`); }
          if(check.bonus?.refill){
            const need = Math.max(0, 7 - G.players[actor].hand.length);
            if(need>0){ drawCards(actor, need); log(`Refilled to 7.`); }
          }
        }

        // Suit bonus resolution
        let extraTurn=false;
        if(check.suitBonus==='HEARTS'){ /* already added +2 */ }
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
        if(check.suitBonus==='CLUBS'){
          extraTurn=true;
        }

        // Win check (to 60)
        if(G.players[actor].score>=60){
          log((actor===0?'P1':'P2')+' wins (60)!');
          G.started=false;
          return;
        }
        endTurn(extraTurn && G.extraChain<1);
        return;
      }

      case 'ACTION_6': {
        // discard the 6
        discardCard(actor, action.payload.cardId);
        drawCards(actor, 2);
        log((actor===0?'P1':'P2')+' played 6 (Draw2).');
        endTurn();
        return;
      }

      case 'ACTION_7': {
        // maybe blocked by Ace (already handled in transport with ACE_OFFER handshake;
        // transport will either send ACTION_7_RESOLVE or ACE_REACT outcome)
        if(action.payload?.blocked){
          // counter +1 already applied below
          log('7 was blocked by Ace.');
          endTurn();
          return;
        }
        // discard the 7
        discardCard(actor, action.payload.cardId);
        // steal 1 random card
        const opp = G.players[target].hand;
        if(opp.length>0){
          const j = rnd(opp.length);
          const c = opp.splice(j,1)[0];
          G.players[actor].hand.push(c);
          log('7: stole a random card.');
        }else{
          log('7: opponent had no cards.');
        }
        endTurn();
        return;
      }

      case 'ACTION_9': {
        if(action.payload?.blocked){
          log('9 was blocked by Ace.');
          endTurn();
          return;
        }
        // discard the 9
        discardCard(actor, action.payload.cardId);
        // give chosen card to opponent
        const g = discardCard(actor, action.payload.giveId);
        if(g){ G.players[target].hand.push(g); }
        // take one random from opponent
        const opp = G.players[target].hand;
        if(opp.length>0){
          const j = rnd(opp.length);
          const c = opp.splice(j,1)[0];
          G.players[actor].hand.push(c);
          log('9: swapped one card.');
        }else{
          log('9: opponent had no cards to swap.');
        }
        endTurn();
        return;
      }

      case 'ACE_REACT': {
        // Block + counter already decided in transport; apply counter if used:true
        if(action.payload?.used){
          // Spend an Ace from target (already consumed UI-side), but ensure state trimmed:
          spendAce(target);
          // counter: steal 1 point from aggressor (if possible)
          const give = Math.min(1, G.players[actor].score);
          G.players[actor].score -= give;
          G.players[target].score += give;
          log('Ace block succeeded: +1 point counter.');
        }else{
          log('Ace not used.');
        }
        return;
      }

      case 'SIGIL': {
        const r = action.payload.rank; // 'J'|'Q'|'K'
        const cardId = action.payload.cardId;
        discardCard(actor, cardId);
        if(r==='J'){ G.players[actor].score += 2; drawCards(actor,1); log('J: +2, draw 1.'); }
        if(r==='Q'){ G.players[actor].score += 3; drawCards(actor,1); log('Q: +3, draw 1.'); }
        if(r==='K'){ G.players[actor].score += 5; drawCards(actor,2); log('K: +5, draw 2.'); }
        if(G.players[actor].score>=60){ log((actor===0?'P1':'P2')+' wins (60)!'); G.started=false; return; }
        endTurn();
        return;
      }

      case 'DISCARD': {
        const c = discardCard(actor, action.payload.cardId);
        log((actor===0?'P1':'P2')+` discarded ${c? (c.rank+c.suit) : '—'}.`);
        endTurn();
        return;
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

  // ---------- Button wiring (local → sendTurn) ----------
  const btnConstruct = el('btnConstruct');
  const btnAction = el('btnAction');
  const btnSigil = el('btnSigil');
  const btnDiscard = el('btnDiscard');

  btnConstruct.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const action = attemptConstructFromSelection();
    if(!action) return;
    window.sendTurn(action); // app.js will apply (host) & sync
    G.selected.clear(); render();
  });

  btnAction.addEventListener('click', ()=>{
    if(!G.started){ log('Start the game.'); return; }
    const pidx = me();
    if(G.turn!==pidx){ log('Not your turn'); return; }
    const sel = currentSelected(pidx);
    if(sel.length===0){ log('Select an action card (6/7/9), and for 9 also select a second card to give.'); return; }
    // 6: select exactly one 6
    if(sel.length===1 && sel[0].rank==='6'){
      window.sendTurn({ type:'ACTION_6', from:(pidx===0?'P1':'P2'), payload:{ cardId: sel[0].id } });
      G.selected.clear(); render(); return;
    }
    // 7: select exactly one 7
    if(sel.length===1 && sel[0].rank==='7'){
      window.sendTurn({ type:'ACTION_7', from:(pidx===0?'P1':'P2'), payload:{ cardId: sel[0].id } });
      G.selected.clear(); render(); return;
    }
    // 9: select a 9 and one more card to give
    if(sel.length===2 && sel.some(c=>c.rank==='9')){
      const nine = sel.find(c=>c.rank==='9');
      const give = sel.find(c=>c.id!==nine.id);
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

})();