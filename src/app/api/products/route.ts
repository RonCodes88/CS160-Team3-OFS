import { parseShopQuery } from "@/lib/catalog/query";
import { searchCatalogProducts } from "@/lib/catalog/service";

export async function GET(request: Request) {
    const url = new URL(request.url);

    const query = parseShopQuery({
        q: url.searchParams.get("q") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
    });

    const products = await searchCatalogProducts(query);

    return Response.json({ products });
}
