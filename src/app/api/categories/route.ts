import { listCategories } from "@/lib/catalog/sampleCatalog";

export async function GET() {
    const categories = await listCategories();

    return Response.json({
        categories,
    });
}