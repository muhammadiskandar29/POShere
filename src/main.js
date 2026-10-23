import './style.css';
import QRCode from 'qrcode';
import { readQrCodeFromImage, fileToBase64, uploadBase64Image } from './utils/imageReader.js';
import { convertStaticQrisToDynamic, parseQris } from './utils/qris.js';
import { dbService } from './utils/dbService.js';
import { getSupabaseConfig, saveSupabaseConfig } from './utils/supabase.js';
import { printerService } from './utils/printerService.js';
import { getIcon } from './utils/icons.js';

// Application State
const state = {
  auth: {
    isAuthenticated: false,
    token: localStorage.getItem('poshere_jwt_token') || null,
    loading: false,
    errorMessage: '',
    selectedQuickUser: 'owner'
  },
  currentUser: {
    id: 'usr_1',
    username: 'owner',
    name: 'Mas Bos (Owner)',
    role: 'owner' // 'owner' or 'kasir'
  },
  currentView: 'pos', // 'pos', 'products', 'categories', 'payments', 'registers', 'users', 'transactions', 'reports', 'printer', 'settings'
  categories: [],
  products: [],
  paymentMethods: [],
  cashRegisters: [],
  activeRegister: null,
  users: [],
  transactions: [],
  selectedCategory: 'all',
  searchQuery: '',
  cart: [],
  isMobileSidebarOpen: false,
  isCustomerDisplayOpen: false, // Dual screen Customer Facing Display
  selectedCheckoutPayment: null, // Selected payment method in checkout
  checkoutStep: 'select_payment', // 'select_payment' -> 'customer_confirm' -> 'final_confirm'
  checkoutCustomerName: 'Pelanggan',
  checkoutTableNumber: 'Meja 1',
  checkoutPaidAmount: 0,
  activeHoldTransactionId: null, // ID transaksi jika keranjang sedang mengerjakan pesanan yang di-hold
  cartCustomerName: '',
  cartTableNumber: '',
  modalState: {
    isOpen: false,
    type: null,
    data: null
  }
};

// Formatting Helper
const formatRupiah = (num) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(num || 0);
};

// Data Loader dari Supabase / dbService
async function loadAllData() {
  try {
    const [cats, prods, pays, regs, users, trx] = await Promise.all([
      dbService.getCategories(),
      dbService.getProducts(),
      dbService.getPaymentMethods(),
      dbService.getCashRegisters(),
      dbService.getUsers(),
      dbService.getTransactions()
    ]);

    state.categories = cats;
    state.products = prods;
    state.paymentMethods = pays;
    state.cashRegisters = regs;
    if (state.cashRegisters && state.cashRegisters.length && !state.activeRegister) {
      state.activeRegister = state.cashRegisters[0];
    }
    state.users = users;
    if (state.users && state.users.length) {
      // pastikan currentUser tersinkron
      const found = state.users.find(u => u.id === state.currentUser.id);
      if (found) state.currentUser = found;
      else state.currentUser = state.users[0];
    }
    state.transactions = trx;
  } catch (err) {
    console.error('Failed to load database records', err);
  }
}

// Cart Handlers
function addToCart(product) {
  if (product.stock <= 0) {
    alert(`Stok "${product.name}" telah habis!`);
    return;
  }
  const existing = state.cart.find(it => it.product_id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock) {
      alert(`Stok hanya tersedia ${product.stock}`);
      return;
    }
    existing.quantity += 1;
    existing.subtotal = existing.quantity * existing.price;
  } else {
    state.cart.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      subtotal: product.price,
      image_path: product.image_path
    });
  }
  renderApp();
}

function updateCartQty(productId, delta) {
  const item = state.cart.find(it => it.product_id === productId);
  if (!item) return;

  const product = state.products.find(p => p.id === productId);
  const newQty = item.quantity + delta;

  if (newQty <= 0) {
    state.cart = state.cart.filter(it => it.product_id !== productId);
  } else {
    if (product && newQty > product.stock) {
      alert(`Maksimal stok tersedia adalah ${product.stock}`);
      return;
    }
    item.quantity = newQty;
    item.subtotal = item.quantity * item.price;
  }
  renderApp();
}

function clearCart() {
  if (confirm('Kosongkan keranjang pesanan?')) {
    state.cart = [];
    renderApp();
  }
}

// Open Modals
function openModal(type, data = null) {
  state.modalState = { isOpen: true, type, data };
  renderApp();
  if (type === 'payment_checkout') {
    handleCheckoutModalRender();
  }
}

function closeModal() {
  state.modalState = { isOpen: false, type: null, data: null };
  renderApp();
}

// Switch User Role
function switchRole() {
  if (state.currentUser.role === 'owner') {
    const kasir = state.users.find(u => u.role === 'kasir') || {
      id: 'usr_2',
      name: 'Rian (Kasir Barista)',
      role: 'kasir'
    };
    state.currentUser = kasir;
    if (['products', 'payments', 'users', 'reports', 'settings'].includes(state.currentView)) {
      state.currentView = 'pos';
    }
  } else {
    const owner = state.users.find(u => u.role === 'owner') || {
      id: 'usr_1',
      name: 'Mas Bos (Owner)',
      role: 'owner'
    };
    state.currentUser = owner;
  }
  renderApp();
}

// Render Sidebar & Navigation
function renderSidebar() {
  const isOwner = state.currentUser.role === 'owner';
  const { isConfigured } = getSupabaseConfig();

  return `
    <aside class="sidebar ${state.isMobileSidebarOpen ? 'mobile-open' : ''}">
      <div class="brand-header">
        <img src="/poshere_logo.png" alt="POShere Logo" class="brand-logo" onerror="this.src='/poshere_logo.png'" />
        <div class="brand-info">
          <h1>POShere</h1>
          <p>Point of Sale System</p>
        </div>
      </div>

      <nav class="nav-menu">
        <div class="nav-item ${state.currentView === 'pos' ? 'active' : ''}" onclick="window.setView('pos')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <span>Kasir / Kasir POS</span>
        </div>

        <div class="nav-item ${state.currentView === 'transactions' ? 'active' : ''}" onclick="window.setView('transactions')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>Riwayat Transaksi</span>
        </div>

        ${isOwner ? `
          <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin: 0.8rem 0 0.3rem 0.5rem; letter-spacing: 0.05em;">Owner Master Data</div>

          <div class="nav-item ${state.currentView === 'products' ? 'active' : ''}" onclick="window.setView('products')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
            <span>Master Produk</span>
          </div>

          <div class="nav-item ${state.currentView === 'categories' ? 'active' : ''}" onclick="window.setView('categories')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>
            <span>Master Kategori</span>
          </div>

          <div class="nav-item ${state.currentView === 'payments' ? 'active' : ''}" onclick="window.setView('payments')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            <span>Metode Bayar & QRIS</span>
          </div>

          <div class="nav-item ${state.currentView === 'registers' ? 'active' : ''}" onclick="window.setView('registers')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="12" x="3" y="4" rx="2"/><line x1="2" x2="22" y1="20" y2="20"/></svg>
            <span>Master Mesin Kasir</span>
          </div>

          <div class="nav-item ${state.currentView === 'users' ? 'active' : ''}" onclick="window.setView('users')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Master User Kasir</span>
          </div>

          <div class="nav-item ${state.currentView === 'reports' ? 'active' : ''}" onclick="window.setView('reports')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
            <span>Laporan Ringkas</span>
          </div>

            <div class="nav-item ${state.currentView === 'printer' ? 'active' : ''}" onclick="window.setView('printer')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
            <span>Koneksi Printer Struk</span>
            <span style="font-size:0.65rem; background:${printerService.isConnected ? '#ecfdf5' : '#f1f5f9'}; color:${printerService.isConnected ? '#059669' : '#64748b'}; padding:2px 6px; border-radius:99px; margin-left:auto;">
              ${printerService.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>

          <div class="nav-item ${state.currentView === 'settings' ? 'active' : ''}" onclick="window.setView('settings')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            <span>Database MySQL (XAMPP)</span>
            <span style="font-size:0.65rem; background:#ecfdf5; color:#059669; padding:2px 6px; border-radius:99px; margin-left:auto;">AKTIF</span>
          </div>
        ` : ''}
      </nav>

      <div class="sidebar-footer">
        <div class="user-profile-card">
          <div class="user-avatar">${(state.currentUser?.name || 'U').charAt(0)}</div>
          <div class="user-meta">
            <div class="user-name">${state.currentUser?.name || 'User'}</div>
            <span class="role-badge ${state.currentUser?.role === 'owner' ? 'badge-owner' : 'badge-kasir'}">
              ${state.currentUser?.role || 'kasir'}
            </span>
          </div>
          <div class="user-profile-actions">
            ${state.currentUser?.role === 'owner' ? `
              <button class="btn-switch-role" title="Ganti Mode / Simulasi Kasir" onclick="window.switchRole()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
              </button>
            ` : ''}
            <button class="btn-logout-sidebar" title="Logout dari Sistem" onclick="window.handleLogout()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
    ${state.isMobileSidebarOpen ? `<div class="sidebar-backdrop" onclick="window.toggleSidebar()"></div>` : ''}
  `;
}

function renderTopbar() {
  const titles = {
    pos: 'Kasir Point of Sale',
    transactions: 'Riwayat Transaksi',
    products: 'Master Data Produk & Stok',
    payments: 'Master Metode Bayar & QRIS',
    registers: 'Data Master Mesin Kasir / POS Station',
    users: 'Master User & Kasir',
    reports: 'Laporan Penjualan',
    printer: 'Koneksi Mesin Printer Struk (Thermal ESC/POS)',
    settings: 'Pengaturan Database Supabase'
  };

  const { isConfigured } = getSupabaseConfig();

  return `
    <header class="topbar">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <button class="mobile-menu-btn" onclick="window.toggleSidebar()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
        </button>
        <span class="page-title">${titles[state.currentView] || 'POShere'}</span>
      </div>

      <div class="topbar-right">
        <div style="font-size: 0.78rem; display: flex; align-items: center; gap: 0.45rem; background: #f8fafc; color: var(--text-secondary); padding: 0.3rem 0.75rem; border-radius: 99px; border: 1px solid var(--border-light);">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
          <span style="font-weight: 600;">MySQL Online</span>
        </div>
        <div style="font-size: 0.78rem; display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.65rem; background: var(--primary-light); color: var(--primary-focus); border-radius: 99px; font-weight: 700; text-transform: uppercase;">
          ${state.currentUser.role}
        </div>
      </div>
    </header>
  `;
}

// 1. POS View
function renderPosView() {
  let filteredProducts = state.products.filter(p => p.is_active);

  if (state.selectedCategory !== 'all') {
    filteredProducts = filteredProducts.filter(p => p.category_id === state.selectedCategory);
  }

  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase();
    filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
  }

  const subtotal = state.cart.reduce((sum, it) => sum + it.subtotal, 0);
  const totalQty = state.cart.reduce((sum, it) => sum + it.quantity, 0);

  return `
    <div class="pos-container">
      <section class="catalog-section">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <input type="text" class="form-control" placeholder="Cari kopi, pastry, SKU..." 
                 value="${state.searchQuery}" oninput="window.setSearch(this.value)">
        </div>

        <div class="catalog-filter-bar">
          <button class="cat-chip ${state.selectedCategory === 'all' ? 'active' : ''}" 
                  onclick="window.setCategory('all')">
            Semua Menu
          </button>
          ${state.categories.map(c => `
            <button class="cat-chip ${state.selectedCategory === c.id ? 'active' : ''}" 
                    onclick="window.setCategory('${c.id}')">
              ${c.name}
            </button>
          `).join('')}
        </div>

        <div class="product-grid">
          ${filteredProducts.length === 0 ? `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
              <p>Tidak ada produk ditemukan di kategori ini.</p>
            </div>
          ` : filteredProducts.map(p => `
            <div class="product-card" onclick="window.addToCart(${JSON.stringify(p).replace(/"/g, '&quot;')})">
              <div class="product-img-wrap">
                ${p.image_path ? `
                  <img src="${p.image_path}" alt="${p.name}" onerror="this.onerror=null; this.src='/poshere_logo.png';"/>
                ` : `
                  <span style="color: var(--primary); display: inline-flex;">${getIcon('package', 28)}</span>
                `}
              </div>
              <div class="product-name" title="${p.name}">${p.name}</div>
              <div class="product-meta-row">
                <span class="product-price">${formatRupiah(p.price)}</span>
                <span class="stock-tag">Stok: ${p.stock}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="cart-panel">
        <div class="cart-header">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h3 style="font-size: 0.95rem; font-weight: 700;">Pesanan Saat Ini</h3>
              ${(() => {
                const openBillsCount = (state.transactions || []).filter(t => t.status === 'hold').length;
                return `
                  <button class="open-bills-btn" onclick="window.openHoldOrdersModal()" title="Lihat daftar pesanan yang di-hold">
                    ${getIcon('clipboard-list', 14)} Open Bills (${openBillsCount})
                  </button>
                `;
              })()}
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${totalQty} Item dipilih</span>
          </div>
          ${state.cart.length > 0 ? `
            <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.clearCart()">
              Reset
            </button>
          ` : ''}
        </div>

        ${state.activeHoldTransactionId ? `
          <div style="padding: 0 0.85rem; margin-top: 0.5rem;">
            <div class="active-hold-banner">
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                <span style="color: #b45309; display: inline-flex;">${getIcon('alert-triangle', 15)}</span>
                <span><strong>Mengedit Open Bill:</strong> ${state.cartCustomerName || 'Pelanggan'} (${state.cartTableNumber || 'Meja'})</span>
              </div>
              <button class="btn btn-secondary" style="padding: 0.15rem 0.45rem; font-size: 0.68rem; background: white;" onclick="window.cancelEditingHoldOrder()">
                Keluar
              </button>
            </div>
          </div>
        ` : ''}

        <div class="cart-items">
          ${state.cart.length === 0 ? `
            <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
              <div style="color: #cbd5e1; display: inline-flex; margin-bottom: 0.5rem;">${getIcon('inbox', 36)}</div>
              <p style="font-size: 0.85rem; font-weight: 600;">Keranjang masih kosong</p>
              <p style="font-size: 0.72rem; margin-top: 0.25rem;">Pilih produk di katalog untuk menambahkan ke pesanan.</p>
              ${(() => {
                const openCount = (state.transactions || []).filter(t => t.status === 'hold').length;
                return openCount > 0 ? `
                  <button class="open-bills-btn" style="margin-top: 1rem; padding: 0.4rem 0.8rem;" onclick="window.openHoldOrdersModal()">
                    ${getIcon('clipboard-list', 14)} Lihat ${openCount} Pesanan Di-Hold
                  </button>
                ` : '';
              })()}
            </div>
          ` : state.cart.map(item => `
            <div class="cart-item-row">
              <div style="flex: 1; min-width: 0;">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${formatRupiah(item.price)} x ${item.quantity} = <strong>${formatRupiah(item.subtotal)}</strong></div>
              </div>
              <div class="cart-qty-ctrl">
                <button class="qty-btn" onclick="window.updateCartQty('${item.product_id}', -1)">-</button>
                <span class="qty-val">${item.quantity}</span>
                <button class="qty-btn" onclick="window.updateCartQty('${item.product_id}', 1)">+</button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="cart-footer">
          <div class="summary-row">
            <span>Subtotal</span>
            <span>${formatRupiah(subtotal)}</span>
          </div>
          <div class="summary-row total">
            <span>Grand Total</span>
            <span>${formatRupiah(subtotal)}</span>
          </div>

          <div style="display: flex; gap: 0.4rem; margin-top: 0.4rem;">
            <button class="btn btn-hold-cart btn-icon-text" style="flex: 1; padding: 0.65rem; font-size: 0.82rem;" 
                    ${state.cart.length === 0 ? 'disabled' : ''}
                    onclick="window.openHoldOrderForm()">
              ${getIcon('pause', 14)} <span>${state.activeHoldTransactionId ? 'Perbarui Hold' : 'Hold / Open Bill'}</span>
            </button>
            <button class="btn btn-primary" style="flex: 2; padding: 0.65rem; font-size: 0.85rem;" 
                    ${state.cart.length === 0 ? 'disabled' : ''}
                    onclick="window.startCheckout()">
              Bayar / Checkout
            </button>
          </div>

          ${state.cart.length > 0 ? `
            <button class="btn btn-secondary btn-icon-text" style="width: 100%; font-size: 0.78rem; padding: 0.4rem; justify-content: center;" 
                    onclick="window.openCustomerDisplay()">
              ${getIcon('monitor', 14)} <span>Tampilkan ke Layar Pelanggan</span>
            </button>
          ` : ''}
        </div>
      </section>
    </div>
  `;
}

// 2. Master Products View
function renderProductsView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Data Master Produk (Tersimpan di Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">Tabel products Supabase: id, name, category_id, price, cost_price, stock, sku, image_path</p>
        </div>
        <button class="btn btn-primary" onclick="window.openProductForm()">
          + Tambah Produk Baru
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Gambar</th>
              <th>Nama Produk</th>
              <th>Kategori</th>
              <th>Harga Jual</th>
              <th>Harga Modal</th>
              <th>Stok</th>
              <th>SKU</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.products.map(p => {
              const cat = state.categories.find(c => c.id === p.category_id);
              return `
                <tr>
                  <td>
                    <img src="${p.image_path || '/poshere_logo.png'}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;" onerror="this.src='/poshere_logo.png'"/>
                  </td>
                  <td style="font-weight: 600; color: var(--text-main);">${p.name}</td>
                  <td>${cat ? cat.name : '-'}</td>
                  <td style="font-weight: 700; color: var(--primary-focus);">${formatRupiah(p.price)}</td>
                  <td>${formatRupiah(p.cost_price)}</td>
                  <td><span class="stock-tag">${p.stock}</span></td>
                  <td><code>${p.sku || '-'}</code></td>
                  <td>
                    <span class="role-badge ${p.is_active ? 'badge-kasir' : 'badge-owner'}">
                      ${p.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    <div style="display: flex; gap: 0.35rem;">
                      <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem;" onclick="window.editProduct('${p.id}')">Edit</button>
                      <button class="btn btn-danger" style="padding: 0.25rem 0.5rem;" onclick="window.deleteProduct('${p.id}')">Hapus</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 2b. Master Categories View
function renderCategoriesView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Data Master Kategori (Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">
            Tabel categories: Kelola kategori menu/produk (Espresso, Matcha, Snack, Pastry, Retail, dll)
          </p>
        </div>
        <button class="btn btn-primary btn-icon-text" onclick="window.openCategoryForm()">
          ${getIcon('tag', 15)} <span>+ Tambah Kategori Baru</span>
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 50px;">Icon</th>
              <th>Nama Kategori</th>
              <th>Kode / ID</th>
              <th>Jumlah Produk Terkait</th>
              <th style="width: 140px; text-align: right;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.categories.length === 0 ? `
              <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                  Belum ada kategori. Klik "+ Tambah Kategori Baru" untuk membuat kategori pertama Anda.
                </td>
              </tr>
            ` : state.categories.map(c => {
              const productCount = (state.products || []).filter(p => p.category_id === c.id).length;
              return `
                <tr>
                  <td>
                    <div style="width: 32px; height: 32px; border-radius: 8px; background: var(--primary-light); color: var(--primary-focus); display: flex; align-items: center; justify-content: center;">
                      ${getIcon('tag', 16)}
                    </div>
                  </td>
                  <td style="font-weight: 700; color: var(--text-main); font-size: 0.9rem;">${c.name}</td>
                  <td><code>${c.id}</code></td>
                  <td>
                    <span class="stock-tag" style="background: #f1f5f9; color: var(--text-main); font-weight: 600;">
                      ${productCount} Produk
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 0.35rem;">
                      <button class="btn btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="window.editCategory('${c.id}')">Edit</button>
                      <button class="btn btn-danger" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="window.deleteCategory('${c.id}')">Hapus</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 3. Master Payment Methods & QRIS
function renderPaymentsView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Data Master Payment Method & QRIS (Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">
            Tabel payment_methods: foto di-upload base64 ke public/uploads, string QRIS otomatis diekstrak, dan dibuat dinamis saat checkout!
          </p>
        </div>
        <button class="btn btn-primary" onclick="window.openPaymentForm()">
          + Tambah Metode Bayar
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Metode</th>
              <th>Tipe</th>
              <th>Info Rekening / NMID</th>
              <th>Gambar QR</th>
              <th>Raw QRIS String</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.paymentMethods.map(pay => `
              <tr>
                <td style="font-weight: 700; color: var(--text-main);">${pay.name}</td>
                <td><span class="role-badge ${pay.type === 'qris' ? 'badge-owner' : 'badge-kasir'}">${pay.type.toUpperCase()}</span></td>
                <td>${pay.account_info || '-'}</td>
                <td>
                  ${pay.image_path ? `
                    <a href="${pay.image_path}" target="_blank">
                      <img src="${pay.image_path}" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover;" onerror="this.src='/poshere_logo.png'"/>
                    </a>
                  ` : '-'}
                </td>
                <td style="max-width: 200px;">
                  ${pay.qris_raw_string ? `
                    <div style="font-family: monospace; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${pay.qris_raw_string}">
                      ${pay.qris_raw_string}
                    </div>
                  ` : '-'}
                </td>
                <td>
                  <span class="role-badge ${pay.is_active ? 'badge-kasir' : 'badge-owner'}">
                    ${pay.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td>
                  <div style="display: flex; gap: 0.35rem;">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem;" onclick="window.editPayment('${pay.id}')">Edit</button>
                    <button class="btn btn-danger" style="padding: 0.25rem 0.5rem;" onclick="window.deletePayment('${pay.id}')">Hapus</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 3.5. Master Cash Registers (Mesin Kasir / POS Station)
function renderRegistersView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Data Master Mesin Kasir / POS Station (Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">
            Tabel cash_registers: Pengaturan stasiun mesin kasir di outlet/toko, kode mesin (POS-01), stasiun printer, dan lokasi counter
          </p>
        </div>
        <button class="btn btn-primary" onclick="window.openRegisterForm()">
          + Tambah Mesin Kasir Baru
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Kode Mesin</th>
              <th>Nama Stasiun Kasir</th>
              <th>Tipe Printer Default</th>
              <th>Lebar Kertas</th>
              <th>Lokasi Counter</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${(state.cashRegisters || []).map(r => `
              <tr>
                <td style="font-weight: 700; color: var(--primary-focus);"><code>${r.device_code}</code></td>
                <td style="font-weight: 600; color: var(--text-main);">${r.name}</td>
                <td><span class="role-badge badge-owner">${r.printer_type ? r.printer_type.toUpperCase() : 'BLUETOOTH'}</span></td>
                <td><span class="stock-tag">${r.paper_width || 58} mm</span></td>
                <td>${r.location || 'Counter'}</td>
                <td>
                  <span class="role-badge ${r.is_active ? 'badge-kasir' : 'badge-owner'}">
                    ${r.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td>
                  <div style="display: flex; gap: 0.35rem;">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem;" onclick="window.editRegister('${r.id}')">Edit</button>
                    <button class="btn btn-danger" style="padding: 0.25rem 0.5rem;" onclick="window.deleteRegister('${r.id}')">Hapus</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 4. Master Users View
function renderUsersView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Data Master User Kasir & Pemilik (Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">Tabel users: id, username, name, role ('owner' | 'kasir'), pin, status</p>
        </div>
        <button class="btn btn-primary" onclick="window.openUserForm()">
          + Tambah User Baru
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nama Lengkap</th>
              <th>Username</th>
              <th>Role</th>
              <th>PIN Akses</th>
              <th>Status</th>
              <th>Dibuat Pada</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map(u => `
              <tr>
                <td style="font-weight: 600; color: var(--text-main);">${u.name}</td>
                <td><code>@${u.username}</code></td>
                <td>
                  <span class="role-badge ${u.role === 'owner' ? 'badge-owner' : 'badge-kasir'}">
                    ${u.role.toUpperCase()}
                  </span>
                </td>
                <td><code>••••</code></td>
                <td>
                  <span class="role-badge ${u.status === 'active' ? 'badge-kasir' : 'badge-owner'}">
                    ${u.status}
                  </span>
                </td>
                <td style="font-size: 0.75rem;">${new Date(u.created_at || Date.now()).toLocaleDateString('id-ID')}</td>
                <td>
                  <div style="display: flex; gap: 0.35rem;">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem;" onclick="window.editUser('${u.id}')">Edit</button>
                    ${u.id !== 'usr_1' ? `
                      <button class="btn btn-danger" style="padding: 0.25rem 0.5rem;" onclick="window.deleteUser('${u.id}')">Hapus</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 5. Transactions History View
function renderTransactionsView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.1rem; font-weight: 700;">Riwayat Transaksi Penjualan (Supabase)</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">Tabel transactions Supabase secara realtime</p>
        </div>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Waktu</th>
              <th>Status</th>
              <th>Kasir</th>
              <th>Pelanggan</th>
              <th>Metode Bayar</th>
              <th>Item Pesanan</th>
              <th>Grand Total</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.transactions.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
                  Belum ada transaksi tersimpan.
                </td>
              </tr>
            ` : state.transactions.map(trx => `
              <tr>
                <td style="font-weight: 700; color: var(--primary-focus);"><code>${trx.invoice_number}</code></td>
                <td style="font-size: 0.75rem;">${new Date(trx.created_at).toLocaleString('id-ID')}</td>
                <td>
                  <span class="role-badge ${trx.status === 'hold' ? 'badge-hold' : 'badge-kasir'}">
                    ${trx.status === 'hold' ? 'HOLD' : 'SELESAI'}
                  </span>
                </td>
                <td>${trx.cashier_name}</td>
                <td>${trx.customer_name || 'Pelanggan'} (${trx.table_number || '-'})</td>
                <td>
                  ${trx.status === 'hold' ? `
                    <span style="font-size: 0.72rem; color: #b45309; font-weight: 600;">Belum Dibayar</span>
                  ` : `
                    <span class="role-badge ${trx.payment_method_name?.toLowerCase().includes('qris') ? 'badge-owner' : 'badge-kasir'}">
                      ${trx.payment_method_name || 'Cash'}
                    </span>
                  `}
                </td>
                <td style="font-size: 0.75rem;">
                  ${(trx.items || []).map(it => `${it.name} (${it.quantity}x)`).join(', ')}
                </td>
                <td style="font-weight: 800; color: var(--text-main);">${formatRupiah(trx.grand_total)}</td>
                <td>
                  <div style="display: flex; gap: 0.35rem;">
                    ${trx.status === 'hold' ? `
                      <button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.recallHoldOrder('${trx.id}'); window.setView('pos');">
                        Lanjutkan
                      </button>
                    ` : `
                      <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem;" onclick="window.viewReceipt('${trx.id}')">
                        Cetak Struk
                      </button>
                    `}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 6. Reports View (Comprehensive Business Intelligence for Owner)
function renderReportsView() {
  // Hanya hitung transaksi yang sudah selesai (bukan hold)
  const trxs = (state.transactions || []).filter(t => t.status !== 'hold');
  
  // Total Omset / Gross Sales
  const totalRevenue = trxs.reduce((sum, t) => sum + Number(t.grand_total || 0), 0);
  const totalTrx = trxs.length;

  // Hitung Estimasi Total HPP (Harga Pokok Penjualan) & Laba Kotor (Gross Profit)
  let totalCost = 0;
  const productSalesMap = {}; // { [prodId]: { name, qty, totalSales, totalProfit } }
  const cashierSalesMap = {}; // { [cashierName]: { count, totalSales } }
  const paymentSalesMap = {}; // { [payMethod]: { count, totalSales } }

  trxs.forEach(t => {
    // Kinerja kasir
    const cName = t.cashier_name || 'Kasir';
    if (!cashierSalesMap[cName]) {
      cashierSalesMap[cName] = { name: cName, count: 0, totalSales: 0 };
    }
    cashierSalesMap[cName].count += 1;
    cashierSalesMap[cName].totalSales += Number(t.grand_total || 0);

    // Kategori pembayaran
    const pName = t.payment_method_name || 'Cash';
    if (!paymentSalesMap[pName]) {
      paymentSalesMap[pName] = { name: pName, count: 0, totalSales: 0 };
    }
    paymentSalesMap[pName].count += 1;
    paymentSalesMap[pName].totalSales += Number(t.grand_total || 0);

    // Hitung produk & HPP
    (t.items || []).forEach(item => {
      const prodInfo = state.products.find(p => p.id === item.product_id);
      const costPerUnit = prodInfo ? Number(prodInfo.cost_price || 0) : Math.round(Number(item.price || 0) * 0.5);
      const itemCostTotal = costPerUnit * item.quantity;
      totalCost += itemCostTotal;

      const pKey = item.product_id || item.name;
      if (!productSalesMap[pKey]) {
        productSalesMap[pKey] = {
          name: item.name,
          qty: 0,
          totalSales: 0,
          totalCost: 0,
          profit: 0
        };
      }
      productSalesMap[pKey].qty += item.quantity;
      productSalesMap[pKey].totalSales += item.subtotal;
      productSalesMap[pKey].totalCost += itemCostTotal;
      productSalesMap[pKey].profit += (item.subtotal - itemCostTotal);
    });
  });

  const grossProfit = totalRevenue - totalCost;
  const profitMarginPercent = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0;
  const avgBasket = totalTrx > 0 ? Math.round(totalRevenue / totalTrx) : 0;

  // Sorting produk terlaris
  const topProducts = Object.values(productSalesMap).sort((a, b) => b.qty - a.qty);
  const topCashiers = Object.values(cashierSalesMap).sort((a, b) => b.totalSales - a.totalSales);
  const paymentBreakdown = Object.values(paymentSalesMap).sort((a, b) => b.totalSales - a.totalSales);

  return `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main);">Laporan & Analisis Penjualan Toko</h2>
          <p style="font-size: 0.78rem; color: var(--text-muted);">Pantau omset, modal hpp, laba kotor, produk terlaris, dan performa kasir</p>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-secondary btn-icon-text" onclick="window.print()" style="font-size: 0.78rem;">
            ${getIcon('printer', 14)} <span>Cetak / PDF Laporan</span>
          </button>
        </div>
      </div>

      <!-- Ringkasan Finansial Utama (KPI Cards) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem;">
        <div class="card" style="border-left: 4px solid var(--primary); background: #ffffff;">
          <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">TOTAL OMSET (GROSS SALES)</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: var(--primary-focus); margin-top: 0.25rem;">
            ${formatRupiah(totalRevenue)}
          </div>
          <div style="font-size: 0.72rem; color: #10b981; margin-top: 0.35rem; font-weight: 600; display: flex; align-items: center; gap: 0.3rem;">
            ${getIcon('check-circle', 13)} <span>${totalTrx} Total Transaksi Sukses</span>
          </div>
        </div>

        <div class="card" style="border-left: 4px solid #10b981; background: #ffffff;">
          <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">ESTIMASI LABA KOTOR (GROSS PROFIT)</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #10b981; margin-top: 0.25rem;">
            ${formatRupiah(grossProfit)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.35rem;">
            Margin Keuntungan: <strong style="color: #10b981;">${profitMarginPercent}%</strong>
          </div>
        </div>

        <div class="card" style="border-left: 4px solid #f59e0b; background: #ffffff;">
          <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">ESTIMASI TOTAL HPP / MODAL</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #f59e0b; margin-top: 0.25rem;">
            ${formatRupiah(totalCost)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.35rem;">
            Biaya bahan baku produk
          </div>
        </div>

        <div class="card" style="border-left: 4px solid #ec4899; background: #ffffff;">
          <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">RATA-RATA TRANSAKSI (AOV)</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #ec4899; margin-top: 0.25rem;">
            ${formatRupiah(avgBasket)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.35rem;">
            Rata-rata belanja per tamu
          </div>
        </div>
      </div>

      <!-- Detail Grid: Produk Terlaris & Metode Pembayaran -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
        <!-- Card 1: Produk Paling Laris & Keuntungan Tiap Produk -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">Menu Terlaris & Margin Produk</h3>
            <span style="font-size: 0.72rem; color: var(--text-muted);">${topProducts.length} Menu Terjual</span>
          </div>

          <div class="data-table-wrap" style="border: none;">
            <table class="data-table" style="font-size: 0.8rem;">
              <thead>
                <tr>
                  <th>Nama Menu</th>
                  <th style="text-align: center;">Terjual</th>
                  <th style="text-align: right;">Total Penjualan</th>
                  <th style="text-align: right;">Est. Laba</th>
                </tr>
              </thead>
              <tbody>
                ${topProducts.length === 0 ? `
                  <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Belum ada menu yang terjual</td>
                  </tr>
                ` : topProducts.slice(0, 7).map((p, idx) => `
                  <tr>
                    <td>
                      <div style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 0.35rem;">
                        ${idx === 0 ? `<span style="color: #f59e0b; display: inline-flex;">${getIcon('award', 14)}</span>` : ''}
                        <span>${p.name}</span>
                      </div>
                    </td>
                    <td style="text-align: center;"><span class="stock-tag" style="background:#ede9fe; color:#6d28d9; font-weight:700;">${p.qty} item</span></td>
                    <td style="text-align: right; font-weight: 600;">${formatRupiah(p.totalSales)}</td>
                    <td style="text-align: right; font-weight: 700; color: #10b981;">+${formatRupiah(p.profit)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Card 2: Metode Pembayaran (Cash vs QRIS) -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">Distribusi Jalur Pembayaran</h3>
            <span style="font-size: 0.72rem; color: var(--text-muted);">Realisasi Kasir</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.65rem;">
            ${paymentBreakdown.length === 0 ? `
              <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8rem;">Belum ada riwayat pembayaran</div>
            ` : paymentBreakdown.map(pay => {
              const pct = totalRevenue > 0 ? ((pay.totalSales / totalRevenue) * 100).toFixed(0) : 0;
              const isQris = pay.name.toLowerCase().includes('qris');
              return `
                <div style="background: #fafafa; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.75rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                    <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
                      <span style="color: ${isQris ? 'var(--primary)' : '#10b981'}; display: inline-flex;">
                        ${isQris ? getIcon('qr-code', 15) : getIcon('banknote', 15)}
                      </span>
                      <span>${pay.name}</span>
                    </div>
                    <div style="font-weight: 800; font-size: 0.9rem; color: ${isQris ? 'var(--primary-focus)' : '#10b981'};">
                      ${formatRupiah(pay.totalSales)}
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-muted);">
                    <span>${pay.count} Transaksi</span>
                    <span>${pct}% dari Total Omset</span>
                  </div>
                  <!-- Progress bar -->
                  <div style="width: 100%; height: 6px; background: #e2e8f0; border-radius: 99px; margin-top: 0.4rem; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${isQris ? 'var(--primary)' : '#10b981'};"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Kinerja Kasir / Operator Shift -->
      <div class="card">
        <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.75rem;">
          Laporan Kinerja Kasir & Operator
        </h3>
        <div class="data-table-wrap" style="border: none;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nama Kasir / Staff</th>
                <th>Total Struk Dibuat</th>
                <th>Total Nominal Penjualan</th>
                <th>Kontribusi Penjualan</th>
              </tr>
            </thead>
            <tbody>
              ${topCashiers.length === 0 ? `
                <tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Belum ada penjualan oleh kasir</td></tr>
              ` : topCashiers.map(c => {
                const kontribusi = totalRevenue > 0 ? ((c.totalSales / totalRevenue) * 100).toFixed(1) : 0;
                return `
                  <tr>
                    <td style="font-weight: 600; color: var(--text-main);">
                      <div style="display: inline-flex; align-items: center; gap: 0.4rem;">
                        <span style="color: var(--primary); display: inline-flex;">${getIcon('user', 14)}</span>
                        <span>${c.name}</span>
                      </div>
                    </td>
                    <td><span class="stock-tag">${c.count} pesanan</span></td>
                    <td style="font-weight: 800; color: var(--primary-focus);">${formatRupiah(c.totalSales)}</td>
                    <td>
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 0.75rem; font-weight: 600;">${kontribusi}%</span>
                        <div style="flex: 1; max-width: 120px; height: 6px; background: #e2e8f0; border-radius: 99px; overflow: hidden;">
                          <div style="width: ${kontribusi}%; height: 100%; background: var(--primary);"></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 7. Settings View (Supabase URL & Key Configuration)
function renderSettingsView() {
  return `
    <div style="max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- MySQL Local (XAMPP) Card -->
      <div class="card" style="border: 1px solid var(--border-light); background: #ffffff; padding: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: #f0fdf4; color: #16a34a; display: flex; align-items: center; justify-content: center;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            </div>
            <div>
              <h2 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main); margin: 0;">Database MySQL Server (XAMPP)</h2>
              <span style="font-size: 0.78rem; color: var(--text-muted);">Penyimpanan data lokal transaksi, produk, dan kasir</span>
            </div>
          </div>
          <span id="mysql-badge-status" style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; background: #ecfdf5; color: #059669; font-weight: 700; padding: 4px 10px; border-radius: 99px; border: 1px solid #a7f3d0;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981;"></span>
            <span>PORT 3306 ONLINE</span>
          </span>
        </div>

        <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 12px; padding: 1rem; margin: 1.25rem 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; font-size: 0.8rem;">
          <div>
            <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; font-weight: 600;">Database Name</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem; margin-top: 2px;">poshere</div>
          </div>
          <div>
            <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; font-weight: 600;">Host & Port</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem; margin-top: 2px;">127.0.0.1:3306</div>
          </div>
          <div>
            <div style="color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; font-weight: 600;">Data Tersimpan</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem; margin-top: 2px;">
              ${(state.products || []).length} Produk / ${(state.categories || []).length} Kategori
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-primary btn-icon-text" onclick="window.syncLocalStorageToMySQL()" style="padding: 10px 18px;">
            ${getIcon('save', 16)} <span>Sinkronisasi Data ke MySQL Database</span>
          </button>
          <button type="button" class="btn btn-secondary btn-icon-text" onclick="window.pullDataFromMySQL()" style="padding: 10px 18px;">
            ${getIcon('package', 16)} <span>Ambil Data Terbaru dari MySQL</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// 7.5. Thermal Printer Management View
function renderPrinterView() {
  const isBluetoothSupported = printerService.isBluetoothSupported();
  const isSerialSupported = printerService.isSerialSupported();
  const connected = printerService.isConnected;

  return `
    <div style="max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem;">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main);">Koneksi Mesin Cetak Struk (Thermal ESC/POS)</h2>
            <p style="font-size: 0.78rem; color: var(--text-muted);">
              Hubungkan printer thermal 58mm / 80mm kasir via Bluetooth atau Kabel USB Serial langsung dari browser!
            </p>
          </div>
          <span class="role-badge ${connected ? 'badge-kasir' : 'badge-owner'}" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${connected ? '#10b981' : '#94a3b8'};"></span>
            <span>${connected ? 'TERHUBUNG' : 'BELUM TERHUBUNG'}</span>
          </span>
        </div>

        <div style="background: #faf5ff; border: 1px solid var(--primary-border); border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary-focus); margin-bottom: 0.25rem;">
            Mode Mesin Cetak Aktif
          </div>
          <p style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.6;">
            Aplikasi siap mencetak struk kasir otomatis dengan format thermal ESC/POS standar. Jika printer fisik belum dipairing, sistem secara cerdas akan menggunakan <strong>Dialog Cetak Bawaan / Save PDF</strong>.
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Lebar Kertas Thermal Printer</label>
          <select id="printer-paper-width" class="form-control" onchange="window.setPrinterWidth(this.value)">
            <option value="58" ${printerService.paperWidth === 58 ? 'selected' : ''}>Kertas 58 mm (Standar Printer Bluetooth Mini Kasir)</option>
            <option value="80" ${printerService.paperWidth === 80 ? 'selected' : ''}>Kertas 80 mm (Printer Desktop Kasir Besar / Auto Cutter)</option>
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-top: 1rem;">
          <!-- Bluetooth Card -->
          <div style="border: 1px solid var(--border-light); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
              <span style="color: var(--primary); display: inline-flex;">${getIcon('bluetooth', 16)}</span>
              <span>Bluetooth Printer</span>
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); flex: 1;">
              Untuk printer bluetooth mini portable kasir (seperti RPP02N, Panda, Iware, Zywell, dll).
            </p>
            <button class="btn btn-primary" onclick="window.connectBluetoothPrinter()" ${!isBluetoothSupported ? 'title="Gunakan Chrome/Edge"' : ''}>
              ${connected ? 'Re-Connect Bluetooth' : 'Hubungkan Bluetooth'}
            </button>
            ${!isBluetoothSupported ? `<span style="font-size:0.65rem; color:#ef4444;">Browser perlu Web Bluetooth (Chrome/Edge Android/Win)</span>` : ''}
          </div>

          <!-- USB Serial Card -->
          <div style="border: 1px solid var(--border-light); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
              <span style="color: var(--primary); display: inline-flex;">${getIcon('cable', 16)}</span>
              <span>Kabel USB / COM Serial</span>
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); flex: 1;">
              Untuk printer kasir yang dicolok kabel USB ke komputer kasir (Epson, Panda, Xprinter).
            </p>
            <button class="btn btn-secondary" onclick="window.connectUsbPrinter()">
              Hubungkan Kabel USB
            </button>
            ${!isSerialSupported ? `<span style="font-size:0.65rem; color:#ef4444;">Browser perlu Web Serial (Chrome/Edge Desktop)</span>` : ''}
          </div>
        </div>

        <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 0.5rem;">
          <button class="btn btn-success btn-icon-text" onclick="window.testPrintThermal()">
            ${getIcon('printer', 15)} <span>Tes Cetak Struk Uji Coba</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// 8. Modals Renderer
function renderModal() {
  if (!state.modalState.isOpen) return '';
  const { type, data } = state.modalState;

  // STEP 1: Modal Pilih Metode Pembayaran Pertama Kali saat Checkout
  if (type === 'payment_select_method') {
    const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);

    return `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">Pilih Metode Pembayaran</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <div class="modal-body">
            <div style="background: var(--primary-light); padding: 0.85rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary);">Total Tagihan Pesanan:</div>
              <div style="font-size: 1.35rem; font-weight: 800; color: var(--primary-focus);">${formatRupiah(grandTotal)}</div>
            </div>

            <div class="form-group">
              <label class="form-label">Pilih Metode Pembayaran Pelanggan *</label>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                ${state.paymentMethods.filter(p => p.is_active).map(p => `
                  <div onclick="window.confirmSelectedPaymentMethod('${p.id}')" 
                       style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border: 1.5px solid var(--border-light); border-radius: 10px; cursor: pointer; transition: all 0.2s;"
                       onmouseover="this.style.borderColor='var(--primary)'; this.style.background='#faf5ff';"
                       onmouseout="this.style.borderColor='var(--border-light)'; this.style.background='white';">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                      <span style="color: var(--primary); display: inline-flex;">
                        ${p.type === 'qris' ? getIcon('qr-code', 20) : p.type === 'transfer' ? getIcon('building', 20) : p.type === 'ewallet' ? getIcon('smartphone', 20) : getIcon('banknote', 20)}
                      </span>
                      <div>
                        <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">${p.name}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${p.account_info || (p.type === 'qris' ? 'QRIS Dinamis Otomatis' : 'Kasir')}</div>
                      </div>
                    </div>
                    <span class="role-badge ${p.type === 'qris' ? 'badge-owner' : 'badge-kasir'}">
                      ${p.type.toUpperCase()}
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
          </div>
        </div>
      </div>
    `;
  }

  // STEP 3: Modal Final Kasir (Checkout & Pembayaran) setelah close / klik tombol selesai di Customer Display
  if (type === 'payment_checkout') {
    const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);
    const selectedPay = state.selectedCheckoutPayment || state.paymentMethods[0] || {};

    return `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">Checkout & Pembayaran</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <div class="modal-body">
            <div style="background: var(--primary-light); padding: 0.85rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary);">Total Tagihan:</div>
              <div style="font-size: 1.35rem; font-weight: 800; color: var(--primary-focus);">${formatRupiah(grandTotal)}</div>
            </div>

            <div class="form-group">
              <label class="form-label">Nama Pelanggan (Opsional)</label>
              <input type="text" id="checkout-customer-name" class="form-control" placeholder="Contoh: Budi / Meja 05" value="${state.checkoutCustomerName || 'Pelanggan'}"/>
            </div>

            <div class="form-group">
              <label class="form-label">Nomor Meja</label>
              <input type="text" id="checkout-table-number" class="form-control" placeholder="Nomor Meja (opsional)" value="${state.checkoutTableNumber || 'Meja 1'}"/>
            </div>

            <div class="form-group">
              <label class="form-label">Pilih Metode Pembayaran</label>
              <select id="checkout-payment-id" class="form-control" onchange="window.onPaymentMethodChange(this.value)">
                ${state.paymentMethods.filter(p => p.is_active).map(p => `
                  <option value="${p.id}" ${selectedPay.id === p.id ? 'selected' : ''}>${p.name} (${p.type.toUpperCase()})</option>
                `).join('')}
              </select>
            </div>

            <div id="qris-checkout-container" style="display: none;">
              <div class="qris-display-box">
                <div style="font-size: 0.8rem; font-weight: 700; color: var(--primary-focus);">QRIS DINAMIS OTOMATIS</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                  Scan QR ini, nominal <strong>${formatRupiah(grandTotal)}</strong> otomatis terisi tanpa ketik manual!
                </div>
                <div class="qris-canvas-wrapper">
                  <canvas id="qris-dynamic-canvas"></canvas>
                </div>
                <div style="margin-top: 0.5rem; font-size: 0.68rem; font-family: monospace; color: #64748b; word-break: break-all;" id="qris-dynamic-string-display">
                </div>
              </div>
            </div>

            <div id="cash-checkout-container" class="form-group" style="margin-top: 0.85rem;">
              <label class="form-label">Nominal Uang Diterima (Rp)</label>
              <input type="number" id="checkout-paid-amount" class="form-control" value="${grandTotal}" min="${grandTotal}" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
            <button class="btn btn-success btn-icon-text" onclick="window.processPaymentSubmit()">
              ${getIcon('check', 15)} <span>Selesaikan Transaksi</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (type === 'receipt') {
    const trx = data;
    return `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width: 380px;">
          <div class="modal-header">
            <h3 style="font-size: 0.95rem; font-weight: 700;">Struk Transaksi</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <div class="modal-body" id="receipt-printable">
            <div style="text-align: center; margin-bottom: 1rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.75rem;">
              <h2 style="font-size: 1.15rem; font-weight: 800; color: var(--primary-focus);">POShere Store</h2>
              <div style="font-size: 0.75rem; color: #64748b;">Smart Point of Sale & Retail</div>
              <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 0.25rem;">${trx.invoice_number}</div>
              <div style="font-size: 0.7rem; color: #94a3b8;">${new Date(trx.created_at).toLocaleString('id-ID')}</div>
            </div>

            <div style="font-size: 0.75rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
              <span>Kasir: <strong>${trx.cashier_name}</strong></span>
              <span>Meja / Ref: <strong>${trx.table_number || '-'}</strong></span>
            </div>

            <div style="border-top: 1px dashed #cbd5e1; border-bottom: 1px dashed #cbd5e1; padding: 0.5rem 0; margin-bottom: 0.5rem;">
              ${(trx.items || []).map(it => `
                <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 0.25rem;">
                  <span>${it.name} x${it.quantity}</span>
                  <span>${formatRupiah(it.subtotal)}</span>
                </div>
              `).join('')}
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem;">
              <div style="display: flex; justify-content: space-between;">
                <span>Subtotal:</span>
                <span>${formatRupiah(trx.subtotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 0.95rem; border-top: 1px solid #e2e8f0; padding-top: 0.25rem;">
                <span>Total:</span>
                <span style="color: var(--primary-focus);">${formatRupiah(trx.grand_total)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; color: #64748b;">
                <span>Bayar (${trx.payment_method_name}):</span>
                <span>${formatRupiah(trx.paid_amount)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; color: #64748b;">
                <span>Kembalian:</span>
                <span>${formatRupiah(trx.change_amount)}</span>
              </div>
            </div>

            <div style="text-align: center; margin-top: 1.25rem; font-size: 0.72rem; color: #94a3b8;">
              Terima Kasih Atas Kunjungan Anda!<br/>
              Struk Resmi Transaksi POShere
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.closeModal()">Tutup</button>
            <button class="btn btn-secondary btn-icon-text" onclick="window.print()">
              ${getIcon('file-text', 14)} <span>Print Dialog</span>
            </button>
            <button class="btn btn-primary btn-icon-text" onclick="window.printToThermalPrinter()">
              ${getIcon('printer', 14)} <span>Cetak ke Thermal Printer</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (type === 'category_form') {
    const cat = data || {};
    return `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.45rem;">
              <span style="color: var(--primary); display: inline-flex;">${getIcon('tag', 16)}</span>
              <span>${cat.id ? 'Edit Kategori' : 'Tambah Kategori Baru'}</span>
            </h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.saveCategoryForm(event, '${cat.id || ''}')">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nama Kategori *</label>
                <input type="text" id="catform-name" class="form-control" required value="${cat.name || ''}" placeholder="Misal: Coffee, Non-Coffee, Snack, Bakery, Retail"/>
              </div>

              <div class="form-group">
                <label class="form-label">Kode / ID Kategori (Opsional)</label>
                <input type="text" id="catform-id" class="form-control" value="${cat.id || ''}" placeholder="Misal: cat_matcha, cat_snack (dibuat otomatis jika kosong)" ${cat.id ? 'disabled' : ''}/>
                <small style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; display: block;">
                  ID unik kategori sebagai referensi di database Supabase.
                </small>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary btn-icon-text">
                ${getIcon('save', 15)} <span>Simpan Kategori</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (type === 'product_form') {
    const prod = data || {};
    return `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">${prod.id ? 'Edit Produk' : 'Tambah Produk Baru'}</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.saveProductForm(event, '${prod.id || ''}')">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nama Produk / Minuman *</label>
                <input type="text" id="pform-name" class="form-control" required value="${prod.name || ''}" placeholder="Misal: Caramel Latte Ice"/>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="form-group">
                  <label class="form-label">Kategori *</label>
                  <select id="pform-cat" class="form-control">
                    ${state.categories.map(c => `
                      <option value="${c.id}" ${prod.category_id === c.id ? 'selected' : ''}>${c.name}</option>
                    `).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">SKU / Kode</label>
                  <input type="text" id="pform-sku" class="form-control" value="${prod.sku || ''}" placeholder="KOD-001"/>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="form-group">
                  <label class="form-label">Harga Jual (Rp) *</label>
                  <input type="number" id="pform-price" class="form-control" required value="${prod.price || ''}" placeholder="20000"/>
                </div>
                <div class="form-group">
                  <label class="form-label">Harga Pokok/Modal (Rp)</label>
                  <input type="number" id="pform-cost" class="form-control" value="${prod.cost_price || ''}" placeholder="10000"/>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Stok Tersedia *</label>
                <input type="number" id="pform-stock" class="form-control" required value="${prod.stock !== undefined ? prod.stock : 50}"/>
              </div>

              <div class="form-group">
                <label class="form-label">Upload Foto Produk (Base64 -> Public Folder)</label>
                <input type="file" id="pform-file" class="form-control" accept="image/*" onchange="window.handleProductImageUpload(this)"/>
                <input type="hidden" id="pform-image-path" value="${prod.image_path || ''}"/>
                <div id="pform-preview" style="margin-top: 0.5rem;">
                  ${prod.image_path ? `<img src="${prod.image_path}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;"/>` : ''}
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary">Simpan ke Database</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (type === 'payment_form') {
    const pay = data || {};
    return `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">${pay.id ? 'Edit Metode Pembayaran' : 'Tambah Metode Pembayaran'}</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.savePaymentForm(event, '${pay.id || ''}')">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nama Metode Bayar *</label>
                <input type="text" id="payform-name" class="form-control" required value="${pay.name || ''}" placeholder="Misal: QRIS BCA / ShopeePay"/>
              </div>

              <div class="form-group">
                <label class="form-label">Tipe Metode Pembayaran *</label>
                <select id="payform-type" class="form-control" onchange="window.togglePaymentTypeFields(this.value)">
                  <option value="qris" ${pay.type === 'qris' ? 'selected' : ''}>QRIS (Statis ke Dinamis)</option>
                  <option value="cash" ${pay.type === 'cash' ? 'selected' : ''}>Cash / Tunai</option>
                  <option value="transfer" ${pay.type === 'transfer' ? 'selected' : ''}>Transfer Bank (BCA, BRI, Mandiri, BNI)</option>
                  <option value="ewallet" ${pay.type === 'ewallet' ? 'selected' : ''}>E-Wallet (GoPay, OVO, ShopeePay, DANA)</option>
                  <option value="edc" ${pay.type === 'edc' ? 'selected' : ''}>Mesin EDC Gesek / Card Reader</option>
                  <option value="debit" ${pay.type === 'debit' ? 'selected' : ''}>Kartu Debit / Kredit</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Keterangan / Nomor Rekening / Bank / NMID</label>
                <input type="text" id="payform-info" class="form-control" value="${pay.account_info || ''}" placeholder="Misal: BCA 88392019 a.n Toko"/>
              </div>

              <div id="payform-qris-section" style="${pay.type !== 'qris' ? 'display:none;' : ''}">
                <div class="form-group" style="background: #faf5ff; padding: 0.85rem; border-radius: var(--radius-sm); border: 1px dashed var(--primary-border);">
                  <label class="form-label" style="color: var(--primary-focus);">Upload Gambar QRIS (Base64 ke public/uploads)</label>
                  <p style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                    Upload foto QRIS toko. Sistem otomatis <strong>membaca QR code menjadi string teks</strong>!
                  </p>
                  <input type="file" id="payform-file" class="form-control" accept="image/*" onchange="window.handleQrisImageUpload(this)"/>
                  <input type="hidden" id="payform-image-path" value="${pay.image_path || ''}"/>
                  <div id="pform-preview" style="margin-top: 0.5rem;">
                    ${pay.image_path ? `<img src="${pay.image_path}" style="width: 80px; height: 80px; border-radius: 8px; object-fit: contain;"/>` : ''}
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label">String QRIS Statis</label>
                  <textarea id="payform-qris-string" class="form-control" rows="3" placeholder="000201010211...">${pay.qris_raw_string || ''}</textarea>
                  <small style="font-size: 0.7rem; color: var(--text-muted);">
                    String ini yang akan diubah menjadi QRIS dinamis secara otomatis pada setiap transaksi.
                  </small>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary">Simpan ke Database</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (type === 'user_form') {
    const user = data || {};
    return `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">${user.id ? 'Edit User' : 'Tambah User Baru'}</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.saveUserForm(event, '${user.id || ''}')">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nama Lengkap *</label>
                <input type="text" id="uform-name" class="form-control" required value="${user.name || ''}" placeholder="Nama Karyawan/Kasir"/>
              </div>

              <div class="form-group">
                <label class="form-label">Username *</label>
                <input type="text" id="uform-username" class="form-control" required value="${user.username || ''}" placeholder="kasir_pagi"/>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="form-group">
                  <label class="form-label">Role Akses *</label>
                  <select id="uform-role" class="form-control">
                    <option value="kasir" ${user.role === 'kasir' ? 'selected' : ''}>Kasir (Hanya POS & Struk)</option>
                    <option value="owner" ${user.role === 'owner' ? 'selected' : ''}>Pemilik / Owner (Akses Penuh)</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label">PIN Masuk (4-6 Digit)</label>
                  <input type="password" id="uform-pin" maxlength="6" class="form-control" value="${user.pin || '1234'}"/>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary">Simpan User</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Modal Register Form (Mesin Kasir / POS Station)
  if (type === 'register_form') {
    const reg = data || {};
    return `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700;">${reg.id ? 'Edit Mesin Kasir' : 'Tambah Mesin Kasir Baru'}</h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.saveRegisterForm(event, '${reg.id || ''}')">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nama Stasiun Kasir *</label>
                <input type="text" id="regform-name" class="form-control" required value="${reg.name || ''}" placeholder="Misal: Mesin Kasir Bar Utama"/>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="form-group">
                  <label class="form-label">Kode Device / Mesin *</label>
                  <input type="text" id="regform-code" class="form-control" required value="${reg.device_code || ''}" placeholder="POS-01"/>
                </div>
                <div class="form-group">
                  <label class="form-label">Lokasi Counter</label>
                  <input type="text" id="regform-loc" class="form-control" value="${reg.location || 'Counter Depan'}" placeholder="Counter Depan"/>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="form-group">
                  <label class="form-label">Koneksi Printer Bawaan</label>
                  <select id="regform-printer-type" class="form-control">
                    <option value="bluetooth" ${reg.printer_type === 'bluetooth' ? 'selected' : ''}>Bluetooth Thermal</option>
                    <option value="usb_serial" ${reg.printer_type === 'usb_serial' ? 'selected' : ''}>Kabel USB Serial</option>
                    <option value="system" ${reg.printer_type === 'system' ? 'selected' : ''}>Sistem Browser</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Lebar Kertas Default</label>
                  <select id="regform-paper" class="form-control">
                    <option value="58" ${reg.paper_width === 58 ? 'selected' : ''}>58 mm (Mini)</option>
                    <option value="80" ${reg.paper_width === 80 ? 'selected' : ''}>80 mm (Besar)</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary">Simpan Mesin Kasir</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // MODAL FORM: Simpan / Hold Pesanan (Open Bill)
  if (type === 'hold_form') {
    const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);
    const isEdit = Boolean(state.activeHoldTransactionId);

    return `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h3 style="font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.45rem;">
              <span style="color: #b45309; display: inline-flex;">${getIcon('pause', 16)}</span>
              <span>${isEdit ? 'Perbarui Hold / Open Bill' : 'Simpan / Hold Pesanan (Open Bill)'}</span>
            </h3>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <form onsubmit="window.saveHoldOrder(event)">
            <div class="modal-body">
              <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 0.85rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
                <div style="font-size: 0.72rem; color: #92400e;">Total Pesanan Sementara:</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: #b45309;">${formatRupiah(grandTotal)}</div>
                <div style="font-size: 0.7rem; color: #b45309; margin-top: 0.2rem;">
                  ${state.cart.reduce((s, it) => s + it.quantity, 0)} item pesanan siap disimpan ke Open Bills
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Nama Pelanggan / Tamu *</label>
                <input type="text" id="hold-customer-name" class="form-control" required placeholder="Contoh: Budi / Meja 05" value="${state.cartCustomerName || ''}" autofocus/>
              </div>

              <div class="form-group">
                <label class="form-label">Nomor Meja / Lokasi *</label>
                <input type="text" id="hold-table-number" class="form-control" required placeholder="Contoh: Meja 3 / Lantai 2" value="${state.cartTableNumber || 'Meja 1'}"/>
              </div>

              <div class="form-group">
                <label class="form-label">Catatan Tambahan (Opsional)</label>
                <input type="text" id="hold-note" class="form-control" placeholder="Contoh: Tamu mau nambah nanti"/>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Batal</button>
              <button type="submit" class="btn btn-primary btn-icon-text" style="background: #d97706; border-color: #d97706;">
                ${getIcon('save', 15)} <span>${isEdit ? 'Simpan Perubahan' : 'Hold & Bersihkan Kasir'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // MODAL LIST: Daftar Pesanan Di-Hold (Open Bills)
  if (type === 'hold_orders') {
    const holdBills = (state.transactions || []).filter(t => t.status === 'hold');

    return `
      <div class="modal-overlay">
        <div class="modal-content" style="max-width: 620px;">
          <div class="modal-header">
            <div>
              <h3 style="font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.45rem;">
                <span style="color: #b45309; display: inline-flex;">${getIcon('clipboard-list', 16)}</span>
                <span>Daftar Tagihan Terbuka (Open Bills)</span>
              </h3>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.15rem;">
                ${holdBills.length} pesanan sedang di-hold. Klik "Ambil & Lanjutkan" untuk memproses ke kasir / checkout.
              </div>
            </div>
            <button class="modal-close-btn" onclick="window.closeModal()">${getIcon('close', 16)}</button>
          </div>
          <div class="modal-body" style="max-height: 480px; overflow-y: auto;">
            ${holdBills.length === 0 ? `
              <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                <div style="color: #cbd5e1; display: inline-flex; margin-bottom: 0.5rem;">${getIcon('check-circle', 40)}</div>
                <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">Tidak Ada Pesanan yang Di-Hold</h4>
                <p style="font-size: 0.75rem; margin-top: 0.25rem;">Semua transaksi telah selesai atau dibayar.</p>
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                ${holdBills.map(b => `
                  <div style="border: 1.5px solid #fde68a; background: #fffdf5; border-radius: var(--radius-sm); padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span style="font-weight: 800; font-size: 0.95rem; color: var(--text-main);">${b.customer_name}</span>
                          <span class="role-badge badge-owner" style="background: #fef3c7; color: #b45309;">${b.table_number || 'Tanpa Meja'}</span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">
                          Invoice: <code>${b.invoice_number}</code> • Waktu: ${new Date(b.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • Kasir: ${b.cashier_name}
                        </div>
                        ${b.note ? `<div style="font-size: 0.72rem; color: #b45309; margin-top: 0.15rem; display: flex; align-items: center; gap: 0.3rem;">
                          <span style="display: inline-flex;">${getIcon('message-square', 12)}</span>
                          <span>${b.note}</span>
                        </div>` : ''}
                      </div>
                      <div style="text-align: right;">
                        <div style="font-size: 1.15rem; font-weight: 800; color: #b45309;">${formatRupiah(b.grand_total)}</div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">${(b.items || []).reduce((s, it) => s + it.quantity, 0)} item</div>
                      </div>
                    </div>

                    <!-- Ringkasan Item -->
                    <div style="background: white; border-radius: 6px; padding: 0.45rem 0.65rem; font-size: 0.74rem; color: var(--text-main); border: 1px dashed #fde68a;">
                      ${(b.items || []).map(it => `<span>${it.name} <strong>x${it.quantity}</strong></span>`).join(' • ')}
                    </div>

                    <!-- Tombol Aksi -->
                    <div style="display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.25rem;">
                      <button class="btn btn-danger" style="padding: 0.3rem 0.65rem; font-size: 0.75rem;" onclick="window.deleteHoldOrder('${b.id}')">
                        Batalkan
                      </button>
                      <button class="btn btn-secondary btn-icon-text" style="padding: 0.3rem 0.65rem; font-size: 0.75rem;" onclick="window.printHoldOrderBill('${b.id}')">
                        ${getIcon('printer', 13)} <span>Cetak Bill</span>
                      </button>
                      <button class="btn btn-success btn-icon-text" style="padding: 0.3rem 0.85rem; font-size: 0.75rem; font-weight: 700;" onclick="window.recallHoldOrder('${b.id}')">
                        ${getIcon('arrow-right', 13)} <span>Ambil & Lanjutkan</span>
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.closeModal()">Tutup</button>
          </div>
        </div>
      </div>
    `;
  }

  return '';
}

// Checkout QRIS Dynamic Generator
let dynamicQrisStringCache = '';
function handleCheckoutModalRender() {
  setTimeout(() => {
    const paySelect = document.getElementById('checkout-payment-id');
    if (paySelect) {
      window.onPaymentMethodChange(paySelect.value);
    }
  }, 50);
}

window.onPaymentMethodChange = function(payId) {
  const method = state.paymentMethods.find(p => p.id === payId);
  const qrisContainer = document.getElementById('qris-checkout-container');
  const cashContainer = document.getElementById('cash-checkout-container');
  const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);

  state.selectedCheckoutPayment = method;

  if (method && method.type === 'qris') {
    if (qrisContainer) qrisContainer.style.display = 'block';
    if (cashContainer) cashContainer.style.display = 'none';

    const rawQris = method.qris_raw_string || '00020101021126650014ID.GO.IDR.WWW011893600998000001234502150001234567890120303UMI51660014ID.LINKAJA.WWW011893600821000001234502150001234567890120303UMI5204581253033605802ID5914POSHERE COFFEE6007JAKARTA61051234063040ADB';
    try {
      const dynamicQris = convertStaticQrisToDynamic(rawQris, grandTotal);
      dynamicQrisStringCache = dynamicQris;

      const canvas = document.getElementById('qris-dynamic-canvas');
      const textDisplay = document.getElementById('qris-dynamic-string-display');

      if (canvas) {
        QRCode.toCanvas(canvas, dynamicQris, {
          width: 220,
          margin: 1,
          color: {
            dark: '#1e1b4b',
            light: '#ffffff'
          }
        });
      }
      if (textDisplay) {
        textDisplay.textContent = dynamicQris;
      }
    } catch (e) {
      console.error('Error generating dynamic QRIS', e);
    }
  } else {
    if (qrisContainer) qrisContainer.style.display = 'none';
    if (cashContainer) cashContainer.style.display = 'block';
    dynamicQrisStringCache = '';
  }

  // Jika customer display terbuka, sinkronkan tampilannya secara real-time!
  if (state.isCustomerDisplayOpen) {
    updateCustomerDisplayView();
  }
};

// Window Handlers
window.setView = function(v) {
  state.currentView = v;
  state.isMobileSidebarOpen = false;
  renderApp();
};

window.setCategory = function(catId) {
  state.selectedCategory = catId;
  renderApp();
};

window.setSearch = function(text) {
  state.searchQuery = text;
  renderApp();
};

window.toggleSidebar = function() {
  state.isMobileSidebarOpen = !state.isMobileSidebarOpen;
  renderApp();
};

window.addToCart = addToCart;
window.updateCartQty = updateCartQty;
window.clearCart = clearCart;
window.switchRole = switchRole;
window.closeModal = closeModal;

// Flow Baru:
// 1. Klik Bayar/Checkout -> Buka Modal Pilih Metode Pembayaran (Cash, QRIS, Transfer, dll)
window.startCheckout = function() {
  if (state.cart.length === 0) return;
  state.isCustomerDisplayOpen = false;
  openModal('payment_select_method');
};

// 2. Setelah Kasir Memilih Payment Method -> Tutup modal pilih, lalu BUKA CUSTOMER DISPLAY (konfirmasi pembayaran terlampir)
window.confirmSelectedPaymentMethod = function(paymentId) {
  const method = state.paymentMethods.find(p => p.id === paymentId);
  state.selectedCheckoutPayment = method;

  // Tutup modal pemilihan kasir, lalu TAMPILKAN DISPLAY CUSTOMER
  closeModal();
  state.isCustomerDisplayOpen = true;
  renderApp();

  // Sinkronkan QRIS dinamis jika metode QRIS
  if (method && method.type === 'qris') {
    const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);
    const rawQris = method.qris_raw_string || '00020101021126650014ID.GO.IDR.WWW011893600998000001234502150001234567890120303UMI51660014ID.LINKAJA.WWW011893600821000001234502150001234567890120303UMI5204581253033605802ID5914POSHERE COFFEE6007JAKARTA61051234063040ADB';
    try {
      dynamicQrisStringCache = convertStaticQrisToDynamic(rawQris, grandTotal);
    } catch (e) {}
    renderCustomerDisplayQr();
  }
};

window.processPaymentSubmit = async function() {
  const payId = document.getElementById('checkout-payment-id').value;
  const custName = document.getElementById('checkout-customer-name').value || 'Pelanggan Umum';
  const tableNum = document.getElementById('checkout-table-number').value || '-';
  const method = state.paymentMethods.find(p => p.id === payId);
  const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);

  let paidAmount = grandTotal;
  if (method && method.type === 'cash') {
    paidAmount = Number(document.getElementById('checkout-paid-amount').value) || grandTotal;
    if (paidAmount < grandTotal) {
      alert('Uang yang dibayarkan kurang dari total pesanan!');
      return;
    }
  }

  const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const payload = {
    invoice_number: invoiceNumber,
    cashier_user_id: state.currentUser.id,
    cashier_name: state.currentUser.name,
    payment_method_id: payId,
    payment_method_name: method ? method.name : 'Cash',
    customer_name: custName,
    table_number: tableNum,
    items: state.cart,
    subtotal: grandTotal,
    grand_total: grandTotal,
    paid_amount: paidAmount,
    change_amount: Math.max(0, paidAmount - grandTotal),
    qris_dynamic_string: dynamicQrisStringCache,
    status: 'completed'
  };

  try {
    let savedTrx;
    if (state.activeHoldTransactionId) {
      // Selesaikan pesanan yang sebelumnya di-hold
      savedTrx = await dbService.updateTransaction(state.activeHoldTransactionId, payload);
    } else {
      savedTrx = await dbService.createTransaction(payload);
    }

    state.cart = [];
    state.activeHoldTransactionId = null;
    state.cartCustomerName = '';
    state.cartTableNumber = '';
    await loadAllData();
    openModal('receipt', savedTrx || payload);
  } catch (err) {
    alert('Terjadi kesalahan saat menyimpan transaksi: ' + err.message);
  }
};

// --- HOLD ORDER (OPEN BILL) HANDLERS ---
window.openHoldOrderForm = function() {
  if (state.cart.length === 0) return;
  openModal('hold_form');
};

window.saveHoldOrder = async function(event) {
  event.preventDefault();
  const custName = document.getElementById('hold-customer-name').value || 'Tamu';
  const tableNum = document.getElementById('hold-table-number').value || 'Meja 1';
  const note = document.getElementById('hold-note').value || '';
  const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);

  const payload = {
    cashier_user_id: state.currentUser.id,
    cashier_name: state.currentUser.name,
    customer_name: custName,
    table_number: tableNum,
    items: state.cart,
    subtotal: grandTotal,
    grand_total: grandTotal,
    paid_amount: 0,
    change_amount: 0,
    note: note,
    status: 'hold'
  };

  try {
    if (state.activeHoldTransactionId) {
      await dbService.updateTransaction(state.activeHoldTransactionId, payload);
    } else {
      payload.invoice_number = `HOLD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      await dbService.createTransaction(payload);
    }

    // Reset keranjang kasir
    state.cart = [];
    state.activeHoldTransactionId = null;
    state.cartCustomerName = '';
    state.cartTableNumber = '';
    closeModal();
    await loadAllData();
    renderApp();
  } catch (err) {
    alert('Gagal menyimpan hold order: ' + err.message);
  }
};

window.openHoldOrdersModal = function() {
  openModal('hold_orders');
};

window.recallHoldOrder = function(holdId) {
  const trx = state.transactions.find(t => t.id === holdId && t.status === 'hold');
  if (!trx) return;

  state.cart = JSON.parse(JSON.stringify(trx.items || []));
  state.activeHoldTransactionId = trx.id;
  state.cartCustomerName = trx.customer_name || 'Pelanggan';
  state.cartTableNumber = trx.table_number || 'Meja 1';
  state.checkoutCustomerName = trx.customer_name || 'Pelanggan';
  state.checkoutTableNumber = trx.table_number || 'Meja 1';

  closeModal();
  renderApp();
};

window.cancelEditingHoldOrder = function() {
  if (confirm('Yakin ingin keluar dari pengeditan Open Bill ini? Perubahan di keranjang akan dibersihkan.')) {
    state.cart = [];
    state.activeHoldTransactionId = null;
    state.cartCustomerName = '';
    state.cartTableNumber = '';
    renderApp();
  }
};

window.deleteHoldOrder = async function(holdId) {
  if (confirm('Apakah Anda yakin ingin membatalkan dan menghapus pesanan hold ini?')) {
    await dbService.deleteTransaction(holdId);
    if (state.activeHoldTransactionId === holdId) {
      state.cart = [];
      state.activeHoldTransactionId = null;
      state.cartCustomerName = '';
      state.cartTableNumber = '';
    }
    await loadAllData();
    openModal('hold_orders');
  }
};

window.printHoldOrderBill = function(holdId) {
  const trx = state.transactions.find(t => t.id === holdId);
  if (!trx) return;
  openModal('receipt', {
    ...trx,
    payment_method_name: 'OPEN BILL (TAGIHAN SEMENTARA)'
  });
};


// MySQL Sync Actions
window.syncLocalStorageToMySQL = async function() {
  try {
    const raw = localStorage.getItem('poshere_local_db');
    let localData = {};
    if (raw) {
      localData = JSON.parse(raw);
    } else {
      localData = {
        categories: state.categories,
        products: state.products,
        users: state.users,
        payment_methods: state.paymentMethods,
        cash_registers: state.cashRegisters,
        transactions: state.transactions
      };
    }

    const res = await fetch('/api/mysql/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localData)
    });

    const result = await res.json();
    if (result.success) {
      alert(`SUKSES MASUKIN KE MYSQL!\n\n` +
            `• ${result.synced.products} Produk\n` +
            `• ${result.synced.categories} Kategori\n` +
            `• ${result.synced.payment_methods} Metode Bayar\n` +
            `• ${result.synced.users} User Kasir\n` +
            `• ${result.synced.transactions} Transaksi\n\n` +
            `Data sudah masuk ke database "poshere" di MySQL XAMPP (phpMyAdmin)!`);
    } else {
      alert('Gagal sync ke MySQL: ' + (result.error || result.message));
    }
  } catch (err) {
    alert('Error koneksi ke MySQL: ' + err.message);
  }
};

window.pullDataFromMySQL = async function() {
  try {
    const res = await fetch('/api/mysql/pull');
    const result = await res.json();
    if (result.success && result.data) {
      const data = result.data;
      localStorage.setItem('poshere_local_db', JSON.stringify(data));
      await loadAllData();
      renderApp();
      alert(`Berhasil menarik data dari MySQL:\n• ${data.products.length} Produk\n• ${data.categories.length} Kategori\n• ${data.transactions.length} Transaksi`);
    } else {
      alert('Gagal mengambil data dari MySQL: ' + (result.error || result.message));
    }
  } catch (err) {
    alert('Error koneksi ke MySQL: ' + err.message);
  }
};

// Supabase Settings Handler
window.handleSaveSupabaseConfig = async function(e) {
  e.preventDefault();
  const url = document.getElementById('cfg-supabase-url').value;
  const key = document.getElementById('cfg-supabase-key').value;
  saveSupabaseConfig(url, key);
  alert('Konfigurasi Supabase berhasil disimpan! Memuat ulang data dari PostgreSQL Supabase...');
  await loadAllData();
  renderApp();
};

window.testSupabaseConnection = async function() {
  try {
    const prods = await dbService.getProducts();
    alert(`Koneksi database berhasil! Ditemukan ${prods.length} produk di database.`);
  } catch (err) {
    alert('Gagal terkoneksi ke Supabase: ' + err.message);
  }
};

// Master Category Actions
window.openCategoryForm = function() {
  openModal('category_form');
};

window.editCategory = function(id) {
  const c = state.categories.find(x => x.id === id);
  if (c) openModal('category_form', c);
};

window.deleteCategory = async function(id) {
  const count = (state.products || []).filter(p => p.category_id === id).length;
  if (count > 0) {
    if (!confirm(`Ada ${count} produk yang menggunakan kategori ini. Tetap ingin menghapus?`)) {
      return;
    }
  } else if (!confirm('Yakin ingin menghapus kategori ini?')) {
    return;
  }

  await dbService.deleteCategory(id);
  if (state.selectedCategory === id) {
    state.selectedCategory = 'all';
  }
  await loadAllData();
  renderApp();
};

window.saveCategoryForm = async function(event, id) {
  event.preventDefault();
  const name = document.getElementById('catform-name').value.trim();
  const customId = document.getElementById('catform-id') ? document.getElementById('catform-id').value.trim() : '';

  if (!name) return;

  if (id) {
    await dbService.updateCategory(id, { name });
  } else {
    const payload = {
      name,
      id: customId || `cat_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}`
    };
    await dbService.createCategory(payload);
  }

  closeModal();
  await loadAllData();
  renderApp();
};

// Master Product Actions
window.openProductForm = function() {
  openModal('product_form');
};

window.editProduct = function(id) {
  const p = state.products.find(x => x.id === id);
  if (p) openModal('product_form', p);
};

window.deleteProduct = async function(id) {
  if (confirm('Yakin ingin menghapus produk ini?')) {
    await dbService.deleteProduct(id);
    await loadAllData();
    renderApp();
  }
};

window.handleProductImageUpload = async function(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const base64 = await fileToBase64(file);
    const uploadedPath = await uploadBase64Image(base64, file.name);
    document.getElementById('pform-image-path').value = uploadedPath;
    document.getElementById('pform-preview').innerHTML = `<img src="${uploadedPath}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;"/>`;
  } catch (err) {
    alert('Gagal mengupload gambar: ' + err.message);
  }
};

window.saveProductForm = async function(event, id) {
  event.preventDefault();
  const name = document.getElementById('pform-name').value;
  const category_id = document.getElementById('pform-cat').value;
  const sku = document.getElementById('pform-sku').value;
  const price = document.getElementById('pform-price').value;
  const cost_price = document.getElementById('pform-cost').value;
  const stock = document.getElementById('pform-stock').value;
  const image_path = document.getElementById('pform-image-path').value;

  const payload = { name, category_id, sku, price, cost_price, stock, image_path };

  if (id) {
    await dbService.updateProduct(id, payload);
  } else {
    await dbService.createProduct(payload);
  }

  closeModal();
  await loadAllData();
  renderApp();
};

// Master Payment Actions
window.openPaymentForm = function() {
  openModal('payment_form');
};

window.editPayment = function(id) {
  const p = state.paymentMethods.find(x => x.id === id);
  if (p) openModal('payment_form', p);
};

window.deletePayment = async function(id) {
  if (confirm('Yakin ingin menghapus metode pembayaran ini?')) {
    await dbService.deletePaymentMethod(id);
    await loadAllData();
    renderApp();
  }
};

window.togglePaymentTypeFields = function(type) {
  const sec = document.getElementById('payform-qris-section');
  if (sec) {
    sec.style.display = (type === 'cash') ? 'none' : 'block';
  }
};

window.handleQrisImageUpload = async function(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const base64 = await fileToBase64(file);
    const uploadedPath = await uploadBase64Image(base64, file.name);
    document.getElementById('payform-image-path').value = uploadedPath;
    document.getElementById('payform-preview').innerHTML = `<img src="${uploadedPath}" style="width: 80px; height: 80px; border-radius: 8px; object-fit: contain;"/>`;

    const qrString = await readQrCodeFromImage(base64);
    if (qrString) {
      document.getElementById('payform-qris-string').value = qrString;
      const parsed = parseQris(qrString);
      if (parsed.merchantName) {
        document.getElementById('payform-info').value = `Merchant: ${parsed.merchantName} (${parsed.merchantCity || 'ID'})`;
      }
      alert(`Berhasil membaca string QRIS dari gambar!\nMerchant: ${parsed.merchantName || 'Terdeteksi'}`);
    } else {
      alert('Gambar berhasil diunggah ke public/uploads. Anda dapat memasukkan string QRIS secara manual jika diperlukan.');
    }
  } catch (err) {
    alert('Error membaca atau mengunggah gambar QRIS: ' + err.message);
  }
};

window.savePaymentForm = async function(event, id) {
  event.preventDefault();
  const name = document.getElementById('payform-name').value;
  const type = document.getElementById('payform-type').value;
  const account_info = document.getElementById('payform-info').value;
  const image_path = document.getElementById('payform-image-path').value;
  const qris_raw_string = document.getElementById('payform-qris-string').value;

  const payload = { name, type, account_info, image_path, qris_raw_string };

  if (id) {
    await dbService.updatePaymentMethod(id, payload);
  } else {
    await dbService.createPaymentMethod(payload);
  }

  closeModal();
  await loadAllData();
  renderApp();
};

// Master User Actions
window.openUserForm = function() {
  openModal('user_form');
};

window.editUser = function(id) {
  const u = state.users.find(x => x.id === id);
  if (u) openModal('user_form', u);
};

window.deleteUser = async function(id) {
  if (confirm('Yakin ingin menghapus user ini?')) {
    await dbService.deleteUser(id);
    await loadAllData();
    renderApp();
  }
};

window.saveUserForm = async function(event, id) {
  event.preventDefault();
  const name = document.getElementById('uform-name').value;
  const username = document.getElementById('uform-username').value;
  const role = document.getElementById('uform-role').value;
  const pin = document.getElementById('uform-pin').value;

  const payload = { name, username, role, pin };

  if (id) {
    await dbService.updateUser(id, payload);
  } else {
    await dbService.createUser(payload);
  }

  closeModal();
  await loadAllData();
  renderApp();
};

// Thermal Printer Window Actions
window.setPrinterWidth = function(width) {
  printerService.paperWidth = Number(width);
  alert(`Lebar kertas diset ke ${width}mm`);
};

window.connectBluetoothPrinter = async function() {
  try {
    const res = await printerService.connectBluetooth();
    alert(`Berhasil terhubung dengan printer Bluetooth: ${res.name}`);
    renderApp();
  } catch (err) {
    alert(`Gagal konek Bluetooth: ${err.message}`);
  }
};

window.connectUsbPrinter = async function() {
  try {
    const res = await printerService.connectUsbSerial();
    alert(`Berhasil terhubung dengan printer USB Serial: ${res.name}`);
    renderApp();
  } catch (err) {
    alert(`Gagal konek USB Serial: ${err.message}`);
  }
};

window.testPrintThermal = async function() {
  const dummyTrx = {
    invoice_number: 'TEST-PRINTER-001',
    created_at: new Date().toISOString(),
    cashier_name: state.currentUser.name,
    table_number: 'Tes Cetak',
    payment_method_name: 'TEST PRINT',
    items: [
      { name: 'Kopi Susu Uji Coba', quantity: 1, price: 18000, subtotal: 18000 }
    ],
    subtotal: 18000,
    grand_total: 18000,
    paid_amount: 20000,
    change_amount: 2000
  };
  try {
    const result = await printerService.printReceipt(dummyTrx);
    if (result.method !== 'browser_dialog') {
      alert(`Struk berhasil dikirim ke Thermal Printer (${result.method})!`);
    }
  } catch (err) {
    alert('Error saat mencetak: ' + err.message);
  }
};

window.printToThermalPrinter = async function() {
  const trx = state.modalState.data;
  if (!trx) return;
  try {
    const result = await printerService.printReceipt(trx);
    if (result.method !== 'browser_dialog') {
      alert(`Struk transaksi ${trx.invoice_number} berhasil dicetak ke Thermal Printer!`);
    }
  } catch (err) {
    alert('Gagal cetak ke thermal printer: ' + err.message + '\nMenggunakan printer browser standar...');
    window.print();
  }
};

// Master Cash Register Window Actions
window.openRegisterForm = function() {
  openModal('register_form');
};

window.editRegister = function(id) {
  const r = (state.cashRegisters || []).find(x => x.id === id);
  if (r) openModal('register_form', r);
};

window.deleteRegister = async function(id) {
  if (confirm('Yakin ingin menghapus stasiun mesin kasir ini?')) {
    await dbService.deleteCashRegister(id);
    await loadAllData();
    renderApp();
  }
};

window.saveRegisterForm = async function(event, id) {
  event.preventDefault();
  const name = document.getElementById('regform-name').value;
  const device_code = document.getElementById('regform-code').value;
  const location = document.getElementById('regform-loc').value;
  const printer_type = document.getElementById('regform-printer-type').value;
  const paper_width = document.getElementById('regform-paper').value;

  const payload = { name, device_code, location, printer_type, paper_width };

  if (id) {
    await dbService.updateCashRegister(id, payload);
  } else {
    await dbService.createCashRegister(payload);
  }

  closeModal();
  await loadAllData();
  renderApp();
};

// Customer Facing Display Handlers & Renderer
window.openCustomerDisplay = function() {
  state.isCustomerDisplayOpen = true;
  renderApp();
};

window.closeCustomerDisplay = function() {
  state.isCustomerDisplayOpen = false;
  // Setelah close atau selesai di display customer, buka form Checkout & Pembayaran Kasir
  openModal('payment_checkout');
};

window.finishCustomerDisplay = function() {
  state.isCustomerDisplayOpen = false;
  // Buka form Checkout & Pembayaran Kasir untuk menyelesaikan transaksi
  openModal('payment_checkout');
};

window.customerPrintReceipt = async function() {
  if (state.cart.length === 0) return;

  const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);
  const pay = state.selectedCheckoutPayment || { name: 'Cash', type: 'cash' };

  const currentTrx = {
    invoice_number: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
    created_at: new Date().toISOString(),
    cashier_name: state.currentUser ? state.currentUser.name : 'Kasir',
    table_number: 'Meja Tamu',
    payment_method_name: pay.name,
    items: state.cart,
    subtotal: grandTotal,
    grand_total: grandTotal,
    paid_amount: grandTotal,
    change_amount: 0
  };

  // 1. Jika mesin printer Bluetooth atau USB sudah terhubung, lakukan AUTO PRINT!
  if (printerService.isConnected) {
    try {
      const res = await printerService.printReceipt(currentTrx);
      alert(`Struk transaksi berhasil dicetak otomatis ke Thermal Printer (${res.method})!`);
      return;
    } catch (err) {
      console.warn('Gagal cetak otomatis, fallback ke preview struk', err);
    }
  }

  // 2. Jika belum terkoneksi ke printer fisik, tampilkan modal desain struk belanja
  openModal('receipt', currentTrx);
};

function updateCustomerDisplayView() {
  const el = document.getElementById('customer-display-mount');
  if (el) {
    el.outerHTML = renderCustomerDisplay();
    // Render dynamic QR canvas jika metode QRIS terpilih
    renderCustomerDisplayQr();
  }
}

function renderCustomerDisplayQr() {
  setTimeout(() => {
    const pay = state.selectedCheckoutPayment;
    const canvas = document.getElementById('cd-qris-canvas');
    if (pay && pay.type === 'qris' && canvas && dynamicQrisStringCache) {
      QRCode.toCanvas(canvas, dynamicQrisStringCache, {
        width: 200,
        margin: 1,
        color: { dark: '#1e1b4b', light: '#ffffff' }
      });
    }
  }, 30);
}

function renderCustomerDisplay() {
  if (!state.isCustomerDisplayOpen) return '<div id="customer-display-mount" style="display:none;"></div>';

  const grandTotal = state.cart.reduce((s, it) => s + it.subtotal, 0);
  const pay = state.selectedCheckoutPayment;

  return `
    <div id="customer-display-mount" class="customer-display-overlay">
      <div class="customer-display-box">
        <!-- Customer Display Header -->
        <div class="customer-display-header">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <img src="/poshere_logo.png" style="width: 36px; height: 36px; border-radius: 8px;" alt="POShere" onerror="this.src='/poshere_logo.png'"/>
            <div>
              <div style="font-weight: 800; font-size: 1.1rem; letter-spacing: -0.02em;">POShere Store</div>
              <div style="font-size: 0.72rem; color: #cbd5e1;">Layar Pelanggan / Customer Facing Display</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <button class="btn btn-success btn-icon-text" style="padding: 0.35rem 0.85rem; font-size: 0.8rem; font-weight: 700;" onclick="window.finishCustomerDisplay()">
              ${getIcon('check', 14)} <span>Selesai / Lanjut Kasir</span>
            </button>
            <button class="btn btn-secondary btn-icon-text" style="background: rgba(255,255,255,0.15); color:white; border:none; padding:0.35rem 0.65rem; font-size:0.75rem;" onclick="window.closeCustomerDisplay()">
              ${getIcon('close', 14)} <span>Tutup</span>
            </button>
          </div>
        </div>

        <!-- 2 SISI DISPLAY: SEBELAH KIRI METODE BAYAR, SEBELAH KANAN LIST TRANSAKSI -->
        <div class="customer-display-body">
          <!-- SISI KIRI: METODE PEMBAYARAN & QRIS DINAMIS / REKENING / CASH -->
          <div class="cd-left-panel">
            ${!pay ? `
              <div style="text-align: center; color: var(--text-muted);">
                <div style="color: #cbd5e1; display: inline-flex; margin-bottom: 0.75rem;">${getIcon('credit-card', 44)}</div>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main);">Menunggu Pemilihan Pembayaran</h4>
                <p style="font-size: 0.78rem; margin-top: 0.25rem;">Kasir sedang memilih metode pembayaran untuk Anda...</p>
              </div>
            ` : pay.type === 'qris' ? `
              <div style="text-align: center; width: 100%;">
                <div style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--primary-light); color: var(--primary-focus); font-weight: 800; font-size: 0.8rem; padding: 0.35rem 0.85rem; border-radius: 99px; margin-bottom: 0.75rem;">
                  <span style="display: inline-flex;">${getIcon('qr-code', 14)}</span> QRIS DINAMIS INSTAN
                </div>
                <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main); margin-bottom: 0.25rem;">
                  Scan QR untuk Bayar
                </h3>
                <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">
                  Nominal <strong>${formatRupiah(grandTotal)}</strong> otomatis terisi di GoPay, OVO, ShopeePay, BCA, Mandiri, dll
                </p>

                <div class="qris-canvas-wrapper" style="box-shadow: 0 10px 25px -5px rgba(139, 92, 246, 0.25);">
                  <canvas id="cd-qris-canvas"></canvas>
                </div>

                <div style="margin-top: 0.85rem; font-size: 0.75rem; font-weight: 700; color: var(--text-main);">
                  ${pay.name}
                </div>
                <div style="font-size: 0.68rem; color: var(--text-muted);">${pay.account_info || 'NMID: ID1020038847291'}</div>
              </div>
            ` : pay.type === 'transfer' ? `
              <div style="text-align: center; width: 100%; padding: 1rem;">
                <div style="color: var(--primary); display: inline-flex; margin-bottom: 0.75rem;">${getIcon('building', 44)}</div>
                <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main);">${pay.name}</h3>
                <div style="background: white; border: 2px dashed var(--primary-border); border-radius: 12px; padding: 1.25rem; margin: 1rem 0;">
                  <div style="font-size: 0.75rem; color: var(--text-muted);">Silakan Transfer Tepat Sejumlah:</div>
                  <div style="font-size: 1.5rem; font-weight: 900; color: var(--primary-focus); margin: 0.35rem 0;">
                    ${formatRupiah(grandTotal)}
                  </div>
                  <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-top: 0.5rem;">
                    ${pay.account_info || 'Nomor Rekening Kasir'}
                  </div>
                </div>
                <div style="font-size: 0.75rem; color: #10b981; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
                  ${getIcon('check-circle', 14)} <span>Tunjukkan bukti transfer ke kasir</span>
                </div>
              </div>
            ` : pay.type === 'ewallet' ? `
              <div style="text-align: center; width: 100%; padding: 1rem;">
                <div style="color: var(--primary); display: inline-flex; margin-bottom: 0.75rem;">${getIcon('smartphone', 44)}</div>
                <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main);">${pay.name}</h3>
                <div style="font-size: 1.4rem; font-weight: 900; color: var(--primary-focus); margin: 0.5rem 0;">
                  ${formatRupiah(grandTotal)}
                </div>
                <p style="font-size: 0.78rem; color: var(--text-muted);">${pay.account_info || 'Nomor Akun Dompet Digital'}</p>
              </div>
            ` : `
              <div style="text-align: center; width: 100%; padding: 1rem;">
                <div style="color: #10b981; display: inline-flex; margin-bottom: 0.75rem;">${getIcon('banknote', 44)}</div>
                <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main);">${pay.name}</h3>
                <div style="font-size: 1.5rem; font-weight: 900; color: #10b981; margin: 0.5rem 0;">
                  ${formatRupiah(grandTotal)}
                </div>
                <p style="font-size: 0.78rem; color: var(--text-muted);">Silakan serahkan uang tunai pas / pecahan kepada kasir</p>
              </div>
            `}
          </div>

          <!-- SISI KANAN: LIST TRANSAKSI & RINCIAN PESANAN -->
          <div class="cd-right-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 0.75rem; margin-bottom: 0.75rem;">
              <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-main);">Rincian Pesanan Anda</h4>
              <span class="stock-tag" style="background: #ede9fe; color: var(--primary-focus); font-weight:700;">
                ${state.cart.reduce((s, it) => s + it.quantity, 0)} Item
              </span>
            </div>

            <!-- List Menu yang Dibeli -->
            <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; padding-right: 0.35rem; max-height: 250px;">
              ${state.cart.length === 0 ? `
                <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8rem;">Tidak ada pesanan</div>
              ` : state.cart.map(item => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem; border-radius: 8px; background: #fafafa; border: 1px solid #f1f5f9;">
                  <div>
                    <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);">${item.name}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">${formatRupiah(item.price)} x ${item.quantity}</div>
                  </div>
                  <div style="font-weight: 800; font-size: 0.88rem; color: var(--text-main);">
                    ${formatRupiah(item.subtotal)}
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Total Ringkasan Tagihan -->
            <div style="margin-top: 1rem; border-top: 2px dashed var(--border-light); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem;">
              <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary);">
                <span>Subtotal Belanja:</span>
                <span>${formatRupiah(grandTotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
                <span style="font-size: 1rem; font-weight: 800; color: var(--text-main);">TOTAL TAGIHAN:</span>
                <span style="font-size: 1.4rem; font-weight: 900; color: var(--primary-focus);">${formatRupiah(grandTotal)}</span>
              </div>
            </div>

            <!-- Tombol Cetak Struk & Tombol Selesai Pembayaran -->
            <div style="margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid var(--border-light); display: flex; gap: 0.5rem; flex-direction: column;">
              <button class="btn btn-primary btn-icon-text" style="width: 100%; padding: 0.65rem; font-size: 0.85rem; justify-content: center;" onclick="window.customerPrintReceipt()">
                ${getIcon('printer', 15)} <span>Cetak Struk Pembelian</span>
              </button>
              <button class="btn btn-success btn-icon-text" style="width: 100%; padding: 0.65rem; font-size: 0.85rem; font-weight: 700; justify-content: center;" onclick="window.finishCustomerDisplay()">
                ${getIcon('check', 15)} <span>Selesai Pembayaran / Lanjut ke Kasir</span>
              </button>
              <div style="font-size: 0.68rem; color: var(--text-muted); text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${printerService.isConnected ? '#10b981' : '#94a3b8'};"></span>
                <span>${printerService.isConnected ? 'Mesin printer siap: Cetak langsung ke struk fisik' : 'Mesin belum terhubung: Menampilkan desain struk digital'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Enterprise POS Station Gateway (Style ESB / Moka / Square POS)
function renderAuthModal() {
  if (state.auth.isAuthenticated) return '';

  return `
    <div class="pos-auth-viewport">
      <div class="pos-auth-card">
        <!-- Header POS Terminal -->
        <div class="pos-terminal-header">
          <div class="pos-terminal-brand">
            <div class="pos-terminal-logo-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="12" x="3" y="4" rx="2"/><line x1="2" x2="22" y1="20" y2="20"/><path d="M7 8h10"/><path d="M7 12h4"/></svg>
            </div>
            <div>
              <div class="pos-terminal-title">POSHERE TERMINAL</div>
              <div class="pos-terminal-subtitle">POINT OF SALE STATION #01</div>
            </div>
          </div>
          <div class="pos-station-status">
            <span class="status-pulse-dot"></span>
            <span>ONLINE (MYSQL :3306)</span>
          </div>
        </div>

        <div class="pos-auth-layout">
          <!-- Left Column: User Selection / Shift Info -->
          <div class="pos-auth-staff-col">
            <div class="pos-section-label">PILIH PETUGAS KASIR / OWNER</div>
            
            <div class="pos-staff-list">
              ${(state.users || []).map(u => {
                const isSelected = state.auth.selectedQuickUser === u.username;
                const isOwner = u.role === 'owner';
                return `
                  <div class="pos-staff-card ${isSelected ? 'active' : ''}" onclick="window.selectStaffTerminal('${u.username}')">
                    <div class="pos-staff-avatar ${isOwner ? 'owner-bg' : 'kasir-bg'}">
                      ${u.name.charAt(0)}
                    </div>
                    <div class="pos-staff-details">
                      <div class="pos-staff-name">${u.name}</div>
                      <div class="pos-staff-role">${u.role.toUpperCase()} • @${u.username}</div>
                    </div>
                    <div class="pos-staff-check">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="pos-shift-info-box">
              <div class="pos-shift-row">
                <span class="shift-label">TANGGAL TRANSAKSI</span>
                <span class="shift-value">${new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
              <div class="pos-shift-row">
                <span class="shift-label">DATABASE SYNC</span>
                <span class="shift-value" style="color: #059669; font-weight:700;">MYSQL POSHERE</span>
              </div>
              <div class="pos-shift-row">
                <span class="shift-label">KEAMANAN</span>
                <span class="shift-value">JWT BEARER 256-BIT</span>
              </div>
            </div>
          </div>

          <!-- Right Column: PIN Pad / Keypad POS -->
          <div class="pos-auth-keypad-col">
            <div class="pos-section-label">OTORISASI PIN KASIR (4 DIGIT)</div>

            <div class="pos-pin-display-wrapper">
              <input 
                type="hidden" 
                id="loginUsername" 
                value="${state.auth.selectedQuickUser || 'owner'}"
              />
              <input 
                type="password" 
                id="loginPin" 
                class="pos-pin-hidden-input" 
                maxlength="6"
                value="${state.auth.enteredPin || ''}"
                readonly
              />
              <div class="pos-pin-dots-display" id="posPinDotsDisplay">
                <span class="pos-pin-dot ${ (state.auth.enteredPin || '').length >= 1 ? 'filled' : '' }"></span>
                <span class="pos-pin-dot ${ (state.auth.enteredPin || '').length >= 2 ? 'filled' : '' }"></span>
                <span class="pos-pin-dot ${ (state.auth.enteredPin || '').length >= 3 ? 'filled' : '' }"></span>
                <span class="pos-pin-dot ${ (state.auth.enteredPin || '').length >= 4 ? 'filled' : '' }"></span>
              </div>
              <div class="pos-pin-hint">Masukkan 4 Digit Kode Keamanan Petugas</div>
            </div>

            ${state.auth.errorMessage ? `
              <div class="pos-error-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>${state.auth.errorMessage}</span>
              </div>
            ` : ''}

            <!-- Hardware-style Numeric Numpad POS Terminal -->
            <div class="pos-numpad-grid">
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('1')">1</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('2')">2</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('3')">3</button>

              <button type="button" class="numpad-btn" onclick="window.pressPinKey('4')">4</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('5')">5</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('6')">6</button>

              <button type="button" class="numpad-btn" onclick="window.pressPinKey('7')">7</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('8')">8</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('9')">9</button>

              <button type="button" class="numpad-btn numpad-action-clear" onclick="window.clearPinKey()">C</button>
              <button type="button" class="numpad-btn" onclick="window.pressPinKey('0')">0</button>
              <button type="button" class="numpad-btn numpad-action-back" onclick="window.backspacePinKey()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
              </button>
            </div>

            <!-- Login Action Button -->
            <button 
              type="button" 
              class="pos-btn-login-submit" 
              onclick="window.executeTerminalLogin()"
              ${state.auth.loading ? 'disabled' : ''}
            >
              ${state.auth.loading ? `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>MEMVALIDASI KREDENSIAL...</span>
              ` : `
                <span>BUKA SESI KASIR (LOGIN)</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              `}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// POS Terminal Staff Selection
window.selectStaffTerminal = function(username) {
  state.auth.selectedQuickUser = username;
  state.auth.enteredPin = '';
  state.auth.errorMessage = '';
  renderApp();
};

// Numpad Handlers
window.pressPinKey = function(digit) {
  if (!state.auth.enteredPin) state.auth.enteredPin = '';
  if (state.auth.enteredPin.length < 6) {
    state.auth.enteredPin += digit;
    state.auth.errorMessage = '';
    renderApp();

    // Auto submit jika sudah 4 digit
    if (state.auth.enteredPin.length === 4) {
      setTimeout(() => {
        window.executeTerminalLogin();
      }, 150);
    }
  }
};

window.clearPinKey = function() {
  state.auth.enteredPin = '';
  state.auth.errorMessage = '';
  renderApp();
};

window.backspacePinKey = function() {
  if (state.auth.enteredPin && state.auth.enteredPin.length > 0) {
    state.auth.enteredPin = state.auth.enteredPin.slice(0, -1);
    state.auth.errorMessage = '';
    renderApp();
  }
};

// POS Terminal Execute Login with JWT
window.executeTerminalLogin = async function() {
  const username = state.auth.selectedQuickUser || 'owner';
  const pin = state.auth.enteredPin || '';

  if (!pin || pin.length < 4) {
    state.auth.errorMessage = 'Masukkan minimal 4 digit PIN petugas!';
    renderApp();
    return;
  }

  state.auth.loading = true;
  state.auth.errorMessage = '';
  renderApp();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin })
    });

    const data = await res.json();

    if (res.ok && data.success && data.token) {
      localStorage.setItem('poshere_jwt_token', data.token);
      localStorage.setItem('poshere_jwt_user', JSON.stringify(data.user));

      state.auth.isAuthenticated = true;
      state.auth.token = data.token;
      state.auth.loading = false;
      state.auth.enteredPin = '';
      state.auth.errorMessage = '';
      state.currentUser = data.user;

      await loadAllData();
      renderApp();
    } else {
      // Fallback local check
      const foundUser = (state.users || []).find(u => u.username === username && u.pin === pin);
      if (foundUser) {
        state.auth.isAuthenticated = true;
        state.auth.loading = false;
        state.auth.enteredPin = '';
        state.auth.errorMessage = '';
        state.currentUser = {
          id: foundUser.id,
          username: foundUser.username,
          name: foundUser.name,
          role: foundUser.role
        };
        localStorage.setItem('poshere_jwt_user', JSON.stringify(state.currentUser));
        renderApp();
      } else {
        state.auth.loading = false;
        state.auth.enteredPin = '';
        state.auth.errorMessage = data.message || 'PIN Petugas Salah!';
        renderApp();
      }
    }
  } catch (err) {
    const foundUser = (state.users || []).find(u => u.username === username && u.pin === pin);
    if (foundUser) {
      state.auth.isAuthenticated = true;
      state.auth.loading = false;
      state.auth.enteredPin = '';
      state.auth.errorMessage = '';
      state.currentUser = {
        id: foundUser.id,
        username: foundUser.username,
        name: foundUser.name,
        role: foundUser.role
      };
      localStorage.setItem('poshere_jwt_user', JSON.stringify(state.currentUser));
      renderApp();
    } else {
      state.auth.loading = false;
      state.auth.enteredPin = '';
      state.auth.errorMessage = 'Gagal verifikasi terminal: Pastikan MySQL aktif.';
      renderApp();
    }
  }
};

// Logout Handler
window.handleLogout = function() {
  if (confirm('Apakah Anda yakin ingin logout dari sistem?')) {
    localStorage.removeItem('poshere_jwt_token');
    localStorage.removeItem('poshere_jwt_user');
    state.auth.isAuthenticated = false;
    state.auth.token = null;
    state.auth.errorMessage = '';
    renderApp();
  }
};

// App Renderer
function renderApp() {
  const app = document.getElementById('app');

  // Jika belum login, tampilkan layar Login JWT Portal
  if (!state.auth.isAuthenticated) {
    app.innerHTML = `
      ${renderAuthModal()}
    `;
    return;
  }

  let viewContent = '';
  switch (state.currentView) {
    case 'pos':
      viewContent = renderPosView();
      break;
    case 'products':
      viewContent = renderProductsView();
      break;
    case 'categories':
      viewContent = renderCategoriesView();
      break;
    case 'payments':
      viewContent = renderPaymentsView();
      break;
    case 'registers':
      viewContent = renderRegistersView();
      break;
    case 'users':
      viewContent = renderUsersView();
      break;
    case 'transactions':
      viewContent = renderTransactionsView();
      break;
    case 'reports':
      viewContent = renderReportsView();
      break;
    case 'printer':
      viewContent = renderPrinterView();
      break;
    case 'settings':
      viewContent = renderSettingsView();
      break;
    default:
      viewContent = renderPosView();
  }

  app.innerHTML = `
    ${renderSidebar()}
    <div class="main-wrapper">
      ${renderTopbar()}
      <main class="content-body">
        ${viewContent}
      </main>
    </div>
    ${renderModal()}
    ${renderCustomerDisplay()}
  `;
}

async function init() {
  await loadAllData();

  // Verifikasi JWT Token jika ada tersimpan
  const savedToken = localStorage.getItem('poshere_jwt_token');
  const savedUser = localStorage.getItem('poshere_jwt_user');

  if (savedToken) {
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${savedToken}` }
      });
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        state.auth.isAuthenticated = true;
        state.auth.token = savedToken;
        state.currentUser = data.user;
      } else {
        localStorage.removeItem('poshere_jwt_token');
        state.auth.isAuthenticated = false;
      }
    } catch {
      if (savedUser) {
        try {
          state.currentUser = JSON.parse(savedUser);
          state.auth.isAuthenticated = true;
        } catch {
          state.auth.isAuthenticated = false;
        }
      }
    }
  } else {
    state.auth.isAuthenticated = false;
  }

  renderApp();
}

init();

