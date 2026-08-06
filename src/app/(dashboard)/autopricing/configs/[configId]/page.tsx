import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAutopricingConfig } from "../../actions";
import { ConfigEditor } from "./config-editor";

export default async function AutopricingConfigPage({ params }: { params: Promise<{ configId: string }> }) {
  const { configId } = await params;
  const result = await getAutopricingConfig(configId);

  if ("error" in result) {
    return (
      <main className="p-6">
        <Link href="/autopricing/configs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to configurations
        </Link>
        <p role="alert" className="mt-3 text-sm text-destructive">
          Could not load configuration: {result.error}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <div>
        <Link href="/autopricing/configs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to configurations
        </Link>
        <h1 className="mt-2 text-lg font-semibold">Autoprice Configuration: {result.name}</h1>
      </div>
      <ConfigEditor initialConfig={result} />
    </main>
  );
}
