// Pass count={null} to hide the numeric summary (as for individual reviews).
export default function RatingStars({ rating, count }) {
    const normalizedRating = Number(rating || 0);
    const reviewCount = Number(count || 0);

    return (
        <div className="d-flex align-items-center gap-2 small">
            <span>
                {[1, 2, 3, 4, 5].map(star => (
                    <i key={star} className={normalizedRating >= star ? 'bi bi-star-fill text-warning' : 'bi bi-star text-warning'} />
                ))}
            </span>
            {count !== null
                ? <span className="text-muted">{normalizedRating.toFixed(1)} ({reviewCount})</span>
                : null}
        </div>
    );
}
