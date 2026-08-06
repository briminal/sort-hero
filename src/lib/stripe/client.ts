import Stripe from "stripe";

let stripe: Stripe | null = null;

/** Server-side Stripe singleton -- never imported into client bundles. */
export function getStripe(): Stripe {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
    stripe = new Stripe(secretKey);
  }
  return stripe;
}
