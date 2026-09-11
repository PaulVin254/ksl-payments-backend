import axios from "axios";

interface WelcomeEmailParams {
  studentName: string;
  studentEmail: string;
  amountPaid: number;
  mpesaReceipt: string;
  paymentTier: string;
  whatsAppGroupLink: string;
}

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "paul@ephphathakenya.co.ke";
  const senderName = process.env.BREVO_SENDER_NAME || "Paul - Ephphatha Sign Language";

  if (!apiKey) {
    console.warn("⚠️ Warning: BREVO_API_KEY not set. Skipping welcome email.");
    return false;
  }

  const tierLabel =
    params.paymentTier === "micro"
      ? "Class Micro-Commitment"
      : params.paymentTier === "deposit"
      ? "Seat Reservation Deposit"
      : params.paymentTier === "full"
      ? "Full Course Enrolment"
      : "Course Payment";

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Welcome to Ephphatha Sign Language</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f5; color: #1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #eaeaea; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 32px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em;">Ephphatha Sign Language</h1>
              <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 14px;">KSL Bridge Builder Online Academy</p>
            </td>
          </tr>
          
          <!-- Body Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px 0; font-size: 22px; color: #0f172a;">Jambo ${params.studentName}! 🎉</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
                Your M-Pesa payment of <strong>Ksh ${params.amountPaid.toLocaleString()}</strong> has been successfully received and verified. Your spot is officially secured!
              </p>
              
              <!-- Receipt Card -->
              <table width="100%" cellpadding="12" cellspacing="0" style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 32px;">
                <tr>
                  <td style="font-size: 13px; color: #64748b; font-weight: 600;">Payment Option:</td>
                  <td style="font-size: 14px; color: #0f172a; font-weight: 700; text-align: right;">${tierLabel}</td>
                </tr>
                <tr>
                  <td style="font-size: 13px; color: #64748b; font-weight: 600;">M-Pesa Receipt:</td>
                  <td style="font-size: 14px; color: #059669; font-weight: 800; text-align: right; font-family: monospace;">${params.mpesaReceipt}</td>
                </tr>
                <tr>
                  <td style="font-size: 13px; color: #64748b; font-weight: 600;">Amount Paid:</td>
                  <td style="font-size: 14px; color: #0f172a; font-weight: 700; text-align: right;">Ksh ${params.amountPaid.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="font-size: 13px; color: #64748b; font-weight: 600;">Status:</td>
                  <td style="font-size: 13px; color: #059669; font-weight: 700; text-align: right;">✅ Verified & Confirmed</td>
                </tr>
              </table>

              <!-- Next Steps CTA -->
              <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
                <h3 style="margin: 0 0 8px 0; color: #065f46; font-size: 18px;">👉 Immediate Next Step</h3>
                <p style="margin: 0 0 20px 0; color: #047857; font-size: 14px; line-height: 1.5;">
                  Join the class WhatsApp group right away. That's where class timetables, meeting links, and student materials are posted!
                </p>
                <a href="${params.whatsAppGroupLink}" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 2px 8px rgba(5,150,105,0.3);">
                  💬 Join Class WhatsApp Group
                </a>
              </div>

              <p style="font-size: 14px; line-height: 1.6; color: #64748b; margin: 0;">
                If you have any questions or need special support, feel free to WhatsApp or call Paul directly on <a href="tel:+254717297022" style="color: #0f172a; font-weight: 700;">0717 297 022</a>.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eaeaea; font-size: 12px; color: #94a3b8;">
              &copy; ${new Date().getFullYear()} Ephphatha Sign Language · All rights reserved.<br/>
              Empowering communication across Kenya and beyond.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: params.studentEmail,
            name: params.studentName,
          },
        ],
        subject: `🎉 You're in! KSL Class Registration Confirmed (Receipt: ${params.mpesaReceipt})`,
        htmlContent: htmlContent,
      },
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    console.log("✅ Brevo email sent successfully to", params.studentEmail, response.data);
    return true;
  } catch (error: any) {
    console.error("❌ Failed to send Brevo welcome email:", error.response?.data || error.message);
    return false;
  }
}
