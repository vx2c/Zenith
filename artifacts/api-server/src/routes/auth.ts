import { Router, type IRouter } from "express";
import { RobloxCallbackBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/roblox-callback", async (req, res): Promise<void> => {
  const parsed = RobloxCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, redirect_uri } = parsed.data;

  const clientId = process.env["ROBLOX_CLIENT_ID"];
  const clientSecret = process.env["ROBLOX_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    req.log.error("ROBLOX_CLIENT_ID or ROBLOX_CLIENT_SECRET not configured");
    res.status(500).json({ error: "OAuth credentials not configured" });
    return;
  }

  const tokenUrl = "https://apis.roblox.com/oauth/v1/token";

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirect_uri);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  const fetchResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!fetchResponse.ok) {
    const errorData = await fetchResponse.text();
    req.log.warn({ status: fetchResponse.status, details: errorData }, "Roblox token exchange failed");
    res.status(502).json({ error: "Token exchange failed", details: errorData });
    return;
  }

  const tokenData = (await fetchResponse.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    displayName?: string;
  };

  res.status(200).json({
    accessToken: tokenData.access_token,
    tokenType: tokenData.token_type,
    expiresIn: tokenData.expires_in ?? null,
    refreshToken: tokenData.refresh_token ?? null,
    scope: tokenData.scope ?? null,
    displayName: tokenData.displayName ?? null,
  });
});

export default router;
