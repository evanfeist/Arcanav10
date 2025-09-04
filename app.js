// app.js — WebRTC host/join transport for Arcana (CSP-safe, no eval)
// No rule changes. Host is authority. Supports 6/7/9 + Ace flow + suit bonuses via your engine.

(() => {
  // ======= DOM helpers =======
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const logEl = $('log');
  const signalInput = $('signalUrl');
  const btnUseUrl = $('btnUseUrl');
  const btnHost = $('btnHost');
  const btnJoin = $('btnJoin');
  const hostIdEl = $('hostId');
  const joinIdInput = $('joinId');
  const btnStart = $('btnStart');
  const btnResync = $('btnResync');

  const aceModal = $('aceModal');
  const aceText  = $('aceText');
  const aceNo    = $('aceNo');
  const aceYes   = $('aceYes');

  function log(...a){ const d=document.createElement('div'); d.textContent=a.join(' '); logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; console.log('[LOG]',...a); }
  function setStatus(t, cls){ statusEl.textContent=t; statusEl.className = 'pill' + (cls? ' ' + cls : ''); }
  function enableStart(b){ btnStart.disabled = !b; btnResync.disabled = !b; }

  // ======= Engine integration contract (no football) =======
  // Implement these in your Stage-2 game code (or leave defaults to test wiring):
  const arcana = window.arcana = window.arcana || {
    // Return full snapshot (deck, hands, discard, scores, turn pointer, etc.)
    serialize(){ return { demo:true, ts:Date.now() }; },

    // Apply full snapshot to local memory; do not mutate parameters.
    hydrate(state){ /* replace with your real hydrate */ },

    // Apply a single action (host-only authority). MUST be pure rules: scoring, suit bonuses, etc.
    // action: { type:'CONSTRUCT'|'ACTION_6'|'ACTION_7'|'ACTION_9'|'ACE_REACT'|'SIGIL'|'DISCARD'|'DRAW', payload?:any, from:'P1'|'P2' }
    applyTurn(action){ /* replace with your real applyTurn */ },

    // Repaint UI from current memory.
    render(){ /* replace with your render */ },

    // Does the TARGET currently hold an Ace they can spend?
    hasAce(player){ return false; },

    // Spend an Ace from TARGET (mutate local state); return true if spent.
    spendAce(player){ return false; },

    // Optional: stringify an action for your log
    describe(action){ return JSON.stringify(action); }
  };

  // ======= Net state =======
  const G = {
    net: {
      ws: null,
      url: 'wss://arcana-signal.onrender.com', // 👈 Replace with your deployed WSS URL
      role: null,        // 'host' | 'guest'
      hostId: null,
      pc: null,
      dc: null,
      connected: false,
    },
    // For Ace handshake
    pendingAce: null // { context:{for:'A7'|'A9'}, resolve:fn, reject:fn }
  };

signalInput.value = G.net.url;

  // ======= Utils =======
  function randomHostId(){
    const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s='';
    for(let i=0;i<6;i++) s += c[Math.floor(Math.random()*c.length)];
    return s;
  }
  function wsSend(obj){ if(G.net.ws && G.net.ws.readyState===1){ try{ G.net.ws.send(JSON.stringify(obj)); }catch{} } }
  function dcSend(obj){ if(G.net.dc && G.net.connected){ try{ G.net.dc.send(JSON.stringify(obj)); }catch{} } }

  // ======= WebSocket signaling =======
  function wsConnect(url){
    if(G.net.ws) try{ G.net.ws.close(); }catch{}
    G.net.ws = new WebSocket(url);
    G.net.ws.onopen = ()=>{ log('WS open →', url); setStatus('Signaling connected','ok'); };
    G.net.ws.onclose = ()=>{ log('WS close'); setStatus('Signaling closed','bad'); if(!G.net.connected) enableStart(false); };
    G.net.ws.onerror = ()=>{ log('WS error'); setStatus('Signaling error','bad'); enableStart(false); };
    G.net.ws.onmessage = async (e)=>{
      let msg={}; try{ msg = JSON.parse(e.data||'{}'); }catch{ return; }

      if(msg.type==='host-ok'){
        G.net.role='host'; G.net.hostId=msg.hostId; hostIdEl.textContent=msg.hostId;
        setStatus('Host ready. Share ID.');
        await hostCreatePeerAndOffer();
        return;
      }
      if(msg.type==='join-ok'){
        G.net.role='guest'; G.net.hostId=msg.hostId;
        setStatus('Found host. Setting up…');
        // Guest waits for offer
        return;
      }
      if(msg.type==='guest-joined' && G.net.role==='host'){
        // Nudge with a fresh offer (covers races)
        try{
          const offer = await G.net.pc.createOffer();
          await G.net.pc.setLocalDescription(offer);
          wsSend({ type:'signal', hostId:G.net.hostId, payload:{ sdp:G.net.pc.localDescription }});
        }catch(e){ log('Re-offer error', e); }
        return;
      }
      if(msg.type==='signal' && msg.hostId===G.net.hostId && msg.payload){
        await onSignal(msg.payload);
        return;
      }
    };
  }

  // ======= WebRTC =======
  function attachPeerLogs(pc,label){
    pc.oniceconnectionstatechange=()=>log(`[ICE] ${label}:`, pc.iceConnectionState);
    pc.onconnectionstatechange   =()=>log(`[PC ] ${label}:`, pc.connectionState);
    pc.onsignalingstatechange    =()=>log(`[SIG] ${label}:`, pc.signalingState);
    pc.onicegatheringstatechange =()=>log(`[GATH] ${label}:`, pc.iceGatheringState);
  }

  async function hostCreatePeerAndOffer(){
    if(G.net.pc) try{ G.net.pc.close(); }catch{}
    G.net.pc = new RTCPeerConnection({ iceServers:[{ urls:'stun:stun.l.google.com:19302' }] });
    attachPeerLogs(G.net.pc,'HOST');

    const dc = G.net.pc.createDataChannel('arcana',{ ordered:true });
    hookDC(dc);

    G.net.pc.onicecandidate = (e)=>{ if(e.candidate){ wsSend({ type:'signal', hostId:G.net.hostId, payload:{ ice:e.candidate } }); } };

    const offer = await G.net.pc.createOffer();
    await G.net.pc.setLocalDescription(offer);
    wsSend({ type:'signal', hostId:G.net.hostId, payload:{ sdp:G.net.pc.localDescription } });
    log('Host sent offer');
  }

  async function guestEnsurePeer(){
    if(G.net.pc) return G.net.pc;
    G.net.pc = new RTCPeerConnection({ iceServers:[{ urls:'stun:stun.l.google.com:19302' }] });
    attachPeerLogs(G.net.pc,'GUEST');

    G.net.pc.ondatachannel = (ev)=>{ hookDC(ev.channel); };
    G.net.pc.onicecandidate = (e)=>{ if(e.candidate){ wsSend({ type:'signal', hostId:G.net.hostId, payload:{ ice:e.candidate } }); } };
    return G.net.pc;
  }

  function hookDC(dc){
    G.net.dc = dc;
    dc.onopen = ()=>{
      log('[DC ] open'); G.net.connected=true; setStatus('Connected','ok'); enableStart(true);
      // Belt-and-suspenders: host pushes SYNC when channel opens
      if(G.net.role==='host'){ dcSend({ kind:'SYNC', state: arcana.serialize() }); }
    };
    dc.onclose = ()=>{ log('[DC ] close'); G.net.connected=false; setStatus('Disconnected','bad'); enableStart(false); };
    dc.onmessage = (e)=>{
      let obj={}; try{ obj = JSON.parse(e.data||'{}'); }catch{ return; }
      handlePacket(obj);
    };
  }

  async function onSignal(payload){
    if(payload.sdp){
      if(payload.sdp.type==='offer'){
        const pc = await guestEnsurePeer();
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ type:'signal', hostId:G.net.hostId, payload:{ sdp:pc.localDescription } });
        log('Guest sent answer');
      } else if(payload.sdp.type==='answer'){
        if(!G.net.pc) return;
        await G.net.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        log('Host applied answer');
      }
    } else if(payload.ice){
      const c = new RTCIceCandidate(payload.ice);
      if(!G.net.pc) await guestEnsurePeer();
      try{ await G.net.pc.addIceCandidate(c); }catch(e){ log('ICE add error', e); }
    }
  }

  // ======= Packet handling (Host authority) =======
  function handlePacket(p){
    if(!p || typeof p!=='object') return;

    if(p.kind==='SYNC'){
      arcana.hydrate(p.state); arcana.render(); log('RX SYNC ✓');
      return;
    }

    if(p.kind==='TURN_ACTION'){
      if(G.net.role==='host'){
        // Host receives a request from guest to perform an action.
        hostResolveAndBroadcast(p.action); // includes Ace flow & suit bonuses inside your engine
      } else {
        // Guest should not apply turns from self over net; ignore.
      }
      return;
    }

    if(p.kind==='ACE_OFFER'){
      // Target prompts: use Ace?
      const { context } = p;
      G.pendingAce = { context };
      aceText.textContent = `Opponent played ${context.for==='A7'?'a Steal (7)':'a Swap (9)'} targeting you. Use an Ace to block?`;
      aceModal.classList.add('open');
      return;
    }

    if(p.kind==='APPLY'){
      // Minimal delta or full state; we choose full state for simplicity
      if(p.state){ arcana.hydrate(p.state); arcana.render(); log('APPLY → synced'); }
      return;
    }
  }

  // Host-only: central place that enforces rules and broadcasts results.
  async function hostResolveAndBroadcast(action){
    // 7/9 need Ace handshake with target
    if(action.type==='ACTION_7' || action.type==='ACTION_9'){
      const target = (action.from==='P1' ? 'P2' : 'P1');
      if(arcana.hasAce(target)){
        // Ask target over DC
        dcSend({ kind:'ACE_OFFER', context:{ for: action.type==='ACTION_7' ? 'A7' : 'A9' } });
        const useAce = await waitForAceReply(); // resolves true/false
        if(useAce){
          arcana.spendAce(target); // mutate local state (host view)
          // Apply your Ace block + counter rules inside applyTurn (e.g., steal 1 point, cancel action)
          arcana.applyTurn({ type:'ACE_REACT', payload:{ used:true, for:action.type }, from:target });
          // Then broadcast the updated snapshot
          dcSend({ kind:'APPLY', state: arcana.serialize() });
          return;
        }
        // else fall through to resolve action normally
      }
    }

    // All other actions (including unblocked 7/9)
    arcana.applyTurn(action);       // scoring, suit bonuses (♦/♠), etc.
    dcSend({ kind:'APPLY', state: arcana.serialize() });
  }

  function waitForAceReply(){
    return new Promise((resolve)=>{
      // Reuse the modal’s yes/no handlers for guest, and auto-timeout guard if needed
      const onYes = ()=>{ cleanup(); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:true } } }); resolve(true); };
      const onNo  = ()=>{ cleanup(); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:false } } }); resolve(false); };

      // On the guest, clicking buttons sends back TURN_ACTION(ACE_REPLY).
      // On the host, we listen for that reply here:
      const prev = handlePacket;
      handlePacket = function(p){
        if(p && p.kind==='TURN_ACTION' && p.action && p.action.type==='ACE_REPLY'){
          const { use } = p.action.payload||{};
          // restore
          handlePacket = prev;
          resolve(!!use);
          return;
        }
        // pass-through for other packets
        prev(p);
      };

      function cleanup(){ /* no-op; modal is on guest */ }
    });
  }

  // ======= Local UI wiring =======
  btnUseUrl.addEventListener('click', ()=>{
    const v = signalInput.value.trim();
    G.net.url = v || G.net.url;
    // Mixed-content note: if using GitHub Pages (https), this must be wss://
    wsConnect(G.net.url);
    setStatus('Connecting to signaling…');
  });

  btnHost.addEventListener('click', ()=>{
    if(!G.net.ws || G.net.ws.readyState!==1){ wsConnect(G.net.url); setStatus('Connecting…'); setTimeout(()=>btnHost.click(), 200); return; }
    const id = randomHostId();
    wsSend({ type:'host', hostId:id }); hostIdEl.textContent = id;
  });

  btnJoin.addEventListener('click', ()=>{
    if(!G.net.ws || G.net.ws.readyState!==1){ wsConnect(G.net.url); setStatus('Connecting…'); setTimeout(()=>btnJoin.click(), 200); return; }
    const id = joinIdInput.value.trim().toUpperCase(); if(!id){ log('Enter a Host ID'); return; }
    wsSend({ type:'join', hostId:id });
  });

  btnStart.addEventListener('click', ()=>{
    if(!G.net.connected){ log('Not connected'); return; }
    if(G.net.role!=='host'){ log('Only host can start'); return; }
    dcSend({ kind:'SYNC', state: arcana.serialize() });
    log('Host sent SYNC');
  });

  btnResync.addEventListener('click', ()=>{
    if(G.net.role!=='host'){ log('Only host resyncs'); return; }
    dcSend({ kind:'SYNC', state: arcana.serialize() });
    log('Host re-synced');
  });

  // Guest Ace modal buttons (host never sees this modal)
  aceNo.addEventListener('click', ()=>{ aceModal.classList.remove('open'); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:false } } }); });
  aceYes.addEventListener('click', ()=>{ aceModal.classList.remove('open'); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:true } } }); });

  // ======= Public helpers you can call from your board code =======
  // Call this when the local player clicks something that should become a TURN.
  // Example: sendTurn({ type:'ACTION_7', from: mySide })
  window.sendTurn = function(action){
    // Guests send a TURN request to host; Host can call hostResolveAndBroadcast directly.
    if(G.net.role==='host'){ hostResolveAndBroadcast(action); }
    else { dcSend({ kind:'TURN_ACTION', action }); }
  };

  // Initial
  setStatus('Idle'); enableStart(false);
})();
