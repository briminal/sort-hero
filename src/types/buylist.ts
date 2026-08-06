import { z } from "zod";
import { buylistPricingRuleSchema } from "@/types/buylist-pricing";

export const conditionSchema = z.enum(["NM", "LP", "MP", "HP", "DMG"]);
export const payoutTypeSchema = z.enum(["cash", "credit"]);
export const fulfillmentMethodSchema = z.enum(["drop_in", "delivery"]);

export const buylistCartItemSchema = z.object({
  cardId: z.string().uuid(),
  cardName: z.string().min(1),
  condition: conditionSchema,
  quantity: z.number().int().min(1).max(999),
  payoutType: payoutTypeSchema.default("cash"),
  printing: z.string().max(30).default("normal"),
  language: z.string().max(10).default("EN"),
  notes: z.string().max(500).nullable().optional(),
});

export const previewOfferSchema = z.object({
  storeSlug: z.string().min(1),
  items: z.array(buylistCartItemSchema).min(1).max(200),
});

export const submitBuylistSchema = z.object({
  storeSlug: z.string().min(1),
  customer: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
  }),
  items: z.array(buylistCartItemSchema).min(1).max(200),
  fulfillmentMethod: fulfillmentMethodSchema.nullable().optional(),
  paymentAccount: z.string().max(200).nullable().optional(),
  orderNotes: z.string().max(2000).nullable().optional(),
  // Only meaningful (and enforced) when the store's checkout config has
  // require_terms_acceptance on -- see submitBuylist, which re-checks this
  // server-side rather than trusting a disabled-until-checked button.
  acceptedTerms: z.boolean().optional(),
  // Same pattern as acceptedTerms -- only meaningful (and enforced) when
  // the store's checkout config has an address_acknowledgment_message set.
  addressAcknowledged: z.boolean().optional(),
});

export const browseCardsSchema = z.object({
  gameCode: z.string().min(1),
  setId: z.string().uuid().nullable().optional(),
  query: z.string().max(200).optional(),
  page: z.number().int().min(1).max(1000).default(1),
});

export const submissionTokenSchema = z.object({
  token: z.string().uuid(),
});

export const postCustomerMessageSchema = z.object({
  token: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

export const respondToOfferSchema = z.object({
  token: z.string().uuid(),
  accept: z.boolean(),
});

export const priceItemSchema = z.object({
  itemId: z.string().uuid(),
  quantityApproved: z.number().int().min(0),
  offeredCashPriceCents: z.number().int().min(0),
  offeredCreditPriceCents: z.number().int().min(0),
});

export const priceSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  items: z.array(priceItemSchema).min(1).max(200),
});

export const payoutMethodSchema = z.enum(["cash", "store_credit"]);

export const completeSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  payoutMethod: payoutMethodSchema,
});

export const declineSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
});

export const postStaffMessageSchema = z.object({
  submissionId: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

export const verifyBuylistItemSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
  verifiedQuantity: z.number().int().min(0),
});

export const sendBuylistItemToInventorySchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const previewBuylistOfferSchema = z.object({
  items: z.array(buylistCartItemSchema).min(1).max(200),
});

export const createPosBuySchema = z.object({
  customer: z.object({
    name: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
  }),
  items: z.array(buylistCartItemSchema).min(1).max(200),
  payoutMethod: payoutMethodSchema,
});

export const completeStoreCreditPaymentSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  amountCents: z.number().int().min(1),
});

export const saveBuylistRulesSchema = z.object({
  gameId: z.string().uuid().nullable(),
  setId: z.string().uuid().nullable(),
  rules: z.array(buylistPricingRuleSchema).max(50),
});

export const saveBuylistCheckoutConfigSchema = z.object({
  checkoutMessage: z.string().max(2000).nullable(),
  cashIncentiveMessage: z.string().max(500).nullable(),
  creditIncentiveMessage: z.string().max(500).nullable(),
  termsText: z.string().max(5000).nullable(),
  requireTermsAcceptance: z.boolean(),
  dropInEnabled: z.boolean(),
  dropInMessage: z.string().max(2000).nullable(),
  deliveryEnabled: z.boolean(),
  deliveryMessage: z.string().max(2000).nullable(),
  addressAcknowledgmentMessage: z.string().max(500).nullable(),
});

export type Condition = z.infer<typeof conditionSchema>;
export type BuylistCartItem = z.infer<typeof buylistCartItemSchema>;
export type SubmitBuylistInput = z.infer<typeof submitBuylistSchema>;
export type CreatePosBuyInput = z.infer<typeof createPosBuySchema>;
