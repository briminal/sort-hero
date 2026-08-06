"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { extractText, pickLikelyCardName } from "@/lib/recognition/ocr";
import { confirmScan, getHighValueThreshold, getMarketPricesForCards, requestUploadUrl, searchCards } from "./actions";
import { getActiveGames } from "../../games-actions";
import type { CardCandidate } from "@/lib/recognition/match";
import type { ActiveGame } from "@/lib/games";

type Status = "idle" | "camera-on" | "capturing" | "matching" | "confirming" | "confirmed";

const CONFIRMED_FLASH_MS = 1200;

function dataUrlToBlob(dataUrl: string): Blob {
  const [header = "", base64 = ""] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

export default function ScanningPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [games, setGames] = useState<ActiveGame[]>([]);
  const [gameCode, setGameCode] = useState<string>("mtg");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CardCandidate[]>([]);
  const [selected, setSelected] = useState<CardCandidate | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [thresholdCents, setThresholdCents] = useState<number | null>(null);
  const [isHighValue, setIsHighValue] = useState(false);

  // Without this, navigating away or unmounting while the camera is on
  // leaves the stream (and the browser's recording indicator) running
  // indefinitely -- getUserMedia tracks aren't stopped automatically.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    getActiveGames().then((result) => {
      if ("games" in result) setGames(result.games);
    });
  }, []);

  useEffect(() => {
    getHighValueThreshold().then((result) => {
      if ("thresholdCents" in result) setThresholdCents(result.thresholdCents);
    });
  }, []);

  async function startCamera() {
    setError(null);
    try {
      // Prefer the rear camera on a phone -- "ideal" (not "exact") so
      // desktop/laptop webcams without a facingMode still work instead of
      // failing outright.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("camera-on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access camera");
    }
  }

  async function captureAndScan() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setError(null);
    setStatus("capturing");
    setCandidates([]);
    setSelected(null);
    setIsHighValue(false);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);

    try {
      const text = await extractText(dataUrl);
      setOcrText(text);
      const query = pickLikelyCardName(text);

      if (query.length < 2) {
        setError("Could not read any text off the card -- try recapturing.");
        setStatus("camera-on");
        return;
      }

      setStatus("matching");
      const result = await searchCards({ gameCode, query });
      if ("error" in result) {
        setError(result.error);
        setStatus("camera-on");
        return;
      }
      setCandidates(result.candidates);
      setStatus("camera-on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStatus("camera-on");
    }
  }

  async function handleSelect(candidate: CardCandidate) {
    setSelected(candidate);
    setIsHighValue(false);
    if (thresholdCents === null) return;

    const priceResult = await getMarketPricesForCards({ cardIds: [candidate.id] });
    if ("prices" in priceResult) {
      const price = priceResult.prices[candidate.id];
      setIsHighValue(price !== null && price !== undefined && price >= thresholdCents);
    }
  }

  async function handleConfirm() {
    if (!selected) return;
    setError(null);
    setStatus("confirming");

    let imageKey: string | null = null;

    if (capturedImage) {
      const blob = dataUrlToBlob(capturedImage);
      const uploadResult = await requestUploadUrl(blob.size);
      if ("uploadUrl" in uploadResult) {
        try {
          await fetch(uploadResult.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "image/jpeg" },
            body: blob,
          });
          imageKey = uploadResult.key;
        } catch {
          // Upload failing (e.g. R2 not configured) doesn't block confirming
          // the scan -- the card reference is what matters most.
        }
      }
    }

    const result = await confirmScan({ cardId: selected.id, imageKey, quantity });
    if ("error" in result) {
      setError(result.error);
      setStatus("camera-on");
      return;
    }

    setConfirmedId(result.id);
    setStatus("confirmed");

    // Loop back to the camera automatically after a brief success flash --
    // rapid successive single-card scanning shouldn't require a manual
    // restart after every card.
    setTimeout(() => {
      setCandidates([]);
      setSelected(null);
      setCapturedImage(null);
      setOcrText(null);
      setQuantity(1);
      setConfirmedId(null);
      setIsHighValue(false);
      setStatus("camera-on");
    }, CONFIRMED_FLASH_MS);
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Card Scanning</h1>
        <Link href="/scanning/bulk" className="text-sm text-primary hover:underline">
          Bulk intake
        </Link>
      </div>

      <label htmlFor="gameCode" className="mb-1 block text-sm font-medium">
        Game
      </label>
      <select
        id="gameCode"
        value={gameCode}
        onChange={(e) => setGameCode(e.target.value)}
        className="mb-4 w-full rounded border border-input bg-background p-3 text-base"
      >
        {games.map((g) => (
          <option key={g.code} value={g.code}>
            {g.name}
          </option>
        ))}
      </select>

      {status === "idle" && (
        <button onClick={startCamera} className="w-full rounded bg-primary py-3 text-lg font-medium text-primary-foreground">
          Start camera
        </button>
      )}

      <video
        ref={videoRef}
        muted
        playsInline
        className={`mx-auto mb-4 aspect-[3/4] w-full max-w-md rounded-lg bg-muted object-cover ${status === "idle" ? "hidden" : ""}`}
      />
      <canvas ref={canvasRef} className="hidden" />

      {status !== "idle" && (
        <button
          onClick={captureAndScan}
          disabled={status === "capturing" || status === "matching"}
          className="mb-4 w-full rounded bg-primary py-3 text-lg font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "capturing" || status === "matching" ? "Scanning..." : "Capture & scan"}
        </button>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {ocrText !== null && (
        <p data-testid="ocr-text" className="mb-4 text-sm text-muted-foreground">
          OCR read: {ocrText.trim() || "(no text found)"}
        </p>
      )}

      {candidates.length > 0 && (
        <ul data-testid="candidates" className="mb-4 divide-y divide-border rounded border border-border">
          {candidates.map((c) => (
            <li key={c.id}>
              <button onClick={() => handleSelect(c)} className="w-full p-3 text-left text-base hover:bg-accent">
                {c.name} {c.set_name ? `(${c.set_name})` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && status !== "confirmed" && (
        <div className="mb-4">
          <p className="mb-2 flex items-center gap-2">
            Selected: {selected.name}
            {isHighValue && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                High value
              </span>
            )}
          </p>
          <label htmlFor="quantity" className="mb-1 block text-sm font-medium">
            Quantity
          </label>
          <input
            id="quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
            className="mb-4 w-full rounded border border-input bg-background p-3 text-base"
          />
          <button
            onClick={handleConfirm}
            disabled={status === "confirming"}
            className="w-full rounded bg-primary py-3 text-lg font-medium text-primary-foreground disabled:opacity-50"
          >
            {status === "confirming" ? "Confirming..." : "Confirm scan"}
          </button>
        </div>
      )}

      {status === "confirmed" && confirmedId && (
        <p data-testid="confirmed" className="rounded bg-success/10 p-3 text-sm text-success">
          Added to inventory (item {confirmedId}). Ready for the next card...
        </p>
      )}
    </main>
  );
}
