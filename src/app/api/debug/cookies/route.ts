// GET /api/debug/cookies
// Debug endpoint to verify YouTube cookies are loaded correctly.
// Returns cookie status WITHOUT exposing cookie values (for security).

import { NextResponse } from "next/server";
import { validateYouTubeCookies } from "@/lib/video-processor";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoded = process.env.YOUTUBE_COOKIES;

  if (!encoded || encoded.trim() === "") {
    return NextResponse.json({
      status: "not_configured",
      message: "YOUTUBE_COOKIES env var is not set.",
      instructions: [
        "1. Install 'Get cookies.txt LOCALLY' browser extension",
        "2. Log into YouTube in your browser",
        "3. Export cookies for youtube.com",
        "4. Base64-encode the file",
        "5. Set YOUTUBE_COOKIES=<base64> on Railway Variables",
      ],
    });
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const validation = validateYouTubeCookies(decoded);

    return NextResponse.json({
      status: validation.valid ? "loaded" : "invalid",
      message: validation.valid
        ? `Loaded ${validation.cookieCount} cookies successfully`
        : "Cookies file parsed but no valid cookies found",
      details: {
        cookieCount: validation.cookieCount,
        hasLoginInfo: validation.hasLoginInfo,
        hasVisitorInfo: validation.hasVisitorInfo,
        domains: validation.domains,
        hasRequiredCookies: validation.hasLoginInfo && validation.hasVisitorInfo,
      },
      warnings: [
        ...(!validation.hasLoginInfo
          ? ["Missing LOGIN_INFO cookie — you may not be logged in"]
          : []),
        ...(!validation.hasVisitorInfo
          ? ["Missing VISITOR_INFO1_LIVE cookie — session may be invalid"]
          : []),
      ],
      rawContentPreview: decoded.slice(0, 200) + (decoded.length > 200 ? "..." : ""),
    });
  } catch (err) {
    return NextResponse.json({
      status: "decode_error",
      message: "Failed to decode YOUTUBE_COOKIES env var",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
