import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { DEFAULT_RULES } from "@/lib/pricing/engine";
import type { PricingRule } from "@/types/pricing";
import { PricingRulesEditor } from "./pricing-rules-editor";

export default async function AutopricingPage() {
  const supabase = await createClient();
  await getMyStore(supabase);

  const { data, error } = await supabase
    .from("pricing_rules")
    .select("id, step_order, rule_type, config, enabled")
    .order("step_order");

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold">Autopricing</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load pricing rules: {error.message}
        </p>
      </main>
    );
  }

  const rules: PricingRule[] =
    data && data.length > 0
      ? data.map((r) => ({
          id: r.id as string,
          stepOrder: r.step_order as number,
          ruleType: r.rule_type as PricingRule["ruleType"],
          config: r.config as Record<string, unknown>,
          enabled: r.enabled as boolean,
        }))
      : DEFAULT_RULES.map((r, i) => ({ ...r, id: `default-${i}` }));

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Autopricing</h1>
        <Link href="/autopricing/configs" className="text-sm text-primary underline underline-offset-4">
          Per-game configurations (new) &rarr;
        </Link>
      </div>
      <PricingRulesEditor initialRules={rules} />
    </main>
  );
}
