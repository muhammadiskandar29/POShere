import { sql } from '../../../lib/db.js';
import { canPerformAction, getRoleActionDeniedMessage } from '../rbac.js';

export async function executeCreateProduct(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'create_product')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'menambahkan produk baru')
    };
  }

  const name = params.name?.trim();
  if (!name) {
    return { success: false, error: 'Nama produk wajib diisi.' };
  }

  const price = Number(params.price) || 0;
  const costPrice = Number(params.cost_price) || Math.round(price * 0.6);
  const stock = Number(params.stock) || 0;

  // Resolve Tenant
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
    return { success: false, error: 'Cabang/Tenant belum ditentukan.' };
  }

  // Resolve Category
  let categoryId = null;
  let categoryName = '-';
  if (params.category_name) {
    const cats = await sql`
      SELECT id, name FROM categories 
      WHERE name ILIKE ${'%' + params.category_name.trim() + '%'} AND tenant_id = ${tenantId}
      LIMIT 1;
    `;
    if (cats.length > 0) {
      categoryId = cats[0].id;
      categoryName = cats[0].name;
    } else {
      // Auto create category if not exist
      const newCatId = 'cat_' + Date.now();
      await sql`
        INSERT INTO categories (id, name, icon, tenant_id)
        VALUES (${newCatId}, ${params.category_name.trim()}, 'coffee', ${tenantId})
        ON CONFLICT (id) DO NOTHING;
      `;
      categoryId = newCatId;
      categoryName = params.category_name.trim();
    }
  }

  const prodId = 'prod_' + Date.now();
  const sku = params.sku?.trim() || `SKU-${Date.now().toString().slice(-6)}`;

  await sql`
    INSERT INTO products (id, category_id, name, price, cost_price, stock, sku, image_path, is_active, tenant_id)
    VALUES (
      ${prodId}, ${categoryId}, ${name}, ${price}, ${costPrice}, ${stock},
      ${sku}, '', true, ${tenantId}
    );
  `;

  return {
    success: true,
    product: {
      id: prodId,
      name,
      price,
      stock,
      category_name: categoryName,
      tenant_name: tenantName,
      sku
    }
  };
}

export async function executeDeleteProduct(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'delete_product')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'menghapus produk')
    };
  }

  const query = (params.product_name || params.name || params.sku || '').trim();
  if (!query) {
    return { success: false, error: 'Nama produk atau SKU yang ingin dihapus wajib disertakan.' };
  }

  let products = [];
  if (operatorUser.role === 'super_admin') {
    products = await sql`
      SELECT p.id, p.name, p.sku, p.stock, t.name as tenant_name
      FROM products p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE p.name ILIKE ${'%' + query + '%'} OR p.sku ILIKE ${query}
      LIMIT 1;
    `;
  } else {
    products = await sql`
      SELECT p.id, p.name, p.sku, p.stock, t.name as tenant_name
      FROM products p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE (p.name ILIKE ${'%' + query + '%'} OR p.sku ILIKE ${query})
        AND p.tenant_id = ${operatorUser.tenant_id}
      LIMIT 1;
    `;
  }

  if (products.length === 0) {
    return { success: false, error: `Produk "${query}" tidak ditemukan di katalog.` };
  }

  const targetProd = products[0];
  await sql`DELETE FROM products WHERE id = ${targetProd.id};`;

  return {
    success: true,
    product: {
      id: targetProd.id,
      name: targetProd.name,
      sku: targetProd.sku || '-',
      tenant_name: targetProd.tenant_name || '-'
    }
  };
}

export async function executeUpdateProductStock(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'update_product_stock')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'mengubah stok produk')
    };
  }

  const query = (params.product_name || params.name || '').trim();
  if (!query) {
    return { success: false, error: 'Nama produk yang ingin diubah stoknya wajib disertakan.' };
  }

  const qty = Number(params.quantity);
  if (isNaN(qty)) {
    return { success: false, error: 'Jumlah stok (quantity) harus berupa angka valid.' };
  }

  let products = [];
  if (operatorUser.role === 'super_admin') {
    products = await sql`
      SELECT p.id, p.name, p.stock, t.name as tenant_name
      FROM products p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE p.name ILIKE ${'%' + query + '%'} OR p.sku ILIKE ${query}
      LIMIT 1;
    `;
  } else {
    products = await sql`
      SELECT p.id, p.name, p.stock, t.name as tenant_name
      FROM products p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE (p.name ILIKE ${'%' + query + '%'} OR p.sku ILIKE ${query})
        AND p.tenant_id = ${operatorUser.tenant_id}
      LIMIT 1;
    `;
  }

  if (products.length === 0) {
    return { success: false, error: `Produk "${query}" tidak ditemukan di katalog.` };
  }

  const targetProd = products[0];
  const oldStock = Number(targetProd.stock) || 0;
  const actionType = (params.action_type || 'add').toLowerCase();

  let newStock = oldStock;
  if (actionType === 'set') {
    newStock = qty;
  } else {
    // default 'add'
    newStock = oldStock + qty;
  }

  if (newStock < 0) {
    return { success: false, error: `Stok tidak boleh bernilai negatif (stok saat ini: ${oldStock}).` };
  }

  await sql`UPDATE products SET stock = ${newStock} WHERE id = ${targetProd.id};`;

  return {
    success: true,
    product: {
      name: targetProd.name,
      oldStock,
      newStock,
      tenant_name: targetProd.tenant_name || '-'
    }
  };
}
