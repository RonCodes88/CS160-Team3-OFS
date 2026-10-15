import { getCatalogCategories } from "@/lib/catalog/service";

export async function GET() {
    const categories = await getCatalogCategories();

    return Response.json({
        categories,
    });
}
