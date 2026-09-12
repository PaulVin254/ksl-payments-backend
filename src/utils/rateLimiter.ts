/**
 * In-Memory Rate Limiting & Phone Cooldown Engine
 * Protects against:
 * 1. Denial-of-Wallet (Phone Bombing) harassment
 * 2. Safaricom Daraja API quota exhaustion
 * 3. Bot checkout spam
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
    if (now - timestamp > 60 * 1000) {
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
 * Enforces IP-based rate limit: max 5 requests per 10 minutes.
 */
export function checkIpRateLimit(ip: string, maxRequests = 5, windowMs = 10 * 60 * 1000): RateLimitResult {
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
      reason: `Too many payment requests from this IP. Please wait ${retryAfter}s before retrying.`,
      retryAfterSeconds: retryAfter,
    };
  }

  bucket.timestamps.push(now);
  return { allowed: true };
}

/**
 * Enforces Phone Cooldown: blocks multiple STK pushes to the same phone within 60 seconds.
 */
export function checkPhoneCooldown(cleanPhone: string, cooldownMs = 60 * 1000): RateLimitResult {
  const now = Date.now();
  const lastTime = phoneCooldownMap.get(cleanPhone);

  if (lastTime && now - lastTime < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastTime)) / 1000);
    return {
      allowed: false,
      reason: `A payment prompt was recently sent to ${cleanPhone}. Please check your phone or wait ${remaining}s before requesting another prompt.`,
      retryAfterSeconds: remaining,
    };
  }

  phoneCooldownMap.set(cleanPhone, now);
  return { allowed: true };
}
