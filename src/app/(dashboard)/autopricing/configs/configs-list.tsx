"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createAutopricingConfig, deleteAutopricingConfig, type AutopricingConfigSummary } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type GameOption = { id: string; code: string; name: string };

export function ConfigsList({ games, initialConfigs }: { games: GameOption[]; initialConfigs: AutopricingConfigSummary[] }) {
  const router = useRouter();
  const [configs, setConfigs] = useState(initialConfigs);
  const [name, setName] = useState("");
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !gameId) {
      setError("Name and game are required.");
      return;
    }
    setBusy(true);
    const result = await createAutopricingConfig({ gameId, name: name.trim() });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/autopricing/configs/${result.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newConfigName">Configuration name</Label>
            <Input
              id="newConfigName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Magic: The Gathering"
              className="w-56"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newConfigGame">Game</Label>
            <Select value={gameId} onValueChange={setGameId}>
              <SelectTrigger id="newConfigGame" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {games.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? "Creating..." : "+ Create New Configuration"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {configs.map((config) => (
          <Card key={config.id} className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center justify-between gap-2 pt-4">
              <Link href={`/autopricing/configs/${config.id}`} className="flex-1">
                <p className="font-medium text-foreground">{config.name}</p>
                <p className="text-xs text-muted-foreground">{config.gameName}</p>
              </Link>
              <button
                aria-label={`Delete ${config.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  const result = await deleteAutopricingConfig({ id: config.id });
                  if (!("error" in result)) setConfigs((prev) => prev.filter((c) => c.id !== config.id));
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </CardContent>
          </Card>
        ))}
        {configs.length === 0 && <p className="text-sm text-muted-foreground">No configurations yet -- create one above.</p>}
      </div>
    </div>
  );
}
