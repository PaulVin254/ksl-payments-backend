-- ==============================================================================
-- Registered Business Paybill Schema (Supabase PostgreSQL)
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/aojlbhvjvoxofdzzjrud/sql
-- ==============================================================================

-- 1. Create Invoices / Orders Table
CREATE TABLE IF NOT EXISTS public.business_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(255),
    amount NUMERIC(12, 2) NOT NULL,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'unpaid', -- 'unpaid', 'partially_paid', 'paid', 'cancelled'
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Payments Table (Tracks STK Push & C2B Manual Payments)
CREATE TABLE IF NOT EXISTS public.business_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'stk_push', -- 'stk_push' or 'c2b_manual'
    checkout_request_id VARCHAR(100) UNIQUE,
    merchant_request_id VARCHAR(100),
    mpesa_receipt_number VARCHAR(100) UNIQUE,
    invoice_id UUID REFERENCES public.business_invoices(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100),
    account_reference VARCHAR(100) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    payer_first_name VARCHAR(100),
    payer_middle_name VARCHAR(100),
    payer_last_name VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'unassigned'
    result_code VARCHAR(50),
    result_desc TEXT,
    transaction_date TIMESTAMPTZ,
    raw_callback JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_business_invoices_number ON public.business_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_business_invoices_status ON public.business_invoices(status);

CREATE INDEX IF NOT EXISTS idx_business_payments_checkout_id ON public.business_payments(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_business_payments_receipt ON public.business_payments(mpesa_receipt_number);
CREATE INDEX IF NOT EXISTS idx_business_payments_account_ref ON public.business_payments(account_reference);
CREATE INDEX IF NOT EXISTS idx_business_payments_status ON public.business_payments(status);
CREATE INDEX IF NOT EXISTS idx_business_payments_phone ON public.business_payments(phone_number);

-- 4. Automatic updated_at Trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_invoices_updated_at ON public.business_invoices;
CREATE TRIGGER trg_business_invoices_updated_at
    BEFORE UPDATE ON public.business_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_business_payments_updated_at ON public.business_payments;
CREATE TRIGGER trg_business_payments_updated_at
    BEFORE UPDATE ON public.business_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Row Level Security (RLS)
ALTER TABLE public.business_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_payments ENABLE ROW LEVEL SECURITY;

-- Allow service role (backend API) full access
DROP POLICY IF EXISTS "Service role full access on business_invoices" ON public.business_invoices;
CREATE POLICY "Service role full access on business_invoices"
    ON public.business_invoices
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on business_payments" ON public.business_payments;
CREATE POLICY "Service role full access on business_payments"
    ON public.business_payments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
