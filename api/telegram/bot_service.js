import { sql } from '../db.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash';

function sanitizeReply(text) {
  if (!text) return '';
  return text
    .replace(/\*\s*\*/g, '-')
    .replace(/\*+/g, '')
    .replace(/_+/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

// Helper to send message to Telegram
export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing in environment.');

  const clean = options.raw ? text : sanitizeReply(text);
  const payload = {
    chat_id: chatId,
    text: clean,
    disable_web_page_preview: true
  };

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('sendTelegramMessage error:', err);
  }
}

// Helper to show typing status
export async function sendChatAction(chatId, action = 'typing') {
  const token = TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action })
    });
  } catch (e) {
    // ignore
  }
}

// Fetch live store statistics and context from Neon DB
export async function getStoreContext(user) {
  try {
    const isSuperAdmin = user.role === 'super_admin';
    const tenantFilter = !isSuperAdmin && user.tenant_id ? user.tenant_id : null;

    // Fetch Tenants info
    const tenants = await sql`SELECT id, name FROM tenants ORDER BY created_at ASC;`;

    // Fetch Products (low stock and general)
    let lowStockProducts = [];
    let totalProductsCount = 0;
    if (tenantFilter) {
      lowStockProducts = await sql`
        SELECT name, stock, price, sku 
        FROM products 
        WHERE tenant_id = ${tenantFilter} AND is_active = true AND stock <= 10
        ORDER BY stock ASC LIMIT 15;
      `;
      const pCount = await sql`SELECT count(*) FROM products WHERE tenant_id = ${tenantFilter};`;
      totalProductsCount = Number(pCount[0]?.count || 0);
    } else {
      lowStockProducts = await sql`
        SELECT p.name, p.stock, p.price, p.sku, t.name as tenant_name
        FROM products p
        LEFT JOIN tenants t ON p.tenant_id = t.id
        WHERE p.is_active = true AND p.stock <= 10
        ORDER BY p.stock ASC LIMIT 15;
      `;
      const pCount = await sql`SELECT count(*) FROM products;`;
      totalProductsCount = Number(pCount[0]?.count || 0);
    }

    // Fetch Recent Transactions (last 30 transactions)
    let recentTrx = [];
    if (tenantFilter) {
      recentTrx = await sql`
        SELECT invoice_number, cashier_name, payment_method_name, status, grand_total, items, created_at
        FROM transactions
        WHERE tenant_id = ${tenantFilter}
        ORDER BY created_at DESC LIMIT 30;
      `;
    } else {
      recentTrx = await sql`
        SELECT t.invoice_number, t.cashier_name, t.payment_method_name, t.status, t.grand_total, t.items, t.created_at, ten.name as tenant_name
        FROM transactions t
        LEFT JOIN tenants ten ON t.tenant_id = ten.id
        ORDER BY t.created_at DESC LIMIT 30;
      `;
    }

    // Calculate Today's metrics (Asia/Jakarta timezone)
    const nowJakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const todayStr = nowJakarta.toISOString().split('T')[0];

    let todayTrxCount = 0;
    let todaySuccessTrxCount = 0;
    let todayCancelledTrxCount = 0;
    let todayTotalSales = 0;
    const paymentBreakdown = {};
    const cashierBreakdown = {};
    const itemSalesCount = {};

    recentTrx.forEach(trx => {
      const trxDate = new Date(trx.created_at).toISOString().split('T')[0];
      const isToday = (trxDate === todayStr);
      const isCancelled = (trx.status === 'dibatalkan' || trx.status === 'cancelled');

      if (isToday) {
        todayTrxCount++;
        if (isCancelled) {
          todayCancelledTrxCount++;
        } else {
          todaySuccessTrxCount++;
          const val = Number(trx.grand_total) || 0;
          todayTotalSales += val;

          // Payment method
          const pm = trx.payment_method_name || 'Lainnya';
          paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + val;

          // Cashier
          const cName = trx.cashier_name || 'Kasir';
          cashierBreakdown[cName] = (cashierBreakdown[cName] || 0) + 1;

          // Items
          if (Array.isArray(trx.items)) {
            trx.items.forEach(it => {
              const iName = it.name || 'Produk';
              const qty = Number(it.qty) || 1;
              itemSalesCount[iName] = (itemSalesCount[iName] || 0) + qty;
            });
          }
        }
      }
    });

    const topItems = Object.entries(itemSalesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => `${name} (${qty} terjual)`);

    return {
      tenants: tenants.map(t => t.name).join(', '),
      todayStr,
      todayTrxCount,
      todaySuccessTrxCount,
      todayCancelledTrxCount,
      todayTotalSales,
      paymentBreakdown,
      cashierBreakdown,
      topItems,
      totalProductsCount,
      lowStockProducts: lowStockProducts.map(p => `- ${p.name}: stok sisa ${p.stock} (Rp ${Number(p.price).toLocaleString('id-ID')})${p.tenant_name ? ` [${p.tenant_name}]` : ''}`)
    };
  } catch (err) {
    console.error('getStoreContext error:', err);
    return null;
  }
}

// Generate intelligent AI response via Gemini
export async function askGemini(user, storeContext, question) {
  const apiKey = GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in .env.');

  const storeInfoText = storeContext ? `
[DATA REAL-TIME TOKO POSHERE]
- Tanggal Hari Ini (WIB): ${storeContext.todayStr}
- Cabang/Tenant Toko: ${storeContext.tenants || 'POShere Flagship Store'}
- Total Transaksi Hari Ini: ${storeContext.todayTrxCount} (${storeContext.todaySuccessTrxCount} Berhasil, ${storeContext.todayCancelledTrxCount} Dibatalkan)
- Total Omset / Penjualan Sukses Hari Ini: Rp ${storeContext.todayTotalSales.toLocaleString('id-ID')}
- Metode Pembayaran Hari Ini: ${Object.entries(storeContext.paymentBreakdown).map(([k, v]) => `${k}: Rp ${Number(v).toLocaleString('id-ID')}`).join(', ') || 'Belum ada transaksi sukses'}
- Transaksi per Kasir: ${Object.entries(storeContext.cashierBreakdown).map(([k, v]) => `${k}: ${v} transaksi`).join(', ') || 'Belum ada transaksi hari ini'}
- Produk Terlaris Hari Ini: ${storeContext.topItems.join(', ') || 'Belum ada item terjual hari ini'}
- Total Katalog Produk: ${storeContext.totalProductsCount} produk
- Daftar Produk Menipis (Stok <= 10):
${storeContext.lowStockProducts.length > 0 ? storeContext.lowStockProducts.join('\n') : 'Semua stok produk saat ini aman (di atas 10 unit)'}
` : 'Data real-time saat ini sedang dimuat ulang.';

  const systemInstruction = `
Kamu adalah asisten bisnis eksekutif untuk sistem kasir POShere.
Lawan bicaramu adalah pimpinan/manajemen toko (@${user.telegram_username}).

ATURAN FORMAT & KOMUNIKASI (SANGAT KETAT):
1. LANGSUNG KE INTI:
   - Jawab secara spesifik apa yang ditanyakan saja.
   - DILARANG mengulang salam pembuka/formal (seperti "Halo, Super Administrator!", "Senang bisa membantu Anda kembali", dll).
   - DILARANG membuat kalimat penutup basa-basi (seperti "Ada hal lain yang ingin saya bantu?", "Apakah ada yang ingin dianalisis?").
   - DILARANG memberi paragraf opini atau "Insight Bisnis" panjang jika pengguna hanya menanyakan data atau angka ringkas.

2. MINIMALIS DAN BERSIH (BEBAS DARI SIMBOL ANEH):
   - DILARANG KERAS menggunakan simbol bintang (*) atau garis bawah (_) untuk cetak tebal maupun daftar.
   - HINDARI karakter bertumpuk seperti "* *Teks:* *Angka*".
   - Untuk daftar, gunakan tanda strip (-) sederhana.
   - Format angka uang selalu: Rp 50.000 (dengan titik pemisah ribuan).
   - Buat format yang rapi, padat, dan mudah dibaca cepat di layar ponsel.

3. CONTOH FORMAT YANG BENAR:

   Jika ditanya penjualan/omset:
   Penjualan Hari Ini:
   - Omset: Rp 50.000 (1 transaksi berhasil)
   - Dibatalkan: 2 transaksi
   - Pembayaran: QRIS (Rp 50.000)
   - Kasir: Ria Iskandar
   - Produk Terjual: Mawar Merah (1), Mawar Putih (1)

   Jika ditanya stok barang:
   Status Stok:
   - Semua produk aman di atas 10 unit.

   Jika ditanya kasir:
   Aktivitas Kasir Hari Ini:
   - Ria Iskandar: 1 transaksi berhasil (Rp 50.000)
`;

  const payload = {
    contents: [
      {
        parts: [
          { text: `${systemInstruction}\n\n${storeInfoText}\n\n[PERTANYAAN PENGGUNA]:\n${question}` }
        ]
      }
    ]
  };

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      if (data.error) {
        lastError = new Error(`[${model}] ${data.error.message || 'Error'}`);
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return 'Maaf, saya tidak dapat memproses data saat ini. Silakan coba sesaat lagi.';
}

// Master handler for any incoming Telegram update
export async function handleTelegramUpdate(update) {
  const message = update?.message || update?.edited_message;
  if (!message || !message.chat) return { status: 'skipped', reason: 'no message' };

  const chatId = message.chat.id;
  const rawText = (message.text || '').trim();
  const username = message.from?.username;
  const firstName = message.from?.first_name || 'Teman';

  // 1. Check if user has a Telegram username
  if (!username) {
    await sendTelegramMessage(chatId, 
      `Halo ${firstName},\n\nAkun Telegram Anda belum memiliki Username (@).\n\nPOShere mengenali hak akses Anda melalui Username Telegram.\n\nCara mengaktifkan:\n1. Buka Pengaturan Telegram (Settings)\n2. Pilih Username / Nama Pengguna\n3. Buat username, lalu daftarkan ke Admin toko.`
    );
    return { status: 'rejected', reason: 'no_username' };
  }

  // 2. Query Neon DB for user with this telegram_username
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const matchedUsers = await sql`
    SELECT id, username, name, role, email, status, tenant_id, telegram_chat_id
    FROM users 
    WHERE LOWER(telegram_username) = ${cleanUsername};
  `;

  if (matchedUsers.length === 0) {
    await sendTelegramMessage(chatId, 
      `Maaf @${username}, akun Telegram Anda belum terdaftar di sistem POShere.\n\nSilakan hubungi Administrator untuk mendaftarkan username @${username}.`
    );
    return { status: 'unauthorized', username };
  }

  const user = matchedUsers[0];

  // 3. Update telegram_chat_id if not saved or changed
  if (!user.telegram_chat_id || String(user.telegram_chat_id) !== String(chatId)) {
    try {
      await sql`UPDATE users SET telegram_chat_id = ${chatId} WHERE id = ${user.id};`;
    } catch (e) {
      console.warn('Failed to update telegram_chat_id:', e.message);
    }
  }

  // 4. Handle /start command
  if (rawText.toLowerCase() === '/start') {
    const welcomeMsg = `Halo! POShere Assistant siap membantu.\n\nSistem toko sudah terhubung secara real-time. Anda bisa langsung menanyakan penjualan hari ini, cek stok barang, atau aktivitas kasir.`;
    await sendTelegramMessage(chatId, welcomeMsg);
    return { status: 'started', username };
  }

  // 5. Send typing indicator while querying and generating AI response
  await sendChatAction(chatId, 'typing');

  try {
    // 6. Gather store context
    const storeContext = await getStoreContext(user);

    // 7. Ask Gemini AI
    const replyText = await askGemini(user, storeContext, rawText);

    // 8. Reply to Telegram
    await sendTelegramMessage(chatId, replyText);
    return { status: 'answered', username, query: rawText };
  } catch (err) {
    console.error('Error generating AI response:', err);
    await sendTelegramMessage(chatId, `Maaf, terjadi kendala saat memproses pertanyaan Anda: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}
