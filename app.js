// app.js — P2P transport (signaling + WebRTC) with offline host fallback
(function(){
  const $ = (id)=>document.getElementById(id);
  const statusEl=$('status'), logEl=$('log');
  const signalInput=$('signalUrl'), btnUseUrl=$('btnUseUrl');
  const btnHost=$('btnHost'), btnJoin=$('btnJoin'), hostIdEl=$('hostId'), joinIdInput=$('joinId');
  const btnStart=$('btnStart'), btnResync=$('btnResync');

  function log(...a){ const d=document.createElement('div'); d.textContent=a.join(' '); logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; console.log('[LOG]',...a); }
  function setStatus(t,cls){ statusEl.textContent=t; statusEl.className='pill'+(cls?' '+cls:''); }
  function enableStart(b){ btnStart.disabled=!b; btnResync.disabled=!b; }

  const G={ net:{ ws:null, url:'wss://arcana-signal.onrender.com', role:null, hostId:null, pc:null, dc:null, connected:false } };
  signalInput.value = G.net.url;

  // Offline host fallback so single-tab testing works
  window.sendTurn = function(action){
    if (G.net.role==='host' && (!G.net.connected || !G.net.dc)) {
      window.arcana.applyTurn(action); window.arcana.render(); return;
    }
    if (G.net.role==='host') hostResolveAndBroadcast(action);
    else dcSend({ kind:'TURN_ACTION', action });
  };

  // Wait for engine
  document.addEventListener('arcana:ready', ()=>{ setStatus('Engine ready'); });

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
      if(msg.type==='host-ok'){ G.net.role='host'; G.net.hostId=msg.hostId; hostIdEl.textContent=msg.hostId; if(window.arcana_setRole) window.arcana_setRole('host'); await hostCreatePeerAndOffer(); setStatus('Host ready. Share ID.','ok'); return; }
      if(msg.type==='join-ok'){ G.net.role='guest'; G.net.hostId=msg.hostId; if(window.arcana_setRole) window.arcana_setRole('guest'); setStatus('Found host. Setting up…'); return; }
      if(msg.type==='guest-joined' && G.net.role==='host'){ try{ const offer=await G.net.pc.createOffer(); await G.net.pc.setLocalDescription(offer); wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:G.net.pc.localDescription}});}catch(e){log('re-offer err',e);} return; }
      if(msg.type==='signal' && msg.hostId===G.net.hostId && msg.payload){ await onSignal(msg.payload); return; }
    };
  }

  function attachPeerLogs(pc,label){
    pc.oniceconnectionstatechange=()=>log('[ICE]',label,pc.iceConnectionState);
    pc.onconnectionstatechange   =()=>log('[PC]',label,pc.connectionState);
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
      // optional baseline sync; host will start game explicitly
      if(G.net.role==='host'){ dcSend({kind:'SYNC', state:window.arcana.serialize()}); }
    };
    dc.onclose= ()=>{ log('[DC] close'); G.net.connected=false; setStatus('Disconnected','bad'); enableStart(false); };
    dc.onmessage=(e)=>{ let o={}; try{o=JSON.parse(e.data||'{}');}catch{return;} handlePacket(o); };
  }
  async function onSignal(payload){
    if(payload.sdp){
      if(payload.sdp.type==='offer'){
        const pc=await guestEnsurePeer(); await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
        wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:pc.localDescription}}); log('Guest sent answer');
      } else if(payload.sdp.type==='answer'){ if(!G.net.pc) return; await G.net.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)); log('Host applied answer'); }
    } else if(payload.ice){
      if(!G.net.pc) await guestEnsurePeer();
      try{ await G.net.pc.addIceCandidate(new RTCIceCandidate(payload.ice)); }catch(e){ log('ICE add err', e); }
    }
  }

  // Packets
  function handlePacket(p){
    if(!p||typeof p!=='object')return;

    if(p.kind==='SYNC'){
      if (p.state) { window.arcana.hydrate(p.state); window.arcana.render(); }
      log('RX SYNC ✓'); return;
    }
    if(p.kind==='APPLY'){
      if(p.state){ window.arcana.hydrate(p.state); window.arcana.render(); log('APPLY → synced'); }
      return;
    }
    if(p.kind==='TURN_ACTION'){
      if(G.net.role==='host'){ hostResolveAndBroadcast(p.action); }
      return;
    }

    // Ace handshake (guest UI)
    if(p.kind==='ACE_OFFER'){
      const aceModal = document.getElementById('aceModal');
      const aceText  = document.getElementById('aceText');
      const aceNo    = document.getElementById('aceNo');
      const aceYes   = document.getElementById('aceYes');
      aceText.textContent = `Opponent played ${p.context.for==='A7'?'a Steal (7)':'a Swap (9)'} targeting you. Use an Ace to block?`;
      aceModal.classList.add('open');
      const close = ()=>aceModal.classList.remove('open');
      const onNo = ()=>{ close(); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:false } } }); aceNo.removeEventListener('click', onNo); aceYes.removeEventListener('click', onYes); };
      const onYes= ()=>{ close(); dcSend({ kind:'TURN_ACTION', action:{ type:'ACE_REPLY', payload:{ use:true  } } }); aceNo.removeEventListener('click', onNo); aceYes.removeEventListener('click', onYes); };
      aceNo.addEventListener('click', onNo, { once:true });
      aceYes.addEventListener('click', onYes, { once:true });
      return;
    }
  }

  // Host resolves + broadcasts
  async function hostResolveAndBroadcast(action){
    // 7/9 Ace handshake
    if(action.type==='ACTION_7' || action.type==='ACTION_9'){
      const target = (action.from==='P1' ? 'P2' : 'P1');
      if(window.arcana.hasAce(target)){
        // ask guest (target) if they want to use Ace
        dcSend({ kind:'ACE_OFFER', context:{ for: action.type==='ACTION_7' ? 'A7' : 'A9' } });
        const useAce = await waitForAceReply();
        if(useAce){
          window.arcana.applyTurn({ type:'ACE_REACT', payload:{ used:true, for:action.type }, from:target });
          dcSend({ kind:'APPLY', state: window.arcana.serialize() });
          return;
        }
      }
    }
    window.arcana.applyTurn(action);
    dcSend({ kind:'APPLY', state: window.arcana.serialize() });
  }

  function waitForAceReply(){
    return new Promise((resolve)=>{
      // temporarily hook handlePacket to watch for ACE_REPLY
      const old = handlePacket;
      handlePacket = function(p){
        if(p && p.kind==='TURN_ACTION' && p.action && p.action.type==='ACE_REPLY'){
          const use = !!(p.action.payload && p.action.payload.use);
          handlePacket = old;
          resolve(use);
          return;
        }
        old(p);
      };
    });
  }

  // UI wiring
  btnUseUrl.addEventListener('click',()=>{ const v=signalInput.value.trim(); G.net.url=v||G.net.url; wsConnect(G.net.url); setStatus('Connecting…'); });
  btnHost.addEventListener('click',()=>{ if(!G.net.ws||G.net.ws.readyState!==1){ wsConnect(G.net.url); setTimeout(()=>btnHost.click(),200); return; } const id=randId(); wsSend({type:'host',hostId:id}); hostIdEl.textContent=id; });
  btnJoin.addEventListener('click',()=>{ if(!G.net.ws||G.net.ws.readyState!==1){ wsConnect(G.net.url); setTimeout(()=>btnJoin.click(),200); return; } const id=joinIdInput.value.trim().toUpperCase(); if(!id){log('Enter Host ID');return;} wsSend({type:'join',hostId:id}); });

  btnStart.addEventListener('click', ()=>{
    if(!G.net.connected){ log('Not connected'); return; }
    if(G.net.role!=='host'){ log('Only host can start'); return; }
    window.arcana.startNew(); // host creates real game
    dcSend({ kind:'SYNC', state: window.arcana.serialize() }); // push snapshot
    log('Host sent SYNC');
  });

  btnResync.addEventListener('click',()=>{ if(G.net.role!=='host'){log('Only host');return;} dcSend({kind:'SYNC',state:window.arcana.serialize()}); log('Host re-sync'); });

  // Small hook for game.js logs (no-op is fine)
  window.pushLog = (s)=>{};
})();