import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function fileNameFromPath(p: string): string {
  const seg = p.split(/[/\\]/).filter(Boolean);
  return seg[seg.length - 1] || 'file';
}

function extFromPath(p: string): string {
  const name = fileNameFromPath(p);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function mimeFromImageExt(ext: string): string {
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function mimeFromDocExt(ext: string): string {
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

async function pathsToImageFiles(paths: string[]): Promise<File[]> {
  const out: File[] = [];
  for (const path of paths) {
    const b64 = await invoke<string>('read_picked_file_base64', { path });
    const bytes = base64ToUint8Array(b64);
    const ext = extFromPath(path);
    const name = fileNameFromPath(path);
    const mime = mimeFromImageExt(ext);
    const blob = new Blob([bytes], { type: mime });
    out.push(new File([blob], name, { type: mime, lastModified: Date.now() }));
  }
  return out;
}

async function pathsToDocumentFiles(paths: string[]): Promise<File[]> {
  const out: File[] = [];
  for (const path of paths) {
    const b64 = await invoke<string>('read_picked_file_base64', { path });
    const bytes = base64ToUint8Array(b64);
    const ext = extFromPath(path);
    const name = fileNameFromPath(path);
    const mime = mimeFromDocExt(ext);
    const blob = new Blob([bytes], { type: mime });
    out.push(new File([blob], name, { type: mime, lastModified: Date.now() }));
  }
  return out;
}

/** Native dialog: only PNG/JPEG/GIF/WebP appear in the default filter (OS may still offer “All files”). */
export async function pickChatImagesTauri(): Promise<File[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (selected === null) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return pathsToImageFiles(paths);
}

/** Native dialog: only PDF/TXT/MD/JSON. */
export async function pickChatDocumentsTauri(): Promise<File[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json'] }],
  });
  if (selected === null) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return pathsToDocumentFiles(paths);
}
