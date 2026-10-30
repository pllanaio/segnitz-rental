import { useEffect, useState } from 'react';
import RatingStars from './RatingStars';

export function productCardData(product) {
    const productImages = product.images || [];
    return {
        productId: product.id,
        productKey: product.product_key,
        title: product.title,
        description: product.description || '',
        attributes: {
            color: product.color,
            power: product.power_value,
            powerUnit: product.power_unit,
            operatingHours: product.operating_hours,
            mileageKm: product.mileage_km
        },
        price: `${Number(product.price_per_day).toFixed(2)} € / Tag`,
        deposit: `${Number(product.deposit).toFixed(2)} €`,
        image: productImages.length > 0 ? productImages[0].path : product.image_path,
        images: productImages.map(image => image.path),
        averageRating: product.average_rating || 0,
        reviewCount: product.review_count || 0,
        product
    };
}

const AVAILABILITY_LOADING = { className: 'bg-secondary', text: 'Verfügbarkeit wird geprüft...' };

export default function ProductCard({ product, onOpen }) {
    const card = productCardData(product);
    const [availability, setAvailability] = useState(AVAILABILITY_LOADING);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const response = await fetch(`/products/${product.id}/current-availability`);
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Verfügbarkeit konnte nicht geladen werden.');
                }

                if (!active) return;
                setAvailability(result.available
                    ? { className: 'bg-success', text: 'Aktuell verfügbar' }
                    : { className: 'bg-warning', text: 'Aktuell vermietet' });
            } catch (error) {
                console.error('Fehler beim Laden der Verfügbarkeit:', error);
                if (active) setAvailability({ className: 'bg-secondary', text: 'Verfügbarkeit unbekannt' });
            }
        })();
        return () => { active = false; };
    }, [product.id]);

    return (
        <div className="product-card" data-product={card.productKey} data-product-id={card.productId} data-available="unknown"
            onClick={() => onOpen(card)}>
            <div className="product-card-image-wrap">
                {card.image ? <img src={card.image} alt={product.title} /> : null}
                <div className={`availability-badge badge ${availability.className}`}>{availability.text}</div>
            </div>

            <div className="product-card-body">
                <h5 className="product-card-title">{product.title}</h5>
                <RatingStars rating={product.average_rating} count={product.review_count} />

                <p className="product-card-description">{product.description || ''}</p>

                <div className="product-card-price-row">
                    <div>
                        <div className="product-card-price">{Number(product.price_per_day).toFixed(2)} € / Tag</div>
                        <div className="product-card-deposit">Kaution: {Number(product.deposit).toFixed(2)} €</div>
                    </div>

                    <button type="button" className="btn btn-outline-primary btn-sm product-details-btn"
                        onClick={event => {
                            event.stopPropagation();
                            onOpen(card);
                        }}>
                        Details
                    </button>
                </div>
            </div>
        </div>
    );
}
