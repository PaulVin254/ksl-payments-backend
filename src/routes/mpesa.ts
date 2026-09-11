import { Router, Request, Response } from "express";
import { darajaService } from "../services/daraja.js";
import { supabaseAdmin } from "../services/supabase.js";
import { formatPhoneNumber } from "../utils/mpesa.js";
import { sendWelcomeEmail } from "../services/brevo.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js";

export const mpesaRouter = Router();

/**
 * POST /api/mpesa/stkpush
 * Initiates an M-Pesa STK Push to the student's mobile number
 */
mpesaRouter.post("/stkpush", async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, phoneNumber, email, amount, paymentTier } = req.body;

    if (!fullName || !phoneNumber || !amount) {
      res.status(400).json({
        success: false,
        error: "fullName, phoneNumber, and amount are required",
      });
      return;
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 1) {
      res.status(400).json({
        success: false,
        error: "Amount must be a valid positive number",
      });
      return;
    }

    // 1. Format phone number to 254XXXXXXXXX
    let cleanPhone: string;
    try {
      cleanPhone = formatPhoneNumber(phoneNumber);
    } catch (err: any) {
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
    const { error: dbError } = await supabaseAdmin
      .from("payment_confirmations")
      .insert({
        full_name: fullName,
        phone_number: cleanPhone,
        email: email || null,
        payment_type: paymentTier === "micro" ? "deposit" : paymentTier || "full",
        payment_tier: paymentTier || "full",
        amount_paid: numericAmount,
        checkout_request_id: stkResponse.CheckoutRequestID,
        merchant_request_id: stkResponse.MerchantRequestID,
        status: "pending",
        intake_tag: "june_2026",
        source_page: "/level1-offer",
      });

    if (dbError) {
      console.error("⚠️ Supabase insert error on pending payment:", dbError);
    }

    res.status(200).json({
      success: true,
      message: "STK push initiated successfully",
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      customerMessage: stkResponse.CustomerMessage,
    });
  } catch (error: any) {
    console.error("❌ Error in /stkpush endpoint:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process STK push request",
    });
  }
});

/**
 * POST /api/mpesa/callback
 * Webhook called by Safaricom Daraja when student completes/cancels the prompt
 */
mpesaRouter.post("/callback", async (req: Request, res: Response): Promise<void> => {
  // Always respond with 200 OK immediately to satisfy Safaricom's webhook SLA
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });

  try {
    const callbackData = req.body?.Body?.stkCallback;
    if (!callbackData) {
      console.warn("⚠️ Received invalid callback body from Safaricom:", JSON.stringify(req.body));
      return;
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } =
      callbackData;

    console.log(`🔔 Daraja Callback received for CheckoutRequestID: ${CheckoutRequestID} (Code: ${ResultCode})`);

    // ResultCode 0 means SUCCESS
    if (ResultCode === 0 && CallbackMetadata?.Item) {
      const items: Array<{ Name: string; Value?: any }> = CallbackMetadata.Item;
      const getVal = (name: string) => items.find((i) => i.Name === name)?.Value;

      const mpesaReceipt = String(getVal("MpesaReceiptNumber") || "");
      const amount = Number(getVal("Amount") || 0);
      const transactionDate = String(getVal("TransactionDate") || "");

      // 1. Update Supabase record to verified
      const { data: updatedRecord, error: updateError } = await supabaseAdmin
        .from("payment_confirmations")
        .update({
          status: "verified",
          mpesa_receipt: mpesaReceipt,
          mpesa_code: mpesaReceipt,
          admin_notes: `Verified via Daraja. TransDate: ${transactionDate}`,
        })
        .eq("checkout_request_id", CheckoutRequestID)
        .select()
        .single();

      if (updateError) {
        console.error("❌ Failed to update Supabase record on success callback:", updateError);
      } else {
        console.log(`✅ Payment verified for ${updatedRecord?.full_name} (${mpesaReceipt})`);
      }

      // 2. Trigger Post-Payment Automations (Brevo Email & Meta WhatsApp API)
      const groupLink =
        process.env.WHATSAPP_CLASS_GROUP_LINK || "https://chat.whatsapp.com/JHAPRzElBgQIUhwjHfxkP8";

      if (updatedRecord) {
        // Send Brevo Email
        if (updatedRecord.email) {
          sendWelcomeEmail({
            studentName: updatedRecord.full_name,
            studentEmail: updatedRecord.email,
            amountPaid: updatedRecord.amount_paid || amount,
            mpesaReceipt: mpesaReceipt,
            paymentTier: updatedRecord.payment_tier || "full",
            whatsAppGroupLink: groupLink,
          }).catch((err) => console.error("Email send background error:", err));
        }

        // Send WhatsApp API Message
        sendWhatsAppMessage({
          phoneNumber: updatedRecord.phone_number,
          studentName: updatedRecord.full_name,
          amountPaid: updatedRecord.amount_paid || amount,
          mpesaReceipt: mpesaReceipt,
          whatsAppGroupLink: groupLink,
        }).catch((err) => console.error("WhatsApp send background error:", err));
      }
    } else {
      // Payment failed or was cancelled by user
      console.warn(`⚠️ Payment not completed. Code: ${ResultCode}, Reason: ${ResultDesc}`);

      const { error: failUpdateError } = await supabaseAdmin
        .from("payment_confirmations")
        .update({
          status: "failed",
          admin_notes: `Failed: ${ResultDesc} (ResultCode: ${ResultCode})`,
        })
        .eq("checkout_request_id", CheckoutRequestID);

      if (failUpdateError) {
        console.error("Failed to update status to failed in Supabase:", failUpdateError);
      }
    }
  } catch (error: any) {
    console.error("❌ Error processing Daraja callback:", error);
  }
});

/**
 * GET /api/mpesa/status/:checkoutRequestId
 * Returns the current database status of a payment
 */
mpesaRouter.get("/status/:checkoutRequestId", async (req: Request, res: Response): Promise<void> => {
  try {
    const { checkoutRequestId } = req.params;

    const { data, error } = await supabaseAdmin
      .from("payment_confirmations")
      .select("id, status, mpesa_receipt, amount_paid, full_name, created_at")
      .eq("checkout_request_id", checkoutRequestId)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }

    res.status(200).json({
      success: true,
      transaction: data,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
