/**
 * Advanced Thermal Printer Service (ESC/POS, Web Bluetooth, Web Serial, Browser Fallback)
 * Mendukung berbagai jenis mesin kasir thermal (58mm, 80mm, Bluetooth, USB, OS Spooler, Drawer Kick)
 */

export const DEFAULT_PRINTER_SETTINGS = {
  paperWidth: 58, // 58 | 80 mm
  charPerLine: 32, // 32 (58mm) or 48 (80mm)
  connectionType: 'auto', // 'auto' | 'bluetooth' | 'usb_serial' | 'browser_dialog'
  baudRate: 9600, // 9600 | 19200 | 38400 | 115200
  autoCut: false, // Auto cutter blade (false on 58mm, true on 80mm)
  openCashDrawer: false, // RJ11 Kick Drawer on transaction
  feedLines: 4, // Blank lines before tear/cut
  fontSize: 'normal', // 'compact' | 'normal' | 'large'
  headerAlign: 'center', // 'center' | 'left'
  storeName: 'POSHERE STORE',
  storeAddress: 'Smart Point of Sale & Retail System',
  storePhone: '',
  receiptFooter: 'Terima Kasih Atas Kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar',
  showCashier: true,
  showTable: true,
  showCustomer: true,
  showTax: true,
  showDiscount: true,
  printCopy: 1 // 1 struk atau 2 rangkap (kasir & pelanggan)
};

// ESC/POS Command Byte Constants
const ESC = '\x1B';
const GS = '\x1D';

export class ThermalPrinterService {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.serialPort = null;
    this.isConnected = false;
    this.connectionMethod = null; // 'bluetooth' | 'usb_serial'
    this.connectedDeviceName = '';
    this.settings = this.loadSettings();
  }

  // Getter & Setter paperWidth untuk backward compatibility
  get paperWidth() {
    return this.settings.paperWidth;
  }

  set paperWidth(val) {
    const width = Number(val) === 80 ? 80 : 58;
    this.settings.paperWidth = width;
    // Set default char per line jika belum diset kustom
    if (width === 80 && this.settings.charPerLine === 32) {
      this.settings.charPerLine = 48;
      this.settings.autoCut = true;
    } else if (width === 58 && this.settings.charPerLine === 48) {
      this.settings.charPerLine = 32;
      this.settings.autoCut = false;
    }
    this.saveSettings(this.settings);
  }

  // Muat preferensi printer dari LocalStorage
  loadSettings() {
    try {
      const saved = localStorage.getItem('poshere_printer_settings');
      if (saved) {
        return { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Gagal memuat setting printer:', e);
    }
    return { ...DEFAULT_PRINTER_SETTINGS };
  }

  // Simpan preferensi printer ke LocalStorage
  saveSettings(newSettings = {}) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('poshere_printer_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.error('Gagal menyimpan setting printer:', e);
    }
    return this.settings;
  }

  // Reset ke pengaturan bawaan
  resetSettings() {
    this.settings = { ...DEFAULT_PRINTER_SETTINGS };
    try {
      localStorage.removeItem('poshere_printer_settings');
    } catch (e) {}
    return this.settings;
  }

  // Cek apakah browser mendukung Web Bluetooth
  isBluetoothSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  // Cek apakah browser mendukung Web Serial (USB / COM Port printer)
  isSerialSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  // Koneksi via Bluetooth dengan dukungan UUID universal printer thermal
  async connectBluetooth() {
    if (!this.isBluetoothSupported()) {
      throw new Error('Browser ini belum mendukung Web Bluetooth API. Gunakan Google Chrome atau Microsoft Edge.');
    }

    // Daftar UUID layanan printer thermal yang umum (Panda, Iware, Goojprt, Zjiang, RPP, Zywell, dll)
    const optionalServices = [
      '000018f0-0000-1000-8000-00805f9b34fb', // Standar ESC/POS
      '0000ffe0-0000-1000-8000-00805f9b34fb', // Chip HM-10 / Zjiang / Panda BLE
      '0000fee7-0000-1000-8000-00805f9b34fb', // Generic BLE Serial
      '0000ff00-0000-1000-8000-00805f9b34fb', // Generic Printer BLE
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Microchip
      '0000ae30-0000-1000-8000-00805f9b34fb',
      '0000af30-0000-1000-8000-00805f9b34fb'
    ];

    try {
      // Menggunakan acceptAllDevices agar semua printer Bluetooth di sekitar dapat dipilih kasir
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.isConnected = false;
        this.characteristic = null;
        this.connectedDeviceName = '';
        this.connectionMethod = null;
        if (typeof window.onPrinterStateChange === 'function') {
          window.onPrinterStateChange();
        }
      });

      const server = await this.device.gatt.connect();
      const services = await server.getPrimaryServices();

      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.isConnected = true;
              this.connectionMethod = 'bluetooth';
              this.connectedDeviceName = this.device.name || 'Bluetooth Thermal Printer';
              return { success: true, name: this.connectedDeviceName, method: 'bluetooth' };
            }
          }
        } catch (charErr) {
          console.warn('Gagal membaca characteristic pada service BLE:', service, charErr);
        }
      }

      throw new Error('Printer terhubung namun tidak ditemukan characteristic penulisan data (write). Pastikan perangkat adalah printer thermal ESC/POS.');
    } catch (err) {
      console.error('Bluetooth connection failed', err);
      throw err;
    }
  }

  // Koneksi via Web Serial (Printer USB / Desktop Kasir)
  async connectUsbSerial(baudRate = null) {
    if (!this.isSerialSupported()) {
      throw new Error('Browser ini belum mendukung Web Serial API untuk printer USB. Gunakan browser Chrome/Edge Desktop.');
    }

    const rate = Number(baudRate || this.settings.baudRate || 9600);

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: rate });
      this.serialPort = port;
      this.isConnected = true;
      this.connectionMethod = 'usb_serial';
      this.connectedDeviceName = `USB Serial (${rate} baud)`;
      return { success: true, name: this.connectedDeviceName, method: 'usb_serial' };
    } catch (err) {
      console.error('Serial USB connection failed', err);
      throw err;
    }
  }

  // Putus koneksi printer fisik
  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {}
    }
    if (this.serialPort) {
      try {
        this.serialPort.close();
      } catch (e) {}
    }
    this.device = null;
    this.characteristic = null;
    this.serialPort = null;
    this.isConnected = false;
    this.connectionMethod = null;
    this.connectedDeviceName = '';
    return { success: true };
  }

  // Format Baris Struk (Align Left, Right dengan spasi penyeimbang)
  formatLine(left, right, maxChars = 32) {
    const l = String(left || '');
    const r = String(right || '');
    const spaces = Math.max(1, maxChars - l.length - r.length);
    return l + ' '.repeat(spaces) + r;
  }

  // Sinyal Buka Laci Kasir (Cash Drawer Kick RJ11 - Pin 2 & Pin 5)
  generateCashDrawerCommand() {
    const encoder = new TextEncoder();
    // ESC p 0 25 250 (Pin 2 standard) + ESC p 1 25 250 (Pin 5 alternative)
    const cmd = ESC + 'p\x00\x19\xFA' + ESC + 'p\x01\x19\xFA';
    return encoder.encode(cmd);
  }

  // Kirim sinyal buka laci kasir langsung
  async kickCashDrawer() {
    const rawBytes = this.generateCashDrawerCommand();
    if (this.characteristic && this.isConnected) {
      await this.characteristic.writeValue(rawBytes);
      return { success: true, method: 'bluetooth' };
    } else if (this.serialPort && this.isConnected) {
      const writer = this.serialPort.writable.getWriter();
      await writer.write(rawBytes);
      writer.releaseLock();
      return { success: true, method: 'usb_serial' };
    } else {
      throw new Error('Printer thermal belum terhubung langsung via Bluetooth atau USB Serial untuk membuka laci kasir.');
    }
  }

  // Generate Raw ESC/POS Buffer untuk Struk Transaksi secara Dinamis
  generateReceiptCommands(trx, customWidth = null) {
    const width = Number(customWidth || this.settings.paperWidth || 58);
    const maxChars = Number(this.settings.charPerLine) || (width === 80 ? 48 : 32);
    const divider = '-'.repeat(maxChars) + '\n';
    let cmd = '';

    // Init printer
    cmd += ESC + '@'; // Initialize

    // Buka laci kasir sebelum cetak jika disetel
    if (this.settings.openCashDrawer) {
      cmd += ESC + 'p\x00\x19\xFA';
    }

    // Header Toko
    const headerAlign = this.settings.headerAlign === 'left' ? '\x00' : '\x01';
    cmd += ESC + 'a' + headerAlign; // Align
    cmd += ESC + '!' + '\x38'; // Double height + double width
    cmd += (this.settings.storeName || 'POSHERE STORE') + '\n';
    cmd += ESC + '!' + '\x00'; // Normal font
    
    if (this.settings.storeAddress) {
      cmd += this.settings.storeAddress + '\n';
    }
    if (this.settings.storePhone) {
      cmd += `Telp: ${this.settings.storePhone}\n`;
    }
    cmd += divider;

    // Info Transaksi
    cmd += ESC + 'a' + '\x00'; // Left align
    cmd += `No   : ${trx.invoice_number || 'TRX-SAMPLE'}\n`;
    cmd += `Waktu: ${new Date(trx.created_at || Date.now()).toLocaleString('id-ID')}\n`;
    if (this.settings.showCashier) {
      cmd += `Kasir: ${trx.cashier_name || 'Kasir'}\n`;
    }
    if (this.settings.showTable && trx.table_number) {
      cmd += `Meja : ${trx.table_number}\n`;
    }
    if (this.settings.showCustomer && (trx.customer_name || trx.customer)) {
      cmd += `Plggn: ${trx.customer_name || trx.customer}\n`;
    }
    cmd += divider;

    // Item List
    (trx.items || []).forEach(item => {
      cmd += `${item.name}\n`;
      const itemQty = item.quantity || item.qty || 1;
      const qtyPrice = `  ${itemQty} x Rp ${Number(item.price || 0).toLocaleString('id-ID')}`;
      const subtotal = `Rp ${Number(item.subtotal || (itemQty * (item.price || 0))).toLocaleString('id-ID')}`;
      cmd += this.formatLine(qtyPrice, subtotal, maxChars) + '\n';
    });

    cmd += divider;

    // Summary
    cmd += this.formatLine('Subtotal', `Rp ${Number(trx.subtotal || 0).toLocaleString('id-ID')}`, maxChars) + '\n';
    if (this.settings.showTax && trx.tax) {
      cmd += this.formatLine('Pajak (PB1)', `Rp ${Number(trx.tax).toLocaleString('id-ID')}`, maxChars) + '\n';
    }
    if (this.settings.showDiscount && trx.discount) {
      cmd += this.formatLine('Diskon', `-Rp ${Number(trx.discount).toLocaleString('id-ID')}`, maxChars) + '\n';
    }

    cmd += ESC + '!' + '\x20'; // Bold
    cmd += this.formatLine('TOTAL', `Rp ${Number(trx.grand_total || 0).toLocaleString('id-ID')}`, maxChars) + '\n';
    cmd += ESC + '!' + '\x00'; // Normal

    cmd += this.formatLine(`Bayar (${trx.payment_method_name || 'Cash'})`, `Rp ${Number(trx.paid_amount || trx.grand_total || 0).toLocaleString('id-ID')}`, maxChars) + '\n';
    cmd += this.formatLine('Kembalian', `Rp ${Number(trx.change_amount || 0).toLocaleString('id-ID')}`, maxChars) + '\n';

    // Footer
    cmd += ESC + 'a' + '\x01'; // Center
    if (this.settings.receiptFooter) {
      cmd += '\n' + this.settings.receiptFooter + '\n';
    }

    // Spasi Akhir (Feed Lines)
    const feedCount = Math.max(2, Math.min(8, Number(this.settings.feedLines) || 4));
    cmd += '\n'.repeat(feedCount);

    // Auto Cut paper jika diaktifkan (disarankan untuk printer 80mm yang ada pisau pemotong)
    if (this.settings.autoCut) {
      cmd += GS + 'V' + '\x41' + '\x00';
    }

    // Convert string to Uint8Array
    const encoder = new TextEncoder();
    return encoder.encode(cmd);
  }

  // Kirim data print ke printer yang terhubung
  async printReceipt(trx) {
    // Jika preferensi koneksi dipaksa ke 'browser_dialog'
    if (this.settings.connectionType === 'browser_dialog') {
      window.print();
      return { success: true, method: 'browser_dialog' };
    }

    const copies = Math.max(1, Number(this.settings.printCopy) || 1);
    const rawBytes = this.generateReceiptCommands(trx);

    if (this.characteristic && this.isConnected) {
      // Print via Bluetooth (dengan chunking untuk batas MTU BLE)
      for (let c = 0; c < copies; c++) {
        const chunkSize = 100;
        for (let i = 0; i < rawBytes.length; i += chunkSize) {
          const chunk = rawBytes.slice(i, i + chunkSize);
          await this.characteristic.writeValue(chunk);
        }
        if (c < copies - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
      return { success: true, method: 'bluetooth', copies };
    } else if (this.serialPort && this.isConnected) {
      // Print via USB Serial
      for (let c = 0; c < copies; c++) {
        const writer = this.serialPort.writable.getWriter();
        await writer.write(rawBytes);
        writer.releaseLock();
        if (c < copies - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      return { success: true, method: 'usb_serial', copies };
    } else {
      // Fallback cerdas: Browser Print Dialog
      window.print();
      return { success: true, method: 'browser_dialog', copies: 1 };
    }
  }
}

export const printerService = new ThermalPrinterService();
