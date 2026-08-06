"use client";

import { useState } from "react";
import { saveBuylistCheckoutConfig } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CheckoutConfig = {
  checkoutMessage: string;
  cashIncentiveMessage: string;
  creditIncentiveMessage: string;
  termsText: string;
  requireTermsAcceptance: boolean;
  dropInEnabled: boolean;
  dropInMessage: string;
  deliveryEnabled: boolean;
  deliveryMessage: string;
  addressAcknowledgmentMessage: string;
};

export function CheckoutMessageEditor({ initialConfig }: { initialConfig: CheckoutConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveBuylistCheckoutConfig({
      checkoutMessage: config.checkoutMessage.trim() || null,
      cashIncentiveMessage: config.cashIncentiveMessage.trim() || null,
      creditIncentiveMessage: config.creditIncentiveMessage.trim() || null,
      termsText: config.termsText.trim() || null,
      requireTermsAcceptance: config.requireTermsAcceptance,
      dropInEnabled: config.dropInEnabled,
      dropInMessage: config.dropInMessage.trim() || null,
      deliveryEnabled: config.deliveryEnabled,
      deliveryMessage: config.deliveryMessage.trim() || null,
      addressAcknowledgmentMessage: config.addressAcknowledgmentMessage.trim() || null,
    });
    setSaving(false);
    setSaveMessage("error" in result ? `Error: ${result.error}` : "Saved.");
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-5 pt-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="checkoutMessage">Checkout banner</Label>
          <p className="text-xs text-muted-foreground">Shown at the top of the cart on the public buylist portal.</p>
          <Textarea
            id="checkoutMessage"
            value={config.checkoutMessage}
            onChange={(e) => setConfig({ ...config, checkoutMessage: e.target.value })}
            placeholder="e.g. Cards are inspected in person -- final offer may differ slightly from the estimate below."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cashIncentiveMessage">Cash offer note</Label>
            <p className="text-xs text-muted-foreground">Shown next to the cash total.</p>
            <Input
              id="cashIncentiveMessage"
              type="text"
              value={config.cashIncentiveMessage}
              onChange={(e) => setConfig({ ...config, cashIncentiveMessage: e.target.value })}
              placeholder="e.g. Paid instantly"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="creditIncentiveMessage">Store credit note</Label>
            <p className="text-xs text-muted-foreground">Shown next to the credit total.</p>
            <Input
              id="creditIncentiveMessage"
              type="text"
              value={config.creditIncentiveMessage}
              onChange={(e) => setConfig({ ...config, creditIncentiveMessage: e.target.value })}
              placeholder="e.g. Store credit pays a bonus!"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="termsText">Terms &amp; conditions text</Label>
          <Textarea
            id="termsText"
            value={config.termsText}
            onChange={(e) => setConfig({ ...config, termsText: e.target.value })}
            placeholder="e.g. All submitted cards are subject to in-store condition review before payout."
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.requireTermsAcceptance}
            onChange={(e) => setConfig({ ...config, requireTermsAcceptance: e.target.checked })}
            className="size-4 rounded border-input"
          />
          Require customers to check a box accepting the terms above before submitting
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.dropInEnabled}
                onChange={(e) => setConfig({ ...config, dropInEnabled: e.target.checked })}
                className="size-4 rounded border-input"
              />
              Enable drop-in fulfillment
            </label>
            <Textarea
              value={config.dropInMessage}
              onChange={(e) => setConfig({ ...config, dropInMessage: e.target.value })}
              placeholder="e.g. Please bring your cards into our store once approved."
              disabled={!config.dropInEnabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.deliveryEnabled}
                onChange={(e) => setConfig({ ...config, deliveryEnabled: e.target.checked })}
                className="size-4 rounded border-input"
              />
              Enable delivery fulfillment
            </label>
            <Textarea
              value={config.deliveryMessage}
              onChange={(e) => setConfig({ ...config, deliveryMessage: e.target.value })}
              placeholder="e.g. Please ship your cards to our store once approved."
              disabled={!config.deliveryEnabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressAcknowledgmentMessage">Address acknowledgment checkbox text</Label>
          <p className="text-xs text-muted-foreground">
            If set, customers must check a box with this text before submitting -- e.g. confirming your store address.
          </p>
          <Input
            id="addressAcknowledgmentMessage"
            value={config.addressAcknowledgmentMessage}
            onChange={(e) => setConfig({ ...config, addressAcknowledgmentMessage: e.target.value })}
            placeholder="e.g. Our address is 123 Main St, Anytown"
          />
        </div>
      </CardContent>
      <CardFooter className="items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {saveMessage && (
          <span data-testid="checkout-message-save-status" className="text-sm text-muted-foreground">
            {saveMessage}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
