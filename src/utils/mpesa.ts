/**
 * Normalizes Kenyan phone numbers to the 254XXXXXXXXX format required by Safaricom Daraja.
 * Accepts formats: 07XXXXXXXX, 01XXXXXXXX, +254XXXXXXXXX, 254XXXXXXXXX, 7XXXXXXXX.
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.trim().replace(/\D/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("254")) {
    // already 254
  } else if (cleaned.startsWith("7") || cleaned.startsWith("1")) {
    cleaned = "254" + cleaned;
  }

  if (cleaned.length !== 12 || !cleaned.startsWith("254")) {
    throw new Error(`Invalid Kenyan phone number format: ${phone}. Expected 07... or 01...`);
  }

  return cleaned;
}

/**
 * Formats current UTC/local time as YYYYMMDDHHmmss string required by Daraja STK Push.
 */
export function generateTimestamp(): string {
  const date = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Computes the Base64 Daraja Password: Base64(Shortcode + Passkey + Timestamp)
 */
export function generatePassword(shortcode: string, passkey: string, timestamp: string): string {
  const raw = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}
