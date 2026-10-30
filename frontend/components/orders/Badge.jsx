// Renders a badge descriptor from lib/orders.js ({ color, text, spacing }).
export default function Badge({ badge }) {
    if (!badge) return null;
    return <span className={`badge bg-${badge.color}${badge.spacing ? ' me-1' : ''}`}>{badge.text}</span>;
}
