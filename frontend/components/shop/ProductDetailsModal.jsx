import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import RatingStars from './RatingStars';
import { getBootstrap, getModal, hideModal } from '../../lib/bootstrap';
import { createCalendar } from '../../lib/calendar';
import { formatLocalDate } from '../../lib/dateUtils';
import { calculateRentalDays, formatCurrency, parseHourlyPrices, sortReviews } from '../../lib/shop';
import { showAlert } from '../../lib/alerts';

const HOURLY_TARIFFS = [2, 4, 6, 8];

function numberWithUnit(value, unit) {
    if (value == null || String(value).trim() === '') return '';
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
        ? `${number.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${unit}` : '';
}

function attributeRows(attributes = {}) {
    return [
        ['Farbe', String(attributes.color || '').trim()],
        ['Leistung', numberWithUnit(attributes.power, attributes.powerUnit || 'kW')],
        ['Betriebsstunden', numberWithUnit(attributes.operatingHours, 'h')],
        ['Kilometerstand', numberWithUnit(attributes.mileageKm, 'km')]
    ].filter(([, value]) => value);
}

export async function loadBlockedPeriods(productId) {
    try {
        const response = await fetch(`/products/${productId}/availability`);
        return await response.json();
    } catch (error) {
        console.error('Fehler beim Laden der Verfügbarkeit:', error);
        return [];
    }
}

function ProductReviews({ state, onShowAll }) {
    if (state.status === 'loading') return <div className="text-muted">Bewertungen werden geladen...</div>;
    if (state.status === 'error') return <div className="text-muted">Bewertungen konnten nicht geladen werden.</div>;
    if (state.reviews.length === 0) return <div className="text-muted">Noch keine Bewertungen vorhanden.</div>;

    const visibleReviews = state.showAll ? state.reviews : state.reviews.slice(0, 3);

    return (
        <>
            {visibleReviews.map((review, index) => (
                <div className="border-bottom pb-2 mb-2" key={review.id ?? index}>
                    <RatingStars rating={review.rating} count={null} />
                    <div className="small text-muted">
                        {review.displayName || 'Kunde'} · {review.createdAt || ''}
                    </div>
                    <div>
                        {review.reviewText
                            ? review.reviewText
                            : <span className="text-muted">Keine Rezension geschrieben.</span>}
                    </div>
                </div>
            ))}
            {!state.showAll && state.reviews.length > 3
                ? (
                    <button type="button" className="btn btn-outline-primary btn-sm mt-2"
                        data-frontend-action="show-all-reviews" onClick={onShowAll}>
                        Alle Bewertungen anzeigen
                    </button>
                )
                : null}
        </>
    );
}

const ProductDetailsModal = forwardRef(function ProductDetailsModal({ onAddToCart }, ref) {
    const modalRef = useRef(null);
    const carouselRef = useRef(null);
    const rangeInputRef = useRef(null);
    const startInputRef = useRef(null);
    const endInputRef = useRef(null);
    const calendarContainerRef = useRef(null);
    const hoursSelectRef = useRef(null);
    const startTimeRef = useRef(null);
    const calendarRef = useRef(null);
    const cardRef = useRef(null);
    const blockedPeriodsRef = useRef([]);
    const reviewRequestRef = useRef(0);

    const [card, setCard] = useState(null);
    const [session, setSession] = useState(0);
    const [info, setInfo] = useState({ hidden: true, blocked: null, text: '' });
    const [reviews, setReviews] = useState({ status: 'loading', reviews: [], showAll: false });
    const [reviewCountText, setReviewCountText] = useState('');
    const [hourlyPrices, setHourlyPrices] = useState(null);
    const [startTimeDisabled, setStartTimeDisabled] = useState(true);

    const selectedHourlyTariff = () => Number(hoursSelectRef.current?.value) || null;

    const updateSelectedRentalPrice = () => {
        const start = startInputRef.current.value;
        const end = endInputRef.current.value;
        if (!start || !end) {
            setInfo(current => ({ ...current, hidden: true }));
            return;
        }
        const product = cardRef.current?.product;
        if (!product) return;
        const hours = selectedHourlyTariff();
        const prices = parseHourlyPrices(product);
        const days = calculateRentalDays(start, end);
        const rent = hours ? Number(hours === 8 ? product.price_per_day : prices[hours]) : days * Number(product.price_per_day);
        const deposit = Number(product.deposit);
        setInfo({
            hidden: false,
            blocked: null,
            text: (hours ? `${hours} Stunden ab ${startTimeRef.current.value}` : `${days} Miettag${days === 1 ? '' : 'e'}`) +
                ` · Miete inkl. MwSt.: ${formatCurrency(rent)} · Kaution: ${formatCurrency(deposit)} · Gesamt: ${formatCurrency(rent + deposit)}`
        });
    };

    const initProductCalendar = hours => {
        calendarRef.current?.destroy();
        rangeInputRef.current.value = '';
        startInputRef.current.value = '';
        endInputRef.current.value = '';
        calendarContainerRef.current.replaceChildren();

        const blockedRanges = blockedPeriodsRef.current
            .filter(period => !hours || !period.rentalHours)
            .map(period => ({
                from: period.rentalStart.split('T')[0],
                to: period.rentalEnd.split('T')[0]
            }));

        const calendar = createCalendar(rangeInputRef.current, {
            mode: hours ? 'single' : 'range',
            inline: true,
            disableMobile: true,
            appendTo: calendarContainerRef.current,
            minDate: 'today',
            dateFormat: 'Y-m-d',
            disable: blockedRanges,
            showMonths: 1,
            allowInput: false,
            onChange(selectedDates) {
                const currentHours = selectedHourlyTariff();
                if (selectedDates.length !== (currentHours ? 1 : 2)) {
                    startInputRef.current.value = '';
                    endInputRef.current.value = '';
                    setInfo({ hidden: true, blocked: null, text: '' });
                    return;
                }

                startInputRef.current.value = calendar.formatDate(selectedDates[0], 'Y-m-d');
                endInputRef.current.value = calendar.formatDate(selectedDates[currentHours ? 0 : 1], 'Y-m-d');
                setInfo(current => ({ ...current, hidden: false }));
                updateSelectedRentalPrice();
            }
        });
        calendarRef.current = calendar;
    };

    const loadProductReviews = async productId => {
        const request = ++reviewRequestRef.current;
        setReviews({ status: 'loading', reviews: [], showAll: false });
        setReviewCountText('');

        try {
            const response = await fetch(`/products/${productId}/reviews`);
            const result = await response.json();
            if (request !== reviewRequestRef.current) return;

            if (!response.ok) {
                setReviews({ status: 'error', reviews: [], showAll: false });
                return;
            }

            const sorted = sortReviews(result);
            setReviewCountText(sorted.length === 1 ? '1 Bewertung' : `${sorted.length} Bewertungen`);
            setReviews({ status: 'loaded', reviews: sorted, showAll: false });
        } catch (error) {
            console.error('Fehler beim Laden der Bewertungen:', error);
            if (request === reviewRequestRef.current) setReviews({ status: 'error', reviews: [], showAll: false });
        }
    };

    useImperativeHandle(ref, () => ({
        async open(nextCard) {
            cardRef.current = nextCard;
            setCard(nextCard);
            setSession(current => current + 1);
            loadProductReviews(nextCard.productId);

            const today = formatLocalDate();
            startInputRef.current.value = '';
            endInputRef.current.value = '';
            startInputRef.current.min = today;
            endInputRef.current.min = today;
            setInfo({ hidden: true, blocked: null, text: '' });

            const periods = await loadBlockedPeriods(nextCard.productId);
            blockedPeriodsRef.current = Array.isArray(periods) ? periods : [];
            if (blockedPeriodsRef.current.length > 0) {
                setInfo({ hidden: false, blocked: blockedPeriodsRef.current, text: '' });
            }

            const prices = parseHourlyPrices(nextCard.product);
            setHourlyPrices(prices || null);
            setStartTimeDisabled(true);
            if (hoursSelectRef.current) hoursSelectRef.current.value = '';
            initProductCalendar(null);
            getModal(modalRef.current).show();
        }
    }));

    // Bootstrap's carousel needs a fresh instance for every newly rendered slide set.
    useEffect(() => {
        const element = carouselRef.current;
        if (!element || !card || card.images.length === 0) return undefined;
        const bootstrap = getBootstrap();
        const carousel = bootstrap.Carousel.getOrCreateInstance(element, { interval: 5000, ride: 'carousel' });
        carousel.cycle();
        return () => carousel.dispose();
    }, [card, session]);

    useEffect(() => () => calendarRef.current?.destroy(), []);

    const addToCart = async () => {
        const selected = cardRef.current;
        if (!selected) return;

        const rentalStart = startInputRef.current.value;
        const rentalEnd = endInputRef.current.value;

        if (!rentalStart || !rentalEnd) {
            showAlert('Bitte wählen Sie Mietbeginn und Mietende aus.', 'warning');
            return;
        }

        if (new Date(rentalEnd) < new Date(rentalStart)) {
            showAlert('Das Mietende darf nicht vor dem Mietbeginn liegen.', 'warning');
            return;
        }

        const rentalHours = selectedHourlyTariff();
        await onAddToCart({
            productId: selected.productId,
            rentalStart,
            rentalEnd,
            rentalHours,
            rentalStartTime: rentalHours ? startTimeRef.current.value : null,
            blockedPeriods: blockedPeriodsRef.current
        });

        hideModal(modalRef.current);
    };

    const rows = attributeRows(card?.attributes);
    const images = card?.images || [];

    return (
        <div className="modal fade" id="productDetailsModal" tabIndex={-1} aria-hidden="true" ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Produktdetails</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>
                    <div className="modal-body">
                        <div id="modalProductCarouselWrapper" className={images.length > 0 ? 'mb-3' : 'mb-3 d-none'}>
                            <div id="modalProductCarousel" className="carousel slide" data-bs-ride="carousel"
                                key={session} ref={carouselRef}>
                                <div className="carousel-inner" id="modalProductCarouselInner">
                                    {images.map((imagePath, index) => (
                                        <div className={index === 0 ? 'carousel-item active' : 'carousel-item'} key={`${imagePath}-${index}`}>
                                            <img src={imagePath} className="d-block w-100 rounded modal-product-image" alt={card.title} />
                                        </div>
                                    ))}
                                </div>

                                <button className="carousel-control-prev" type="button" data-bs-target="#modalProductCarousel"
                                    data-bs-slide="prev">
                                    <span className="carousel-control-prev-icon" />
                                </button>

                                <button className="carousel-control-next" type="button" data-bs-target="#modalProductCarousel"
                                    data-bs-slide="next">
                                    <span className="carousel-control-next-icon" />
                                </button>
                            </div>
                        </div>
                        <h5 id="modalProductTitle">{card?.title || ''}</h5>
                        <div id="modalProductRating" className="mb-2">
                            {card ? <RatingStars rating={Number(card.averageRating || 0)} count={Number(card.reviewCount || 0)} /> : null}
                        </div>
                        <p id="modalProductDescription">{card?.description || ''}</p>
                        <section id="modalProductAttributes" className={rows.length > 0 ? 'rounded border p-3 mb-3' : 'rounded border p-3 mb-3 d-none'}
                            aria-labelledby="modalProductAttributesTitle">
                            <h6 id="modalProductAttributesTitle" className="mb-3">Artikelmerkmale</h6>
                            <dl id="modalProductAttributeList" className="row mb-0">
                                {rows.map(([label, value]) => (
                                    <AttributeRow key={label} label={label} value={value} />
                                ))}
                            </dl>
                        </section>
                        <p><strong>Preis:</strong> <span id="modalProductPrice">{card?.price || ''}</span></p>
                        <p><strong>Kaution:</strong> <span id="modalProductDeposit">{card?.deposit || ''}</span></p>
                        <input type="hidden" id="modalProductId" value={card?.productId ?? ''} readOnly />
                        <div className="row g-3">
                            <input type="text" id="modalRentalRange" className="d-none" hidden tabIndex={-1} aria-hidden="true" readOnly
                                ref={rangeInputRef} />

                            <input type="hidden" id="modalRentalStart" ref={startInputRef} />
                            <input type="hidden" id="modalRentalEnd" ref={endInputRef} />

                            <div className="col-12">
                                <div id="modalHourlyTariffs" className="row g-3 mb-3" hidden={!hourlyPrices}>
                                    <div className="col-sm-7">
                                        <label htmlFor="modalRentalHours" className="form-label">Miettarif</label>
                                        <select id="modalRentalHours" className="form-select" ref={hoursSelectRef} key={session}
                                            defaultValue=""
                                            onChange={() => {
                                                const hours = selectedHourlyTariff();
                                                initProductCalendar(hours);
                                                setStartTimeDisabled(!hours);
                                                updateSelectedRentalPrice();
                                            }}>
                                            <option value="">Tagesmiete</option>
                                            {hourlyPrices ? HOURLY_TARIFFS.map(hours => (
                                                <option key={hours} value={hours}>
                                                    {`${hours} Stunden · ${formatCurrency(hours === 8 ? card.product.price_per_day : hourlyPrices[hours])}`}
                                                </option>
                                            )) : null}
                                        </select>
                                    </div>
                                    <div className="col-sm-5">
                                        <label htmlFor="modalRentalStartTime" className="form-label">Startzeit</label>
                                        <input type="time" id="modalRentalStartTime" className="form-control" defaultValue="08:00"
                                            ref={startTimeRef} disabled={startTimeDisabled} onInput={updateSelectedRentalPrice} />
                                    </div>
                                </div>
                                <div id="modalCalendarContainer" role="group" aria-label="Mietzeitraum im Kalender auswählen"
                                    ref={calendarContainerRef} />
                            </div>

                            <div className="col-12">
                                <div id="modalRentalInfo" className={info.hidden ? 'alert alert-info d-none mb-0' : 'alert alert-info mb-0'}>
                                    {info.blocked
                                        ? (
                                            <>
                                                <strong>Bereits reservierte Zeiträume:</strong><br />
                                                {info.blocked.map((period, index) => (
                                                    <span key={`${period.rentalStart}-${period.rentalEnd}-${index}`}>
                                                        {index > 0 ? <br /> : null}
                                                        {period.rentalStart} bis {period.rentalEnd}
                                                    </span>
                                                ))}
                                            </>
                                        )
                                        : info.text}
                                </div>
                            </div>
                        </div>
                        <hr />
                        <div id="modalProductReviewsSection">
                            <div className="d-flex justify-content-between align-items-center mb-2">
                                <h6 className="mb-0">Bewertungen</h6>
                                <span id="modalProductReviewCount" className="small text-muted">{reviewCountText}</span>
                            </div>

                            <div id="modalProductReviews">
                                <ProductReviews state={reviews}
                                    onShowAll={() => setReviews(current => ({ ...current, showAll: true }))} />
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        <button type="button" className="btn btn-primary" id="selectProductFromModal" onClick={addToCart}>
                            In den Warenkorb
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

function AttributeRow({ label, value }) {
    return (
        <>
            <dt className="col-6 fw-normal text-muted">{label}</dt>
            <dd className="col-6 fw-semibold text-end text-break">{value}</dd>
        </>
    );
}

export default ProductDetailsModal;
