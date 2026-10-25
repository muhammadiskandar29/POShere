import { sql } from '../../../lib/db.js';
import { canPerformAction, getRoleActionDeniedMessage } from '../rbac.js';
import { convertStaticQrisToDynamic } from '../../../src/utils/qris.js';
import QRCode from 'qrcode';

export async function executeCreateTransaction(operatorUser, params) {
  // 1. RBAC Check
  if (!canPerformAction(operatorUser.role, 'create_transaction')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'membuat transaksi kasir')
    };
  }

  // 2. Resolve Tenant
  let tenantId = operatorUser.tenant_id;
  let tenantName = '';
  const tenants = await sql`SELECT id, name FROM tenants ORDER BY created_at ASC;`;

  if (operatorUser.role === 'super_admin') {
    if (params.tenant_name) {
      const match = tenants.find(t => 
        t.name.toLowerCase().includes(params.tenant_name.toLowerCase()) ||
        t.id.toLowerCase() === params.tenant_name.toLowerCase()
      );
      if (match) {
        tenantId = match.id;
        tenantName = match.name;
      }
    }
    if (!tenantId && tenants.length > 0) {
      tenantId = tenants[0].id;
      tenantName = tenants[0].name;
    }
  } else {
    const userTenant = tenants.find(t => t.id === tenantId);
    tenantName = userTenant?.name || tenantId;
  }

  if (!tenantId) {
    return { success: false, error: 'Cabang/Tenant toko tidak valid.' };
  }

  // 3. Resolve Items
  if (!Array.isArray(params.items) || params.items.length === 0) {
    return { success: false, error: 'Item belanja tidak boleh kosong.' };
  }

  // Fetch tenant products
  const products = await sql`
    SELECT id, name, price, stock, is_active 
    FROM products 
    WHERE tenant_id = ${tenantId} AND is_active = true;
  `;

  if (products.length === 0) {
    return { success: false, error: `Tidak ada produk aktif di katalog ${tenantName}.` };
  }

  const transactionItems = [];
  let grandTotal = 0;

  for (const requestedItem of params.items) {
    const reqName = (requestedItem.name || '').toLowerCase().trim();
    const reqQty = Math.max(1, Number(requestedItem.qty) || 1);

    // Fuzzy match product
    const matchedProduct = products.find(p => 
      p.name.toLowerCase() === reqName ||
      p.name.toLowerCase().includes(reqName) ||
      reqName.includes(p.name.toLowerCase())
    );

    if (!matchedProduct) {
      return {
        success: false,
        error: `Produk "${requestedItem.name}" tidak ditemukan di katalog ${tenantName}.`
      };
    }

    const price = Number(matchedProduct.price) || 0;
    const subtotal = price * reqQty;
    grandTotal += subtotal;

    transactionItems.push({
      product_id: matchedProduct.id,
      name: matchedProduct.name,
      price: price,
      qty: reqQty,
      subtotal: subtotal
    });
  }

  // 4. Resolve Payment Method
  const pms = await sql`
    SELECT id, name, type, qris_raw_string 
    FROM payment_methods 
    WHERE tenant_id = ${tenantId} AND is_active = true;
  `;

  const methodInput = (params.payment_method || 'qris').toLowerCase().trim();
  const isQris = methodInput.includes('qris');

  let chosenPm = null;
  if (isQris) {
    chosenPm = pms.find(p => p.type === 'qris') || pms[0];
  } else {
    chosenPm = pms.find(p => p.type === 'cash') || pms[0];
  }

  if (!chosenPm) {
    return { success: false, error: 'Metode pembayaran toko belum disetting.' };
  }

  // 5. Generate Invoice & Transaction
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;
  const trxId = 'trx_' + Date.now();
  const customerName = params.customer_name?.trim() || 'Pelanggan Telegram';
  const trxStatus = isQris ? 'pending' : 'completed';
  const paymentStatus = isQris ? 'unpaid' : 'completed';

  await sql`
    INSERT INTO transactions (
      id, invoice_number, cashier_user_id, cashier_name, table_number, customer_name,
      payment_method_id, payment_method_name, payment_status, status, note, items,
      subtotal, tax_amount, discount_amount, grand_total, paid_amount, change_amount,
      tenant_id
    ) VALUES (
      ${trxId},
      ${invoiceNumber},
      ${operatorUser.id},
      ${operatorUser.name},
      ${params.table_number || ''},
      ${customerName},
      ${chosenPm.id},
      ${chosenPm.name},
      ${paymentStatus},
      ${trxStatus},
      ${'Dibuat via POShere Telegram Bot'},
      ${JSON.stringify(transactionItems)}::jsonb,
      ${grandTotal},
      0,
      0,
      ${grandTotal},
      ${isQris ? 0 : grandTotal},
      0,
      ${tenantId}
    );
  `;

  // 6. Handle Dynamic QRIS Generation
  let qrBuffer = null;
  let dynamicQrisString = '';

  if (isQris && chosenPm.qris_raw_string) {
    try {
      dynamicQrisString = convertStaticQrisToDynamic(chosenPm.qris_raw_string, grandTotal);
      qrBuffer = await QRCode.toBuffer(dynamicQrisString, {
        type: 'png',
        width: 450,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
    } catch (qrErr) {
      console.error('Failed to generate dynamic QRIS image:', qrErr);
    }
  }

  return {
    success: true,
    isQris,
    transaction: {
      id: trxId,
      invoice_number: invoiceNumber,
      cashier_name: operatorUser.name,
      tenant_name: tenantName,
      customer_name: customerName,
      items: transactionItems,
      grand_total: grandTotal,
      payment_method: chosenPm.name,
      status: trxStatus
    },
    dynamicQrisString,
    qrBuffer
  };
}
