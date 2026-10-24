import { getSupabase } from './supabase.js';

// Fallback in-memory / local storage jika Supabase belum diisi URL / Key
const LOCAL_STORAGE_KEY = 'poshere_local_db';

function getLocalStore() {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  const defaultData = {
    users: [
      { id: 'usr_superadmin', username: 'superadmin', name: 'Super Administrator', role: 'super_admin', pin: '1234', status: 'active' },
      { id: 'usr_1', username: 'owner', name: 'Pemilik Toko', role: 'owner', pin: '1234', status: 'active' },
      { id: 'usr_2', username: 'kasir1', name: 'Kasir Utama', role: 'kasir', pin: '1111', status: 'active' }
    ],
    categories: [
      { id: 'cat_coffee', name: 'Espresso & Coffee', icon: 'coffee' }
    ],
    products: [
      { id: 'prod_1', name: 'Kopi Susu Gula Aren', category_id: 'cat_coffee', price: 18000, cost_price: 9000, stock: 100, sku: 'KPS-001', image_path: '/placeholder_coffee1.jpg', is_active: true }
    ],
    payment_methods: [
      { id: 'pay_qris', name: 'QRIS Statis / Dinamis', type: 'qris', account_info: 'NMID: ID1020038847291 - POShere Store', qris_raw_string: '00020101021126650014ID.GO.IDR.WWW011893600998000001234502150001234567890120303UMI51660014ID.LINKAJA.WWW011893600821000001234502150001234567890120303UMI5204581253033605802ID5914POSHERE STORE6007JAKARTA61051234063040ADB', image_path: '/poshere_logo.png', is_active: true }
    ],
    cash_registers: [
      { id: 'reg_pos1', name: 'Mesin Kasir Utama (Bar)', device_code: 'POS-01', printer_type: 'bluetooth', paper_width: 58, location: 'Counter Bar Depan', is_active: true }
    ],
    transactions: []
  };
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(defaultData));
  return defaultData;
}

function saveLocalStore(data) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

// --------------------------------------------------------------------------
// REPOSITORY DENGAN DUKUNGAN SUPABASE LANGSUNG
// --------------------------------------------------------------------------

export const dbService = {
  // --- USERS ---
  async getUsers() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
      if (!error && data) return data;
      console.warn('Supabase getUsers error, fallback to local', error);
    }
    return getLocalStore().users || [];
  },

  async createUser(user) {
    const supabase = getSupabase();
    const newUser = {
      id: user.id || `usr_${Date.now()}`,
      username: user.username,
      name: user.name,
      role: user.role,
      pin: user.pin || '1234',
      status: user.status || 'active',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('users').insert([newUser]).select();
      if (!error && data) return data[0];
      console.warn('Supabase createUser error', error);
    }

    const store = getLocalStore();
    store.users = store.users || [];
    store.users.push(newUser);
    saveLocalStore(store);
    return newUser;
  },

  async updateUser(id, updateData) {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('users').update(updateData).eq('id', id).select();
      if (!error && data) return data[0];
    }
    const store = getLocalStore();
    const idx = store.users.findIndex(u => u.id === id);
    if (idx !== -1) {
      store.users[idx] = { ...store.users[idx], ...updateData };
      saveLocalStore(store);
      return store.users[idx];
    }
    return null;
  },

  async deleteUser(id) {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('users').delete().eq('id', id);
    }
    const store = getLocalStore();
    store.users = (store.users || []).filter(u => u.id !== id);
    saveLocalStore(store);
    return true;
  },

  // --- CATEGORIES ---
  async getCategories() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('categories').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length) return data;
    }
    return getLocalStore().categories || [];
  },

  async createCategory(category) {
    const supabase = getSupabase();
    const newCat = {
      id: category.id || `cat_${Date.now()}`,
      name: category.name,
      icon: category.icon || 'tag',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('categories').insert([newCat]).select();
      if (!error && data) return data[0];
      console.warn('Supabase createCategory error', error);
    }

    const store = getLocalStore();
    store.categories = store.categories || [];
    store.categories.push(newCat);
    saveLocalStore(store);
    return newCat;
  },

  async updateCategory(id, updateData) {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('categories').update(updateData).eq('id', id).select();
      if (!error && data) return data[0];
    }

    const store = getLocalStore();
    store.categories = (store.categories || []).map(c => c.id === id ? { ...c, ...updateData } : c);
    saveLocalStore(store);
    return true;
  },

  async deleteCategory(id) {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('categories').delete().eq('id', id);
    }

    const store = getLocalStore();
    store.categories = (store.categories || []).filter(c => c.id !== id);
    saveLocalStore(store);
    return true;
  },

  // --- PRODUCTS ---
  async getProducts() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length) return data;
    }
    return getLocalStore().products || [];
  },

  async createProduct(product) {
    const supabase = getSupabase();
    const newProd = {
      id: product.id || `prod_${Date.now()}`,
      name: product.name,
      category_id: product.category_id || 'cat_coffee',
      price: Number(product.price) || 0,
      cost_price: Number(product.cost_price) || 0,
      stock: Number(product.stock) || 0,
      sku: product.sku || `SKU-${Date.now().toString().slice(-4)}`,
      image_path: product.image_path || '',
      is_active: product.is_active !== undefined ? product.is_active : true,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('products').insert([newProd]).select();
      if (!error && data) return data[0];
      console.warn('Supabase createProduct error', error);
    }

    const store = getLocalStore();
    store.products = store.products || [];
    store.products.push(newProd);
    saveLocalStore(store);
    return newProd;
  },

  async updateProduct(id, updateData) {
    const supabase = getSupabase();
    const cleanData = { ...updateData };
    if (cleanData.price !== undefined) cleanData.price = Number(cleanData.price);
    if (cleanData.cost_price !== undefined) cleanData.cost_price = Number(cleanData.cost_price);
    if (cleanData.stock !== undefined) cleanData.stock = Number(cleanData.stock);

    if (supabase) {
      const { data, error } = await supabase.from('products').update(cleanData).eq('id', id).select();
      if (!error && data) return data[0];
    }

    const store = getLocalStore();
    const idx = store.products.findIndex(p => p.id === id);
    if (idx !== -1) {
      store.products[idx] = { ...store.products[idx], ...cleanData };
      saveLocalStore(store);
      return store.products[idx];
    }
    return null;
  },

  async deleteProduct(id) {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('products').delete().eq('id', id);
    }
    const store = getLocalStore();
    store.products = (store.products || []).filter(p => p.id !== id);
    saveLocalStore(store);
    return true;
  },

  // --- PAYMENT METHODS ---
  async getPaymentMethods() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('payment_methods').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length) return data;
    }
    return getLocalStore().payment_methods || [];
  },

  async createPaymentMethod(payment) {
    const supabase = getSupabase();
    const newPay = {
      id: payment.id || `pay_${Date.now()}`,
      name: payment.name,
      type: payment.type || 'qris',
      account_info: payment.account_info || '',
      qris_raw_string: payment.qris_raw_string || '',
      image_path: payment.image_path || '',
      is_active: payment.is_active !== undefined ? payment.is_active : true,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('payment_methods').insert([newPay]).select();
      if (!error && data) return data[0];
    }

    const store = getLocalStore();
    store.payment_methods = store.payment_methods || [];
    store.payment_methods.push(newPay);
    saveLocalStore(store);
    return newPay;
  },

  async updatePaymentMethod(id, updateData) {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('payment_methods').update(updateData).eq('id', id).select();
      if (!error && data) return data[0];
    }
    const store = getLocalStore();
    const idx = store.payment_methods.findIndex(p => p.id === id);
    if (idx !== -1) {
      store.payment_methods[idx] = { ...store.payment_methods[idx], ...updateData };
      saveLocalStore(store);
      return store.payment_methods[idx];
    }
    return null;
  },

  async deletePaymentMethod(id) {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('payment_methods').delete().eq('id', id);
    }
    const store = getLocalStore();
    store.payment_methods = (store.payment_methods || []).filter(p => p.id !== id);
    saveLocalStore(store);
    return true;
  },

  // --- CASH REGISTERS (MASTER MESIN KASIR) ---
  async getCashRegisters() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('cash_registers').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length) return data;
    }
    return getLocalStore().cash_registers || [];
  },

  async createCashRegister(reg) {
    const supabase = getSupabase();
    const newReg = {
      id: reg.id || `reg_${Date.now()}`,
      name: reg.name,
      device_code: reg.device_code || `POS-${Math.floor(10 + Math.random() * 90)}`,
      printer_type: reg.printer_type || 'bluetooth',
      paper_width: Number(reg.paper_width) || 58,
      location: reg.location || 'Counter',
      is_active: reg.is_active !== undefined ? reg.is_active : true,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('cash_registers').insert([newReg]).select();
      if (!error && data) return data[0];
    }

    const store = getLocalStore();
    store.cash_registers = store.cash_registers || [];
    store.cash_registers.push(newReg);
    saveLocalStore(store);
    return newReg;
  },

  async updateCashRegister(id, updateData) {
    const supabase = getSupabase();
    const cleanData = { ...updateData };
    if (cleanData.paper_width !== undefined) cleanData.paper_width = Number(cleanData.paper_width);

    if (supabase) {
      const { data, error } = await supabase.from('cash_registers').update(cleanData).eq('id', id).select();
      if (!error && data) return data[0];
    }

    const store = getLocalStore();
    const idx = (store.cash_registers || []).findIndex(r => r.id === id);
    if (idx !== -1) {
      store.cash_registers[idx] = { ...store.cash_registers[idx], ...cleanData };
      saveLocalStore(store);
      return store.cash_registers[idx];
    }
    return null;
  },

  async deleteCashRegister(id) {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('cash_registers').delete().eq('id', id);
    }
    const store = getLocalStore();
    store.cash_registers = (store.cash_registers || []).filter(r => r.id !== id);
    saveLocalStore(store);
    return true;
  },

  // --- TRANSACTIONS ---
  async getTransactions() {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalStore().transactions || [];
  },

  async createTransaction(trx) {
    const supabase = getSupabase();
    const newTrx = {
      id: trx.id || `trx_${Date.now()}`,
      invoice_number: trx.invoice_number,
      cashier_user_id: trx.cashier_user_id || null,
      cashier_name: trx.cashier_name || 'Kasir',
      payment_method_id: trx.payment_method_id || null,
      payment_method_name: trx.payment_method_name || 'Cash',
      customer_name: trx.customer_name || 'Pelanggan Umum',
      table_number: trx.table_number || '-',
      items: trx.items || [],
      subtotal: Number(trx.subtotal) || 0,
      tax: Number(trx.tax) || 0,
      discount: Number(trx.discount) || 0,
      grand_total: Number(trx.grand_total) || 0,
      paid_amount: Number(trx.paid_amount) || Number(trx.grand_total) || 0,
      change_amount: Number(trx.change_amount) || 0,
      qris_dynamic_string: trx.qris_dynamic_string || '',
      status: trx.status || 'completed',
      note: trx.note || '',
      created_at: trx.created_at || new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase.from('transactions').insert([newTrx]).select();
      if (!error && data) {
        // Kurangi stok produk di Supabase jika status completed
        if (newTrx.status === 'completed') {
          for (const item of (trx.items || [])) {
            const { data: p } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
            if (p && p.stock !== undefined) {
              const nextStock = Math.max(0, p.stock - item.quantity);
              await supabase.from('products').update({ stock: nextStock }).eq('id', item.product_id);
            }
          }
        }
        return data[0];
      }
      console.warn('Supabase createTransaction error', error);
    }

    const store = getLocalStore();
    // Kurangi stok lokal jika status completed
    if (newTrx.status === 'completed') {
      (trx.items || []).forEach(it => {
        const p = store.products.find(prod => prod.id === it.product_id);
        if (p) p.stock = Math.max(0, p.stock - it.quantity);
      });
    }

    store.transactions = store.transactions || [];
    store.transactions.unshift(newTrx);
    saveLocalStore(store);
    return newTrx;
  },

  async updateTransaction(id, updates) {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select();
      if (!error && data) {
        // Jika status berubah ke completed, kurangi stok produk
        if (updates.status === 'completed' && updates.items) {
          for (const item of (updates.items || [])) {
            const { data: p } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
            if (p && p.stock !== undefined) {
              const nextStock = Math.max(0, p.stock - item.quantity);
              await supabase.from('products').update({ stock: nextStock }).eq('id', item.product_id);
            }
          }
        }
        return data[0];
      }
      console.warn('Supabase updateTransaction error', error);
    }

    const store = getLocalStore();
    const idx = (store.transactions || []).findIndex(t => t.id === id);
    if (idx !== -1) {
      const oldTrx = store.transactions[idx];
      store.transactions[idx] = { ...oldTrx, ...updates };

      if (updates.status === 'completed' && oldTrx.status !== 'completed' && updates.items) {
        updates.items.forEach(it => {
          const p = store.products.find(prod => prod.id === it.product_id);
          if (p) p.stock = Math.max(0, p.stock - it.quantity);
        });
      }

      saveLocalStore(store);
      return store.transactions[idx];
    }
    return null;
  },

  async deleteTransaction(id) {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) console.warn('Supabase deleteTransaction error', error);
    }

    const store = getLocalStore();
    store.transactions = (store.transactions || []).filter(t => t.id !== id);
    saveLocalStore(store);
    return true;
  }
};
