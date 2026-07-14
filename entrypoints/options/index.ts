import { getConfig, setConfig } from '../../src/lib/storage';

export default defineUnlistedScript(async () => {
  const geminiInput = document.getElementById('gemini') as HTMLInputElement;
  const avInput = document.getElementById('alphavantage') as HTMLInputElement;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
  const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  // Load existing config
  const config = await getConfig();
  if (config.geminiApiKey) geminiInput.value = config.geminiApiKey;
  if (config.alphaVantageKey) avInput.value = config.alphaVantageKey;

  // Save
  saveBtn.addEventListener('click', async () => {
    const geminiKey = geminiInput.value.trim();
    const avKey = avInput.value.trim();

    if (!geminiKey || !avKey) {
      showStatus('Both API keys are required.', 'error');
      return;
    }

    await setConfig({
      geminiApiKey: geminiKey,
      alphaVantageKey: avKey,
    });

    showStatus('API keys saved successfully.', 'success');
  });

  // Clear
  clearBtn.addEventListener('click', async () => {
    geminiInput.value = '';
    avInput.value = '';
    await setConfig({});
    showStatus('API keys cleared.', 'success');
  });

  function showStatus(message: string, type: 'success' | 'error') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    setTimeout(() => {
      statusEl.className = 'status';
    }, 4000);
  }
});

