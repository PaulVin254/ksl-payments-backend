-- Fr. Anthony Chilolo Daniel, SMM - Graduation gift & messages
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/aojlbhvjvoxofdzzjrud/sql

CREATE TABLE IF NOT EXISTS public.father_anthony_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contributor_name TEXT NOT NULL,
    phone_number TEXT,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    message TEXT,
    payment_method TEXT NOT NULL DEFAULT 'message_only', -- 'stk_push' | 'manual_mpesa' | 'message_only'
    payment_status TEXT NOT NULL DEFAULT 'message_only', -- 'pending' | 'verified' | 'failed' | 'self_reported' | 'message_only'
    mpesa_receipt TEXT,
    checkout_request_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fac_status ON public.father_anthony_contributions(payment_status);
CREATE INDEX IF NOT EXISTS idx_fac_created ON public.father_anthony_contributions(created_at DESC);

-- All access goes through the backend (service role). No public policies.
ALTER TABLE public.father_anthony_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on father_anthony_contributions" ON public.father_anthony_contributions;
CREATE POLICY "Service role full access on father_anthony_contributions"
    ON public.father_anthony_contributions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

