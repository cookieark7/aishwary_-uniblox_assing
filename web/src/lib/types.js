/**
 * Layer 0 — canonical types (JSDoc), mirroring the API's camelCase responses exactly.
 * Money is always integer paise in `…Cents` fields.
 */

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {number} priceCents
 * @property {number} stock
 */

/**
 * @typedef {Object} CartItem
 * @property {string} productId
 * @property {string} name
 * @property {number} unitPriceCents   current product price (carts never store prices)
 * @property {number} quantity
 * @property {number} lineTotalCents
 * @property {number} availableStock
 * @property {boolean} inStock
 */

/**
 * @typedef {Object} Cart
 * @property {string} id
 * @property {'open' | 'checked_out'} status
 * @property {string | null} orderId
 * @property {CartItem[]} items
 * @property {number} itemCount
 * @property {number} subtotalCents
 * @property {'INR'} currency
 */

/**
 * @typedef {Object} OrderItem
 * @property {string} productId
 * @property {string} name              snapshot at checkout time
 * @property {number} unitPriceCents    snapshot at checkout time
 * @property {number} quantity
 * @property {number} lineTotalCents
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} cartId
 * @property {OrderItem[]} items
 * @property {number} subtotalCents
 * @property {number} discountCents
 * @property {number} totalCents
 * @property {string | null} couponCode
 * @property {'INR'} currency
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Coupon
 * @property {string} id
 * @property {string} code
 * @property {number} milestone
 * @property {number} percentOff
 * @property {'available' | 'redeemed'} status
 * @property {string} createdAt
 * @property {string | null} [redeemedAt]
 * @property {string | null} [redeemedOrderId]
 */

/**
 * @typedef {Object} Milestone
 * @property {number} everyNOrders
 * @property {number} percentOff
 * @property {number} ordersPlaced
 * @property {number} couponsGenerated
 * @property {number} nextMilestoneAt
 * @property {boolean} eligible
 */

/**
 * The single error shape every endpoint returns: { error: { code, message, details? } }.
 * @typedef {Object} ApiErrorBody
 * @property {string} code
 * @property {string} message
 * @property {unknown} [details]
 */

/**
 * One row in the network inspector.
 * @typedef {Object} NetworkEntry
 * @property {number} id
 * @property {string} method
 * @property {string} path
 * @property {unknown} [requestBody]
 * @property {number | null} status        null while in flight, 0 on a network failure
 * @property {unknown} [responseBody]
 * @property {boolean} replayed            the Idempotent-Replayed: true response header
 * @property {number | null} ms
 * @property {string | null} group         e.g. "Race lab · Oversell ×11"
 * @property {number} startedAt
 */

export {};
