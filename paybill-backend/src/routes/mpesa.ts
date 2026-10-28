import { Router, Request, Response } from "express";
import { darajaPaybillService } from "../services/daraja.js";
import { businessPaymentService } from "../services/supabase.js";
import { formatPhoneNumber } from "../utils/mpesa.js";

export const mpesaRouter = Router();

function verifyWebhookToken(req: Request): boolean {
  const secret = process.env.DARAJA_WEBHOOK_SECRET?.trim();
  if (!secret) return true; // If no secret configured, allow

  const queryToken = req.query.token as string | undefined;
  const headerToken = req.headers["x-webhook-secret"] as string | undefined;

  return queryToken === secret || headerToken === secret;
}

/**
 * 1. INITIATE STK PUSH (Paybill)
 * POST /api/mpesa/stkpush
 * Body: { phoneNumber, amount, accountReference, transactionDesc?, invoiceNumber? }
 */
mpesaRouter.post("/stkpush", async (req: Request, res: Response) => {
  try {
    const { phoneNumber, amount, accountReference, transactionDesc, invoiceNumber } =
      req.body;

    if (!phoneNumber || !amount || !accountReference) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: phoneNumber, amount, and accountReference are required.",
      });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);
    const parsedAmount = Math.round(Number(amount));

    if (parsedAmount < 1) {
      return res.status(400).json({
        success: false,
        error: "Amount must be at least KES 1.",
      });
    }

    // Trigger Daraja STK Push
    const stkResponse = await darajaPaybillService.initiateStkPush({
      phoneNumber: formattedPhone,
      amount: parsedAmount,
      accountReference: accountReference.trim(),
      transactionDesc,
    });

    // Record pending transaction in Supabase
    await businessPaymentService.recordStkInitiation({
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      accountReference: accountReference.trim(),
      amount: parsedAmount,
      phoneNumber: formattedPhone,
      invoiceNumber: invoiceNumber || accountReference.trim(),
    });

    return res.status(200).json({
      success: true,
      message: stkResponse.CustomerMessage,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      accountReference,
    });
  } catch (error: any) {
    console.error("[STK PUSH HANDLER ERROR]", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to initiate STK push",
    });
  }
});

/**
 * 2. STK PUSH WEBHOOK CALLBACK
 * POST /api/mpesa/callback
 */
mpesaRouter.post("/callback", async (req: Request, res: Response) => {
  if (!verifyWebhookToken(req)) {
    console.warn("[WEBHOOK AUTH] Rejected unauthorized callback ping");
    return res.status(401).json({ ResultCode: 1, ResultDesc: "Unauthorized" });
  }

  // Always acknowledge Safaricom promptly
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });

  try {
    const callbackData = req.body?.Body?.stkCallback;
    if (!callbackData) {
      console.warn("[CALLBACK] Missing stkCallback body payload", req.body);
      return;
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = callbackData;

    console.log(
      `[STK CALLBACK] Checkout: ${CheckoutRequestID}, ResultCode: ${ResultCode}`
    );

    if (ResultCode === 0 && CallbackMetadata?.Item) {
      const items: any[] = CallbackMetadata.Item;
      const getVal = (name: string) =>
        items.find((i) => i.Name === name)?.Value;

      const mpesaReceiptNumber = String(getVal("MpesaReceiptNumber") || "");
      const rawDate = String(getVal("TransactionDate") || "");

      let txDate = new Date();
      if (rawDate && rawDate.length === 14) {
        const y = parseInt(rawDate.substring(0, 4), 10);
        const m = parseInt(rawDate.substring(4, 6), 10) - 1;
        const d = parseInt(rawDate.substring(6, 8), 10);
        const hh = parseInt(rawDate.substring(8, 10), 10);
        const mm = parseInt(rawDate.substring(10, 12), 10);
        const ss = parseInt(rawDate.substring(12, 14), 10);
        txDate = new Date(y, m, d, hh, mm, ss);
      }

      await businessPaymentService.handleStkSuccess({
        checkoutRequestId: CheckoutRequestID,
        mpesaReceiptNumber,
        transactionDate: txDate,
        rawCallback: req.body,
      });
    } else {
      await businessPaymentService.handleStkFailure({
        checkoutRequestId: CheckoutRequestID,
        resultCode: String(ResultCode),
        resultDesc: ResultDesc || "Cancelled or Failed",
        rawCallback: req.body,
      });
    }
  } catch (error: any) {
    console.error("[CALLBACK PROCESSING ERROR]", error.message);
  }
});

/**
 * 3. C2B MANUAL VALIDATION ENDPOINT
 * POST /api/mpesa/c2b/validation
 * Auto-accepts all incoming payments (ResultCode: 0)
 */
mpesaRouter.post("/c2b/validation", (req: Request, res: Response) => {
  if (!verifyWebhookToken(req)) {
    return res.status(401).json({ ResultCode: "C2B00016", ResultDesc: "Unauthorized" });
  }

  console.log("[C2B VALIDATION]", {
    TransID: req.body?.TransID,
    BillRefNumber: req.body?.BillRefNumber,
    TransAmount: req.body?.TransAmount,
  });

  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
});

/**
 * 4. C2B MANUAL CONFIRMATION ENDPOINT
 * POST /api/mpesa/c2b/confirmation
 * Reconciles payments made directly via the SIM Paybill menu
 */
mpesaRouter.post("/c2b/confirmation", async (req: Request, res: Response) => {
  if (!verifyWebhookToken(req)) {
    return res.status(401).json({ ResultCode: 1, ResultDesc: "Unauthorized" });
  }

  // Always respond to Safaricom immediately
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });

  try {
    const payload = req.body;
    const {
      TransID,
      TransAmount,
      BillRefNumber,
      MSISDN,
      FirstName,
      MiddleName,
      LastName,
      TransTime,
    } = payload;

    if (!TransID || !TransAmount || !BillRefNumber) {
      console.warn("[C2B CONFIRMATION] Incomplete payload received", payload);
      return;
    }

    let txDate = new Date();
    if (TransTime && String(TransTime).length === 14) {
      const s = String(TransTime);
      const y = parseInt(s.substring(0, 4), 10);
      const m = parseInt(s.substring(4, 6), 10) - 1;
      const d = parseInt(s.substring(6, 8), 10);
      const hh = parseInt(s.substring(8, 10), 10);
      const mm = parseInt(s.substring(10, 12), 10);
      const ss = parseInt(s.substring(12, 14), 10);
      txDate = new Date(y, m, d, hh, mm, ss);
    }

    await businessPaymentService.handleC2bConfirmation({
      mpesaReceiptNumber: TransID,
      accountReference: BillRefNumber.trim(),
      amount: Number(TransAmount),
      phoneNumber: MSISDN,
      firstName: FirstName,
      middleName: MiddleName,
      lastName: LastName,
      transactionDate: txDate,
      rawPayload: payload,
    });

    console.log(
      `[C2B CONFIRMATION SUCCESS] Receipt: ${TransID}, Amount: ${TransAmount}, Ref: ${BillRefNumber}`
    );
  } catch (error: any) {
    console.error("[C2B CONFIRMATION ERROR]", error.message);
  }
});

/**
 * 5. PAYMENT STATUS QUERY & ACTIVE RECONCILIATION
 * GET /api/mpesa/status/:checkoutRequestId
 */
mpesaRouter.get("/status/:checkoutRequestId", async (req: Request, res: Response) => {
  try {
    const checkoutRequestId = String(req.params.checkoutRequestId);
    let payment = await businessPaymentService.getPaymentByCheckoutId(
      checkoutRequestId
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found for this CheckoutRequestID",
      });
    }

    // If still pending after 15+ seconds, perform active Daraja query reconciliation
    if (payment.status === "pending") {
      const diffMs = Date.now() - new Date(payment.created_at).getTime();
      if (diffMs > 15000) {
        const queryRes = await darajaPaybillService.queryStkStatus(
          checkoutRequestId
        );
        if (queryRes) {
          if (queryRes.ResultCode === "0") {
            await businessPaymentService.handleStkSuccess({
              checkoutRequestId,
              mpesaReceiptNumber: "QUERY_VERIFIED",
              transactionDate: new Date(),
              rawCallback: queryRes,
            });
          } else if (
            queryRes.ResultCode !== undefined &&
            queryRes.ResultCode !== "1037" && // 1037 is DS timeout user still entering PIN
            queryRes.ResultCode !== "0"
          ) {
            await businessPaymentService.handleStkFailure({
              checkoutRequestId,
              resultCode: queryRes.ResultCode,
              resultDesc: queryRes.ResultDesc || "Failed",
              rawCallback: queryRes,
            });
          }
          // Fetch updated
          payment = await businessPaymentService.getPaymentByCheckoutId(
            checkoutRequestId
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to query status",
    });
  }
});

/**
 * 6. REGISTER C2B URLS (Admin Endpoint)
 * POST /api/mpesa/c2b/register
 */
mpesaRouter.post("/c2b/register", async (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"] as string | undefined;
  const configuredAdminKey = process.env.ADMIN_SECRET_KEY?.trim();

  if (
    !configuredAdminKey ||
    adminKey !== configuredAdminKey
  ) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { validationUrl, confirmationUrl, responseType } = req.body;
    const result = await darajaPaybillService.registerC2bUrl({
      validationUrl,
      confirmationUrl,
      responseType,
    });

    return res.status(200).json({
      success: true,
      message: "C2B URLs registered successfully with Safaricom Daraja",
      result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to register C2B URLs",
    });
  }
});
