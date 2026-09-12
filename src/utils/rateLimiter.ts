/**
 * In-Memory Rate Limiting & Phone Cooldown Engine
 * Balanced for high conversion + robust abuse protection:
 * 1. IP Anti-Bot Barrier: 50 requests per 10 mins (protects against DDoS without blocking shared Wi-Fi/CGNAT)
 * 2. Phone Cooldown: 20 seconds (just enough for Safaricom prompt to arrive)
 * 3. Instant Retry: Cooldown can be cleared immediately upon failure or retry
 */

interface IpBucket {
  timestamps: number[];
}

const ipLimitMap = new Map<string, IpBucket>();
const phoneCooldownMap = new Map<string, number>();

// Clean up stale entries every 15 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  for (const [ip, bucket] of ipLimitMap.entries()) {
    bucket.timestamps = bucket.timestamps.filter((t) => t > tenMinutesAgo);
    if (bucket.timestamps.length === 0) {
      ipLimitMap.delete(ip);
    }
  }

  for (const [phone, timestamp] of phoneCooldownMap.entries()) {
    if (now - timestamp > 20 * 1000) {
      phoneCooldownMap.delete(phone);
    }
  }
}, 15 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Enforces IP-based rate limit: 50 requests per 10 minutes.
 * High enough to never block innocent users on shared mobile/campus networks.
 */
export function checkIpRateLimit(ip: string, maxRequests = 50, windowMs = 10 * 60 * 1000): RateLimitResult {
  const now = Date.now();
  const cleanIp = ip.trim().toLowerCase();

  let bucket = ipLimitMap.get(cleanIp);
  if (!bucket) {
    bucket = { timestamps: [] };
    ipLimitMap.set(cleanIp, bucket);
  }

  // Remove timestamps outside the sliding window
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      allowed: false,
      reason: "Too many payment requests from this network. Please wait a moment or pay directly via our manual PayBill.",
      retryAfterSeconds: retryAfter,
    };
  }

  bucket.timestamps.push(now);
  return { allowed: true };
}

/**
 * Enforces Phone Cooldown: blocks multiple STK pushes to the same phone within 20 seconds.
 */
export function checkPhoneCooldown(cleanPhone: string, cooldownMs = 20 * 1000): RateLimitResult {
  const now = Date.now();
  const lastTime = phoneCooldownMap.get(cleanPhone);

  if (lastTime && now - lastTime < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastTime)) / 1000);
    return {
      allowed: false,
      reason: "A payment prompt was just sent to your phone. Please check your screen or wait a few seconds before trying again.",
      retryAfterSeconds: remaining,
    };
  }

  phoneCooldownMap.set(cleanPhone, now);
  return { allowed: true };
}

/**
 * Instantly clears cooldown for a specific phone number.
 * Called when a transaction fails, wrong PIN is entered, or user clicks 'Try Again'.
 */
export function clearPhoneCooldown(cleanPhone: string): void {
  phoneCooldownMap.delete(cleanPhone);
}

/**
 * Clears IP rate limit history for a specific IP.
 */
export function clearIpRateLimit(ip: string): void {
  ipLimitMap.delete(ip.trim().toLowerCase());
}
