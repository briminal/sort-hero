"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import {
  requestPasswordReset,
  type ForgotPasswordActionState,
} from "../actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialState: ForgotPasswordActionState = null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Sending..." : "Send reset link"}
    </Button>
  );
}

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState(requestPasswordReset, initialState);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold">
            Sort<span className="text-primary">Hero</span>
          </span>
          <Badge variant="secondary">Reset password</Badge>
        </div>
        <div>
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription className="mt-1">We&apos;ll email you a link to reset it.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {state && "success" in state ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            If an account exists for that email, a reset link is on its way.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            {state?.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}
            <SubmitButton />
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
