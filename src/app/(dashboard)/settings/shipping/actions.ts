"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getMyStore } from "@/lib/supabase/store";
import { getShippoClient, verifyShippoConnection } from "@/lib/shipping/shippo/client";
import {
  connectShippoSchema,
  disconnectShippingSchema,
  getWebhookUrlSchema,
  updateFromAddressSchema,
} from "@/types/shipping";
import type { Address } from "@/types/shipping";

type ActionResult<T> = T | { error: string };

async function requireOwner(): Promise<{ storeId: string }> {
  const supabase = await createClient();
  const { storeId, role } = await getMyStore(supabase);
  if (role !== "owner") {
    throw new Error("Only a store owner can manage shipping connections");
  }
  return { storeId };
}

export async function connectShippo(input: {
  apiKey: string;
  fromAddress: Address;
}): Promise<ActionResult<{ connectionId: string }>> {
  const parsed = connectShippoSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();

    // Connectivity check with the submitted key BEFORE persisting anything.
    const client = getShippoClient(parsed.data.apiKey);
    await verifyShippoConnection(client);

    const service = getServiceClient();

    const { data: connection, error: connectionError } = await service
      .from("shipping_connections")
      .upsert(
        { store_id: storeId, provider: "shippo", status: "connected", from_address: parsed.data.fromAddress, last_error: null },
        { onConflict: "store_id,provider" },
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw new Error(connectionError?.message ?? "Could not save connection");

    const { error: credentialsError } = await service
      .from("shipping_credentials")
      .upsert({ connection_id: connection.id, shippo_api_key: parsed.data.apiKey }, { onConflict: "connection_id" });
    if (credentialsError) throw new Error(credentialsError.message);

    revalidatePath("/settings/shipping");
    return { connectionId: connection.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not connect Shippo" };
  }
}

export async function updateFromAddress(input: {
  connectionId: string;
  fromAddress: Address;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = updateFromAddressSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await requireOwner();
    const supabase = await createClient();

    const { error } = await supabase
      .from("shipping_connections")
      .update({ from_address: parsed.data.fromAddress })
      .eq("id", parsed.data.connectionId);
    if (error) throw new Error(error.message);

    revalidatePath("/settings/shipping");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update address" };
  }
}

export async function disconnectShipping(input: { connectionId: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = disconnectShippingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();
    const service = getServiceClient();

    const { data: connection } = await service
      .from("shipping_connections")
      .select("id, store_id")
      .eq("id", parsed.data.connectionId)
      .single();
    if (!connection || connection.store_id !== storeId) throw new Error("Connection not found");

    await service.from("shipping_connections").update({ status: "disconnected" }).eq("id", connection.id);

    // Row stays for audit trail, secret is nulled -- flag-not-delete, same
    // convention as every other module.
    await service
      .from("shipping_credentials")
      .update({ shippo_api_key: null })
      .eq("connection_id", connection.id);

    revalidatePath("/settings/shipping");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not disconnect" };
  }
}

export async function getWebhookUrl(input: { connectionId: string }): Promise<ActionResult<{ url: string }>> {
  const parsed = getWebhookUrlSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();
    const service = getServiceClient();

    const { data: connection } = await service
      .from("shipping_connections")
      .select("id, store_id")
      .eq("id", parsed.data.connectionId)
      .single();
    if (!connection || connection.store_id !== storeId) throw new Error("Connection not found");

    const { data: credentials } = await service
      .from("shipping_credentials")
      .select("webhook_token")
      .eq("connection_id", parsed.data.connectionId)
      .single();
    if (!credentials) throw new Error("Credentials not found");

    return { url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/shippo?token=${credentials.webhook_token}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not get webhook URL" };
  }
}
