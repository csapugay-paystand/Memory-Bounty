import crypto from "crypto";

// Simulated types
interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  customerId: string;
  status: "pending" | "succeeded" | "failed" | "refunded";
  metadata: Record<string, string>;
}

interface WebhookEvent {
  id: string;
  type: string;
  data: { object: PaymentIntent };
  signature: string;
}

interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

// Validates a Stripe-style webhook signature using HMAC-SHA256
export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex")
  );
}

// Routes an incoming webhook event to the appropriate handler
export async function handleWebhookEvent(
  event: WebhookEvent,
  secret: string
): Promise<{ handled: boolean; error?: string }> {
  const isValid = validateWebhookSignature(
    JSON.stringify(event.data),
    event.signature,
    secret
  );

  if (!isValid) {
    return { handled: false, error: "Invalid webhook signature" };
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      await onPaymentSucceeded(event.data.object);
      return { handled: true };
    case "payment_intent.payment_failed":
      await onPaymentFailed(event.data.object);
      return { handled: true };
    default:
      return { handled: false, error: `Unhandled event type: ${event.type}` };
  }
}

// Processes a successful payment: updates order status and triggers fulfillment
async function onPaymentSucceeded(intent: PaymentIntent): Promise<void> {
  const orderId = intent.metadata["orderId"];
  if (!orderId) throw new Error("Missing orderId in payment metadata");

  await markOrderPaid(orderId, intent.id);
  await triggerFulfillment(orderId);
}

// Handles a failed payment attempt: logs the failure and notifies the customer
async function onPaymentFailed(intent: PaymentIntent): Promise<void> {
  const orderId = intent.metadata["orderId"];
  const customerId = intent.customerId;

  console.error(`Payment failed for order ${orderId}, customer ${customerId}`);
  await notifyCustomerOfFailure(customerId, orderId);
}

// Issues a full refund for a given payment intent ID
export async function refundPayment(
  intentId: string,
  reason: string
): Promise<RefundResult> {
  if (!intentId.startsWith("pi_")) {
    return { success: false, error: "Invalid payment intent ID format" };
  }

  const refundId = `re_${crypto.randomUUID()}`;
  console.log(`Refunding ${intentId} — reason: ${reason} — refundId: ${refundId}`);

  return { success: true, refundId };
}

// Computes a deterministic idempotency key for a payment operation
export function buildIdempotencyKey(
  customerId: string,
  orderId: string,
  amount: number
): string {
  return crypto
    .createHash("sha256")
    .update(`${customerId}:${orderId}:${amount}`)
    .digest("hex")
    .slice(0, 32);
}

// --- Internal helpers (not exported) ---

async function markOrderPaid(orderId: string, intentId: string): Promise<void> {
  console.log(`Order ${orderId} marked paid via ${intentId}`);
}

async function triggerFulfillment(orderId: string): Promise<void> {
  console.log(`Fulfillment triggered for order ${orderId}`);
}

async function notifyCustomerOfFailure(
  customerId: string,
  orderId: string
): Promise<void> {
  console.log(`Notifying customer ${customerId} of failure on order ${orderId}`);
}
