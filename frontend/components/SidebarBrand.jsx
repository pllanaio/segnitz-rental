export function SidebarLogo({ linked = false }) {
    const image = <img src="img/logo.png" alt="Segnitz Rental Logo" className="img-fluid sidebar-logo" />;
    return (
        <div className="sidebar-brand text-center mb-3">
            {linked ? <a href="/" aria-label="Zur Startseite">{image}</a> : image}
        </div>
    );
}

// compact: line box sized by the link alone, as on the former quirks-mode index.html.
export function SidebarLegal({ compact = false }) {
    return (
        <div className="sidebar-legal" style={compact ? { fontSize: '.8125rem' } : undefined}>
            <a href="/widerruf.html">Widerruf</a>
        </div>
    );
}
