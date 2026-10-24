// RBAC (Role-Based Access Control) Matrix for Telegram Bot Actions

export const ROLE_PERMISSIONS = {
  super_admin: [
    'create_tenant',
    'create_user',
    'create_category',
    'create_product',
    'create_transaction',
    'view_reports',
    'view_stock',
    'cancel_transaction'
  ],
  owner: [
    'create_user',
    'create_category',
    'create_product',
    'create_transaction',
    'view_reports',
    'view_stock'
  ],
  manager: [
    'create_category',
    'create_product',
    'create_transaction',
    'view_reports',
    'view_stock'
  ],
  kasir: [
    'create_transaction',
    'view_stock'
  ]
};

export function canPerformAction(role, action) {
  if (!role) return false;
  const normalizedRole = role.toLowerCase().trim();
  const permissions = ROLE_PERMISSIONS[normalizedRole] || [];
  return permissions.includes(action);
}

export function getRoleActionDeniedMessage(user, actionLabel) {
  const roleName = user.role?.toUpperCase() || 'PENGGUNA';
  return `Akses ditolak. Role Anda (${roleName}) tidak memiliki izin untuk ${actionLabel}.`;
}
