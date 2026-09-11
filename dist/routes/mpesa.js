import { Router } from "express";
import { darajaService } from "../services/daraja.js";
import { supabaseAdmin } from "../services/supabase.js";
import { formatPhoneNumber } from "../utils/mpesa.js";
import { sendWelcomeEmail } from "../services/brevo.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js";
import { logEvent } from "../index.js";
export const mpesaRouter = Router();
/**
 * POST /api/mpesa/stkpush
 * Initiates an M-Pesa STK Push to the student's mobile number
 */
mpesaRouter.post("/stkpush", async (req, res) => {
    try {
        const { fullName, phoneNumber, email, amount, paymentTier } = req.body;
        logEvent("INFO", "Initiating STK push request", {
            fullName,
            phone: phoneNumber,
            amount,
            tier: paymentTier,
        }, "STK_PUSH");
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
        let cleanPhone;
        try {
            cleanPhone = formatPhoneNumber(phoneNumber);
            logEvent("INFO", `Normalized phone number: ${cleanPhone}`, undefined, "STK_PUSH");
        }
        catch (err) {
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
        logEvent("INFO", `Saving pending record to Supabase (CheckoutRequestID: ${stkResponse.CheckoutRequestID})`, undefined, "DATABASE");
        const { error: dbError } = await supabaseAdmin
            .from("payment_confirmations")
            .insert({
            full_name: fullName,
            phone_number: cleanPhone,
            email: email || null,
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
        }
        else {
            logEvent("SUCCESS", "Pending payment row created in Supabase", undefined, "DATABASE");
        }
        res.status(200).json({
            success: true,
            message: "STK push initiated successfully",
            checkoutRequestId: stkResponse.CheckoutRequestID,
            merchantRequestId: stkResponse.MerchantRequestID,
            customerMessage: stkResponse.CustomerMessage,
        });
    }
    catch (error) {
        logEvent("ERROR", "Unhandled error in /stkpush endpoint", error.message, "STK_PUSH");
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
mpesaRouter.post("/callback", async (req, res) => {
    // Always respond with 200 OK immediately to satisfy Safaricom's webhook SLA
    res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
    try {
        const callbackData = req.body?.Body?.stkCallback;
        if (!callbackData) {
            logEvent("WARN", "Received empty or invalid callback body from Safaricom", req.body, "CALLBACK");
            return;
        }
        const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData;
        logEvent("INFO", `Daraja Callback received (ResultCode: ${ResultCode})`, {
            CheckoutRequestID,
            ResultDesc,
        }, "CALLBACK");
        // ResultCode 0 means SUCCESS
        if (ResultCode === 0 && CallbackMetadata?.Item) {
            const items = CallbackMetadata.Item;
            const getVal = (name) => items.find((i) => i.Name === name)?.Value;
            const mpesaReceipt = String(getVal("MpesaReceiptNumber") || "");
            const amount = Number(getVal("Amount") || 0);
            const transactionDate = String(getVal("TransactionDate") || "");
            logEvent("SUCCESS", `Payment completed by student! Receipt: ${mpesaReceipt}`, {
                amount,
                transactionDate,
            }, "PAYMENT_CONFIRMED");
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
                logEvent("ERROR", "Failed to update Supabase record to verified", updateError, "DATABASE");
            }
            else {
                logEvent("SUCCESS", `Supabase record updated for ${updatedRecord?.full_name}`, undefined, "DATABASE");
            }
            // 2. Trigger Post-Payment Automations (Brevo Email & Meta WhatsApp API)
            const groupLink = process.env.WHATSAPP_CLASS_GROUP_LINK || "https://chat.whatsapp.com/JHAPRzElBgQIUhwjHfxkP8";
            if (updatedRecord) {
                if (updatedRecord.email) {
                    sendWelcomeEmail({
                        studentName: updatedRecord.full_name,
                        studentEmail: updatedRecord.email,
                        amountPaid: updatedRecord.amount_paid || amount,
                        mpesaReceipt: mpesaReceipt,
                        paymentTier: updatedRecord.payment_tier || "full",
                        whatsAppGroupLink: groupLink,
                    }).catch((err) => logEvent("ERROR", "Brevo email send error", err, "BREVO"));
                }
                sendWhatsAppMessage({
                    phoneNumber: updatedRecord.phone_number,
                    studentName: updatedRecord.full_name,
                    amountPaid: updatedRecord.amount_paid || amount,
                    mpesaReceipt: mpesaReceipt,
                    whatsAppGroupLink: groupLink,
                }).catch((err) => logEvent("ERROR", "WhatsApp send error", err, "WHATSAPP"));
            }
        }
        else {
            logEvent("WARN", `Payment cancelled or failed (Code: ${ResultCode})`, {
                CheckoutRequestID,
                ResultDesc,
            }, "CALLBACK");
            await supabaseAdmin
                .from("payment_confirmations")
                .update({
                status: "failed",
                admin_notes: `Failed: ${ResultDesc} (ResultCode: ${ResultCode})`,
            })
                .eq("checkout_request_id", CheckoutRequestID);
        }
    }
    catch (error) {
        logEvent("ERROR", "Error in Daraja callback processing", error.message, "CALLBACK");
    }
});
/**
 * GET /api/mpesa/status/:checkoutRequestId
 * Returns the current database status of a payment
 */
mpesaRouter.get("/status/:checkoutRequestId", async (req, res) => {
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
        res.status(200).json({ success: true, transaction: data });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/mpesa/simulate-success
 * Simulates a successful Daraja callback for testing in Sandbox
 */
mpesaRouter.post("/simulate-success", async (req, res) => {
    try {
        const { checkoutRequestId } = req.body;
        if (!checkoutRequestId) {
            res.status(400).json({ success: false, error: "checkoutRequestId is required" });
            return;
        }
        logEvent("INFO", `Simulating successful M-Pesa callback for CheckoutRequestID: ${checkoutRequestId}`, undefined, "SIMULATION");
        // Generate random M-Pesa receipt e.g. TST8291038
        const mockReceipt = `TST${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        const transactionDate = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
        // 1. Update Supabase record to verified
        const { data: updatedRecord, error: updateError } = await supabaseAdmin
            .from("payment_confirmations")
            .update({
            status: "verified",
            mpesa_receipt: mockReceipt,
            mpesa_code: mockReceipt,
            admin_notes: `Verified via Sandbox Simulation. TransDate: ${transactionDate}`,
        })
            .eq("checkout_request_id", checkoutRequestId)
            .select()
            .single();
        if (updateError) {
            logEvent("ERROR", "Failed to update Supabase record in simulation", updateError, "SIMULATION");
            res.status(500).json({ success: false, error: updateError.message });
            return;
        }
        logEvent("SUCCESS", `Simulation verified! Receipt: ${mockReceipt} for ${updatedRecord?.full_name}`, updatedRecord, "SIMULATION");
        // 2. Trigger Brevo & WhatsApp automations if credentials configured
        const groupLink = process.env.WHATSAPP_CLASS_GROUP_LINK || "https://chat.whatsapp.com/JHAPRzElBgQIUhwjHfxkP8";
        if (updatedRecord?.email) {
            sendWelcomeEmail({
                studentName: updatedRecord.full_name,
                studentEmail: updatedRecord.email,
                amountPaid: updatedRecord.amount_paid || 500,
                mpesaReceipt: mockReceipt,
                paymentTier: updatedRecord.payment_tier || "full",
                whatsAppGroupLink: groupLink,
            }).catch((err) => logEvent("ERROR", "Brevo email error in simulation", err, "SIMULATION"));
        }
        if (updatedRecord?.phone_number) {
            sendWhatsAppMessage({
                phoneNumber: updatedRecord.phone_number,
                studentName: updatedRecord.full_name,
                amountPaid: updatedRecord.amount_paid || 500,
                mpesaReceipt: mockReceipt,
                whatsAppGroupLink: groupLink,
            }).catch((err) => logEvent("ERROR", "WhatsApp error in simulation", err, "SIMULATION"));
        }
        res.status(200).json({
            success: true,
            message: "Simulation completed successfully",
            mpesaReceipt: mockReceipt,
            student: updatedRecord?.full_name,
        });
    }
    catch (error) {
        logEvent("ERROR", "Simulation route error", error.message, "SIMULATION");
        res.status(500).json({ success: false, error: error.message });
    }
});
