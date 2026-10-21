import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { getCustomerCart, setCustomerCartItem } from '@/lib/cart/service';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ['CUSTOMER']);
    if (!auth.ok) return auth.response;

    try {
        const cart = await getCustomerCart(auth.user.id);
        return NextResponse.json(cart);
    } catch (err: any) {
        return NextResponse.json({ error: { message: err.message } }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ['CUSTOMER']);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json();
        const { productId, quantity } = body;

        if (
            typeof productId !== "string" ||
            productId.length === 0 ||
            !Number.isSafeInteger(quantity) ||
            quantity < 0
        ) {
            return NextResponse.json(
                { error: { message: 'Invalid product ID or quantity.' } },
                { status: 400 }
            );
        }

        const updatedCart = await setCustomerCartItem(auth.user.id, productId, quantity);
        return NextResponse.json(updatedCart);
    } catch (err: any) {
        return NextResponse.json(
            { error: { message: err.message } },
            { status: 400 }
        );
    }
}