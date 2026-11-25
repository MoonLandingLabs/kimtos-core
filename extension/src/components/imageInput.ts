// Reusable image input: upload, drag-and-drop, or paste an image, with a
// preview. Holds the current image and fires `change`. Mirrors audioInput.

import { createImagePanel } from './imagePanel.js';
import { formatSize } from '../lib/format.js';
import { UPLOAD } from './icons.js';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif'];

function isImageFile(file: File): boolean {
  const type = file.type || '';
  if (type.startsWith('image/')) return true;
  if (type) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

export type ImageInputData = {
  blob: Blob;
  filename: string;
};

export function createImageInput() {
  let blob: Blob | null = null;
  let filename = 'image.png';
  let objectUrl: string | null = null;

  const el = document.createElement('div');
  el.className = 'image-input';

  const dropzone = document.createElement('button');
  dropzone.type = 'button';
  dropzone.className = 'dropzone';
  dropzone.innerHTML = `
    ${UPLOAD}
    <span class="dropzone-title">Drop or paste an image, or click to browse</span>
    <span class="dropzone-hint">PNG, JPG, WEBP, GIF · ⌘/Ctrl+V to paste</span>`;

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;

  const error = document.createElement('p');
  error.className = 'app-error';
  error.hidden = true;

  const preview = document.createElement('div');
  preview.className = 'image-preview';
  preview.hidden = true;
  const meta = document.createElement('div');
  meta.className = 'image-preview-meta';
  const name = document.createElement('span');
  name.className = 'image-preview-name';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-button';
  remove.textContent = 'Remove';
  meta.append(name, remove);
  preview.append(meta);

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  function setImage(newBlob: Blob, label: string): void {
    error.hidden = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    blob = newBlob;
    filename = label;
    objectUrl = URL.createObjectURL(newBlob);
    preview.replaceChildren(createImagePanel(objectUrl), meta);
    name.textContent = newBlob.size ? `${label} · ${formatSize(newBlob.size)}` : label;
    dropzone.hidden = true;
    preview.hidden = false;
    // Only once there is a preview may the input claim the pane's spare height —
    // the dropzone on its own must stay compact (#626).
    el.classList.add('has-image');
    el.dispatchEvent(new CustomEvent('change'));
  }

  function reset(): void {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    blob = null;
    error.hidden = true;
    dropzone.hidden = false;
    preview.hidden = true;
    el.classList.remove('has-image');
    el.dispatchEvent(new CustomEvent('change'));
  }

  function handleFile(f: File): void {
    if (isImageFile(f)) setImage(f, f.name || 'image.png');
    else showError('That doesn’t look like an image. Use PNG, JPG, WEBP or GIF.');
  }

  dropzone.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) handleFile(f);
    file.value = '';
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  // Paste an image from the clipboard while this input is on screen.
  //
  // `isConnected`, not `document.body.contains(el)`: the latter asks "is it in THIS
  // page", which a popped-out app's element is not, so the check would wrongly say
  // the input is gone (#85). Only snaptext uses this today and it is not pop-out
  // capable — if that changes, the listener below must move to the app's document
  // too, or a paste inside the floating window will never reach it.
  document.addEventListener('paste', (e) => {
    if (!el.isConnected) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const f = item.getAsFile();
    if (f) setImage(f, f.name || 'pasted.png');
  });

  remove.addEventListener('click', reset);

  el.append(dropzone, file, error, preview);

  return {
    el,
    getData: (): ImageInputData | null => (blob ? { blob, filename } : null),
    onChange: (fn: () => void) => el.addEventListener('change', fn),
    reset,
  };
}
