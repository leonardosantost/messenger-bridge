const WS_ALARM = 'ws-keepalive';

let socket = null;
let settings = { serverUrl: '', token: '' };

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['serverUrl', 'token']);
  settings = { serverUrl: stored.serverUrl || '', token: stored.token || '' };
}

function connect() {
  if (!settings.serverUrl || !settings.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

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
  if (message.type === 'incoming_message' && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
});

loadSettings().then(connect);
