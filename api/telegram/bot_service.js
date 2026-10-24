import { sql } from '../db.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash';

// Helper to send message to Telegram
export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing in environment.');

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parseMode || 'Markdown',
    disable_web_page_preview: true
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    
    // If Markdown parsing fails in Telegram, fallback to plain text
    if (!data.ok && payload.parse_mode) {
      delete payload.parse_mode;
      const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await retryRes.json();
    }
    return data;
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
Kamu adalah "POShere AI", Asisten Cerdas Enterprise untuk aplikasi Point of Sale (POS) POShere.
Kamu sedang berbicara langsung dengan:
- Nama: ${user.name}
- Username Telegram: @${user.telegram_username}
- Role di Sistem: ${user.role} (Super Administrator / Manajemen)

Kepribadian & Gaya Komunikasi:
1. Bersahabat, cerdas, profesional, to-the-point, dan sangat membantu layaknya manajer/analis bisnis pribadi.
2. Gunakan Bahasa Indonesia yang natural, sopan, dan luwes.
3. Selalu format angka uang dalam Rupiah (contoh: Rp 150.000).
4. Gunakan format Telegram Markdown yang rapi (bold untuk angka/poin penting, bullet points untuk daftar).
5. Jawab pertanyaan user secara akurat HANYA berdasarkan data real-time toko yang diberikan di bawah ini. Jika ada informasi yang belum ada di data toko, katakan apa adanya tanpa mengarang data palsu.
6. Berikan insight atau saran bisnis cerdas jika relevan (misalnya mengingatkan untuk restock jika produk tertentu hampir habis).
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
  return 'Maaf, saya tidak dapat memproses jawaban saat ini. Silakan coba kembali sesaat lagi.';
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
      `Halo *${firstName}*! 👋\n\nAkun Telegram Anda saat ini belum memiliki *Username* (@).\n\nAplikasi POShere Enterprise menggunakan Username Telegram untuk mengenali hak akses Anda secara otomatis.\n\n*Cara mengaktifkan:*\n1. Buka Pengaturan Telegram (Settings).\n2. Pilih *Username / Nama Pengguna*.\n3. Buat username Anda, lalu hubungi Admin toko untuk mendaftarkannya.`
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
      `Maaf @${username}, akun Telegram Anda *belum terdaftar* di sistem POShere Enterprise.\n\nSilakan hubungi Super Administrator untuk mendaftarkan username *@${username}* pada menu Manajemen Pengguna POS.`
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
    const welcomeMsg = `Halo *${user.name}* (${user.role.toUpperCase()})! 👋\n\nSelamat datang di *POShere Enterprise AI Assistant*.\n\nSaya asisten AI toko Anda yang terhubung langsung dengan database POS. Anda bisa bertanya apa saja secara bebas (*free-text*), misalnya:\n\n• _"Berapa total omset hari ini?"_\n• _"Ada produk yang stoknya mau habis?"_\n• _"Siapa kasir dengan transaksi terbanyak hari ini?"_\n• _"Produk apa yang paling laku?"_\n• _"Rangkum penjualan hari ini dong"_\n\nSilakan ketik pertanyaan Anda sekarang!`;
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
