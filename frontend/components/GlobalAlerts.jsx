// Container for showAlert() messages (lib/alerts.js appends them as plain DOM nodes).
export default function GlobalAlerts({ variant = 'default' }) {
    const admin = variant === 'admin';
    return (
        <div id="globalAlertContainer" className={`position-fixed top-0 start-50 translate-middle-x ${admin ? 'mt-5' : 'mt-3'}`}
            style={{ zIndex: admin ? 4000 : 3000, width: '90%', maxWidth: 520 }} />
    );
}
