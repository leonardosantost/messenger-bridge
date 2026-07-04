// ATENÇÃO: o Messenger usa classes CSS geradas/ofuscadas que mudam com frequência.
// Os seletores abaixo são um ponto de partida e muito provavelmente vão precisar
// ser ajustados inspecionando o DOM ao vivo (DevTools > Elements) na sua conta.
// Prefira sempre atributos estáveis (role, aria-label) a classes.
const SELECTORS = {
  // Confirmado inspecionando o DOM real: a lista de conversas fica dentro
  // deste landmark (role="navigation", aria-label="Lista de tópicos"). O
  // Messenger usa [role="row"] tanto ali quanto nas mensagens da conversa
  // aberta, então excluímos qualquer [role="row"] que esteja dentro desse
  // container ao procurar mensagens de verdade.
  // ATENÇÃO: aria-label é traduzido — se o Messenger estiver em outro idioma,
  // ajuste esse texto (ex: "Chats" em inglês).
  sidebarNav: '[aria-label="Lista de tópicos"]',
  unreadMarkerText: 'Mensagem não lida',
  messageRow: '[role="row"]',
  composeBox: '[role="textbox"][contenteditable="true"]',
  threadListLink: 'a[href*="/t/"]',
};

const seenMessages = new Set();

function getThreadIdFromUrl(url) {
  const match = url.match(/\/t\/(\d+)/);
  return match ? match[1] : null;
}

function currentThreadId() {
  return getThreadIdFromUrl(location.pathname);
}

function messageSignature(threadId, row) {
  return `${threadId}:${row.textContent?.slice(0, 200)}`;
}

function isOutgoing(row) {
  // Heurística: bolhas próprias geralmente ficam alinhadas à direita e/ou têm
  // aria-label começando com "You sent". Ajuste conforme o que você observar.
  const label = row.getAttribute('aria-label') || '';
  return /^you sent/i.test(label);
}

function extractText(row) {
  return row.textContent?.trim() ?? '';
}

function reportIncomingMessage(threadId, text) {
  console.log('[messenger-bridge] mensagem recebida detectada:', threadId, text);
  chrome.runtime.sendMessage({
    type: 'incoming_message',
    threadId,
    senderId: threadId,
    senderName: document.title || 'Messenger',
    text,
  });
}

function scanForNewMessages() {
  const threadId = currentThreadId();
  if (!threadId) return;

  const sidebar = document.querySelector(SELECTORS.sidebarNav);
  const rows = document.querySelectorAll(SELECTORS.messageRow);
  rows.forEach((row) => {
    if (sidebar && sidebar.contains(row)) return; // ignora prévias da lista de conversas

    const text = extractText(row);
    if (!text || isOutgoing(row)) return;

    const signature = messageSignature(threadId, row);
    if (seenMessages.has(signature)) return;
    seenMessages.add(signature);

    reportIncomingMessage(threadId, text);
  });
}

// Varre a lista de conversas por itens marcados como "não lidos" e abre o
// primeiro que não seja a conversa já aberta — assim a extensão navega
// sozinha entre conversas com mensagem nova, sem precisar de clique manual.
function openNextUnreadThread() {
  const sidebar = document.querySelector(SELECTORS.sidebarNav);
  if (!sidebar) return;

  const rows = Array.from(sidebar.querySelectorAll(SELECTORS.messageRow));
  const unreadRow = rows.find((row) => row.textContent?.includes(SELECTORS.unreadMarkerText));
  if (!unreadRow) return;

  const link = unreadRow.querySelector(SELECTORS.threadListLink);
  const href = link?.getAttribute('href') || '';
  const threadId = getThreadIdFromUrl(href);
  if (!threadId || threadId === currentThreadId()) return;

  console.log('[messenger-bridge] abrindo conversa não lida automaticamente:', threadId);
  link.click();
}

function findThreadLink(threadId) {
  return Array.from(document.querySelectorAll(SELECTORS.threadListLink)).find((link) =>
    link.getAttribute('href')?.includes(`/t/${threadId}`)
  );
}

async function ensureOnThread(threadId) {
  if (currentThreadId() === threadId) return true;

  const link = findThreadLink(threadId);
  if (link) {
    link.click();
  } else {
    location.assign(`https://www.messenger.com/t/${threadId}`);
  }

  // Espera a navegação/SPA atualizar o DOM.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (currentThreadId() === threadId) return true;
  }
  return currentThreadId() === threadId;
}

async function sendMessageToThread(threadId, text) {
  console.log('[messenger-bridge] comando send_message recebido:', threadId, text);
  const onThread = await ensureOnThread(threadId);
  if (!onThread) {
    console.error('[messenger-bridge] não foi possível abrir a thread', threadId);
    return;
  }

  const box = document.querySelector(SELECTORS.composeBox);
  if (!box) {
    console.error('[messenger-bridge] caixa de mensagem não encontrada — ajuste SELECTORS.composeBox');
    return;
  }

  box.focus();
  document.execCommand('insertText', false, text);
  box.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 100));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'send_message') {
    sendMessageToThread(message.threadId, message.text);
  }
});

const observer = new MutationObserver(() => scanForNewMessages());
observer.observe(document.body, { childList: true, subtree: true });
scanForNewMessages();

// A cada 5s, se houver conversa não lida diferente da aberta, abre ela.
// Isso permite capturar mensagens de qualquer conversa sem intervenção manual.
setInterval(openNextUnreadThread, 5000);
