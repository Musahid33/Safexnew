'use client';

import { useId, useRef, useState } from 'react';

/**
 * Photo attachment for a DM observation.
 *
 * A phone photo is 3–8 MB, which is too much to keep in the plan payload and too slow to
 * upload from a stockyard. The file is therefore resized and re-encoded in the browser
 * before it ever leaves the device: longest edge 1000 px, JPEG, walking the quality down
 * until the data URL fits the budget the server also enforces in `lib/dm/plan.ts`.
 */

export const PHOTO_TARGET_CHARS = 120_000;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` applies the EXIF rotation, so a portrait photo is not printed sideways.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // HEIC and friends can fail here; the <img> path below still works where the browser
      // can decode the file at all.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached.');
  }

  const source = await decode(file);
  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) throw new Error('That file could not be read as an image.');

  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, 1000 / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize the photo.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  // Quality first, then size: a 1000 px frame is usually under budget at 0.72.
  for (const quality of [0.72, 0.6, 0.48]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length <= PHOTO_TARGET_CHARS) return data;
  }

  const smaller = document.createElement('canvas');
  const shrink = 700 / longest;
  smaller.width = Math.max(1, Math.round(sourceWidth * shrink));
  smaller.height = Math.max(1, Math.round(sourceHeight * shrink));
  const smallContext = smaller.getContext('2d');
  if (!smallContext) throw new Error('This browser cannot resize the photo.');
  smallContext.fillStyle = '#fff';
  smallContext.fillRect(0, 0, smaller.width, smaller.height);
  smallContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
  const data = smaller.toDataURL('image/jpeg', 0.55);
  if (data.length > PHOTO_TARGET_CHARS) {
    throw new Error('That photo is still too large — try a different one.');
  }
  return data;
}

export type PhotoValue = string;

export function PhotoField({
  value, onChange, disabled
}: {
  value: PhotoValue;
  onChange: (value: PhotoValue) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      onChange(await compressPhoto(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That photo could not be attached.');
    } finally {
      setBusy(false);
      // Cleared so picking the same file again after removing it still fires a change.
      if (input.current) input.current.value = '';
    }
  }

  return <div className="dm-photo">
    {/*
      One input, deliberately without `capture`: the browser then shows its own sheet —
      Camera, Gallery / Files — and both are one tap away. Adding `capture="environment"`
      skips that sheet and pins the field to the camera, which is exactly how the gallery
      disappeared on Android.
    */}
    <input
      id={inputId}
      ref={input}
      type="file"
      accept="image/*"
      className="dm-photo-input"
      disabled={disabled || busy}
      onChange={(event) => void pick(event.target.files?.[0])}
    />

    {value && <div className="dm-photo-has">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL preview, not a Next image */}
      <img src={value} alt="Attached" className="dm-photo-thumb" />
    </div>}

    <div className="dm-photo-actions">
      <button
        type="button"
        className="dm-photo-add"
        title="Camera ya gallery — dono options khulenge"
        onClick={() => input.current?.click()}
        disabled={disabled || busy}
      >{busy ? '…' : value ? 'Change' : 'Photo'}</button>
      {value && <button
        type="button"
        className="dm-photo-remove"
        onClick={() => onChange('')}
        disabled={busy}
      >Remove</button>}
    </div>

    {error && <small className="dm-photo-error" role="alert">{error}</small>}
  </div>;
}
