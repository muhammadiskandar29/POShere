/**
 * QRIS Dinamis, Parser, Validator, & CRC16 Generator Berdasarkan Spesifikasi EMVCo / QRIS Indonesia (ASPI)
 * Diadopsi penuh sesuai referensi: https://github.com/verssache/qris-dinamis
 */

/**
 * Map nama tag standar EMVCo / QRIS
 */
export const TAG_NAMES = {
  "00": "Payload Format Indicator",
  "01": "Point of Initiation Method",
  "02": "Visa",
  "03": "Mastercard",
  "04": "Mastercard",
  "15": "Visa",
  "26": "Merchant Account Information",
  "27": "Merchant Account Information",
  "28": "Merchant Account Information",
  "29": "Merchant Account Information",
  "30": "Merchant Account Information",
  "31": "Merchant Account Information",
  "32": "Merchant Account Information",
  "33": "Merchant Account Information",
  "34": "Merchant Account Information",
  "35": "Merchant Account Information",
  "36": "Merchant Account Information",
  "37": "Merchant Account Information",
  "38": "Merchant Account Information",
  "39": "Merchant Account Information",
  "40": "Merchant Account Information",
  "41": "Merchant Account Information",
  "42": "Merchant Account Information",
  "43": "Merchant Account Information",
  "44": "Merchant Account Information",
  "45": "Merchant Account Information",
  "46": "Merchant Account Information",
  "47": "Merchant Account Information",
  "48": "Merchant Account Information",
  "49": "Merchant Account Information",
  "50": "Merchant Account Information",
  "51": "Merchant Account Information",
  "52": "Merchant Category Code",
  "53": "Transaction Currency",
  "54": "Transaction Amount",
  "55": "Tip or Convenience Indicator",
  "56": "Value of Convenience Fee (Fixed)",
  "57": "Value of Convenience Fee (%)",
  "58": "Country Code",
  "59": "Merchant Name",
  "60": "Merchant City",
  "61": "Postal Code",
  "62": "Additional Data Field",
  "63": "CRC",
};

const NESTED_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(i + 26).padStart(2, "0")),
  "62",
]);

/**
 * Calculate CRC16-CCITT checksum for QRIS/EMVCo QR codes.
 * Polynomial: 0x1021, Init: 0xFFFF
 * Mengikuti implementasi verssache/qris-dinamis
 */
export function calculateCRC16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Parse raw TLV string into array of TLV elements
 */
export function parseTLV(data) {
  const elements = [];
  let pos = 0;

  while (pos < data.length) {
    if (pos + 4 > data.length) break;

    const tag = data.substring(pos, pos + 2);
    const length = parseInt(data.substring(pos + 2, pos + 4), 10);

    if (isNaN(length) || pos + 4 + length > data.length) break;

    const value = data.substring(pos + 4, pos + 4 + length);
    const name = TAG_NAMES[tag] ?? `Unknown (${tag})`;

    const element = { tag, name, length, value };

    if (NESTED_TAGS.has(tag)) {
      element.children = parseTLV(value);
    }

    elements.push(element);
    pos += 4 + length;
  }

  return elements;
}

/**
 * Rebuild a QRIS string from TLV elements (without CRC).
 */
export function buildTLVString(elements) {
  return elements
    .map((el) => {
      const value = el.children ? buildTLVString(el.children) : el.value;
      const length = value.length.toString().padStart(2, "0");
      return `${el.tag}${length}${value}`;
    })
    .join("");
}

export function makeTLV(tag, value, name = "") {
  return { tag, name: name || TAG_NAMES[tag] || "", length: value.length, value };
}

/**
 * Validate a QRIS string for structural correctness and CRC integrity.
 */
export function validateQRIS(qrisString) {
  const errors = [];

  if (!qrisString || qrisString.trim().length === 0) {
    return { valid: false, errors: ["String QRIS kosong"] };
  }

  const str = qrisString.trim();

  // Must start with payload format indicator "000201"
  if (!str.startsWith("000201")) {
    errors.push('QRIS harus diawali dengan Payload Format Indicator "000201"');
  }

  if (str.length < 20) {
    errors.push("Panjang karakter QRIS terlalu pendek");
    return { valid: false, errors };
  }

  // CRC validation
  const dataWithoutCRC = str.substring(0, str.length - 4);
  const declaredCRC = str.substring(str.length - 4);
  const calculatedCRC = calculateCRC16(dataWithoutCRC);

  if (declaredCRC.toUpperCase() !== calculatedCRC) {
    errors.push(
      `CRC mismatch: expected ${calculatedCRC}, got ${declaredCRC.toUpperCase()}`
    );
  }

  // Parse TLV structure
  const elements = parseTLV(str);

  if (elements.length === 0) {
    errors.push("Gagal mem-parsing elemen TLV QRIS");
    return { valid: false, errors };
  }

  const tags = new Set(elements.map((e) => e.tag));

  const requiredTags = [
    { tag: "00", name: "Payload Format Indicator" },
    { tag: "01", name: "Point of Initiation Method" },
    { tag: "52", name: "Merchant Category Code" },
    { tag: "53", name: "Transaction Currency" },
    { tag: "58", name: "Country Code" },
    { tag: "59", name: "Merchant Name" },
    { tag: "60", name: "Merchant City" },
    { tag: "63", name: "CRC" },
  ];

  for (const req of requiredTags) {
    if (!tags.has(req.tag)) {
      errors.push(`Missing required tag ${req.tag} (${req.name})`);
    }
  }

  return { valid: errors.length === 0, errors, elements };
}

/**
 * Convert a static QRIS string to dynamic by injecting amount and optional fee.
 * Mengikuti logika resmi verssache/qris-dinamis
 */
export function convertQRIS(qrisString, options = {}) {
  const amount = typeof options === 'number' ? options : (options.amount || 0);
  const fee = typeof options === 'object' ? options.fee : null;

  const elements = parseTLV(qrisString);

  // Build the new TLV array preserving order, injecting/replacing as needed
  const result = [];
  let amountInserted = false;

  // Tags to skip (we'll re-insert them)
  const managedTags = new Set(["54", "55", "56", "57", "63"]);

  for (const el of elements) {
    if (managedTags.has(el.tag)) continue;

    if (el.tag === "01") {
      // Ubah static (11) -> dynamic (12)
      result.push(makeTLV("01", "12", "Point of Initiation Method"));
      continue;
    }

    // Insert amount + fee before tag 58 (Country Code)
    if (el.tag === "58" && !amountInserted) {
      const amountStr = Math.round(Number(amount)).toString();
      result.push(makeTLV("54", amountStr, "Transaction Amount"));

      if (fee) {
        if (fee.type === "fixed") {
          result.push(makeTLV("55", "02", "Tip or Convenience Indicator"));
          result.push(
            makeTLV("56", fee.value.toString(), "Value of Convenience Fee (Fixed)")
          );
        } else {
          result.push(makeTLV("55", "03", "Tip or Convenience Indicator"));
          result.push(
            makeTLV("57", fee.value.toString(), "Value of Convenience Fee (%)")
          );
        }
      }

      amountInserted = true;
    }

    result.push(el);
  }

  // Jika tag 58 tidak ditemukan, tambahkan sebelum akhir
  if (!amountInserted) {
    const amountStr = Math.round(Number(amount)).toString();
    result.push(makeTLV("54", amountStr, "Transaction Amount"));
  }

  // Build string without CRC, then append CRC (6304 + checksum)
  const withoutCRC = buildTLVString(result);
  const crcInput = withoutCRC + "6304";
  const crc = calculateCRC16(crcInput);

  return crcInput + crc;
}

// Alias untuk kompatibilitas kode aplikasi
export const convertStaticQrisToDynamic = convertQRIS;

/**
 * Parse a QRIS string into a structured QRISData object.
 */
export function parseQris(qrisString) {
  const raw = parseTLV(qrisString || '');
  const findTag = (tag) => raw.find((t) => t.tag === tag);

  const methodValue = findTag("01")?.value;
  const method = methodValue === "12" ? "dynamic" : "static";

  const tipIndicatorValue = findTag("55")?.value;
  let tipIndicator = null;
  if (tipIndicatorValue === "01") tipIndicator = "prompt";
  else if (tipIndicatorValue === "02") tipIndicator = "fixed";
  else if (tipIndicatorValue === "03") tipIndicator = "percentage";

  const merchantAccountInfo = raw
    .filter((t) => {
      const tagNum = parseInt(t.tag, 10);
      return tagNum >= 26 && tagNum <= 51 && t.children;
    })
    .map((t) => {
      const children = t.children ?? [];
      const findChild = (childTag) => children.find((c) => c.tag === childTag);

      return {
        tag: t.tag,
        globallyUniqueId: findChild("00")?.value ?? "",
        merchantId: findChild("01")?.value ?? findChild("02")?.value,
        merchantCriteria: findChild("03")?.value,
        fields: children,
      };
    });

  const merchantName = findTag("59")?.value ?? "";
  const merchantCity = findTag("60")?.value ?? "";

  return {
    version: findTag("00")?.value ?? "01",
    method,
    merchantAccountInfo,
    merchantCategoryCode: findTag("52")?.value ?? "",
    currency: findTag("53")?.value ?? "360",
    amount: findTag("54")?.value ? Number(findTag("54")?.value) : null,
    tipIndicator,
    tipFixed: findTag("56")?.value,
    tipPercentage: findTag("57")?.value,
    countryCode: findTag("58")?.value ?? "ID",
    merchantName,
    merchantCity,
    postalCode: findTag("61")?.value ?? "",
    additionalData: findTag("62")?.children,
    crc: findTag("63")?.value ?? "",
    raw,
    isValid: Boolean(merchantName || (qrisString && qrisString.startsWith("000201"))),
    isDynamic: method === 'dynamic'
  };
}
