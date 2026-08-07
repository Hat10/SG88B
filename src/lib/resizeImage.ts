// Downscale + re-encode an image in the browser before we upload it, so we store
// and serve small files instead of full-resolution phone photos. This cuts
// Supabase file-storage use, egress on every view, and backup size all at once.
// No dependencies — uses the browser's built-in canvas.

const MAX_DIM = 1600; // longest edge in px; plenty crisp for on-screen viewing
const QUALITY = 0.8;  // JPEG quality (0–1)

export async function resizeImage(file: File): Promise<File> {
  // Only touch raster images we can actually decode; pass anything else through.
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` honours EXIF rotation so portrait photos aren't drawn sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // couldn't decode (e.g. HEIC on some browsers) — upload original
  }

  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  // Keep the original if re-encoding didn't actually save anything (e.g. an
  // already-tiny image, or one that's smaller as PNG).
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}
