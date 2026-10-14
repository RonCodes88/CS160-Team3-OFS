import { listProducts } from "@/lib/catalog/sampleCatalog";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ productId: string }> },
) {
    const { productId } = await params;
    const products = await listProducts();

    const product = products.find((item) => item.id === productId);

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