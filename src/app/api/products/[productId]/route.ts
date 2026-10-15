import { getCatalogProduct } from "@/lib/catalog/service";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ productId: string }> },
) {
    const { productId } = await params;
    const product = await getCatalogProduct(productId);


    if (!product) {
        return Response.json(
            {
                error: {
                    code: "PRODUCT_NOT_FOUND",
                    message: "Product not found.",
                },
            },
            { status: 404 },
        );
    }

    return Response.json({ product });
}
