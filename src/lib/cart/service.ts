import { createAdminClient } from '@/lib/supabase/admin';

export interface CartResponse {
    cart_id: string;
    total_weight: number;
    items: Array<{
        product_id: string;
        sku: string;
        name: string;
        description: string;
        price_cents: number;
        unit_weight: number;
        quantity: number;
        line_weight: number;
    }>;
}

export async function getCustomerCart(customerId: string): Promise<CartResponse> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('customer_get_cart', {
        p_customer_id: customerId,
    });

    if (error) throw error;
    return data as CartResponse;
}

export async function setCustomerCartItem(
    customerId: string,
    productId: string,
    quantity: number
): Promise<CartResponse> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('customer_set_cart_item', {
        p_customer_id: customerId,
        p_product_id: productId,
        p_quantity: quantity,
    });

    if (error) {
        if (error.code === 'P0003') {
            throw new Error('Requested quantity exceeds available stock.');
        }
        if (error.code === 'P0004') {
            throw new Error('Cart weight exceeds the maximum allowed limit of 200 lb.');
        }
        throw error;
    }

    return data as CartResponse;
}