const serverUrlInput = document.getElementById('serverUrl');
const tokenInput = document.getElementById('token');
const status = document.getElementById('status');

chrome.storage.sync.get(['serverUrl', 'token'], (stored) => {
  serverUrlInput.value = stored.serverUrl || '';
  tokenInput.value = stored.token || '';
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    serverUrl: serverUrlInput.value.trim(),
    token: tokenInput.value.trim(),
  });
  status.textContent = 'Salvo. Reconectando...';
  setTimeout(() => (status.textContent = ''), 2000);
});
