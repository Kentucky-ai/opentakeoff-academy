document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      document.getElementById('copy-status').textContent = 'Commands copied. Replace YOUR_MODEL_ID before running.';
      setTimeout(() => { button.textContent = 'Copy commands'; }, 2000);
    } catch {
      document.getElementById('copy-status').textContent = 'Clipboard unavailable. Select and copy the commands above.';
    }
  });
});
