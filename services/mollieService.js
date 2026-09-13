const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const testPayments = new Map();
const testRefunds = new Map();
const testOperations = new Map();
const { createMollieClient } = require('@mollie/api-client');

let mollieClient = null;
let testCustomerCounter = 0;

async function withMollieTimeout(promise, operation = 'Mollie-Anfrage') {
    const configured = Number(process.env.MOLLIE_REQUEST_TIMEOUT_MS || 15000);
    const timeoutMs = Number.isFinite(configured)
        ? Math.min(Math.max(configured, 1000), 30000)
        : 15000;
    let timeout;

    try {
        return await Promise.race([
            promise,
            new Promise((resolve, reject) => {
                timeout = setTimeout(() => {
                    const error = new Error(`${operation} hat das Zeitlimit überschritten.`);
                    error.code = 'MOLLIE_TIMEOUT';
                    reject(error);
                }, timeoutMs);
                timeout.unref?.();
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function isTestMode() {
    const testMode = process.env.MOLLIE_TEST_MODE === '1';
    if (testMode && process.env.NODE_ENV === 'production') throw new Error('Mollie-Simulator ist in Produktion nicht erlaubt.');
    return testMode;
}

function getMollieClient() {
    if (!process.env.MOLLIE_API_KEY) {
        throw new Error('MOLLIE_API_KEY fehlt in der .env');
    }

    if (!mollieClient) {
        mollieClient = createMollieClient({
            apiKey: process.env.MOLLIE_API_KEY
        });
    }

    return mollieClient;
}

function getBaseUrl() {
    if (!process.env.BASE_URL) {
        throw new Error('BASE_URL fehlt in der .env');
    }

    return process.env.BASE_URL.replace(/\/$/, '');
}

function formatMollieAmount(amount, options = {}) {
    const { allowZero = false } = options;
    const numericAmount = Number(amount || 0);

    if (!Number.isFinite(numericAmount)) {
        throw new Error('Mollie-Betrag ist ungültig.');
    }

    if (allowZero ? numericAmount < 0 : numericAmount <= 0) {
        throw new Error(
            allowZero
                ? 'Mollie-Betrag darf nicht negativ sein.'
                : 'Mollie-Betrag muss größer als 0 sein.'
        );
    }

    return numericAmount.toFixed(2);
}

function getMollieCheckoutUrl(payment) {
    return typeof payment.getCheckoutUrl === 'function'
        ? payment.getCheckoutUrl()
        : payment._links?.checkout?.href;
}

function buildPaymentMetadata(order, overrides = {}) {
    return {
        orderId: String(order.id),
        orderNo: String(order.orderNo),
        type: order.type || 'order_payment',
        itemId: order.itemId ? String(order.itemId) : null,
        ...overrides
    };
}

function readTestPaymentFixture(paymentId) {
    const directory = process.env.MOLLIE_TEST_FIXTURES_DIR;
    if (!directory || process.env.NODE_ENV !== 'test' || !/^tr_[A-Za-z0-9_-]+$/.test(paymentId)) return null;
    const filename = path.join(directory, `${paymentId}.json`);
    try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function testOperationFile(operationKey) {
    if (!operationKey || !process.env.MOLLIE_TEST_FIXTURES_DIR || process.env.NODE_ENV !== 'test') return null;
    return path.join(process.env.MOLLIE_TEST_FIXTURES_DIR, `operation-${crypto.createHash('sha256').update(operationKey).digest('hex')}.json`);
}
function readTestOperation(operationKey) {
    if (!operationKey) return null;
    const filename = testOperationFile(operationKey);
    if (filename && fs.existsSync(filename)) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    return testOperations.get(operationKey) || null;
}
function writeTestResult(operationKey, result) {
    if (operationKey) testOperations.set(operationKey, result);
    const filename = testOperationFile(operationKey);
    if (filename) {
        fs.writeFileSync(`${filename}.tmp`, JSON.stringify(result));
        fs.renameSync(`${filename}.tmp`, filename);
        if (result.resource === 'payment') {
            const paymentFile = path.join(process.env.MOLLIE_TEST_FIXTURES_DIR, `${result.id}.json`);
            fs.writeFileSync(`${paymentFile}.tmp`, JSON.stringify(result));
            fs.renameSync(`${paymentFile}.tmp`, paymentFile);
        }
    }
}

function createTestPayment(order, status = 'open') {
    const id = `tr_test_${status}_${crypto.randomBytes(10).toString("hex")}`;
    const checkoutUrl = `https://checkout.test.mollie.local/${id}`;

    const payment = {
        resource: 'payment',
        id,
        status,
        method: status === 'paid' ? 'ideal' : null,
        amount: {
            currency: order.currency || 'EUR',
            value: formatMollieAmount(order.totalAmount, {
                allowZero: Boolean(order.allowZeroAmount)
            })
        },
        metadata: buildPaymentMetadata(order, order.metadata || {}),
        getCheckoutUrl() {
            return checkoutUrl;
        },
        _links: {
            checkout: {
                href: checkoutUrl
            }
        }
    };
    testPayments.set(id, payment);
    return payment;
}

async function createMollieCustomer({ name, email, metadata = {} }) {
    if (!email) {
        throw new Error('E-Mail ist für Mollie Customer erforderlich.');
    }

    if (isTestMode()) {
        testCustomerCounter += 1;
        return {
            id: `cst_test_${testCustomerCounter}`,
            name: name || email,
            email,
            metadata
        };
    }

    const mollie = getMollieClient();

    return withMollieTimeout(mollie.customers.create({
        name: name || email,
        email,
        metadata
    }), 'Mollie-Customer-Erstellung');
}

async function getMollieCustomer(customerId) {
    if (!customerId) {
        throw new Error('customerId ist erforderlich.');
    }

    if (isTestMode()) {
        return { id: customerId };
    }

    const mollie = getMollieClient();

    return withMollieTimeout(mollie.customers.get(customerId), 'Mollie-Customer-Abfrage');
}

async function getMollieCustomerMandates(customerId) {
    if (!customerId) {
        throw new Error('customerId ist erforderlich.');
    }

    if (isTestMode()) {
        return { _embedded: { mandates: [] } };
    }

    const mollie = getMollieClient();

    return withMollieTimeout(mollie.customerMandates.page({
        customerId
    }), 'Mollie-Mandatsabfrage');
}

async function getValidMollieMandate(customerId) {
    const mandates = await getMollieCustomerMandates(customerId);

    const mandateList =
        mandates?._embedded?.mandates ||
        mandates?._embedded?.customer_mandates ||
        mandates ||
        [];

    return mandateList.find(mandate => mandate.status === 'valid') || null;
}

async function createMolliePaymentForOrder(order) {
    if (isTestMode()) {
        const existing = readTestOperation(order.idempotencyKey);
        if (existing) return existing;
        const payment = createTestPayment(order, 'open');
        writeTestResult(order.idempotencyKey, payment);
        return payment;
    }

    const mollie = getMollieClient();

    const amountValue = formatMollieAmount(order.totalAmount, {
        allowZero: Boolean(order.allowZeroAmount)
    });

    const baseUrl = getBaseUrl();

    const payload = {
        amount: {
            currency: order.currency || 'EUR',
            value: amountValue
        },

        description:
            order.description ||
            `Segnitz Rental Bestellung ${order.orderNo}`,

        redirectUrl:
            order.redirectUrl ||
            `${baseUrl}/index.html?payment=return&orderId=${encodeURIComponent(order.id)}`,

        webhookUrl:
            order.webhookUrl ||
            `${baseUrl}/webhooks/mollie`,

        metadata: buildPaymentMetadata(order, order.metadata || {})
    };

    if (order.customerId) payload.customerId = order.customerId;
    if (order.sequenceType) payload.sequenceType = order.sequenceType;
    if (order.mandateId) payload.mandateId = order.mandateId;

    if (Array.isArray(order.methods) && order.methods.length > 0) {
        payload.method = order.methods;
    } else if (order.method) {
        payload.method = order.method;
    }

    if (order.idempotencyKey) payload.idempotencyKey = order.idempotencyKey;

    return withMollieTimeout(mollie.payments.create(payload), 'Mollie-Zahlungserstellung');
}

async function createFirstMolliePayment(order) {
    if (!order.customerId) {
        throw new Error('customerId ist für First Payment erforderlich.');
    }

    return createMolliePaymentForOrder({
        ...order,
        sequenceType: 'first',
        type: order.type || 'order_payment_first'
    });
}

async function createRecurringMolliePayment(order) {
    if (!order.customerId) {
        throw new Error('customerId ist für Recurring Payment erforderlich.');
    }

    return createMolliePaymentForOrder({
        ...order,
        sequenceType: 'recurring',
        type: order.type || 'recurring_payment',
        redirectUrl: order.redirectUrl || undefined
    });
}

async function getMolliePayment(paymentId) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
    }

    if (isTestMode()) {
        const payment = readTestPaymentFixture(paymentId) || testPayments.get(paymentId);
        if (!payment) throw new Error('Isolierte Mollie-Testfixture fehlt.');
        return payment;
    }

    const mollie = getMollieClient();

    return withMollieTimeout(mollie.payments.get(paymentId), 'Mollie-Zahlungsabfrage');
}

async function createMollieRefundForPayment({
    paymentId,
    amount,
    description,
    metadata = {},
    idempotencyKey
}) {
    if (!paymentId) {
        throw new Error('paymentId ist für eine Erstattung erforderlich.');
    }

    const formattedAmount = formatMollieAmount(amount);

    if (isTestMode()) {
        const existing = readTestOperation(idempotencyKey);
        if (existing) return existing;
        const refund = {
            resource: 'refund', id: `re_test_paid_${crypto.randomBytes(10).toString('hex')}`,
            status: 'refunded', paymentId, amount: { currency: 'EUR', value: formattedAmount },
            description, metadata
        };
        testRefunds.set(refund.id, refund);
        writeTestResult(idempotencyKey, refund);
        return refund;
    }

    const mollie = getMollieClient();

    const payload = {
        paymentId,
        amount: {
            currency: 'EUR',
            value: formattedAmount
        },
        description,
        metadata
    };

    if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

    return withMollieTimeout(mollie.paymentRefunds.create(payload), 'Mollie-Rückerstattung');
}

async function collectMolliePages(loadFirstPage, resource, { maxPages = 10, maxItems = 1000 } = {}) {
    let page = await withMollieTimeout(loadFirstPage(), `Mollie-${resource}-Abfrage`);
    const result = [];
    for (let index = 0; index < maxPages; index += 1) {
        const rows = Array.isArray(page) ? page : page?._embedded?.[resource] || [];
        result.push(...rows);
        if (result.length > maxItems) break;
        if (typeof page.nextPage !== 'function') {
            if (page?.links?.next || page?._links?.next) break;
            return result;
        }
        if (index + 1 >= maxPages) break;
        page = await withMollieTimeout(page.nextPage(), `Mollie-${resource}-Folgeseite`);
    }
    const error = new Error('Mollie-Abgleich überschreitet das Seitenbudget; manuelle Prüfung erforderlich.');
    error.code = 'MOLLIE_PAGINATION_LIMIT';
    throw error;
}

async function listMollieRefundsForPayment(paymentId) {
    if (!paymentId) throw new Error('paymentId ist erforderlich.');
    if (isTestMode()) {
        const fixture = readTestPaymentFixture(paymentId);
        const refunds = new Map([...testRefunds.values()].filter(refund => refund.paymentId === paymentId).map(refund => [refund.id, refund]));
        const directory = process.env.NODE_ENV === 'test' && process.env.MOLLIE_TEST_FIXTURES_DIR;
        if (directory) for (const name of fs.readdirSync(directory).filter(name => /^operation-[a-f0-9]{64}\.json$/.test(name))) {
            const resource = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
            if (resource.resource === 'refund' && resource.paymentId === paymentId) refunds.set(resource.id, resource);
        }
        return fixture?._embedded?.refunds || [...refunds.values()];
    }
    return collectMolliePages(() => getMollieClient().paymentRefunds.page({ paymentId, limit: 100 }), 'refunds');
}

async function listMollieChargebacksForPayment(paymentId) {
    if (!paymentId) throw new Error('paymentId ist erforderlich.');
    if (isTestMode()) return readTestPaymentFixture(paymentId)?._embedded?.chargebacks || [];
    return collectMolliePages(() => getMollieClient().paymentChargebacks.page({ paymentId, limit: 100 }), 'chargebacks');
}

async function cancelMolliePayment(paymentId, options = {}) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
    }

    if (isTestMode()) {
        const existing = readTestOperation(options.idempotencyKey);
        if (existing) return existing;
        const payment = { ...await getMolliePayment(paymentId), status: 'canceled' };
        testPayments.set(paymentId, payment);
        writeTestResult(options.idempotencyKey, payment);
        return payment;
    }

    const mollie = getMollieClient();

    return withMollieTimeout(mollie.payments.cancel(
        paymentId,
        options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined
    ), 'Mollie-Zahlungsstornierung');
}

function serializeMolliePayment(payment) {
    return {
        id: payment.id,
        status: payment.status || null,
        method: payment.method || null,
        amount: payment.amount || null,
        metadata: payment.metadata || null,
        checkoutUrl: getMollieCheckoutUrl(payment) || null,
        links: payment._links || null
    };
}

function serializeMollieRefund(refund) {
    return {
        id: refund.id,
        status: refund.status || null,
        paymentId: refund.paymentId || refund.payment_id || null,
        amount: refund.amount || null,
        description: refund.description || null,
        metadata: refund.metadata || null
    };
}

async function executeMollieExternalEffect(effectType, payload, operationKey) {
    if (effectType === 'mollie.payment.create') {
        const payment = await createMolliePaymentForOrder({
            ...payload.payment,
            idempotencyKey: operationKey
        });
        return serializeMolliePayment(payment);
    }

    if (effectType === 'mollie.refund.create') {
        const refund = await createMollieRefundForPayment({
            ...payload.refund,
            metadata: { ...payload.refund.metadata, externalOperationKey: operationKey },
            idempotencyKey: operationKey
        });
        return serializeMollieRefund(refund);
    }

    if (effectType === 'mollie.payment.cancel') {
        const currentPayment = await getMolliePayment(payload.paymentId);
        const currentStatus = String(currentPayment.status || '').toLowerCase();

        if (!['open', 'pending', 'authorized'].includes(currentStatus)) {
            return {
                ...serializeMolliePayment(currentPayment),
                cancellationSkipped: true
            };
        }

        const cancelledPayment = await cancelMolliePayment(
            payload.paymentId,
            { idempotencyKey: operationKey }
        );
        return serializeMolliePayment(cancelledPayment);
    }

    throw new Error(`Unbekannter Mollie-Outbox-Effekt: ${effectType}`);
}

module.exports = {
    createMolliePaymentForOrder,
    createFirstMolliePayment,
    createRecurringMolliePayment,

    createMollieCustomer,
    getMollieCustomer,
    getMollieCustomerMandates,
    getValidMollieMandate,

    getMolliePayment,
    createMollieRefundForPayment,
    listMollieRefundsForPayment, listMollieChargebacksForPayment, collectMolliePages,
    cancelMolliePayment,

    executeMollieExternalEffect,
    serializeMolliePayment,
    serializeMollieRefund,

    getMollieCheckoutUrl,
    formatMollieAmount,
    withMollieTimeout
};
