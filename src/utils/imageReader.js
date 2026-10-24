import jsQR from 'jsqr';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

/**
 * Filter 1: Unsharp Mask / Sharpen Convolution
 * Sangat efektif untuk foto struk / QRIS dari kamera HP yang buram, kurang fokus, atau soft file beresolusi rendah
 */
function applySharpen(imageData) {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(data.length);
  // Kernel 3x3:
  // [  0, -1,  0 ]
  // [ -1,  5, -1 ]
  // [  0, -1,  0 ]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val =
          5 * data[idx + c] -
          data[((y - 1) * width + x) * 4 + c] -
          data[((y + 1) * width + x) * 4 + c] -
          data[(y * width + (x - 1)) * 4 + c] -
          data[(y * width + (x + 1)) * 4 + c];
        output[idx + c] = Math.min(255, Math.max(0, val));
      }
      output[idx + 3] = data[idx + 3];
    }
  }
  return new ImageData(output, width, height);
}

/**
 * Filter 2: Contrast Boost & Histogram Stretch
 * Membantu gambar QR yang pudar, kurang kontras, atau terkena bayangan lampu
 */
function applyContrastBoost(imageData) {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(data.length);

  let minLum = 255;
  let maxLum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const range = maxLum - minLum || 1;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const stretched = Math.min(255, Math.max(0, ((lum - minLum) / range) * 255));
    output[i] = stretched;
    output[i + 1] = stretched;
    output[i + 2] = stretched;
    output[i + 3] = 255;
  }
  return new ImageData(output, width, height);
}

/**
 * Filter 3: Binarization / Thresholding adaptif
 */
function applyBinarize(imageData) {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(data.length);

  let totalLum = 0;
  const pixelCount = width * height;
  for (let i = 0; i < data.length; i += 4) {
    totalLum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  const avgLum = totalLum / pixelCount;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const val = lum < avgLum * 0.95 ? 0 : 255;
    output[i] = val;
    output[i + 1] = val;
    output[i + 2] = val;
    output[i + 3] = 255;
  }
  return new ImageData(output, width, height);
}

/**
 * Scan satu canvas dengan jsQR melalui multi-pass (asli, kontras, pertajam, binarisasi)
 */
function tryScanCanvasWithJsQr(canvas, ctx) {
  if (!canvas.width || !canvas.height) return null;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 1. Raw attemptBoth
  let code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
  if (code && code.data && code.data.trim()) return code.data.trim();

  // 2. Contrast Boosted
  try {
    const contrastData = applyContrastBoost(imgData);
    code = jsQR(contrastData.data, contrastData.width, contrastData.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data && code.data.trim()) return code.data.trim();
  } catch (e) {}

  // 3. Sharpened (penajaman gambar buram / soft)
  try {
    const sharpData = applySharpen(imgData);
    code = jsQR(sharpData.data, sharpData.width, sharpData.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data && code.data.trim()) return code.data.trim();
  } catch (e) {}

  // 4. Binarized (hitam-putih tegas)
  try {
    const binData = applyBinarize(imgData);
    code = jsQR(binData.data, binData.width, binData.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data && code.data.trim()) return code.data.trim();
  } catch (e) {}

  return null;
}

/**
 * Membaca QR code dari gambar dengan format apapun (PNG, JPG, WEBP, GIF, SVG, BMP, dll.)
 * Menggunakan pipeline multi-layer:
 * 1. Hardware BarcodeDetector API (Chrome/Edge/Android native vision)
 * 2. ZXing MultiFormat Reader (industri perbankan / enterprise)
 * 3. jsQR Full Resolution
 * 4. jsQR Center Crop (khusus template poster resmi QRIS Bank seperti BCA, Mandiri, DANA, BRI, dll.)
 * 5. jsQR Downscale / Upscale & Image Enhancement (Sharpening, Auto-Levels, Binarize)
 */
export async function readQrCodeFromImage(imageSource) {
  return new Promise(async (resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = async () => {
      try {
        // --- LAYER 1: Native BarcodeDetector (Browser Built-in) ---
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(img);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              return resolve(barcodes[0].rawValue.trim());
            }
          } catch (detErr) {
            console.debug('Native BarcodeDetector pass skipped:', detErr);
          }
        }

        // --- LAYER 2: ZXing BrowserMultiFormatReader ---
        try {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const zxingReader = new BrowserMultiFormatReader(hints);
          const zxingResult = await zxingReader.decodeFromImageElement(img);
          if (zxingResult && zxingResult.getText()) {
            return resolve(zxingResult.getText().trim());
          }
        } catch (zxingErr) {
          console.debug('ZXing raw pass skipped:', zxingErr);
        }

        // --- LAYER 3: jsQR Canvas Utama (Full Resolution + Filters) ---
        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = img.naturalWidth || img.width;
        mainCanvas.height = img.naturalHeight || img.height;
        const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
        mainCtx.drawImage(img, 0, 0);

        let detected = tryScanCanvasWithJsQr(mainCanvas, mainCtx);
        if (detected) return resolve(detected);

        // --- LAYER 4: Center Crop Multi-Box ---
        // Poster cetak / soft file bank (seperti QRIS DANA/BCA/Shopee/Gojek/Mandiri)
        // memiliki QR Code di tengah poster (posisi Y 20% - 80%, X 10% - 90%)
        const cropConfigs = [
          // Crop tengah persegi (center 65%)
          { x: 0.15, y: 0.22, w: 0.70, h: 0.56 },
          // Crop tengah lebih ketat (center 50%)
          { x: 0.20, y: 0.28, w: 0.60, h: 0.48 },
          // Crop tengah lebih luas (center 80%)
          { x: 0.10, y: 0.15, w: 0.80, h: 0.70 }
        ];

        for (const crop of cropConfigs) {
          const sx = Math.floor(mainCanvas.width * crop.x);
          const sy = Math.floor(mainCanvas.height * crop.y);
          const sw = Math.floor(mainCanvas.width * crop.w);
          const sh = Math.floor(mainCanvas.height * crop.h);

          if (sw > 20 && sh > 20) {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = sw;
            cropCanvas.height = sh;
            const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
            cropCtx.drawImage(mainCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

            detected = tryScanCanvasWithJsQr(cropCanvas, cropCtx);
            if (detected) return resolve(detected);

            // Coba juga dengan ZXing pada crop canvas
            try {
              const hints = new Map();
              hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
              hints.set(DecodeHintType.TRY_HARDER, true);
              const cropZxing = new BrowserMultiFormatReader(hints);
              const res = await cropZxing.decodeFromCanvas(cropCanvas);
              if (res && res.getText()) return resolve(res.getText().trim());
            } catch (e) {}
          }
        }

        // --- LAYER 5: Downscale Rescaling (Optimal untuk foto resolusi raksasa 3000px+) ---
        const maxDims = [1000, 800, 600, 1400];
        for (const maxDim of maxDims) {
          if (mainCanvas.width > maxDim || mainCanvas.height > maxDim) {
            const scale = Math.min(maxDim / mainCanvas.width, maxDim / mainCanvas.height);
            const scaleCanvas = document.createElement('canvas');
            scaleCanvas.width = Math.floor(mainCanvas.width * scale);
            scaleCanvas.height = Math.floor(mainCanvas.height * scale);
            const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
            scaleCtx.drawImage(img, 0, 0, scaleCanvas.width, scaleCanvas.height);

            detected = tryScanCanvasWithJsQr(scaleCanvas, scaleCtx);
            if (detected) return resolve(detected);
          }
        }

        // Jika semua teknik scanning tidak mendeteksi QR
        resolve(null);
      } catch (err) {
        console.error('Error during QR decode pipeline:', err);
        resolve(null);
      }
    };

    img.onerror = (err) => reject(new Error('Gagal memuat gambar untuk scanning QR code'));

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else if (imageSource instanceof File || imageSource instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(imageSource);
    } else {
      reject(new Error('Format file gambar tidak didukung'));
    }
  });
}

/**
 * Helper untuk convert file apapun ke base64 Data URL
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Upload base64 ke monolithic API /api/upload
 * Return path publik seperti /uploads/xxx.png
 * Jika upload server gagal, fallback langsung ke base64 string agar tetap tersimpan
 */
export async function uploadBase64Image(base64Data, filename = 'item.png') {
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, filename })
    });

    const resJson = await response.json();
    if (response.ok && resJson.success && resJson.path) {
      return resJson.path;
    }
    // Fallback: simpan base64 data URL langsung jika API tidak merespons
    return base64Data;
  } catch (err) {
    console.warn('Upload API endpoint unreachable, falling back to base64 inline:', err.message);
    return base64Data;
  }
}
