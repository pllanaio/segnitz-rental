// Same tariff rules as the server (services/rentalTariffs.js re-exports this module).
import tariffs from '../../shared/rentalTariffs.js';

export const { normalizeHourlyPrices, quoteTariff, hourlyCharge, hourlyLateFee, earlyReturnCredit } = tariffs;
export default tariffs;
