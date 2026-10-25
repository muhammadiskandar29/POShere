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
