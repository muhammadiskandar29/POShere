import { sql } from '../../../lib/db.js';
import { canPerformAction, getRoleActionDeniedMessage } from '../rbac.js';

export async function executeCreateTenant(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'create_tenant')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'membuat tenant/cabang baru')
    };
  }

  const name = params.name?.trim();
  if (!name) {
    return { success: false, error: 'Nama tenant tidak boleh kosong.' };
  }

  const tenantId = 'tenant_' + Date.now();
  await sql`
    INSERT INTO tenants (id, name, address, is_active)
    VALUES (${tenantId}, ${name}, ${params.address?.trim() || ''}, true);
  `;

  return {
    success: true,
    tenant: {
      id: tenantId,
      name,
      address: params.address?.trim() || '-'
    }
  };
}

export async function executeCreateCategory(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'create_category')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'membuat kategori baru')
    };
  }

  const name = params.name?.trim();
  if (!name) {
    return { success: false, error: 'Nama kategori tidak boleh kosong.' };
  }

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

  const catId = 'cat_' + Date.now();
  await sql`
    INSERT INTO categories (id, name, icon, tenant_id)
    VALUES (${catId}, ${name}, ${params.icon || 'coffee'}, ${tenantId})
    ON CONFLICT (id) DO NOTHING;
  `;

  return {
    success: true,
    category: {
      id: catId,
      name,
      tenant_name: tenantName
    }
  };
}

export async function executeDeleteCategory(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'delete_category')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'menghapus kategori produk')
    };
  }

  const name = params.name || params.category_name;
  if (!name?.trim()) {
    return { success: false, error: 'Nama kategori yang ingin dihapus wajib disertakan.' };
  }

  let cats = [];
  if (operatorUser.role === 'super_admin') {
    cats = await sql`
      SELECT c.id, c.name, t.name as tenant_name
      FROM categories c
      LEFT JOIN tenants t ON c.tenant_id = t.id
      WHERE c.name ILIKE ${name.trim()}
      LIMIT 1;
    `;
  } else {
    cats = await sql`
      SELECT c.id, c.name, t.name as tenant_name
      FROM categories c
      LEFT JOIN tenants t ON c.tenant_id = t.id
      WHERE c.name ILIKE ${name.trim()} AND c.tenant_id = ${operatorUser.tenant_id}
      LIMIT 1;
    `;
  }

  if (cats.length === 0) {
    return { success: false, error: `Kategori "${name}" tidak ditemukan.` };
  }

  const cat = cats[0];
  await sql`UPDATE products SET category_id = NULL WHERE category_id = ${cat.id};`;
  await sql`DELETE FROM categories WHERE id = ${cat.id};`;

  return {
    success: true,
    category: {
      name: cat.name,
      tenant_name: cat.tenant_name || '-'
    }
  };
}

export async function executeDeleteTenant(operatorUser, params) {
  if (!canPerformAction(operatorUser.role, 'delete_tenant')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'menghapus cabang/tenant toko')
    };
  }

  const name = params.name || params.tenant_name;
  if (!name?.trim()) {
    return { success: false, error: 'Nama cabang/tenant yang ingin dihapus wajib disertakan.' };
  }

  const tenants = await sql`
    SELECT id, name FROM tenants 
    WHERE name ILIKE ${name.trim()} OR id ILIKE ${name.trim()}
    LIMIT 1;
  `;

  if (tenants.length === 0) {
    return { success: false, error: `Cabang/tenant "${name}" tidak ditemukan.` };
  }

  const targetTenant = tenants[0];
  if (targetTenant.id === 'tenant_main' || targetTenant.name.toLowerCase().includes('flagship')) {
    return { success: false, error: 'Toko utama (Flagship Store) tidak boleh dihapus demi integritas sistem.' };
  }

  // Cascading cleanup
  await sql`DELETE FROM products WHERE tenant_id = ${targetTenant.id};`;
  await sql`DELETE FROM categories WHERE tenant_id = ${targetTenant.id};`;
  await sql`DELETE FROM payment_methods WHERE tenant_id = ${targetTenant.id};`;
  await sql`DELETE FROM cash_registers WHERE tenant_id = ${targetTenant.id};`;
  await sql`DELETE FROM users WHERE tenant_id = ${targetTenant.id} AND role != 'super_admin';`;
  await sql`DELETE FROM transactions WHERE tenant_id = ${targetTenant.id};`;
  await sql`DELETE FROM tenants WHERE id = ${targetTenant.id};`;

  return {
    success: true,
    tenant: {
      name: targetTenant.name,
      id: targetTenant.id
    }
  };
}
