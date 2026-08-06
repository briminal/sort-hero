"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { Info } from "lucide-react";
import { signUp, type AuthActionState } from "../actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Creating account..." : "Create account"}
    </Button>
  );
}

export default function RegisterPage() {
  const [state, formAction] = useFormState(signUp, initialState);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold">
            Sort<span className="text-primary">Hero</span>
          </span>
          <Badge variant="secondary">Create account</Badge>
        </div>
        <div>
          <CardTitle className="text-2xl">Set up your store</CardTitle>
          <CardDescription className="mt-1">
            Create your account and store in one step, no card required.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>You&apos;ll be the store owner and can invite staff once you&apos;re in.</span>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="storeName">Store name</Label>
            <Input id="storeName" name="storeName" type="text" required minLength={2} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {state?.error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <SubmitButton />
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
