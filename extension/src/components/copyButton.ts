// Reusable copy-to-clipboard button. Pass a function returning the text to copy.

export function createCopyButton(getText: () => string, label = 'Copy'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'button-secondary copy-button';
  button.textContent = label;

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      button.textContent = label;
    }, 1500);
  });

  return button;
}
