import { sql } from '../../lib/db.js';
import { canPerformAction, getRoleActionDeniedMessage } from './rbac.js';
import { executeCreateUser, executeDeleteUser } from './actions/user_actions.js';
import { executeCreateTenant, executeCreateCategory, executeDeleteCategory, executeDeleteTenant } from './actions/tenant_actions.js';
import { executeCreateTransaction, executeCancelTransaction, executeDeleteHoldOrder } from './actions/pos_actions.js';
import { executeCreateProduct, executeDeleteProduct, executeUpdateProductStock } from './actions/product_actions.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Keep last 6 message turns per chatId for conversational memory
const chatSessions = new Map();

function sanitizeReply(text) {
  if (!text) return '';
  return text
    .replace(/\*\s*\*/g, '-')
    .replace(/\*+/g, '')
    .replace(/_+/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

// Send standard text message
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

// Send photo with caption (for QRIS & receipt)
export async function sendTelegramPhoto(chatId, imageBuffer, caption = '') {
  const token = TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing in environment.');

  try {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('caption', sanitizeReply(caption));
    formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'qris.png');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (err) {
    console.error('sendTelegramPhoto error:', err);
  }
}

// Show typing indicator
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

    // Fetch Recent Transactions
    let recentTrx = [];
    if (tenantFilter) {
      recentTrx = await sql`
        SELECT t.invoice_number, t.cashier_name, t.customer_name, t.payment_method_name, t.status, t.grand_total, t.items, t.created_at, ten.name as tenant_name
        FROM transactions t
        LEFT JOIN tenants ten ON t.tenant_id = ten.id
        WHERE t.tenant_id = ${tenantFilter}
        ORDER BY t.created_at DESC LIMIT 30;
      `;
    } else {
      recentTrx = await sql`
        SELECT t.invoice_number, t.cashier_name, t.customer_name, t.payment_method_name, t.status, t.grand_total, t.items, t.created_at, ten.name as tenant_name
        FROM transactions t
        LEFT JOIN tenants ten ON t.tenant_id = ten.id
        ORDER BY t.created_at DESC LIMIT 30;
      `;
    }

    // Calculate Today's metrics (Asia/Jakarta timezone)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    let todayTrxCount = 0;
    let todaySuccessTrxCount = 0;
    let todayCancelledTrxCount = 0;
    let todayTotalSales = 0;
    const paymentBreakdown = {};
    const cashierBreakdown = {};
    const itemSalesCount = {};
    const tenantBreakdowns = {};
    const recentTrxList = [];

    recentTrx.forEach(trx => {
      const trxDateWIB = new Date(trx.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const trxTimeWIB = new Date(trx.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tName = trx.tenant_name || 'Semua Cabang';
      const isToday = (trxDateWIB === todayStr);
      const isCancelled = (trx.status === 'dibatalkan' || trx.status === 'cancelled');
      const val = Number(trx.grand_total) || 0;
      const statusLabel = isCancelled ? 'DIBATALKAN' : (trx.status === 'hold' ? 'HOLD' : 'SELESAI');

      const itemsDetail = Array.isArray(trx.items) 
        ? trx.items.map(it => `${it.name || 'Produk'} (${it.quantity || it.qty || 1}x)`).join(', ')
        : '-';

      recentTrxList.push({
        invoice: trx.invoice_number,
        wibDate: trxDateWIB,
        wibTime: trxTimeWIB,
        tenant: tName,
        cashier: trx.cashier_name || 'Kasir',
        customer: trx.customer_name || 'Pelanggan',
        status: statusLabel,
        total: val,
        payment: trx.payment_method_name || 'QRIS/Cash',
        items: itemsDetail
      });

      if (!tenantBreakdowns[tName]) {
        tenantBreakdowns[tName] = {
          todayTrxCount: 0,
          todaySuccessTrxCount: 0,
          todayCancelledTrxCount: 0,
          todayTotalSales: 0,
          paymentBreakdown: {},
          cashierBreakdown: {},
          itemSalesCount: {}
        };
      }

      if (isToday) {
        todayTrxCount++;
        tenantBreakdowns[tName].todayTrxCount++;

        if (isCancelled) {
          todayCancelledTrxCount++;
          tenantBreakdowns[tName].todayCancelledTrxCount++;
        } else {
          todaySuccessTrxCount++;
          tenantBreakdowns[tName].todaySuccessTrxCount++;

          todayTotalSales += val;
          tenantBreakdowns[tName].todayTotalSales += val;

          const pm = trx.payment_method_name || 'Lainnya';
          paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + val;
          tenantBreakdowns[tName].paymentBreakdown[pm] = (tenantBreakdowns[tName].paymentBreakdown[pm] || 0) + val;

          const cName = trx.cashier_name || 'Kasir';
          cashierBreakdown[cName] = (cashierBreakdown[cName] || 0) + 1;
          tenantBreakdowns[tName].cashierBreakdown[cName] = (tenantBreakdowns[tName].cashierBreakdown[cName] || 0) + 1;

          if (Array.isArray(trx.items)) {
            trx.items.forEach(it => {
              const iName = it.name || 'Produk';
              const qty = Number(it.quantity || it.qty || 1);
              itemSalesCount[iName] = (itemSalesCount[iName] || 0) + qty;
              tenantBreakdowns[tName].itemSalesCount[iName] = (tenantBreakdowns[tName].itemSalesCount[iName] || 0) + qty;
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
      tenantBreakdowns,
      recentTrxList,
      totalProductsCount,
      lowStockProducts: lowStockProducts.map(p => `- ${p.name}: stok sisa ${p.stock} (Rp ${Number(p.price).toLocaleString('id-ID')})${p.tenant_name ? ` [${p.tenant_name}]` : ''}`)
    };
  } catch (err) {
    console.error('getStoreContext error:', err);
    return null;
  }
}

// Gemini Tools Specification
const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'createUser',
        description: 'Membuat akun pengguna/kasir/manager baru di sistem POS. PENTING: DILARANG memanggil fungsi ini jika salah satu dari 8 parameter berikut belum terisi lengkap oleh pengguna. Jika ada yang belum diisi, tanyakan langsung ke pengguna apa data yang kurang.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nama lengkap pengguna (wajib)' },
            username: { type: 'STRING', description: 'Username login POS huruf kecil/angka (wajib)' },
            telegram_username: { type: 'STRING', description: 'Username Telegram diawali @ (wajib)' },
            role: { type: 'STRING', description: 'Role akun: kasir, manager, atau owner (wajib)' },
            tenant_name: { type: 'STRING', description: 'Nama cabang toko penempatan (wajib)' },
            pin: { type: 'STRING', description: 'PIN kasir 4-6 digit angka (wajib)' },
            email: { type: 'STRING', description: 'Alamat email aktif (wajib)' },
            phone: { type: 'STRING', description: 'Nomor HP/WhatsApp aktif (wajib)' }
          },
          required: ['name', 'username', 'telegram_username', 'role', 'tenant_name', 'pin', 'email', 'phone']
        }
      },
      {
        name: 'createTenant',
        description: 'Membuat tenant atau cabang toko baru. Khusus Super Admin.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nama tenant/cabang baru' },
            address: { type: 'STRING', description: 'Alamat lokasi toko' }
          },
          required: ['name']
        }
      },
      {
        name: 'createCategory',
        description: 'Membuat kategori produk baru di toko.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nama kategori produk' },
            tenant_name: { type: 'STRING', description: 'Nama cabang toko' }
          },
          required: ['name']
        }
      },
      {
        name: 'createProduct',
        description: 'Membuat produk baru di katalog toko POS (nama produk, harga, stok awal, kategori, dan cabang toko).',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nama produk baru' },
            price: { type: 'NUMBER', description: 'Harga jual produk' },
            stock: { type: 'NUMBER', description: 'Jumlah stok awal' },
            category_name: { type: 'STRING', description: 'Nama kategori produk (contoh: makanan, minuman, buket, dsb)' },
            tenant_name: { type: 'STRING', description: 'Nama cabang toko' },
            sku: { type: 'STRING', description: 'Kode SKU produk (opsional)' }
          },
          required: ['name', 'price']
        }
      },
      {
        name: 'createTransaction',
        description: 'Membuat transaksi kasir baru untuk pembelian produk. Jika pembayaran QRIS, sistem akan otomatis mengirimkan gambar QRIS Dinamis ke Telegram.',
        parameters: {
          type: 'OBJECT',
          properties: {
            items: {
              type: 'ARRAY',
              description: 'Daftar item belanja',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Nama produk yang dibeli' },
                  qty: { type: 'NUMBER', description: 'Jumlah item' }
                },
                required: ['name', 'qty']
              }
            },
            payment_method: { type: 'STRING', description: 'Metode bayar: qris atau cash' },
            customer_name: { type: 'STRING', description: 'Nama pelanggan' },
            tenant_name: { type: 'STRING', description: 'Nama cabang toko jika operator super admin' }
          },
          required: ['items', 'payment_method']
        }
      },
      {
        name: 'cancelTransaction',
        description: 'Membatalkan transaksi penjualan yang sudah selesai atau pending berdasarkan nomor invoice (contoh: INV-20261025-3375). Stok barang yang dibeli otomatis dikembalikan ke inventaris toko.',
        parameters: {
          type: 'OBJECT',
          properties: {
            invoice_number: { type: 'STRING', description: 'Nomor invoice transaksi (contoh: INV-20261025-3375)' },
            reason: { type: 'STRING', description: 'Alasan pembatalan transaksi' }
          },
          required: ['invoice_number']
        }
      },
      {
        name: 'deleteHoldOrder',
        description: 'Membatalkan dan menghapus pesanan hold (Open Bill) yang belum dibayar berdasarkan nomor invoice atau id transaksi.',
        parameters: {
          type: 'OBJECT',
          properties: {
            invoice_number: { type: 'STRING', description: 'Nomor invoice pesanan hold' }
          },
          required: ['invoice_number']
        }
      },
      {
        name: 'deleteUser',
        description: 'Menghapus akun kasir, manager, atau staf dari sistem berdasarkan username login POS atau username Telegram (@). Akun Super Administrator utama dilindungi.',
        parameters: {
          type: 'OBJECT',
          properties: {
            username: { type: 'STRING', description: 'Username login POS atau username Telegram diawali @' }
          },
          required: ['username']
        }
      },
      {
        name: 'deleteProduct',
        description: 'Menghapus produk dari katalog toko berdasarkan nama produk atau SKU.',
        parameters: {
          type: 'OBJECT',
          properties: {
            product_name: { type: 'STRING', description: 'Nama produk atau SKU yang ingin dihapus' }
          },
          required: ['product_name']
        }
      },
      {
        name: 'updateProductStock',
        description: 'Menambah atau mengatur ulang jumlah stok produk di etalase toko.',
        parameters: {
          type: 'OBJECT',
          properties: {
            product_name: { type: 'STRING', description: 'Nama produk yang ingin diubah stoknya' },
            quantity: { type: 'NUMBER', description: 'Jumlah unit (misal: 10)' },
            action_type: { type: 'STRING', description: 'Pilih "add" untuk menambah stok, atau "set" untuk mengatur ulang total stok. Default "add".' }
          },
          required: ['product_name', 'quantity']
        }
      },
      {
        name: 'deleteCategory',
        description: 'Menghapus kategori produk berdasarkan nama kategori.',
        parameters: {
          type: 'OBJECT',
          properties: {
            category_name: { type: 'STRING', description: 'Nama kategori yang ingin dihapus' }
          },
          required: ['category_name']
        }
      },
      {
        name: 'deleteTenant',
        description: 'Menghapus cabang atau tenant toko beserta seluruh data terkait. Khusus Super Admin.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tenant_name: { type: 'STRING', description: 'Nama cabang toko yang ingin dihapus' }
          },
          required: ['tenant_name']
        }
      }
    ]
  }
];

// Execute a tool requested by Gemini
async function handleToolExecution(operatorUser, chatId, functionCall) {
  const { name, args } = functionCall;

  if (name === 'createUser') {
    const res = await executeCreateUser(operatorUser, args);
    if (!res.success) {
      if (res.missingFields && res.missingFields.length > 0) {
        return `Data belum lengkap. Mohon lengkapi data berikut terlebih dahulu:\n${res.missingFields.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
      }
      return `Gagal membuat akun: ${res.error}`;
    }

    const u = res.user;
    return `Akun berhasil dibuat:\n- Nama: ${u.name}\n- Username POS: ${u.username}\n- Telegram: @${u.telegram_username}\n- Role: ${u.role.toUpperCase()}\n- Cabang: ${u.tenant_name}\n- PIN Kasir: ${u.pin}\n- Email: ${u.email}\n- No. HP: ${u.phone}\n- Status: Aktif`;
  }

  if (name === 'createTenant') {
    const res = await executeCreateTenant(operatorUser, args);
    if (!res.success) return `Gagal membuat tenant: ${res.error}`;
    return `Tenant baru berhasil dibuat:\n- Nama: ${res.tenant.name}\n- Alamat: ${res.tenant.address}\n- ID: ${res.tenant.id}`;
  }

  if (name === 'createCategory') {
    const res = await executeCreateCategory(operatorUser, args);
    if (!res.success) return `Gagal membuat kategori: ${res.error}`;
    return `Kategori berhasil dibuat:\n- Nama: ${res.category.name}\n- Cabang: ${res.category.tenant_name}`;
  }

  if (name === 'createProduct') {
    const res = await executeCreateProduct(operatorUser, args);
    if (!res.success) return `Gagal membuat produk: ${res.error}`;
    return `Produk baru berhasil dibuat:\n- Nama: ${res.product.name}\n- Harga: Rp ${Number(res.product.price).toLocaleString('id-ID')}\n- Stok Awal: ${res.product.stock} unit\n- Kategori: ${res.product.category_name}\n- Cabang: ${res.product.tenant_name}\n- SKU: ${res.product.sku}`;
  }

  if (name === 'createTransaction') {
    const res = await executeCreateTransaction(operatorUser, args);
    if (!res.success) return `Gagal membuat transaksi: ${res.error}`;

    const t = res.transaction;
    const itemListStr = t.items.map(it => `- ${it.qty || it.quantity}x ${it.name} (Rp ${it.subtotal.toLocaleString('id-ID')})`).join('\n');

    if (res.isQris && res.qrBuffer) {
      // Send Photo with Dynamic QRIS
      const caption = `Invoice: ${t.invoice_number}\nKasir: ${t.cashier_name}\nCabang: ${t.tenant_name}\nPelanggan: ${t.customer_name}\n\nItem Belanja:\n${itemListStr}\n\nTotal Tagihan: Rp ${t.grand_total.toLocaleString('id-ID')}\nMetode: QRIS Dinamis\nStatus: Menunggu Pembayaran\n\nSilakan scan kode QRIS di atas untuk menyelesaikan transaksi.`;
      await sendTelegramPhoto(chatId, res.qrBuffer, caption);
      return `Transaksi QRIS ${t.invoice_number} berhasil dibuat dan gambar QRIS sudah dikirimkan di atas.`;
    }

    // Cash transaction
    return `Transaksi Tunai Berhasil:\n- Invoice: ${t.invoice_number}\n- Kasir: ${t.cashier_name}\n- Cabang: ${t.tenant_name}\n- Pelanggan: ${t.customer_name}\n\nItem Belanja:\n${itemListStr}\n\nTotal Pembayaran: Rp ${t.grand_total.toLocaleString('id-ID')}\nStatus: Lunas (Selesai)`;
  }

  if (name === 'cancelTransaction') {
    const res = await executeCancelTransaction(operatorUser, args);
    if (!res.success) return `Gagal membatalkan transaksi: ${res.error}`;
    const t = res.transaction;
    return `Transaksi ${t.invoice_number} berhasil DIBATALKAN:\n- Pelanggan: ${t.customer_name || 'Pelanggan'}\n- Nilai Transaksi: Rp ${Number(t.grand_total).toLocaleString('id-ID')}\n- Stok produk yang dikembalikan: ${t.restoredItems.join(', ') || 'Tidak ada stok'}\n- Status: Dibatalkan (Stok barang telah dipulihkan ke etalase toko)`;
  }

  if (name === 'deleteHoldOrder') {
    const res = await executeDeleteHoldOrder(operatorUser, args);
    if (!res.success) return `Gagal menghapus pesanan hold: ${res.error}`;
    return `Pesanan hold (Open Bill) ${res.invoice_number} (Rp ${Number(res.grand_total).toLocaleString('id-ID')}) berhasil dibatalkan dan dihapus permanen dari sistem.`;
  }

  if (name === 'deleteUser') {
    const res = await executeDeleteUser(operatorUser, args);
    if (!res.success) return `Gagal menghapus user: ${res.error}`;
    return `Pengguna ${res.user.name} (@${res.user.telegram_username || res.user.username}) dengan role ${res.user.role.toUpperCase()} berhasil dihapus dari sistem.`;
  }

  if (name === 'deleteProduct') {
    const res = await executeDeleteProduct(operatorUser, args);
    if (!res.success) return `Gagal menghapus produk: ${res.error}`;
    return `Produk "${res.product.name}" (SKU: ${res.product.sku}) di cabang ${res.product.tenant_name} berhasil dihapus dari katalog toko.`;
  }

  if (name === 'updateProductStock') {
    const res = await executeUpdateProductStock(operatorUser, args);
    if (!res.success) return `Gagal mengubah stok: ${res.error}`;
    return `Stok produk "${res.product.name}" berhasil diperbarui:\n- Stok Sebelumnya: ${res.product.oldStock} unit\n- Stok Sekarang: ${res.product.newStock} unit\n- Cabang: ${res.product.tenant_name}`;
  }

  if (name === 'deleteCategory') {
    const res = await executeDeleteCategory(operatorUser, args);
    if (!res.success) return `Gagal menghapus kategori: ${res.error}`;
    return `Kategori "${res.category.name}" di cabang ${res.category.tenant_name} berhasil dihapus. Produk terkait tetap aman dan telah dilepas dari kategori tersebut.`;
  }

  if (name === 'deleteTenant') {
    const res = await executeDeleteTenant(operatorUser, args);
    if (!res.success) return `Gagal menghapus cabang: ${res.error}`;
    return `Cabang/Tenant "${res.tenant.name}" beserta seluruh data produk, transaksi, dan akun stafnya berhasil dihapus permanen.`;
  }

  return 'Fungsi tidak dikenali.';
}

// Call Gemini with tools and history
export async function askGemini(user, storeContext, question, chatId) {
  const apiKey = GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in .env.');

  let storeInfoText = '';
  if (storeContext) {
    const tenantSummaryText = Object.entries(storeContext.tenantBreakdowns || {}).map(([tName, b]) => `
* Cabang: ${tName}
  - Transaksi Hari Ini: ${b.todayTrxCount} (${b.todaySuccessTrxCount} Selesai/Berhasil, ${b.todayCancelledTrxCount} Dibatalkan)
  - Total Omset: Rp ${b.todayTotalSales.toLocaleString('id-ID')}
  - Metode Pembayaran: ${Object.entries(b.paymentBreakdown).map(([k, v]) => `${k} Rp ${Number(v).toLocaleString('id-ID')}`).join(', ') || 'Belum ada'}
  - Transaksi per Kasir: ${Object.entries(b.cashierBreakdown).map(([k, v]) => `${k} (${v} transaksi)`).join(', ') || '-'}
  - Produk Terjual: ${Object.entries(b.itemSalesCount).map(([k, v]) => `${k} (${v} buah total)`).join(', ') || 'Belum ada'}
`).join('\n');

    const trxTableText = (storeContext.recentTrxList || []).slice(0, 20).map(t => 
      `- [${t.invoice}] ${t.wibDate} ${t.wibTime} WIB | Cabang: ${t.tenant} | Kasir: ${t.cashier} | Pelanggan: ${t.customer} | Status: ${t.status} | Total: Rp ${t.total.toLocaleString('id-ID')} (${t.payment}) | Item: ${t.items}`
    ).join('\n');

    storeInfoText = `
[DATA REAL-TIME TOKO POSHERE (ZONA WAKTU ASIA/JAKARTA - WIB)]
- Tanggal Hari Ini (WIB): ${storeContext.todayStr}
- Cabang Terdaftar: ${storeContext.tenants || 'POShere Flagship Store'}
- Total Transaksi Keseluruhan Hari Ini: ${storeContext.todayTrxCount} (${storeContext.todaySuccessTrxCount} Berhasil, ${storeContext.todayCancelledTrxCount} Dibatalkan)
- Total Omset Keseluruhan Hari Ini: Rp ${storeContext.todayTotalSales.toLocaleString('id-ID')}
- Total Katalog Produk: ${storeContext.totalProductsCount} produk

[RINGKASAN PENJUALAN HARI INI PER CABANG / TENANT]
${tenantSummaryText || '- Belum ada data cabang'}

[DAFTAR TRANSAKSI SISTEM DATABASE TERAKHIR (SUMBER KEBENARAN TUNGGAL)]
${trxTableText || '- Belum ada transaksi'}

[PRODUK MENIPIS (STOK <= 10)]
${storeContext.lowStockProducts.length > 0 ? storeContext.lowStockProducts.join('\n') : 'Semua stok produk saat ini aman (di atas 10 unit)'}
`;
  }

  const systemInstruction = `
Kamu adalah asisten bisnis eksekutif untuk sistem kasir POShere.
Lawan bicaramu adalah:
- Nama: ${user.name}
- Username Telegram: @${user.telegram_username}
- Role: ${user.role}

ATURAN KOMUNIKASI & EKSEKUSI (SANGAT KETAT):
1. ATURAN PEMBUATAN USER BARU (createUser):
   - Seluruh 8 data berikut WAJIB lengkap sebelum akun dibuat:
     1. Nama Lengkap
     2. Username Login POS
     3. Username Telegram (diawali @)
     4. Role (kasir, manager, owner)
     5. Cabang/Tenant toko
     6. PIN kasir (4-6 digit angka)
     7. Email
     8. Nomor HP/WhatsApp
   - DILARANG memanggil fungsi createUser jika salah satu data di atas belum diberikan oleh pengguna.
   - Jika pengguna meminta pembuatan user tapi datanya belum lengkap, tanyakan secara spesifik dan ramah data apa saja yang belum terisi.

2. ATURAN TRANSAKSI KASIR (createTransaction):
   - Jika pengguna meminta transaksi kasir, panggil fungsi createTransaction dengan daftar produk dan metode pembayaran yang diminta.

3. ATURAN LAPORAN PENJUALAN & TRANSAKSI (SANGAT KRUSIAL):
   - Gunakan HANYA data dari [RINGKASAN PENJUALAN HARI INI PER CABANG / TENANT] dan [DAFTAR TRANSAKSI SISTEM DATABASE TERAKHIR] sebagai sumber kebenaran tunggal.
   - DILARANG MENGARANG atau menambahkan transaksi yang pernah dibahas di riwayat percakapan sebelumnya.
   - Waktu dan tanggal pada data di atas sudah dalam format Waktu Indonesia Barat (WIB).
   - Jika pengguna menanyakan laporan transaksi tanggal atau cabang tertentu (misal: "Ria Florist tanggal 25 Oktober"), rujuklah langsung ringkasan cabang dan daftar transaksi di atas. Hitung total transaksi, omset, dan rincian produk secara persis sesuai data database.

4. ATURAN MANAJEMEN DATA & PENGHAPUSAN (KONTROL PENUH SESUAI ROLE):
   - Kamu memiliki kontrol penuh untuk mengeksekusi aksi pembatalan, penghapusan, dan pembaruan data sesuai role pengguna (Super Admin memiliki izin penuh di seluruh menu).
   - Membatalkan Transaksi: Jika pengguna meminta membatalkan transaksi (misal: "batalkan transaksi INV-...", "void/cancel invoice ..."), panggil fungsi cancelTransaction. Stok barang yang dibatalkan akan otomatis dikembalikan ke katalog toko.
   - Menghapus Pesanan Hold (Open Bill): Jika pengguna meminta membatalkan atau menghapus pesanan hold (misal: "hapus open bill INV-...", "hapus pesanan hold ..."), panggil fungsi deleteHoldOrder.
   - Menghapus Pengguna/Kasir: Jika pengguna meminta menghapus kasir atau staf (misal: "hapus user kasir1", "delete akun @kasir1"), panggil fungsi deleteUser.
   - Menghapus Produk: Jika pengguna meminta menghapus produk dari katalog (misal: "hapus produk Bunga Mawar Merah"), panggil fungsi deleteProduct.
   - Mengubah/Tambah Stok: Jika pengguna meminta menambah atau mengubah stok produk (misal: "tambah stok Bunga Mawar 20", "set stok Kopi Susu jadi 50"), panggil fungsi updateProductStock.
   - Menghapus Kategori atau Cabang Toko: Panggil fungsi deleteCategory atau deleteTenant.

5. FORMAT TEKS BERSIH:
   - Jawab langsung apa yang ditanyakan.
   - DILARANG menggunakan bintang ganda (**), garis bawah (_), atau karakter bertumpuk.
   - Gunakan tanda strip (-) sederhana untuk daftar.
   - Jangan mengulang salam formal panjang atau kalimat penutup klise.
`;

  // Retrieve or initialize conversation history for this chat
  let history = chatSessions.get(chatId) || [];

  // Add new user question to history
  history.push({
    role: 'user',
    parts: [{ text: question }]
  });

  // Keep last 6 turns
  if (history.length > 6) {
    history = history.slice(-6);
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: `${systemInstruction}\n\n${storeInfoText}` }]
    },
    contents: history,
    tools: GEMINI_TOOLS
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

      if (data.candidates && data.candidates[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        const functionCallPart = parts.find(p => p.functionCall);

        if (functionCallPart) {
          const actionReply = await handleToolExecution(operatorUserOr(user), chatId, functionCallPart.functionCall);
          
          history.push({
            role: 'model',
            parts: [{ text: actionReply }]
          });
          chatSessions.set(chatId, history);

          return actionReply;
        }

        const textPart = parts.find(p => p.text);
        if (textPart) {
          const replyText = textPart.text;
          history.push({
            role: 'model',
            parts: [{ text: replyText }]
          });
          chatSessions.set(chatId, history);

          return replyText;
        }
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

function operatorUserOr(user) {
  return user;
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
    chatSessions.delete(chatId); // reset session
    const welcomeMsg = `Halo! POShere Assistant siap membantu.\n\nSistem toko sudah terhubung secara real-time. Anda bisa langsung menanyakan penjualan hari ini, cek stok barang, membuat user/tenant, atau membuat pesanan kasir.`;
    await sendTelegramMessage(chatId, welcomeMsg);
    return { status: 'started', username };
  }

  // 5. Handle /cancel or batal command
  if (rawText.toLowerCase() === '/cancel' || rawText.toLowerCase() === 'batal') {
    chatSessions.delete(chatId);
    await sendTelegramMessage(chatId, 'Proses percakapan dibatalkan. Ada yang bisa saya bantu lainnya?');
    return { status: 'cancelled', username };
  }

  // 6. Send typing indicator while querying and generating AI response
  await sendChatAction(chatId, 'typing');

  try {
    // 7. Gather store context
    const storeContext = await getStoreContext(user);

    // 8. Ask Gemini AI with Tools & Memory
    const replyText = await askGemini(user, storeContext, rawText, chatId);

    // 9. Reply to Telegram (if not already handled by photo)
    if (replyText) {
      await sendTelegramMessage(chatId, replyText);
    }
    return { status: 'answered', username, query: rawText };
  } catch (err) {
    console.error('Error generating AI response:', err);
    await sendTelegramMessage(chatId, `Maaf, terjadi kendala saat memproses: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}
