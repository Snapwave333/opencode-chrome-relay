// Options page script for OpenCode Chrome Relay extension

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status')!;

  // Load saved settings
  try {
    const stored = await chrome.storage.local.get('nvidia_api_key');
    if (stored.nvidia_api_key) {
      apiKeyInput.value = stored.nvidia_api_key;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }

  // Save settings
  saveButton?.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    try {
      await chrome.storage.local.set({ nvidia_api_key: apiKey });
      
      statusDiv.textContent = 'Settings saved successfully!';
      statusDiv.className = 'status success';
      statusDiv.style.display = 'block';
      
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    } catch (err) {
      statusDiv.textContent = `Error saving settings: ${err}`;
      statusDiv.className = 'status error';
      statusDiv.style.display = 'block';
    }
  });
});
