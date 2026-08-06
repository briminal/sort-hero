import { getSubmissionByToken } from "../../actions";
import { SubmissionStatusView } from "./submission-status-view";

export default async function BuylistPortalStatusPage({
  params,
}: {
  params: Promise<{ storeSlug: string; token: string }>;
}) {
  const { token } = await params;
  const result = await getSubmissionByToken(token);

  if ("error" in result) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Submission status</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.error}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1 className="mx-auto max-w-2xl px-6 pt-6 text-xl font-semibold text-foreground">Submission status</h1>
      <SubmissionStatusView token={token} initialData={result} />
    </main>
  );
}
