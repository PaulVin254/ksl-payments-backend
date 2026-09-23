import axios from "axios";

interface WelcomeEmailParams {
  studentName: string;
  studentEmail: string;
  amountPaid: number;
  mpesaReceipt: string;
  paymentTier: string;
  whatsAppGroupLink?: string;
  receiptUrl?: string;
  timetableUrl?: string;
}

const TIMETABLE_URL =
  "https://aojlbhvjvoxofdzzjrud.supabase.co/storage/v1/object/public/Learn%20Kenyan%20Sign%20Language%20in%201%20hour/Learn%20Kenyan%20Sign%20Language%20-%20Timetable%20-%20Sept%202026.pdf";

const FRONTEND_BASE_URL =
  process.env.FRONTEND_RECEIPT_URL || "https://learn.ephphathakenya.co.ke";

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "paul@ephphathakenya.co.ke";
  const senderName = process.env.BREVO_SENDER_NAME || "Paul - Ephphatha Sign Language";

  if (!apiKey) {
    console.warn("⚠️ Warning: BREVO_API_KEY not set. Skipping welcome email.");
    return false;
  }

  const tierLabel =
    params.paymentTier === "deposit"
      ? "Seat Reservation Deposit (Ksh 1,000)"
      : params.paymentTier === "full"
      ? "Full Course Enrolment (Ksh 10,000)"
      : "Tuition Installment Payment";

  const totalTuition = 10000;
  const balanceRemaining = Math.max(0, totalTuition - params.amountPaid);
  const receiptUrl =
    params.receiptUrl || `${FRONTEND_BASE_URL}/receipt/${params.mpesaReceipt}`;
  const timetableUrl = params.timetableUrl || TIMETABLE_URL;
  const studentFirstName = params.studentName.trim().split(" ")[0] || "Learner";

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Official Admission Receipt - Ephphatha Sign Language</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #0f172a; line-height: 1.5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 32px 16px; background-color: #f1f5f9;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #064e3b; background: linear-gradient(135deg, #064e3b 0%, #047857 100%); padding: 36px 32px; text-align: center;">
              <span style="display: inline-block; background-color: rgba(255,255,255,0.15); color: #ffffff; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 6px 14px; border-radius: 9999px; margin-bottom: 12px;">
                Official Enrollment Receipt
              </span>
              <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.02em;">
                Ephphatha Sign Language
              </h1>
              <p style="color: #a7f3d0; margin: 6px 0 0 0; font-size: 14px;">
                KSL Bridge Builder Online Academy • September 2026 Intake
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; color: #0f172a;">
                Karibu Sana, ${studentFirstName}! 🎉
              </h2>
              <p style="font-size: 15px; color: #475569; margin: 0 0 24px 0; line-height: 1.6;">
                Your M-Pesa payment of <strong style="color: #0f172a;">Ksh ${params.amountPaid.toLocaleString()}</strong> has been verified. Your seat in the <strong>September 2026 Level 1 Cohort</strong> is officially confirmed!
              </p>

              <!-- Receipt Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 14px; border: 1px solid #e2e8f0; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 18px 20px; border-bottom: 1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; font-weight: 600;">M-Pesa Transaction Code:</td>
                        <td align="right" style="font-size: 14px; color: #047857; font-weight: 800; font-family: monospace;">${params.mpesaReceipt}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; font-weight: 600;">Enrolled Program:</td>
                        <td align="right" style="font-size: 13px; color: #0f172a; font-weight: 700;">KSL Mastery — Level 1</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; font-weight: 600;">Payment Option:</td>
                        <td align="right" style="font-size: 13px; color: #0f172a; font-weight: 700;">${tierLabel}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; font-weight: 600;">Amount Paid:</td>
                        <td align="right" style="font-size: 15px; color: #047857; font-weight: 900;">Ksh ${params.amountPaid.toLocaleString()}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; font-weight: 600;">Remaining Balance:</td>
                        <td align="right" style="font-size: 14px; color: ${balanceRemaining > 0 ? '#b45309' : '#047857'}; font-weight: 800;">
                          ${balanceRemaining > 0 ? `Ksh ${balanceRemaining.toLocaleString()} (Due before class)` : 'Fully Paid ✓'}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Primary CTA: View & Print Receipt -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${receiptUrl}" target="_blank" style="display: block; width: 100%; box-sizing: border-box; background-color: #059669; color: #ffffff; text-decoration: none; padding: 16px 24px; border-radius: 12px; font-weight: 800; font-size: 15px; text-align: center; box-shadow: 0 4px 12px rgba(5,150,105,0.25);">
                      📄 View & Print Official Admission Slip
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Secondary Action: Timetable Download -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 14px; padding: 20px; margin-bottom: 28px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 6px 0; color: #065f46; font-size: 15px; font-weight: 800;">
                      📅 Class Schedule & Timetable
                    </h3>
                    <p style="margin: 0 0 14px 0; color: #047857; font-size: 13px; line-height: 1.5;">
                      Live classes run every <strong>Monday & Wednesday from 8:00 PM to 9:00 PM EAT</strong> on Zoom. You can download the full September 2026 timetable below:
                    </p>
                    <a href="${timetableUrl}" target="_blank" style="display: inline-block; background-color: #ffffff; color: #047857; border: 1px solid #10b981; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px;">
                      📥 Download September 2026 Timetable (PDF)
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Support Note -->
              <p style="font-size: 13px; line-height: 1.6; color: #64748b; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                Have questions or need assistance? Call or text Teacher Paul directly on <a href="tel:+254717297022" style="color: #0f172a; font-weight: 700; text-decoration: none;">0717 297 022</a> or reply directly to this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              &copy; ${new Date().getFullYear()} Ephphatha Sign Language • Deaf Access Initiative Kenya.<br/>
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
        subject: `🎉 Enrollment Confirmed: KSL Level 1 Admission Slip (Receipt: #${params.mpesaReceipt})`,
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
