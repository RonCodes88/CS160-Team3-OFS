import { parseShopQuery } from "@/lib/catalog/query";
import { listProducts } from "@/lib/catalog/sampleCatalog";

export async function GET(request: Request) {
    const url = new URL(request.url);

    const query = parseShopQuery({
        q: url.searchParams.get("q") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
    });

    const products = (await listProducts(query)).filter((product) => product.inStock);

    return Response.json({ products });
}