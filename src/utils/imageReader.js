import jsQR from 'jsqr';

/**
 * Membaca data gambar (bisa File, Blob, atau Base64) dan mengekstrak String QR code jika ada
 */
export async function readQrCodeFromImage(imageSource) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data) {
          resolve(code.data);
        } else {
          // Coba dengan inversion jika belum terdeteksi
          const codeInverted = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });
          if (codeInverted && codeInverted.data) {
            resolve(codeInverted.data);
          } else {
            resolve(null);
          }
        }
      } catch (err) {
        reject(err);
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
      reject(new Error('Format imageSource tidak didukung'));
    }
  });
}

/**
 * Helper untuk convert file ke base64
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
 */
export async function uploadBase64Image(base64Data, filename = 'item.png') {
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data, filename })
  });

  const resJson = await response.json();
  if (!response.ok || !resJson.success) {
    throw new Error(resJson.message || 'Upload gagal');
  }
  return resJson.path;
}
