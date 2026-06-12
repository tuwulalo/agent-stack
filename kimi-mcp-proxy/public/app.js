const healthText = document.querySelector('#healthText');
const modelText = document.querySelector('#modelText');
const statusDot = document.querySelector('.status-dot');
const form = document.querySelector('#chatForm');
const proxyKeyInput = document.querySelector('#proxyKey');
const promptInput = document.querySelector('#prompt');
const output = document.querySelector('#output');
const copyButton = document.querySelector('#copyButton');

async function checkHealth() {
  try {
    const response = await fetch('/health');
    const data = await response.json();

    healthText.textContent = data.ok ? 'Server online' : 'Server unavailable';
    modelText.textContent = `model: ${data.model || 'unknown'}`;
    statusDot.classList.toggle('ok', Boolean(data.ok));
  } catch {
    healthText.textContent = 'Server unavailable';
    modelText.textContent = 'model: unknown';
    statusDot.classList.remove('ok');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const prompt = promptInput.value.trim();
  const proxyKey = proxyKeyInput.value.trim();

  if (!prompt) {
    output.textContent = 'Enter a message.';
    return;
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (proxyKey) {
    headers.Authorization = `Bearer ${proxyKey}`;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  output.textContent = 'Request sent...';

  try {
    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    const data = await response.json();

    if (!response.ok) {
      output.textContent = JSON.stringify(data, null, 2);
      return;
    }

    output.textContent = data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = `Request error: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.textContent);
  copyButton.textContent = 'Copied';
  setTimeout(() => {
    copyButton.textContent = 'Copy';
  }, 1400);
});

checkHealth();
