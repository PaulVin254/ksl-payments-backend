import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

console.log('--- 1. Testing Daraja OAuth with Provided Credentials ---');
const consumerKey = process.env.DARAJA_CONSUMER_KEY;
const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
const authHeader = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
const oauthUrl = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

try {
  const oauthRes = await axios.get(oauthUrl, {
    headers: { Authorization: `Basic ${authHeader}` },
    timeout: 10000,
  });
  console.log('✅ Safaricom OAuth SUCCESS! Token received.');
  console.log('   Expires in:', oauthRes.data.expires_in, 'seconds');
  const token = oauthRes.data.access_token;

  console.log('\n--- 2. Checking Supabase Tables ---');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: payData, error: payError } = await supabase.from('business_payments').select('id').limit(1);
  if (payError) {
    console.log('⚠️  Table business_payments NOT FOUND in Supabase yet.');
    console.log('   Error message:', payError.message);
    console.log('   👉 Please run schema.sql in Supabase SQL editor.');
  } else {
    console.log('✅ Supabase table business_payments exists and is accessible!');
  }

  const { data: invData, error: invError } = await supabase.from('business_invoices').select('id').limit(1);
  if (invError) {
    console.log('⚠️  Table business_invoices NOT FOUND in Supabase yet.');
    console.log('   Error message:', invError.message);
  } else {
    console.log('✅ Supabase table business_invoices exists and is accessible!');
  }

  console.log('\n--- 3. Testing Daraja STK Push Initiation in Sandbox ---');
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

  const shortcode = process.env.DARAJA_PAYBILL_NUMBER;
  const passkey = process.env.DARAJA_PASSKEY;
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const stkUrl = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
  const stkPayload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: 1,
    PartyA: '254708374149',
    PartyB: shortcode,
    PhoneNumber: '254708374149',
    CallBackURL: 'https://webhook.site/placeholder/api/mpesa/callback',
    AccountReference: 'SANDBOX-TEST',
    TransactionDesc: 'Test Payment',
  };

  const stkRes = await axios.post(stkUrl, stkPayload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  console.log('✅ Safaricom STK Push Accepted in Sandbox!');
  console.log('   MerchantRequestID:', stkRes.data.MerchantRequestID);
  console.log('   CheckoutRequestID:', stkRes.data.CheckoutRequestID);
  console.log('   ResponseDescription:', stkRes.data.ResponseDescription);
  console.log('   CustomerMessage:', stkRes.data.CustomerMessage);

} catch (err) {
  console.error('❌ Verification failed:', err.response?.data || err.message);
}
