import { internalErrorResponse } from "@/lib/api/errors";
import { getCatalogCategories } from "@/lib/catalog/service";

export async function GET() {
    try {
        const categories = await getCatalogCategories();

        return Response.json({
            categories,
        });
    } catch (err) {
        return internalErrorResponse(err);
    }
}
