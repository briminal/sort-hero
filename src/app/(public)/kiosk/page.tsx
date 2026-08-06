// A kiosk is always store-specific -- staff get their store's URL
// (/kiosk/{slug}) from the Settings page, there's no cross-store directory
// to browse here (same non-goal as the buylist portal's landing page).
export default function KioskPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className="text-gray-600">
        This kiosk needs a store-specific link. Ask staff for your shop&apos;s kiosk URL.
      </p>
    </main>
  );
}
