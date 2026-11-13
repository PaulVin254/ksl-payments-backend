import { Router, Request, Response } from "express";
import { darajaService } from "../services/daraja.js";
import { supabaseAdmin } from "../services/supabase.js";
import { formatPhoneNumber } from "../utils/mpesa.js";
import { mapMpesaResultCode } from "../utils/mpesaErrors.js";
import { checkIpRateLimit, checkPhoneCooldown, clearPhoneCooldown } from "../utils/rateLimiter.js";
import { logEvent } from "../index.js";

export const giftRouter = Router();

const TABLE = "father_anthony_contributions";
const MAX_AMOUNT = 50000;

const clean = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const clientIp = (req: Request) =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown-ip";

/** Handles a Daraja callback for a gift checkout. Returns true if the checkout belonged to the gift table. */
export async function handleGiftCallback(
  checkoutRequestId: string,
  resultCode: number,
  receipt: string,
  paidAmount: number
): Promise<boolean> {
  const { data: row } = await supabaseAdmin
    .from(TABLE)
    .select("id, payment_status, phone_number")
    .eq("checkout_request_id", checkoutRequestId)
    .maybeSingle();
  if (!row) return false;
  if (row.payment_status === "verified") return true;

  if (resultCode === 0) {
    await supabaseAdmin
      .from(TABLE)
      .update({
        payment_status: "verified",
        mpesa_receipt: receipt || null,
        ...(paidAmount > 0 ? { amount: paidAmount } : {}),
      })
      .eq("id", row.id);
    logEvent("SUCCESS", `Gift contribution verified (${receipt})`, undefined, "GIFT");
  } else {
    if (row.phone_number) clearPhoneCooldown(row.phone_number);
    await supabaseAdmin.from(TABLE).update({ payment_status: "failed" }).eq("id", row.id);
    logEvent("WARN", `Gift contribution failed (code ${resultCode})`, undefined, "GIFT");
  }
  return true;
}

/** GET /api/gift/wall - public, sanitized list + totals */
giftRouter.get("/wall", async (_req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, contributor_name, amount, message, payment_method, payment_status, created_at")
    .in("payment_status", ["verified", "self_reported", "message_only"])
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    res.status(500).json({ success: false, error: "Could not load the wall" });
    return;
  }
  const entries = data || [];
  const paid = entries.filter((e) => Number(e.amount) > 0);
  res.json({
    success: true,
    totalRaised: paid.reduce((s, e) => s + Number(e.amount), 0),
    contributorCount: paid.length,
    entries: entries.map((e) => ({
      id: e.id,
      name: e.contributor_name,
      amount: Number(e.amount),
      message: e.message,
      status: e.payment_status,
      createdAt: e.created_at,
    })),
  });
});

/** POST /api/gift/message - message only, no money */
giftRouter.post("/message", async (req: Request, res: Response) => {
  if (!checkIpRateLimit(clientIp(req)).allowed) {
    res.status(429).json({ success: false, error: "Too many requests, try again shortly." });
    return;
  }
  const name = clean(req.body?.name, 60);
  const message = clean(req.body?.message, 600);
  if (!name || !message) {
    res.status(400).json({ success: false, error: "Name and message are required." });
    return;
  }
  const { error } = await supabaseAdmin.from(TABLE).insert({
    contributor_name: name,
    message,
    amount: 0,
    payment_method: "message_only",
    payment_status: "message_only",
  });
  if (error) {
    res.status(500).json({ success: false, error: "Could not save your message." });
    return;
  }
  res.json({ success: true });
});

/** POST /api/gift/manual - "I already sent via M-Pesa" (self reported) */
giftRouter.post("/manual", async (req: Request, res: Response) => {
  if (!checkIpRateLimit(clientIp(req)).allowed) {
    res.status(429).json({ success: false, error: "Too many requests, try again shortly." });
    return;
  }
  const name = clean(req.body?.name, 60);
  const message = clean(req.body?.message, 600);
  const receipt = clean(req.body?.receipt, 20).toUpperCase();
  const amount = Math.round(Number(req.body?.amount));
  if (!name || !(amount >= 1 && amount <= MAX_AMOUNT)) {
    res.status(400).json({ success: false, error: "Name and a valid amount are required." });
    return;
  }
  if (receipt && !/^[A-Z0-9]{8,12}$/.test(receipt)) {
    res.status(400).json({ success: false, error: "That M-Pesa code doesn't look right." });
    return;
  }
  const { error } = await supabaseAdmin.from(TABLE).insert({
    contributor_name: name,
    message: message || null,
    amount,
    payment_method: "manual_mpesa",
    payment_status: "self_reported",
    mpesa_receipt: receipt || null,
  });
  if (error) {
    res.status(500).json({ success: false, error: "Could not save your contribution." });
    return;
  }
  res.json({ success: true });
});

/** POST /api/gift/stkpush */
giftRouter.post("/stkpush", async (req: Request, res: Response) => {
  try {
    const ip = clientIp(req);
    const ipLimit = checkIpRateLimit(ip);
    if (!ipLimit.allowed) {
      res.status(429).json({ success: false, error: ipLimit.reason });
      return;
    }
    const name = clean(req.body?.name, 60);
    const message = clean(req.body?.message, 600);
    const amount = Math.round(Number(req.body?.amount));
    if (!name || !req.body?.phoneNumber || !(amount >= 1 && amount <= MAX_AMOUNT)) {
      res.status(400).json({ success: false, error: "Name, phone and a valid amount are required." });
      return;
    }
    let phone: string;
    try {
      phone = formatPhoneNumber(req.body.phoneNumber);
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
      return;
    }
    const cooldown = checkPhoneCooldown(phone);
    if (!cooldown.allowed) {
      res.status(429).json({ success: false, error: cooldown.reason });
      return;
    }

    const stk = await darajaService.initiateStkPush({
      phoneNumber: phone,
      amount,
      accountReference: "FrAnthony",
      transactionDesc: "Graduation gift",
    });

    const { error } = await supabaseAdmin.from(TABLE).insert({
      contributor_name: name,
      phone_number: phone,
      message: message || null,
      amount,
      payment_method: "stk_push",
      payment_status: "pending",
      checkout_request_id: stk.CheckoutRequestID,
    });
    if (error) logEvent("ERROR", "Gift insert failed", error, "GIFT");

    res.json({ success: true, checkoutRequestId: stk.CheckoutRequestID });
  } catch (e: any) {
    logEvent("ERROR", "Gift stkpush error", e.message, "GIFT");
    res.status(500).json({ success: false, error: e.message || "Failed to start payment" });
  }
});

/** GET /api/gift/status/:id - poll, with active reconciliation */
giftRouter.get("/status/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { data: row } = await supabaseAdmin
    .from(TABLE)
    .select("id, payment_status, created_at, phone_number, amount")
    .eq("checkout_request_id", id)
    .maybeSingle();
  if (!row) {
    res.status(404).json({ success: false, error: "Not found" });
    return;
  }
  let status = row.payment_status;
  if (status === "pending" && Date.now() - new Date(row.created_at).getTime() > 20000) {
    try {
      const q = await darajaService.queryStkStatus(id);
      if (q && q.ResultCode !== undefined) {
        const code = String(q.ResultCode);
        if (code === "0") {
          await handleGiftCallback(id, 0, "", 0);
          status = "verified";
        } else if (["1032", "1", "1037", "2001", "1019"].includes(code)) {
          mapMpesaResultCode(code, q.ResultDesc);
          await handleGiftCallback(id, Number(code), "", 0);
          status = "failed";
        }
      }
    } catch {
      /* transient - keep polling */
    }
  }
  res.json({ success: true, status });
});

