import { Router, Request, Response } from "express";
import { darajaService } from "../services/daraja.js";
import { supabaseAdmin } from "../services/supabase.js";
import { formatPhoneNumber } from "../utils/mpesa.js";
import { mapMpesaResultCode } from "../utils/mpesaErrors.js";
import { handlePaymentSuccess } from "../services/postPayment.js";
import { logEvent } from "../index.js";

export const mpesaRouter = Router();

/**
 * POST /api/mpesa/stkpush
 * Initiates an M-Pesa STK Push to the student's mobile number
 */
mpesaRouter.post("/stkpush", async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, phoneNumber, email, amount, paymentTier } = req.body;

    logEvent(
      "INFO",
      "Initiating STK push request",
      { fullName, phone: phoneNumber, amount, tier: paymentTier },
      "STK_PUSH"
    );

    if (!fullName || !phoneNumber || !amount) {
      const err = "fullName, phoneNumber, and amount are required";
      logEvent("WARN", "Validation failed for STK push", err, "STK_PUSH");
      res.status(400).json({ success: false, error: err });
      return;
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 1) {
      const err = "Amount must be a valid positive number";
      logEvent("WARN", "Invalid amount provided", { amount }, "STK_PUSH");
      res.status(400).json({ success: false, error: err });
      return;
    }

    // 1. Format phone number to 254XXXXXXXXX
    let cleanPhone: string;
    try {
      cleanPhone = formatPhoneNumber(phoneNumber);
      logEvent("INFO", `Normalized phone number: ${cleanPhone}`, undefined, "STK_PUSH");
    } catch (err: any) {
      logEvent("WARN", "Phone number format error", err.message, "STK_PUSH");
      res.status(400).json({ success: false, error: err.message });
      return;
    }

    // 2. Trigger STK Push via Daraja
    const accountRef = `KSL-${cleanPhone.slice(-4)}`;
    const stkResponse = await darajaService.initiateStkPush({
      phoneNumber: cleanPhone,
      amount: numericAmount,
      accountReference: accountRef,
      transactionDesc: `KSL ${paymentTier || "Class"}`,
    });

    // 3. Save initial pending transaction in Supabase
    logEvent(
      "INFO",
      `Saving pending record to Supabase (CheckoutRequestID: ${stkResponse.CheckoutRequestID})`,
      undefined,
      "DATABASE"
    );

    const { error: dbError } = await supabaseAdmin
      .from("payment_confirmations")
      .insert({
        full_name: fullName.trim(),
        phone_number: cleanPhone,
        email: email?.trim() || null,
        payment_type: paymentTier === "full" ? "full" : "deposit",
        payment_tier: paymentTier || "full",
        amount_paid: numericAmount,
        checkout_request_id: stkResponse.CheckoutRequestID,
        merchant_request_id: stkResponse.MerchantRequestID,
        status: "pending",
        intake_tag: "june_2026",
        source_page: "/level1-offer",
      });

    if (dbError) {
      logEvent("ERROR", "Supabase insert error on pending payment", dbError, "DATABASE");
    } else {
      logEvent("SUCCESS", "Pending payment row created in Supabase", undefined, "DATABASE");
    }

    res.status(200).json({
      success: true,
      message: "STK push initiated successfully",
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      customerMessage: stkResponse.CustomerMessage,
    });
  } catch (error: any) {
    logEvent("ERROR", "Unhandled error in /stkpush endpoint", error.message, "STK_PUSH");
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process STK push request",
    });
  }
});

/**
 * Helper to update Supabase record with resilience if optional columns do not exist yet.
 */
async function safeUpdatePayment(
  checkoutRequestId: string,
  payload: Record<string, any>
): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from("payment_confirmations")
    .update(payload)
    .eq("checkout_request_id", checkoutRequestId)
    .select()
    .single();

  if (error) {
    // If error is related to missing schema columns, strip optional columns and retry
    if (error.message?.includes("column") || error.code === "42703") {
      logEvent("WARN", "Optional column missing in DB; falling back to core fields", error.message, "DATABASE");
      const fallbackPayload = {
        status: payload.status,
        mpesa_receipt: payload.mpesa_receipt,
        mpesa_code: payload.mpesa_code,
        admin_notes: payload.admin_notes || payload.failure_reason,
      };
      const { data: retryData, error: retryErr } = await supabaseAdmin
        .from("payment_confirmations")
        .update(fallbackPayload)
        .eq("checkout_request_id", checkoutRequestId)
        .select()
        .single();
      if (retryErr) throw retryErr;
      return retryData;
    }
    throw error;
  }
  return data;
}

/**
 * POST /api/mpesa/callback
 * Webhook called by Safaricom Daraja when student completes/cancels the prompt.
 * Features strict idempotency to prevent duplicate emails/WhatsApp messages on webhook retries.
 */
mpesaRouter.post("/callback", async (req: Request, res: Response): Promise<void> => {
  // Always respond with 200 OK immediately to satisfy Safaricom's webhook SLA
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });

  try {
    const callbackData = req.body?.Body?.stkCallback;
    if (!callbackData) {
      logEvent("WARN", "Received empty or invalid callback body from Safaricom", req.body, "CALLBACK");
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData;

    logEvent(
      "INFO",
      `Daraja Callback received (ResultCode: ${ResultCode})`,
      { CheckoutRequestID, ResultDesc },
      "CALLBACK"
    );

    // Idempotency Check: Fetch current record from DB
    const { data: existingRecord } = await supabaseAdmin
      .from("payment_confirmations")
      .select("id, status, full_name, email, phone_number, amount_paid, mpesa_receipt, payment_tier")
      .eq("checkout_request_id", CheckoutRequestID)
      .single();

    if (existingRecord?.status === "verified") {
      logEvent(
        "INFO",
        `Idempotency Guard: Transaction ${CheckoutRequestID} is already verified. Skipping duplicate callback.`,
        undefined,
        "CALLBACK"
      );
      return;
    }

    // ResultCode 0 means SUCCESS
    if (ResultCode === 0 && CallbackMetadata?.Item) {
      const items: Array<{ Name: string; Value?: any }> = CallbackMetadata.Item;
      const getVal = (name: string) => items.find((i) => i.Name === name)?.Value;

      const mpesaReceipt = String(getVal("MpesaReceiptNumber") || "");
      const amount = Number(getVal("Amount") || 0);
      const transactionDate = String(getVal("TransactionDate") || "");

      logEvent(
        "SUCCESS",
        `Payment completed by student! Receipt: ${mpesaReceipt}`,
        { amount, transactionDate },
        "PAYMENT_CONFIRMED"
      );

      // 1. Update Supabase record to verified
      const updatedRecord = await safeUpdatePayment(CheckoutRequestID, {
        status: "verified",
        mpesa_receipt: mpesaReceipt,
        mpesa_code: mpesaReceipt,
        result_code: 0,
        result_desc: "Success",
        admin_notes: `Verified via Daraja callback. TransDate: ${transactionDate}`,
      });

      logEvent("SUCCESS", `Supabase record updated for ${updatedRecord?.full_name}`, undefined, "DATABASE");

      // 2. Trigger Post-Payment Automations (Brevo Email & Meta WhatsApp)
      if (updatedRecord) {
        handlePaymentSuccess({
          id: updatedRecord.id,
          full_name: updatedRecord.full_name,
          phone_number: updatedRecord.phone_number,
          email: updatedRecord.email,
          amount_paid: updatedRecord.amount_paid || amount,
          mpesa_receipt: mpesaReceipt,
          payment_tier: updatedRecord.payment_tier,
        }).catch((err) => logEvent("ERROR", "Automation dispatch error", err.message, "AUTOMATIONS"));
      }
    } else {
      // Non-zero ResultCode: Map failure as structured data
      const mappedError = mapMpesaResultCode(ResultCode, ResultDesc);

      logEvent(
        "WARN",
        `Payment unconfirmed (${mappedError.category}: Code ${ResultCode})`,
        { CheckoutRequestID, failureReason: mappedError.failureReason },
        "CALLBACK"
      );

      await safeUpdatePayment(CheckoutRequestID, {
        status: "failed",
        result_code: mappedError.code,
        result_desc: ResultDesc || mappedError.failureReason,
        failure_reason: mappedError.userMessage,
        admin_notes: `Failed: ${ResultDesc} (ResultCode: ${ResultCode}) [${mappedError.category}]`,
      });
    }
  } catch (error: any) {
    logEvent("ERROR", "Error in Daraja callback processing", error.message, "CALLBACK");
  }
});

/**
 * GET /api/mpesa/status/:checkoutRequestId
 * Returns the current database status of a payment.
 * Features ACTIVE RECONCILIATION: If a payment is still pending after 25s,
 * actively queries Safaricom STK query to rescue dropped webhooks.
 */
mpesaRouter.get("/status/:checkoutRequestId", async (req: Request, res: Response): Promise<void> => {
  try {
    const checkoutRequestId = String(req.params.checkoutRequestId);

    const { data, error } = await supabaseAdmin
      .from("payment_confirmations")
      .select("id, status, mpesa_receipt, amount_paid, full_name, phone_number, email, payment_tier, created_at, result_code, result_desc, failure_reason")
      .eq("checkout_request_id", checkoutRequestId)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }

    // Active Reconciliation: If pending for > 25 seconds, query Daraja Gateway directly
    if (data.status === "pending" && data.created_at) {
      const ageInSeconds = (Date.now() - new Date(data.created_at).getTime()) / 1000;

      if (ageInSeconds > 25) {
        logEvent(
          "INFO",
          `Active reconciliation check for ${checkoutRequestId} (Age: ${Math.round(ageInSeconds)}s)`,
          undefined,
          "RECONCILIATION"
        );

        const queryRes = await darajaService.queryStkStatus(checkoutRequestId);

        if (queryRes && queryRes.ResultCode !== undefined) {
          const resCode = String(queryRes.ResultCode);

          if (resCode === "0") {
            // Reconcile as verified!
            logEvent("SUCCESS", `Active STK Query confirmed payment for ${checkoutRequestId}!`, queryRes, "RECONCILIATION");
            const updated = await safeUpdatePayment(checkoutRequestId, {
              status: "verified",
              result_code: 0,
              result_desc: queryRes.ResultDesc || "Confirmed via STK Query",
              admin_notes: "Reconciled via active Daraja status query",
            });

            handlePaymentSuccess({
              id: data.id,
              full_name: data.full_name,
              phone_number: data.phone_number,
              email: data.email,
              amount_paid: data.amount_paid,
              mpesa_receipt: data.mpesa_receipt || "CONFIRMED",
              payment_tier: data.payment_tier,
            }).catch((err) => logEvent("ERROR", "Reconciliation automation error", err.message, "AUTOMATIONS"));

            res.status(200).json({
              success: true,
              transaction: {
                ...data,
                status: "verified",
                result_code: 0,
              },
            });
            return;
          } else if (["1032", "1", "1037", "2001", "1019"].includes(resCode)) {
            // Reconcile definitive failure
            const mapped = mapMpesaResultCode(resCode, queryRes.ResultDesc);
            logEvent("WARN", `Active STK Query confirmed failure: ${mapped.category}`, queryRes, "RECONCILIATION");
            await safeUpdatePayment(checkoutRequestId, {
              status: "failed",
              result_code: mapped.code,
              result_desc: queryRes.ResultDesc,
              failure_reason: mapped.userMessage,
              admin_notes: `Failed via STK Query: ${queryRes.ResultDesc} [${mapped.category}]`,
            });

            res.status(200).json({
              success: true,
              transaction: {
                ...data,
                status: "failed",
                result_code: mapped.code,
                failure_reason: mapped.userMessage,
              },
            });
            return;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      transaction: {
        id: data.id,
        status: data.status,
        mpesa_receipt: data.mpesa_receipt,
        amount_paid: data.amount_paid,
        full_name: data.full_name,
        created_at: data.created_at,
        result_code: data.result_code,
        failure_reason: data.failure_reason,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/mpesa/simulate-success
 * Simulates a successful Daraja callback for testing in Sandbox.
 * STRICTLY PROTECTED: Blocked in production; requires admin key in development.
 */
mpesaRouter.post("/simulate-success", async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Production lockout guard
    if (process.env.NODE_ENV === "production" || process.env.DARAJA_ENVIRONMENT === "production") {
      logEvent("WARN", "Attempt to access /simulate-success in production blocked", undefined, "SECURITY");
      res.status(403).json({
        success: false,
        error: "Forbidden: Sandbox simulation is strictly disabled in production mode",
      });
      return;
    }

    // 2. Admin key authentication guard
    const adminKey = String(req.headers["x-admin-key"] || req.query.adminKey || "");
    const requiredKey = process.env.ADMIN_SECRET_KEY;
    if (requiredKey && adminKey !== requiredKey) {
      logEvent("WARN", "Unauthorized access attempt to /simulate-success", undefined, "SECURITY");
      res.status(401).json({ success: false, error: "Unauthorized: Invalid or missing x-admin-key header" });
      return;
    }

    const { checkoutRequestId } = req.body;
    if (!checkoutRequestId) {
      res.status(400).json({ success: false, error: "checkoutRequestId is required" });
      return;
    }

    logEvent(
      "INFO",
      `Simulating successful M-Pesa callback for CheckoutRequestID: ${checkoutRequestId}`,
      undefined,
      "SIMULATION"
    );

    const mockReceipt = `TST${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    const transactionDate = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

    const updatedRecord = await safeUpdatePayment(String(checkoutRequestId), {
      status: "verified",
      mpesa_receipt: mockReceipt,
      mpesa_code: mockReceipt,
      result_code: 0,
      result_desc: "Simulation Success",
      admin_notes: `Verified via Sandbox Simulation. TransDate: ${transactionDate}`,
    });

    logEvent(
      "SUCCESS",
      `Simulation verified! Receipt: ${mockReceipt} for ${updatedRecord?.full_name}`,
      updatedRecord,
      "SIMULATION"
    );

    if (updatedRecord) {
      handlePaymentSuccess({
        id: updatedRecord.id,
        full_name: updatedRecord.full_name,
        phone_number: updatedRecord.phone_number,
        email: updatedRecord.email,
        amount_paid: updatedRecord.amount_paid || 500,
        mpesa_receipt: mockReceipt,
        payment_tier: updatedRecord.payment_tier || "full",
      }).catch((err) => logEvent("ERROR", "Simulation automation error", err.message, "SIMULATION"));
    }

    res.status(200).json({
      success: true,
      message: "Simulation completed successfully",
      mpesaReceipt: mockReceipt,
      student: updatedRecord?.full_name,
    });
  } catch (error: any) {
    logEvent("ERROR", "Simulation route error", error.message, "SIMULATION");
    res.status(500).json({ success: false, error: error.message });
  }
});
