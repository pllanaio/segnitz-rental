function normalizeCategoryName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function createCategorySlug(value) {
    return normalizeCategoryName(value)
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function syncProductCategories(connection, productId, categories) {
    const normalizedCategories = [
        ...new Set(
            (Array.isArray(categories) ? categories : [])
                .map(normalizeCategoryName)
                .filter(Boolean)
        )
    ];

    await connection.execute(
        `DELETE FROM rental_product_categories WHERE product_id = ?`,
        [productId]
    );

    for (const categoryName of normalizedCategories) {
        const slug = createCategorySlug(categoryName);

        await connection.execute(`
            INSERT IGNORE INTO rental_categories (name, slug)
            VALUES (?, ?)
        `, [categoryName, slug]);

        const [rows] = await connection.execute(
            `SELECT id FROM rental_categories WHERE slug = ? LIMIT 1`,
            [slug]
        );

        if (rows.length > 0) {
            await connection.execute(`
                INSERT IGNORE INTO rental_product_categories (product_id, category_id)
                VALUES (?, ?)
            `, [productId, rows[0].id]);
        }
    }
}

module.exports = {
    normalizeCategoryName,
    createCategorySlug,
    syncProductCategories
};