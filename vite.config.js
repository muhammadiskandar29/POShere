import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

/**
 * Monolithic Server Plugin for File Uploads & Local Fallback
 * All data (Users, Products, Payment Methods, Transactions) are synchronized
 * directly with Supabase via Supabase Client & PostgreSQL.
 */
function monolithicApiPlugin() {
  const uploadsDir = path.resolve(process.cwd(), 'public/uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  function parseBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  function sendJson(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return {
    name: 'monolithic-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) {
          return next();
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        const method = req.method;

        try {
          // --- UPLOAD BASE64 IMAGE ---
          // Mengubah base64 menjadi file gambar fisik di folder public/uploads,
          // lalu mengembalikan path public URL-nya ke Supabase database
          if (pathname === '/api/upload' && method === 'POST') {
            const body = await parseBody(req);
            const { base64Data, filename } = body;
            if (!base64Data) {
              return sendJson(res, 400, { success: false, message: 'Base64 image data is required' });
            }

            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            let buffer;
            let ext = '.png';
            if (matches && matches.length === 3) {
              const mime = matches[1];
              ext = mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png';
              buffer = Buffer.from(matches[2], 'base64');
            } else {
              buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            }

            const safeName = `${Date.now()}_${(filename || 'image').replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`;
            const targetPath = path.join(uploadsDir, safeName);
            fs.writeFileSync(targetPath, buffer);

            const publicPath = `/uploads/${safeName}`;
            return sendJson(res, 200, { success: true, path: publicPath, filename: safeName });
          }

          return sendJson(res, 404, { success: false, message: 'Endpoint not found' });
        } catch (err) {
          console.error('API Error:', err);
          return sendJson(res, 500, { success: false, error: err.message });
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [monolithicApiPlugin()],
  server: {
    port: 5173,
    host: true
  }
});
