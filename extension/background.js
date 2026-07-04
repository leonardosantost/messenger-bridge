const WS_ALARM = 'ws-keepalive';

let socket = null;
let authenticated = false;
let settings = { serverUrl: '', token: '' };

// O service worker MV3 é descartado por inatividade e perde todo o estado em
// memória (inclusive o WebSocket). Quando o content script manda uma
// mensagem recebida enquanto isso acontece, guardamos aqui e reenviamos assim
// que a reconexão autenticar — sem isso a mensagem era perdida em silêncio,
// só chegando (se chegasse) no próximo alarme de reconexão, até 1min depois.
const pendingIncoming = [];

function flushPendingIncoming() {
  while (pendingIncoming.length > 0 && authenticated && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(pendingIncoming.shift()));
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['serverUrl', 'token']);
  settings = { serverUrl: stored.serverUrl || '', token: stored.token || '' };
}

function connect() {
  if (!settings.serverUrl || !settings.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  authenticated = false;
  socket = new WebSocket(settings.serverUrl);

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'auth', token: settings.token }));
  };

  socket.onmessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'auth_ok') {
      authenticated = true;
      flushPendingIncoming();
      return;
    }

    if (data.type === 'send_message') {
      const tabs = await chrome.tabs.query({ url: 'https://www.messenger.com/*' });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'send_message', threadId: data.threadId, text: data.text });
        }
      }
    }
  };

  socket.onclose = () => {
    socket = null;
    authenticated = false;
  };
  socket.onerror = () => {
    socket?.close();
  };
}

// MV3 service workers são descartados após ociosidade; usamos um alarme
// periódico (mínimo de 1 minuto) para religar o WebSocket caso ele tenha caído.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(WS_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  connect();
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WS_ALARM) {
    await loadSettings();
    connect();
  }
});

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === 'sync') {
    socket?.close();
    await loadSettings();
    connect();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'incoming_message') return;

  if (authenticated && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    pendingIncoming.push(message);
    loadSettings().then(connect); // reconecta na hora, não espera o alarme de 1min
  }
});

loadSettings().then(connect);
