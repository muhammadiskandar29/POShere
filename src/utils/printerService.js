/**
 * Thermal Printer ESC/POS & Web Bluetooth / Web Serial Driver
 * Mendukung Thermal Printer 58mm & 80mm via Web Bluetooth, Web Serial (USB), atau Dialog Cetak
 */

// ESC/POS Command Byte Constants
const ESC = '\x1B';
const GS = '\x1D';

export class ThermalPrinterService {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.paperWidth = 58; // 58 or 80 mm
    this.isConnected = false;
  }

  // Cek apakah browser mendukung Web Bluetooth
  isBluetoothSupported() {
    return navigator.bluetooth !== undefined;
  }

  // Cek apakah browser mendukung Web Serial (USB / COM Port printer)
  isSerialSupported() {
    return 'serial' in navigator;
  }

  // Koneksi via Bluetooth (misal Printer Thermal Bluetooth Android / Windows)
  async connectBluetooth() {
    if (!this.isBluetoothSupported()) {
      throw new Error('Browser ini belum mendukung Web Bluetooth API. Gunakan browser Chrome/Edge.');
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455'
        ]
      });

      const server = await this.device.gatt.connect();
      const services = await server.getPrimaryServices();
      
      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            this.characteristic = char;
            this.isConnected = true;
            return { success: true, name: this.device.name || 'Thermal Bluetooth' };
          }
        }
      }

      throw new Error('Tidak dapat menemukan characteristic write pada printer Bluetooth.');
    } catch (err) {
      console.error('Bluetooth connection failed', err);
      throw err;
    }
  }

  // Koneksi via Web Serial (Printer USB / Desktop Kasir)
  async connectUsbSerial() {
    if (!this.isSerialSupported()) {
      throw new Error('Browser ini belum mendukung Web Serial API untuk printer USB. Gunakan browser Chrome/Edge.');
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      this.serialPort = port;
      this.isConnected = true;
      return { success: true, name: 'USB Thermal Printer' };
    } catch (err) {
      console.error('Serial USB connection failed', err);
      throw err;
    }
  }

  // Format Baris Struk (Align Left, Right, Center)
  formatLine(left, right, maxChars = 32) {
    const l = String(left || '');
    const r = String(right || '');
    const spaces = Math.max(1, maxChars - l.length - r.length);
    return l + ' '.repeat(spaces) + r;
  }

  // Generate Raw ESC/POS Buffer untuk Struk Transaksi
  generateReceiptCommands(trx, width = 58) {
    const maxChars = width === 80 ? 42 : 32;
    let cmd = '';

    // Init printer
    cmd += ESC + '@'; // Initialize
    cmd += ESC + 'a' + '\x01'; // Center align

    // Header Toko
    cmd += ESC + '!' + '\x38'; // Double height + double width
    cmd += 'POSHERE STORE\n';
    cmd += ESC + '!' + '\x00'; // Normal font
    cmd += 'Point of Sale System\n';
    cmd += '--------------------------------\n';

    // Info Transaksi
    cmd += ESC + 'a' + '\x00'; // Left align
    cmd += `No   : ${trx.invoice_number}\n`;
    cmd += `Waktu: ${new Date(trx.created_at).toLocaleString('id-ID')}\n`;
    cmd += `Kasir: ${trx.cashier_name || 'Kasir'}\n`;
    cmd += `Meja : ${trx.table_number || '-'}\n`;
    cmd += '--------------------------------\n';

    // Item List
    (trx.items || []).forEach(item => {
      cmd += `${item.name}\n`;
      const qtyPrice = `  ${item.quantity} x Rp ${Number(item.price).toLocaleString('id-ID')}`;
      const subtotal = `Rp ${Number(item.subtotal).toLocaleString('id-ID')}`;
      cmd += this.formatLine(qtyPrice, subtotal, maxChars) + '\n';
    });

    cmd += '--------------------------------\n';

    // Summary
    cmd += this.formatLine('Subtotal', `Rp ${Number(trx.subtotal).toLocaleString('id-ID')}`, maxChars) + '\n';
    if (trx.tax) {
      cmd += this.formatLine('Pajak (PB1)', `Rp ${Number(trx.tax).toLocaleString('id-ID')}`, maxChars) + '\n';
    }
    if (trx.discount) {
      cmd += this.formatLine('Diskon', `-Rp ${Number(trx.discount).toLocaleString('id-ID')}`, maxChars) + '\n';
    }

    cmd += ESC + '!' + '\x20'; // Bold
    cmd += this.formatLine('TOTAL', `Rp ${Number(trx.grand_total).toLocaleString('id-ID')}`, maxChars) + '\n';
    cmd += ESC + '!' + '\x00'; // Normal

    cmd += this.formatLine(`Bayar (${trx.payment_method_name || 'Cash'})`, `Rp ${Number(trx.paid_amount || trx.grand_total).toLocaleString('id-ID')}`, maxChars) + '\n';
    cmd += this.formatLine('Kembalian', `Rp ${Number(trx.change_amount || 0).toLocaleString('id-ID')}`, maxChars) + '\n';

    // Footer
    cmd += ESC + 'a' + '\x01'; // Center
    cmd += '\nTerima Kasih Atas Kunjungan Anda\n';
    cmd += 'Struk Resmi Transaksi POShere\n\n\n\n';

    // Cut paper
    cmd += GS + 'V' + '\x41' + '\x03';

    // Convert string to Uint8Array
    const encoder = new TextEncoder();
    return encoder.encode(cmd);
  }

  // Kirim data print ke printer yang terhubung
  async printReceipt(trx) {
    const rawBytes = this.generateReceiptCommands(trx, this.paperWidth);

    if (this.characteristic && this.isConnected) {
      // Print via Bluetooth
      const chunkSize = 100;
      for (let i = 0; i < rawBytes.length; i += chunkSize) {
        const chunk = rawBytes.slice(i, i + chunkSize);
        await this.characteristic.writeValue(chunk);
      }
      return { success: true, method: 'bluetooth' };
    } else if (this.serialPort && this.isConnected) {
      // Print via USB Serial
      const writer = this.serialPort.writable.getWriter();
      await writer.write(rawBytes);
      writer.releaseLock();
      return { success: true, method: 'usb_serial' };
    } else {
      // Fallback: Browser Print Dialog
      window.print();
      return { success: true, method: 'browser_dialog' };
    }
  }
}

export const printerService = new ThermalPrinterService();
