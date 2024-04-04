document.addEventListener('DOMContentLoaded', async () => {
    try {
        const position = await getUserLocation();
        const placeName = await getPlaceName(position.coords.latitude, position.coords.longitude);
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const dateTimeLocation = `${placeName}, ${formattedDate}`;
        document.getElementById('locationDateField').value = dateTimeLocation;
    } catch (error) {
        console.error(error);
    }
});

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject('Geolocation wird von Ihrem Browser nicht unterstützt.');
        } else {
            navigator.geolocation.getCurrentPosition(resolve, reject);
        }
    });
}

async function getPlaceName(latitude, longitude) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Ortsabfrage fehlgeschlagen');
        const data = await response.json();
        // Zugriff auf den Stadtteil, falls vorhanden, sonst Stadt, sonst Land
        const placeName = data.address.city_district || data.address.city || data.address.country;
        return placeName;
    } catch (error) {
        console.error('Fehler beim Abrufen des Ortsnamens:', error);
        return null;
    }
}