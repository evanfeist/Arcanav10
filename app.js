// app.js — WebRTC Host/Join transport (no eval; CSP-safe)
// Uses Render signaling: wss://arcana-signal.onrender.com
// Host is rules authority. Host applies turns and broadcasts full SYNC.
// Also mirrors concise log lines to the guest.

(() => {
  const $ = (id)=>document.getElementById(id);
  const statusEl=$('status'), logEl=$('log');
  const signalInput=$('signalUrl'), btnUseUrl=$('btnUseUrl');
  const btnHost=$('btnHost'), btnJoin=$('btnJoin'), hostIdEl=$('hostId'), joinIdInput=$('joinId');
  const btnStart=$('btnStart'), btnResync=$('btnResync');

  // Ace drawer (guest)
  const aceDrawer=$('aceDrawer'), aceText=$('aceText');
  const aceClose=$('aceClose'), aceNo=$('aceNo'), aceYes=$('aceYes');

  function log(...a){ const d=document.createElement('div'); d.textContent=a.join(' '); logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; }

  const G = {
    net:{
      ws:null,
      url:'wss://arcana-signal.onrender.com',
      role:null, hostId:null,
      pc:null, dc:null,
      connected:false
    }
  };

  signalInput.value = G.net.url;

  function setStatus(t, cls){ statusEl.textContent=t; statusEl.className='pill'+(cls?' '+cls:''); }
  function enableStart(b){ btnStart.disabled=!b; btnResync.disabled=!b; }

  // Expose role to game engine (so it knows whose hand to reveal)
  function setRole(role){ G.net.role=role; window.arcana_setRole && window.arcana_setRole(role); }

  // Let game.js mirror logs to guest when host
  window.pushLog = function(text){
    if(G.net.role==='host' && G.net.connected){
      dcSend({ kind:'LOG', text });
    }
  };

  // ===== Signaling (WS) =====
  function wsSend(obj){ try{ G.net.ws && G.net.ws.readyState===1 && G.net.ws.send(JSON.stringify(obj)); }catch{} }
  function wsConnect(url){
    if(G.net.ws) try{ G.net.ws.close(); }catch{}
    G.net.ws = new WebSocket(url);
    G.net.ws.onopen = ()=>{ log('WS open', url); setStatus('Signaling connected','ok'); };
    G.net.ws.onclose= ()=>{ log('WS close'); setStatus('Signaling closed','bad'); enableStart(false); };
    G.net.ws.onerror= ()=>{ log('WS error'); setStatus('Signaling error','bad'); enableStart(false); };
    G.net.ws.onmessage = async (e)=>{
      let msg={}; try{ msg=JSON.parse(e.data||'{}'); }catch{ return; }
      if(msg.type==='host-ok'){ setRole('host'); G.net.hostId=msg.hostId; hostIdEl.textContent=msg.hostId; setStatus('Host ready. Share ID.'); await hostPeer(); return; }
      if(msg.type==='join-ok'){ setRole('guest'); G.net.hostId=msg.hostId; setStatus('Found host. Setting up…'); return; }
      if(msg.type==='guest-joined' && G.net.role==='host'){ try{ const offer=await G.net.pc.createOffer(); await G.net.pc.setLocalDescription(offer); wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:G.net.pc.localDescription}});}catch{} return; }
      if(msg.type==='signal' && msg.hostId===G.net.hostId && msg.payload){ await onSignal(msg.payload); return; }
    };
  }

  // ===== WebRTC =====
  async function hostPeer(){
    if(G.net.pc) try{ G.net.pc.close(); }catch{}
    G.net.pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    const dc = G.net.pc.createDataChannel('arcana',{ordered:true});
    hookDC(dc);
    G.net.pc.onicecandidate = (e)=>{ if(e.candidate) wsSend({type:'signal',hostId:G.net.hostId,payload:{ice:e.candidate}}); };
    const offer=await G.net.pc.createOffer(); await G.net.pc.setLocalDescription(offer);
    wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:G.net.pc.localDescription}});
    log('Host sent offer');
  }
  async function guestEnsurePeer(){
    if(G.net.pc) return G.net.pc;
    G.net.pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    G.net.pc.ondatachannel = (e)=> hookDC(e.channel);
    G.net.pc.onicecandidate = (e)=>{ if(e.candidate) wsSend({type:'signal',hostId:G.net.hostId,payload:{ice:e.candidate}}); };
    return G.net.pc;
  }
  function hookDC(dc){
    G.net.dc=dc;
    dc.onopen = ()=>{
      log('[DC] open'); setStatus('Connected','ok'); G.net.connected=true; enableStart(true);
      if(G.net.role==='host'){ dcSend({kind:'SYNC',state:window.arcana.serialize()}); }
    };
    dc.onclose= ()=>{ log('[DC] close'); setStatus('Disconnected','bad'); G.net.connected=false; enableStart(false); };
    dc.onmessage=(e)=>{ let o={}; try{o=JSON.parse(e.data||'{}');}catch{} ; handlePacket(o); };
  }
  async function onSignal(p){
    if(p.sdp){
      if(p.sdp.type==='offer'){ const pc=await guestEnsurePeer(); await pc.setRemoteDescription(new RTCSessionDescription(p.sdp)); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); wsSend({type:'signal',hostId:G.net.hostId,payload:{sdp:pc.localDescription}}); log('Guest sent answer'); }
      if(p.sdp.type==='answer'){ if(!G.net.pc) return; await G.net.pc.setRemoteDescription(new RTCSessionDescription(p.sdp)); log('Host applied answer'); }
    }else if(p.ice){ const c=new RTCIceCandidate(p.ice); if(!G.net.pc) await guestEnsurePeer(); try{ await G.net.pc.addIceCandidate(c);}catch(e){ log('ICE add error',e);} }
  }
  function dcSend(obj){ try{ G.net.dc && G.net.connected && G.net.dc.send(JSON.stringify(obj)); }catch{} }

  // ===== Packets =====
  function handlePacket(p){
    if(!p||typeof p!=='object') return;

    if(p.kind==='SYNC'){
      window.arcana.hydrate(p.state); window.arcana.render();
      // reduce SYNC spam in log for the guest
      if(G.net.role==='host') log('RX SYNC ✓');
      return;
    }

    if(p.kind==='TURN'){
      if(G.net.role==='host'){ hostResolve(p.action); }
      return;
    }

    if(p.kind==='ACE_OFFER'){
      aceText.textContent = p.context.for==='A7' ? 'Opponent played 7. Use Ace to attempt a block? (d6: 1–3 fail, 4–6 block & counter +1)' : 'Opponent played 9. Use Ace to attempt a block? (d6: 1–3 fail, 4–6 block & counter +1)';
      aceDrawer.classList.add('open');
      aceDrawer.dataset.ctx = p.context.for;
      return;
    }

    if(p.kind==='LOG'){
      const d=document.createElement('div'); d.textContent=p.text; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight;
      return;
    }
  }

  // ===== Host resolution =====
  async function hostResolve(action){
    // 7/9 can be blocked by Ace — ask target
    if(action.type==='ACTION_7' || action.type==='ACTION_9'){
      const target = (action.from==='P1')?'P2':'P1';
      if(window.arcana.hasAce(target)){
        dcSend({kind:'ACE_OFFER', context:{for: action.type==='ACTION_7'?'A7':'A9'}});
        const use = await waitForAceReply();
        if(use){
          const roll = 1+Math.floor(Math.random()*6);
          log(`Ace roll = ${roll}`);
          if(roll>=4){
            window.arcana.applyTurn({ type:'ACE_REACT', from:target, payload:{ used:true, for:action.type } });
            // mark original as blocked; applyTurn for action will respect payload.blocked
            action.payload = { ...(action.payload||{}), blocked:true };
          }
        }
      }
    }

    // Apply action and broadcast
    window.arcana.applyTurn(action);
    dcSend({kind:'SYNC', state: window.arcana.serialize()});
    window.arcana.render();
  }

  function waitForAceReply(){
    return new Promise((resolve)=>{
      const prev = handlePacket;
      handlePacket = function(p){
        if(p && p.kind==='TURN' && p.action && p.action.type==='ACE_REPLY'){
          handlePacket = prev;
          resolve(!!(p.action.payload && p.action.payload.use));
          return;
        }
        prev(p);
      };
    });
  }

  // ===== UI events =====
  btnUseUrl.addEventListener('click', ()=>{
    const v=signalInput.value.trim(); G.net.url = v || G.net.url;
    wsConnect(G.net.url); setStatus('Connecting to signaling…');
  });

  btnHost.addEventListener('click', ()=>{
    if(!G.net.ws || G.net.ws.readyState!==1){ wsConnect(G.net.url); setStatus('Connecting…'); setTimeout(()=>btnHost.click(),200); return; }
    const id = shortId(); wsSend({type:'host', hostId:id}); hostIdEl.textContent=id;
  });

  btnJoin.addEventListener('click', ()=>{
    if(!G.net.ws || G.net.ws.readyState!==1){ wsConnect(G.net.url); setStatus('Connecting…'); setTimeout(()=>btnJoin.click(),200); return; }
    const id = joinIdInput.value.trim().toUpperCase(); if(!id){ log('Enter a Host ID'); return; }
    wsSend({type:'join', hostId:id});
  });

  btnStart.addEventListener('click', ()=>{
    if(!G.net.connected){ log('Not connected'); return; }
    if(G.net.role!=='host'){ log('Only host can start'); return; }
    window.arcana.startNew();
    dcSend({kind:'SYNC', state: window.arcana.serialize()});
    window.arcana.render();
    log('Host started game (SYNC sent).');
  });

  btnResync.addEventListener('click', ()=>{
    if(G.net.role!=='host') return;
    dcSend({kind:'SYNC', state: window.arcana.serialize()});
    log('Re-synced.');
  });

  // Ace drawer buttons (guest)
  function closeAce(){ aceDrawer.classList.remove('open'); }
  aceClose.addEventListener('click', closeAce);
  aceNo.addEventListener('click', ()=>{ closeAce(); dcSend({kind:'TURN', action:{ type:'ACE_REPLY', payload:{ use:false } }}); });
  aceYes.addEventListener('click', ()=>{ closeAce(); dcSend({kind:'TURN', action:{ type:'ACE_REPLY', payload:{ use:true } }}); });

  // Public function for game.js to send a turn
  window.sendTurn = function(action){
    if(G.net.role==='host'){ hostResolve(action); }
    else { dcSend({kind:'TURN', action}); }
  };

  function shortId(){
    const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s='';
    for(let i=0;i<6;i++) s += c[Math.floor(Math.random()*c.length)];
    return s;
  }
})();