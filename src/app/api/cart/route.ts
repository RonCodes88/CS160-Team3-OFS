import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import {
    getCustomerCart,
    setCustomerCartItem,
} from "@/lib/cart/service";
import { createAdminClient } from "@/lib/supabase/admin";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Something went wrong.";
}

export async function GET(request: NextRequest) {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);

    if (!auth.ok) return auth.response;

    try {
        const cart = await getCustomerCart(auth.user.id);
        return NextResponse.json(cart);
    } catch (error: unknown) {
        return NextResponse.json(
            { error: { message: getErrorMessage(error) } },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);

    if (!auth.ok) return auth.response;

    try {
        const body: unknown = await request.json();

        if (!body || typeof body !== "object") {
            return NextResponse.json(
                { error: { message: "Request body is required." } },
                { status: 400 },
            );
        }

        const { productId, quantity } = body as {
            productId?: unknown;
            quantity?: unknown;
        };

        if (
            typeof productId !== "string" ||
            productId.length === 0 ||
            typeof quantity !== "number" ||
            !Number.isSafeInteger(quantity) ||
            quantity < 0
        ) {
            return NextResponse.json(
                { error: { message: "Invalid product ID or quantity." } },
                { status: 400 },
            );
        }

        const updatedCart = await setCustomerCartItem(
            auth.user.id,
            productId,
            quantity,
        );

        return NextResponse.json(updatedCart);
    } catch (error: unknown) {
        return NextResponse.json(
            { error: { message: getErrorMessage(error) } },
            { status: 400 },
        );
    }
}