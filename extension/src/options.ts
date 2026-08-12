/** Secenekler sayfasi: agent tokenini saklar ve backend'e ulasilip ulasilmadigini test eder. */

const tokenInput = document.getElementById('token') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const statusBox = document.getElementById('status') as HTMLDivElement;

function setStatus(message: string, ok: boolean): void {
  statusBox.textContent = message;
  statusBox.className = ok ? 'ok' : 'err';
}

void chrome.storage.local.get('agentToken').then((stored) => {
  if (typeof stored.agentToken === 'string') tokenInput.value = stored.agentToken;
});

saveButton.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (token === '') {
    setStatus('Token bos olamaz.', false);
    return;
  }

  void chrome.storage.local.set({ agentToken: token }).then(async () => {
    setStatus('Kaydedildi. Baglanti deneniyor...', true);
    try {
      // Tokenin dogrulugunu panelden teyit ediyoruz; yanlis tokenle
      // eklenti sessizce yeniden baglanma dongusune girer ve kullanici nedenini goremez.
      const response = await fetch('http://127.0.0.1:8787/api/settings/agent-token');
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { token: string };
      if (data.token === token) {
        setStatus('Token dogru. Eklenti panele baglandi.', true);
      } else {
        setStatus('Token panelde kayitli degerle uyusmuyor. Panelden yeniden kopyalayin.', false);
        return;
      }
    } catch {
      setStatus('Kaydedildi, ancak panele ulasilamadi. Sunucu calisiyor mu? (npm start)', false);
      return;
    }
    // Yeni token ile temiz bir baglanti kurulmasi icin servisi yeniden baslat.
    chrome.runtime.reload();
  });
});
