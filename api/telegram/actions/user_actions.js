import { sql } from '../../db.js';
import { canPerformAction, getRoleActionDeniedMessage } from '../rbac.js';

export const REQUIRED_USER_FIELDS = [
  { key: 'name', label: 'Nama Lengkap' },
  { key: 'username', label: 'Username Login POS' },
  { key: 'telegram_username', label: 'Username Telegram (@)' },
  { key: 'role', label: 'Role (Kasir / Manager / Owner)' },
  { key: 'tenant_name', label: 'Cabang / Tenant Toko' },
  { key: 'pin', label: 'PIN Kasir (4-6 digit angka)' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Nomor HP' }
];

export async function executeCreateUser(operatorUser, params) {
  // 1. RBAC check
  if (!canPerformAction(operatorUser.role, 'create_user')) {
    return {
      success: false,
      error: getRoleActionDeniedMessage(operatorUser, 'membuat akun user baru')
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
  } else {
    const userTenant = tenants.find(t => t.id === tenantId);
    tenantName = userTenant?.name || tenantId;
  }

  // 3. Check for missing required fields
  const missing = [];
  if (!params.name?.trim()) missing.push('Nama Lengkap');
  if (!params.username?.trim()) missing.push('Username Login POS');
  if (!params.telegram_username?.trim()) missing.push('Username Telegram (@)');
  if (!params.role?.trim()) missing.push('Role (Kasir / Manager / Owner)');
  if (operatorUser.role === 'super_admin' && !tenantId) missing.push('Cabang / Tenant Toko');
  if (!params.pin?.trim()) missing.push('PIN Kasir (4-6 digit)');
  if (!params.email?.trim()) missing.push('Email');
  if (!params.phone?.trim()) missing.push('Nomor HP');

  if (missing.length > 0) {
    return {
      success: false,
      missingFields: missing,
      error: 'Data belum lengkap.'
    };
  }

  // 4. Validate Role assignment
  const roleInput = params.role.toLowerCase().trim();
  const allowedRoles = ['kasir', 'manager', 'owner', 'super_admin'];
  if (!allowedRoles.includes(roleInput)) {
    return {
      success: false,
      error: `Role "${params.role}" tidak valid. Pilihan role: Kasir, Manager, Owner.`
    };
  }

  if (operatorUser.role !== 'super_admin' && (roleInput === 'super_admin' || roleInput === 'owner')) {
    return {
      success: false,
      error: 'Hanya Super Administrator yang berhak membuat akun dengan role Owner atau Super Admin.'
    };
  }

  // 5. Clean & Validate Inputs
  const usernameClean = params.username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const teleClean = params.telegram_username.replace(/^@/, '').toLowerCase().trim();
  const pinClean = params.pin.trim();

  // Check unique username
  const existingUser = await sql`
    SELECT id FROM users WHERE LOWER(username) = ${usernameClean};
  `;
  if (existingUser.length > 0) {
    return {
      success: false,
      error: `Username "${usernameClean}" sudah dipakai di sistem POS. Silakan gunakan username lain.`
    };
  }

  // Check unique telegram_username
  const existingTele = await sql`
    SELECT id, username FROM users WHERE LOWER(telegram_username) = ${teleClean};
  `;
  if (existingTele.length > 0) {
    return {
      success: false,
      error: `Username Telegram @${teleClean} sudah terdaftar pada akun "${existingTele[0].username}".`
    };
  }

  // 6. Insert new user into Neon DB
  const newUserId = 'usr_' + Date.now();
  await sql`
    INSERT INTO users (
      id, username, name, role, pin, status, email, password, tenant_id, phone, telegram_username
    ) VALUES (
      ${newUserId},
      ${usernameClean},
      ${params.name.trim()},
      ${roleInput},
      ${pinClean},
      'active',
      ${params.email.trim()},
      ${pinClean},
      ${tenantId},
      ${params.phone.trim()},
      ${teleClean}
    );
  `;

  return {
    success: true,
    user: {
      id: newUserId,
      name: params.name.trim(),
      username: usernameClean,
      telegram_username: teleClean,
      role: roleInput,
      tenant_name: tenantName,
      email: params.email.trim(),
      phone: params.phone.trim(),
      pin: pinClean
    }
  };
}
