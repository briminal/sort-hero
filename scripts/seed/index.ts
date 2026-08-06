import { createAdminClient } from "./lib/admin-client";
import { seedScryfall } from "./scryfall";
import { seedPokemonTcg } from "./pokemontcg";
import { seedYgoprodeck } from "./ygoprodeck";

function parseLimit(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const SOURCES: { label: string; seed: (admin: ReturnType<typeof createAdminClient>, limit: number | null) => Promise<void> }[] = [
  { label: "MTG (Scryfall)", seed: seedScryfall },
  { label: "Pokemon (PokemonTCG API)", seed: seedPokemonTcg },
  { label: "Yu-Gi-Oh! (YGOPRODeck)", seed: seedYgoprodeck },
];

async function main() {
  const limit = parseLimit();
  const admin = createAdminClient();

  console.log(`Seeding card database${limit ? ` (capped at ${limit} cards/game)` : " (full import)"}...`);

  const failures: string[] = [];

  // Each source is independent -- one API having a bad day shouldn't block
  // upserting the other two. The script is idempotent, so re-running it
  // later picks up whatever failed without redoing successful work twice.
  for (const { label, seed } of SOURCES) {
    console.log(`\n${label}:`);
    try {
      await seed(admin, limit);
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failures.push(label);
    }
  }

  if (failures.length > 0) {
    console.log(`\nDone, with failures: ${failures.join(", ")}. Re-run npm run seed:cards to retry.`);
    process.exit(1);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
