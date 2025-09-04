// app.js — P2P transport + UI plumbing (guards for arcana readiness)

(function () {
  // ===== DOM =====
  var $ = function (id) { return document.getElementById(id); };
  var statusEl   = $('status');
  var logEl      = $('log');
  var signalInput= $('signalUrl');
  var btnUseUrl  = $('btnUseUrl');
  var btnHost    = $('btnHost');
  var btnJoin    = $('btnJoin');
  var hostIdEl   = $('hostId');
  var joinIdInput= $('joinId');
  var btnStart   = $('btnStart');
  var btnResync  = $('btnResync');

  var aceModal = $('aceDrawer'); // your UI already has this
  var aceText  = $('aceText');
  var aceNo    = $('aceNo');
  var aceYes   = $('aceYes');

  function log() {
    var d = document.createElement('div');
    d.textContent = Array.prototype.join.call(arguments, ' ');
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    try { console.log('[LOG]', Array.prototype.slice.call(arguments)); } catch (e) {}
  }
  function setStatus(t, cls) {
    statusEl.textContent = t;
    statusEl.className = 'pill' + (cls ? (' ' + cls) : '');
  }
  function enableStart(b) {
    btnStart.disabled  = !b;
    btnResync.disabled = !b;
  }

  // ===== arcana readiness (wait) =====
  function arcanaReady() {
    return !!(window.arcana && typeof window.arcana.serialize === 'function' && typeof window.arcana.startNew === 'function');
  }
  function whenArcanaReady(cb) {
    if (arcanaReady()) return cb();
    var once = function () {
      if (arcanaReady()) { document.removeEventListener('arcana:ready', once); cb(); }
    };
    document.addEventListener('arcana:ready', once);
  }

  // ===== Net state =====
  var G = {
    net: {
      ws: null,
      url: 'wss://arcana-signal.onrender.com',
      role: null,       // 'host' | 'guest'
      hostId: null,
      pc: null,
      dc: null,
      connected: false
    }
  };

  // ===== Utils =====
  function randomHostId() {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function wsSend(obj) {
    try { if (G.net.ws && G.net.ws.readyState === 1) G.net.ws.send(JSON.stringify(obj)); } catch (e) {}
  }
  function dcSend(obj) {
    try { if (G.net.dc && G.net.connected) G.net.dc.send(JSON.stringify(obj)); } catch (e) {}
  }

  // ===== WebSocket signaling =====
  function wsConnect(url) {
    if (G.net.ws) { try { G.net.ws.close(); } catch (e) {} }
    G.net.ws = new WebSocket(url);

    G.net.ws.onopen = function () {
      log('WS open', url);
      setStatus('Signaling connected', 'ok');
    };
    G.net.ws.onclose = function (ev) {
      log('WS close', 'code=' + ev.code, 'reason=' + (ev.reason || '(none)'));
      setStatus('Signaling closed', 'bad');
      if (!G.net.connected) enableStart(false);
    };
    G.net.ws.onerror = function (e) {
      log('WS error');
      setStatus('Signaling error', 'bad');
      enableStart(false);
    };
    G.net.ws.onmessage = function (e) {
      var msg = {};
      try { msg = JSON.parse(e.data || '{}'); } catch (err) { return; }

      if (msg.type === 'host-ok') {
        G.net.role = 'host';
        G.net.hostId = msg.hostId;
        hostIdEl.textContent = msg.hostId;
        setStatus('Host ready. Share ID.');
        // tell rules which side we are
        if (window.arcana_setRole) window.arcana_setRole('host');
        hostCreatePeerAndOffer();
        return;
      }
      if (msg.type === 'join-ok') {
        G.net.role = 'guest';
        G.net.hostId = msg.hostId;
        setStatus('Found host. Setting up…');
        if (window.arcana_setRole) window.arcana_setRole('guest');
        return;
      }
      if (msg.type === 'guest-joined' && G.net.role === 'host') {
        // send fresh offer in case of race
        reOffer();
        return;
      }
      if (msg.type === 'signal' && msg.hostId === G.net.hostId && msg.payload) {
        onSignal(msg.payload);
        return;
      }
      if (msg.type === 'host-left') {
        setStatus('Host left', 'bad'); G.net.connected = false; enableStart(false);
        return;
      }
      if (msg.type === 'join-error') {
        setStatus('Join error: ' + (msg.reason || ''), 'bad');
        return;
      }
    };
  }

  // ===== WebRTC =====
  function attachPeerLogs(pc, label) {
    pc.oniceconnectionstatechange = function(){ log('[ICE]', label + ':', pc.iceConnectionState); };
    pc.onconnectionstatechange    = function(){ log('[PC ]', label + ':', pc.connectionState); };
    pc.onsignalingstatechange     = function(){ log('[SIG]', label + ':', pc.signalingState); };
    pc.onicegatheringstatechange  = function(){ log('[GATH]', label + ':', pc.iceGatheringState); };
  }

  function hostCreatePeerAndOffer() {
    if (G.net.pc) { try { G.net.pc.close(); } catch (e) {} }
    G.net.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    attachPeerLogs(G.net.pc, 'HOST');

    var dc = G.net.pc.createDataChannel('arcana', { ordered: true });
    hookDC(dc);

    G.net.pc.onicecandidate = function (e) {
      if (e.candidate) wsSend({ type: 'signal', hostId: G.net.hostId, payload: { ice: e.candidate } });
    };

    G.net.pc.createOffer().then(function (offer) {
      return G.net.pc.setLocalDescription(offer).then(function () {
        wsSend({ type: 'signal', hostId: G.net.hostId, payload: { sdp: G.net.pc.localDescription } });
        log('Host sent offer');
      });
    }).catch(function (e) { log('Offer error', e && e.message); });
  }

  function reOffer() {
    if (!G.net.pc) return;
    G.net.pc.createOffer().then(function (offer) {
      return G.net.pc.setLocalDescription(offer).then(function () {
        wsSend({ type: 'signal', hostId: G.net.hostId, payload: { sdp: G.net.pc.localDescription } });
      });
    }).catch(function (e) { log('Re-offer error', e && e.message); });
  }

  function guestEnsurePeer() {
    if (G.net.pc) return Promise.resolve(G.net.pc);
    G.net.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    attachPeerLogs(G.net.pc, 'GUEST');
    G.net.pc.ondatachannel = function (ev) { hookDC(ev.channel); };
    G.net.pc.onicecandidate = function (e) {
      if (e.candidate) wsSend({ type: 'signal', hostId: G.net.hostId, payload: { ice: e.candidate } });
    };
    return Promise.resolve(G.net.pc);
  }

  function hookDC(dc) {
    G.net.dc = dc;
    dc.onopen = function () {
      log('[DC] open');
      G.net.connected = true;
      setStatus('Connected', 'ok');
      enableStart(true);
      // push SYNC only after arcana is ready
      whenArcanaReady(function () {
        dcSend({ kind: 'SYNC', state: window.arcana.serialize() });
      });
    };
    dc.onclose = function () {
      log('[DC] close');
      G.net.connected = false;
      setStatus('Disconnected', 'bad');
      enableStart(false);
    };
    dc.onmessage = function (e) {
      var obj = {};
      try { obj = JSON.parse(e.data || '{}'); } catch (err) { return; }
      handlePacket(obj);
    };
  }

  function onSignal(payload) {
    if (payload.sdp) {
      if (payload.sdp.type === 'offer') {
        guestEnsurePeer().then(function (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)).then(function () {
            return pc.createAnswer().then(function (answer) {
              return pc.setLocalDescription(answer).then(function () {
                wsSend({ type: 'signal', hostId: G.net.hostId, payload: { sdp: pc.localDescription } });
                log('Guest sent answer');
              });
            });
          });
        }).catch(function (e) { log('Guest SDP error', e && e.message); });
      } else if (payload.sdp.type === 'answer') {
        if (!G.net.pc) return;
        G.net.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)).then(function () {
          log('Host applied answer');
        }).catch(function (e) { log('Host answer error', e && e.message); });
      }
      return;
    }
    if (payload.ice) {
      if (!G.net.pc) { guestEnsurePeer(); }
      try {
        G.net.pc.addIceCandidate(new RTCIceCandidate(payload.ice));
      } catch (e) { log('ICE add error', e && e.message); }
    }
  }

  // ===== Packets =====
  function handlePacket(p) {
    if (!p || typeof p !== 'object') return;

    if (p.kind === 'SYNC') {
      whenArcanaReady(function () {
        window.arcana.hydrate(p.state);
        window.arcana.render();
        log('RX SYNC ok');
      });
      return;
    }

    if (p.kind === 'APPLY') {
      whenArcanaReady(function () {
        if (p.state) {
          window.arcana.hydrate(p.state);
          window.arcana.render();
          log('APPLY ok');
        }
      });
      return;
    }

    if (p.kind === 'TURN_ACTION') {
      // guest -> host request (host only acts)
      if (G.net.role === 'host') {
        hostResolveAndBroadcast(p.action);
      }
      return;
    }

    if (p.kind === 'ACE_OFFER') {
      // show target UI
      aceText.textContent = p.context && p.context.for === 'A9'
        ? 'Opponent played Swap (9) targeting you. Use an Ace to attempt block?'
        : 'Opponent played Steal (7) targeting you. Use an Ace to attempt block?';
      aceModal.classList.add('open');
      return;
    }
  }

  // Host-only resolver
  function hostResolveAndBroadcast(action) {
    whenArcanaReady(function () {
      if (action.type === 'ACTION_7' || action.type === 'ACTION_9') {
        var target = action.from === 'P1' ? 'P2' : 'P1';
        if (window.arcana.hasAce(target)) {
          dcSend({ kind: 'ACE_OFFER', context: { for: (action.type === 'ACTION_9' ? 'A9' : 'A7') } });
          waitForAceReply().then(function (useAce) {
            if (useAce) {
              window.arcana.applyTurn({ type: 'ACE_REACT', payload: { used: true, for: action.type }, from: target });
              dcSend({ kind: 'APPLY', state: window.arcana.serialize() });
            } else {
              window.arcana.applyTurn(action);
              dcSend({ kind: 'APPLY', state: window.arcana.serialize() });
            }
          });
          return;
        }
      }
      window.arcana.applyTurn(action);
      dcSend({ kind: 'APPLY', state: window.arcana.serialize() });
    });
  }

  function waitForAceReply() {
    return new Promise(function (resolve) {
      // temporarily hook handlePacket to catch ACE_REPLY
      var original = handlePacket;
      handlePacket = function (p) {
        if (p && p.kind === 'TURN_ACTION' && p.action && p.action.type === 'ACE_REPLY') {
          handlePacket = original;
          resolve(!!(p.action.payload && p.action.payload.use));
          return;
        }
        original(p);
      };
    });
  }

  // ===== Local UI wiring =====
  signalInput.value = G.net.url;

  btnUseUrl.addEventListener('click', function () {
    var v = (signalInput.value || '').trim();
    if (!v) v = G.net.url;
    if (!/^wss:\/\//i.test(v)) {
      if (/^https:\/\//i.test(v)) v = v.replace(/^https:\/\//i, 'wss://');
      else if (!/^[a-z]+:\/\//i.test(v)) v = 'wss://' + v;
      else { log('URL must start with wss://'); setStatus('Bad URL', 'bad'); return; }
    }
    G.net.url = v;
    log('Connecting to', v);
    setStatus('Connecting to signaling…');
    wsConnect(G.net.url);
  });

  btnHost.addEventListener('click', function () {
    if (!G.net.ws || G.net.ws.readyState !== 1) {
      wsConnect(G.net.url); setStatus('Connecting…');
      setTimeout(function(){ btnHost.click(); }, 200);
      return;
    }
    var id = randomHostId();
    wsSend({ type: 'host', hostId: id });
    hostIdEl.textContent = id;
  });

  btnJoin.addEventListener('click', function () {
    if (!G.net.ws || G.net.ws.readyState !== 1) {
      wsConnect(G.net.url); setStatus('Connecting…');
      setTimeout(function(){ btnJoin.click(); }, 200);
      return;
    }
    var id = (joinIdInput.value || '').trim().toUpperCase();
    if (!id) { log('Enter a Host ID'); return; }
    wsSend({ type: 'join', hostId: id });
  });

  btnStart.addEventListener('click', function () {
    if (!G.net.connected) { log('Not connected'); return; }
    if (G.net.role !== 'host') { log('Only host can start'); return; }
    whenArcanaReady(function () {
      // Start a fresh game on host, then push SYNC
      window.arcana.applyTurn({ type: 'START', from: 'P1' });
      dcSend({ kind: 'SYNC', state: window.arcana.serialize() });
      log('Host sent SYNC');
    });
  });

  btnResync.addEventListener('click', function () {
    if (G.net.role !== 'host') { log('Only host resyncs'); return; }
    whenArcanaReady(function () {
      dcSend({ kind: 'SYNC', state: window.arcana.serialize() });
      log('Host re-synced');
    });
  });

  // Guest Ace modal buttons
  aceNo && aceNo.addEventListener('click', function () {
    if (aceModal) aceModal.classList.remove('open');
    dcSend({ kind: 'TURN_ACTION', action: { type: 'ACE_REPLY', payload: { use: false } } });
  });
  aceYes && aceYes.addEventListener('click', function () {
    if (aceModal) aceModal.classList.remove('open');
    dcSend({ kind: 'TURN_ACTION', action: { type: 'ACE_REPLY', payload: { use: true } } });
  });

  // Auto-connect once
  (function autoConnectOnce() {
    wsConnect(G.net.url);
    setStatus('Connecting to signaling…');
  })();
})();