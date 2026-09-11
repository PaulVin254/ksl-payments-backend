import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
let clientInstance = null;
export function getSupabaseAdmin() {
    if (clientInstance)
        return clientInstance;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables!");
    }
    clientInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
    return clientInstance;
}
export const supabaseAdmin = new Proxy({}, {
    get(_target, prop, receiver) {
        const client = getSupabaseAdmin();
        const value = Reflect.get(client, prop, receiver);
        return typeof value === "function" ? value.bind(client) : value;
    },
});
