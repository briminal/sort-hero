export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-gray-600">
        This page isn&apos;t available without a connection. Reconnect and try again.
      </p>
    </main>
  );
}
