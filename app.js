// app.js — P2P transport (signaling + WebRTC) with correct Ace prompt (defender only) + guest log
(function(){
  const $ = (id)=>document.getElementById(id);
  const statusEl=$('status'), logEl=$('log');
  const signalInput=$('signalUrl'), btnUseUrl=$('btnUseUrl');
  const btnHost=$('btnHost'), btnJoin=$('btnJoin'), hostIdEl=$('hostId'), joinIdInput=$('joinId');
  const btnStart=$('btnStart'), btnResync=$('btnResync');

  // Ace drawer elements (must exist in index.html)
  const aceModal = $('aceModal');
  const aceText  = $('aceText');
  const aceNo    = $('aceNo');
  const aceYes   = $('aceYes');

  function log(...a){
    const d=document.createElement('div');
    d.textContent=a.join(' ');
    logEl.appendChild(d);
    logEl.scrollTop=logEl.scrollHeight;
    console.log('[LOG]',...a);
  }
  function setStatus(t,cls){ statusEl.textContent=t; statusEl.className='pill'+(cls?' '+cls:''); }
  function enableStart(b){ btnStart.disabled=!b; btnResync.disabled=!b; }

  const G={ net:{ ws:null, url:'wss://arcana-signal.onrender.com', role:null, hostId:null, pc:null, dc:null, connected:false } };
  signalInput.value = G.net.url;

  // Host-side waiter for guest ACE_REPLY
  let pendingAceResolve = null;

  // === Minimal offline fallback for host-only local testing ===
  window.sendTurn = function(action){
    if (G.net.role==='host' && (!G.net.connected || !G.net.dc)) {
      window.arcana.applyTurn(action); window.arcana.render(); return;
    }
    if (G.net.role==='host') hostResolveAndBroadcast(action);
    else dcSend({ kind:'TURN_ACTION', action });
  };

  // Utils
  const randId=()=>{ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; };
  const wsSend=(o)=>{ try{ G.net.ws && G.net.ws.readyState===1 && G.net.ws.send(JSON.stringify(o)); }catch{} };
  const dcSend=(o)=>{ try{ G.net.dc && G.net.connected && G.net.dc.send(JSON.stringify(o)); }catch{} };

  // Signaling
  function wsConnect(url){
    if(G.net.ws) try{G.net.ws.close();}catch{}
    G.net.ws = new WebSocket(url);
    G.net.ws.onopen = ()=>{ log('WS open', url); setStatus('Signaling connected','ok'); };
    G.net.ws.onclose= ()=>{ log('WS close'); setStatus('Signaling closed','bad'); if(!G.net.connected) enableStart(false); };
    G.net.ws.onerror= ()=>{ log('WS error'); setStatus('Signaling error','bad'); enableStart(false); };
    G.net.ws.onmessage = async (e)=>{
      let msg={}; try{ msg=JSON.parse(e.data||'{}'); }catch{ return; }

      if(msg.type==='host-ok'){
        G.net.role='host'; G.net.hostId=msg.hostId; hostIdEl.textContent=msg.hostId;
        window.arcana_setRole && window.arcana_setRole('host');
        await hostCreatePeerAndOffer();
        setStatus('Host ready. Share ID.','ok');
        return;
      }

      if(msg.type==='join-ok'){
        G.net.role='guest'; G.net.hostId=msg.hostId;
        window.arcana_setRole && window.arcana_setRole('guest');
        // Guest-only: pipe game.js logs to this tab
        window.pushLog = (s)=>{
          const d=document.createElement('div');
          d.textContent = s;
          logEl.appendChild(d);
          logEl.scrollTop = logEl.scrollHeight;
        };
        setStatus('Found host. Setting up…');
        return;
      }

      if(msg.type==='guest-joined' && G.net.role==='host'){
        try{
          const offer=await G.net.pc.createOffer();
          await G.net.pc.setLocalDescription(offer);
          wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:G.net.pc.localDescription}});
        }catch(e){ log('re-offer err',e); }
        return;
      }

      if(msg.type==='signal' && msg.hostId===G.net.hostId && msg.payload){
        await onSignal(msg.payload);
        return;
      }
    };
  }

  function attachPeerLogs(pc,label){
    pc.oniceconnectionstatechange=()=>log('[ICE]',label,pc.iceConnectionState);
    pc.onconnectionstatechange   =()=>log('[PC]', label,pc.connectionState);
  }

  async function hostCreatePeerAndOffer(){
    if(G.net.pc) try{G.net.pc.close();}catch{}
    G.net.pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    attachPeerLogs(G.net.pc,'HOST');
    const dc = G.net.pc.createDataChannel('arcana',{ ordered:true });
    hookDC(dc);
    G.net.pc.onicecandidate=(e)=>{ if(e.candidate) wsSend({type:'signal',hostId:G.net.hostId,payload:{ice:e.candidate}}); };
    const offer=await G.net.pc.createOffer(); await G.net.pc.setLocalDescription(offer);
    wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:G.net.pc.localDescription}}); log('Host sent offer');
  }

  async function guestEnsurePeer(){
    if(G.net.pc) return G.net.pc;
    G.net.pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    attachPeerLogs(G.net.pc,'GUEST');
    G.net.pc.ondatachannel=(ev)=>hookDC(ev.channel);
    G.net.pc.onicecandidate=(e)=>{ if(e.candidate) wsSend({type:'signal',hostId:G.net.hostId,payload:{ice:e.candidate}}); };
    return G.net.pc;
  }

  function hookDC(dc){
    G.net.dc=dc;
    dc.onopen = ()=>{
      log('[DC] open'); G.net.connected=true; setStatus('Connected','ok'); enableStart(true);
      if(G.net.role==='host'){ dcSend({kind:'SYNC', state:window.arcana.serialize()}); }
    };
    dc.onclose= ()=>{ log('[DC] close'); G.net.connected=false; setStatus('Disconnected','bad'); enableStart(false); };
    dc.onmessage=(e)=>{ let o={}; try{o=JSON.parse(e.data||'{}');}catch{return;} handlePacket(o); };
  }

  async function onSignal(payload){
    if(payload.sdp){
      if(payload.sdp.type==='offer'){
        const pc=await guestEnsurePeer();
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
        wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:pc.localDescription}}); log('Guest sent answer');
      } else if(payload.sdp.type==='answer'){
        if(!G.net.pc) return;
        await G.net.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        log('Host applied answer');
      }
    } else if(payload.ice){
      if(!G.net.pc) await guestEnsurePeer();
      try{ await G.net.pc.addIceCandidate(new RTCIceCandidate(payload.ice)); }catch(e){ log('ICE add err', e); }
    }
  }

  // Packets
  function handlePacket(p){
    if(!p||typeof p!=='object')return;

    // Full sync
    if(p.kind==='SYNC'){
      if (p.state) { window.arcana.hydrate(p.state); window.arcana.render(); }
      log('RX SYNC ✓');
      return;
    }

    // Host -> Guest: show Ace modal to *guest defender only*
    if(p.kind==='ACE_OFFER'){
      if (G.net.role !== 'guest') return; // guard: host should never open this from packet
      aceText.textContent = (p.context && p.context.for==='A9')
        ? 'Opponent played a Swap (9) targeting you. Use an Ace to block?'
        : 'Opponent played a Steal (7) targeting you. Use an Ace to block?';
      aceModal.classList.add('open');

      // Reset handlers to avoid stacking
      aceYes.replaceWith(aceYes.cloneNode(true));
      aceNo.replaceWith(aceNo.cloneNode(true));
      const _yes = document.getElementById('aceYes');
      const _no  = document.getElementById('aceNo');
      const sendReply = (use)=>{
        aceModal.classList.remove('open');
        dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use } } });
      };
      _yes.addEventListener('click', ()=>sendReply(true),  { once:true });
      _no .addEventListener('click', ()=>sendReply(false), { once:true });
      return;
    }

    // State apply
    if(p.kind==='APPLY'){
      if(p.state){ window.arcana.hydrate(p.state); window.arcana.render(); log('APPLY → synced'); }
      return;
    }

    // Guest → Host: turn request (or ACE_REPLY)
    if(p.kind==='TURN_ACTION'){
      if(G.net.role==='host'){
        if(p.action && p.action.type==='ACE_REPLY' && typeof pendingAceResolve === 'function'){
          const { use=false } = (p.action.payload||{});
          pendingAceResolve(use);
          pendingAceResolve = null;
          return;
        }
        hostResolveAndBroadcast(p.action);
      }
      return;
    }
  }

  // Helper: show Ace modal locally (host is the defender)
  function promptAceLocal(forWhat){
    return new Promise((resolve)=>{
      aceText.textContent = (forWhat==='A9')
        ? 'Opponent played a Swap (9) targeting you. Use an Ace to block?'
        : 'Opponent played a Steal (7) targeting you. Use an Ace to block?';
      aceModal.classList.add('open');

      aceYes.replaceWith(aceYes.cloneNode(true));
      aceNo.replaceWith(aceNo.cloneNode(true));
      const _yes = document.getElementById('aceYes');
      const _no  = document.getElementById('aceNo');

      const cleanup = ()=>{ aceModal.classList.remove('open'); };
      _yes.addEventListener('click', ()=>{ cleanup(); resolve(true); }, { once:true });
      _no .addEventListener('click', ()=>{ cleanup(); resolve(false); }, { once:true });
    });
  }

  // Host authority: resolve action, including Ace handshake on 7/9
  function hostResolveAndBroadcast(action){
    if(action && (action.type==='ACTION_7' || action.type==='ACTION_9')){
      const actor = (action.from==='P1') ? 'P1' : 'P2';
      const target = (actor==='P1') ? 'P2' : 'P1';
      const forTag = (action.type==='ACTION_9' ? 'A9' : 'A7');

      if(window.arcana.hasAce(target)){
        if (target === 'P2') {
          // Defender is GUEST → ask guest via packet
          dcSend({ kind:'ACE_OFFER', context:{ for: forTag } });
          new Promise((resolve)=>{ pendingAceResolve = resolve; })
          .then((useAce)=>{
            if(useAce){
              window.arcana.applyTurn({ type:'ACE_REACT', from: target, payload:{ used:true, for: action.type } });
              dcSend({ kind:'APPLY', state: window.arcana.serialize() });
              return;
            }
            window.arcana.applyTurn(action);
            dcSend({ kind:'APPLY', state: window.arcana.serialize() });
          });
          return; // wait for guest reply
        } else {
          // Defender is HOST → open local modal (no packet)
          promptAceLocal(forTag).then((useAce)=>{
            if(useAce){
              window.arcana.applyTurn({ type:'ACE_REACT', from: target, payload:{ used:true, for: action.type } });
              dcSend({ kind:'APPLY', state: window.arcana.serialize() });
              return;
            }
            window.arcana.applyTurn(action);
            dcSend({ kind:'APPLY', state: window.arcana.serialize() });
          });
          return; // wait for local choice
        }
      }

      // No Ace; resolve immediately
      window.arcana.applyTurn(action);
      dcSend({ kind:'APPLY', state: window.arcana.serialize() });
      return;
    }

    // Everything else
    window.arcana.applyTurn(action);
    dcSend({ kind:'APPLY', state: window.arcana.serialize() });
  }

  // UI wiring
  btnUseUrl.addEventListener('click',()=>{ const v=signalInput.value.trim(); G.net.url=v||G.net.url; wsConnect(G.net.url); setStatus('Connecting…'); });
  btnHost.addEventListener('click',()=>{ if(!G.net.ws||G.net.ws.readyState!==1){ wsConnect(G.net.url); setTimeout(()=>btnHost.click(),200); return; } const id=randId(); wsSend({type:'host',hostId:id}); hostIdEl.textContent=id; });
  btnJoin.addEventListener('click',()=>{ if(!G.net.ws||G.net.ws.readyState!==1){ wsConnect(G.net.url); setTimeout(()=>btnJoin.click(),200); return; } const id=joinIdInput.value.trim().toUpperCase(); if(!id){log('Enter Host ID');return;} wsSend({type:'join',hostId:id}); });
  btnStart.addEventListener('click', ()=>{
    if(!G.net.connected){ log('Not connected'); return; }
    if(G.net.role!=='host'){ log('Only host can start'); return; }
    window.arcana.startNew();
    dcSend({ kind:'SYNC', state: window.arcana.serialize() });
    log('Host sent SYNC');
  });
  btnResync.addEventListener('click',()=>{ if(G.net.role!=='host'){log('Only host');return;} dcSend({kind:'SYNC',state:window.arcana.serialize()}); log('Host re-sync'); });

  // Let game.js announce readiness if it wants; not required
  document.addEventListener('arcana:ready', ()=> setStatus('Engine ready'));
})();