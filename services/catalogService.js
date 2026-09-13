'use strict';
const { normalizeQuery } = require('../public/js/catalog-state');

function invalidQuery() {
    return Object.assign(new Error('Ungültige Katalogsuche oder Seitenauswahl.'), { status: 400, statusCode: 400 });
}
function textParameter(value, fallback = '') {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw invalidQuery();
    const normalized = normalizeQuery(value);
    if ([...normalized].length > 120) throw invalidQuery();
    return normalized;
}
function integerParameter(value, fallback, maximum) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) throw invalidQuery();
    const result = Number(value);
    if (result > maximum) throw invalidQuery();
    return result;
}
function parseCatalogQuery(query = {}) {
    return { page: integerParameter(query.page, 1, 10000), pageSize: integerParameter(query.pageSize, 12, 100),
        q: textParameter(query.q), category: textParameter(query.category, 'all') || 'all' };
}
function searchWhere(q, category = 'all') {
    const clauses = ['p.is_active = 1'];
    const params = [];
    if (q) {
        const term = `%${q.replace(/[!%_]/g, value => `!${value}`)}%`;
        clauses.push(`(CONCAT_WS(' ', p.title, p.description, p.product_key, p.category) LIKE ? ESCAPE '!'
          OR EXISTS (SELECT 1 FROM rental_product_categories search_category
             JOIN rental_categories search_name ON search_name.id = search_category.category_id
             WHERE search_category.product_id = p.id AND search_name.name LIKE ? ESCAPE '!'))`);
        params.push(term, term);
    }
    if (category !== 'all') {
        clauses.push(`(p.category = ? OR EXISTS (SELECT 1 FROM rental_product_categories selected_category
          JOIN rental_categories selected_name ON selected_name.id = selected_category.category_id
          WHERE selected_category.product_id = p.id AND selected_name.name = ?))`);
        params.push(category, category);
    }
    return { sql: clauses.join(' AND '), params };
}
function group(rows, project) {
    const grouped = new Map();
    for (const row of rows) {
        const key = String(row.product_id);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(project(row));
    }
    return grouped;
}

async function readCatalogPage(connection, options) {
    const { q, category, pageSize } = options;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        !Number.isSafeInteger(options.page) || options.page < 1 || options.page > 10000) throw invalidQuery();
    const where = searchWhere(q, category);
    const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM rental_products p WHERE ${where.sql}`, where.params);
    const total = Number(count.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Ungültige Kataloganzahl.');
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const page = Math.min(options.page, totalPages);
    // Only range-checked integer literals enter LIMIT/OFFSET. Search/category
    // remain prepared parameters, independent of NO_BACKSLASH_ESCAPES mode and
    // mysql2's unsupported binary DOUBLE binding in MySQL LIMIT clauses.
    const offset = (page - 1) * pageSize;
    const [products] = await connection.execute(`SELECT p.id, p.product_key, p.title, p.description,
        p.price_per_day, p.deposit, p.image_path, p.is_active, p.category,
        COALESCE((SELECT ROUND(AVG(review.rating), 1) FROM product_reviews review WHERE review.product_id = p.id), 0) AS average_rating,
        (SELECT COUNT(*) FROM product_reviews review WHERE review.product_id = p.id) AS review_count
        FROM rental_products p WHERE ${where.sql} ORDER BY p.title ASC, p.id ASC LIMIT ${pageSize} OFFSET ${offset}`,
    where.params);
    let images = []; let categories = [];
    if (products.length) {
        const ids = products.map(product => product.id);
        const placeholders = ids.map(() => '?').join(',');
        [images] = await connection.execute(`SELECT id, product_id, image_path FROM (
          SELECT id, product_id, image_path, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY sort_order, id) AS ordinal
          FROM rental_product_images WHERE product_id IN (${placeholders})
        ) page_images WHERE ordinal <= 10 ORDER BY product_id, ordinal`, ids);
        [categories] = await connection.execute(`SELECT product_id, id, name, slug FROM (
          SELECT rpc.product_id, category.id, category.name, category.slug,
            ROW_NUMBER() OVER (PARTITION BY rpc.product_id ORDER BY category.name, category.id) AS ordinal
          FROM rental_product_categories rpc JOIN rental_categories category ON category.id = rpc.category_id
          WHERE rpc.product_id IN (${placeholders})
        ) page_categories WHERE ordinal <= 100 ORDER BY product_id, ordinal`, ids);
    }
    const imagesByProduct = group(images, row => ({ id: row.id, path: row.image_path }));
    const categoriesByProduct = group(categories, row => ({ id: row.id, name: row.name, slug: row.slug }));
    const search = searchWhere(q);
    const [facets] = await connection.execute(`SELECT name, COUNT(DISTINCT product_id) AS count FROM (
      SELECT category.name, p.id AS product_id FROM rental_products p
      JOIN rental_product_categories rpc ON rpc.product_id = p.id
      JOIN rental_categories category ON category.id = rpc.category_id WHERE ${search.sql}
      UNION ALL
      SELECT p.category AS name, p.id AS product_id FROM rental_products p WHERE ${search.sql}
        AND p.category IS NOT NULL AND p.category != ''
        AND NOT EXISTS (SELECT 1 FROM rental_product_categories rpc WHERE rpc.product_id = p.id)
    ) visible_categories GROUP BY name ORDER BY name LIMIT 101`, [...search.params, ...search.params]);
    const [[searchCount]] = await connection.execute(`SELECT COUNT(*) AS total FROM rental_products p WHERE ${search.sql}`, search.params);
    return {
        products: products.map(product => {
            const productImages = imagesByProduct.get(String(product.id)) || [];
            const productCategories = categoriesByProduct.get(String(product.id)) || [];
            return { ...product, images: productImages, categories: productCategories,
                image_path: productImages[0]?.path || product.image_path || '',
                category: productCategories[0]?.name || product.category || '' };
        }),
        pagination: { page, pageSize, total, totalPages },
        categories: facets.slice(0, 100).map(facet => ({ name: facet.name, count: Number(facet.count) })),
        categoriesTruncated: facets.length > 100, searchTotal: Number(searchCount.total)
    };
}

module.exports = { parseCatalogQuery, readCatalogPage };
