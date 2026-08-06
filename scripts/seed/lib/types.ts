export type NormalizedSet = {
  externalId: string;
  name: string;
  code: string | null;
  releasedAt: string | null; // ISO date, or null
};

export type NormalizedCard = {
  externalId: string;
  name: string;
  setExternalId: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  rarity: string | null;
  metadata: Record<string, unknown> | null;
};

export type NormalizedPrice = {
  cardExternalId: string;
  marketPriceCents: number | null;
  lowPriceCents: number | null;
  highPriceCents: number | null;
};
