import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pLimit from "p-limit";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import Twilio from "twilio";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

// Serve the simple frontend
app.use(express.static("src/public"));

const env = {
  port: Number(process.env.PORT || 3000),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || "",
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || "",
  defaultCountry: process.env.DEFAULT_COUNTRY || "",
  concurrency: Number(process.env.CONCURRENCY || 5),
};

function assertTwilioConfig() {
  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in environment");
  }
  if (!env.twilioMessagingServiceSid && !env.twilioFromNumber) {
    throw new Error(
      "Provide either TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER in environment"
    );
  }
}

function createTwilioClient() {
  assertTwilioConfig();
  return new Twilio(env.twilioAccountSid, env.twilioAuthToken);
}

function toArrayNumbers(numbersOrText) {
  if (Array.isArray(numbersOrText)) {
    return numbersOrText;
  }
  if (typeof numbersOrText === "string") {
    // Split by commas, semicolons, whitespace, or newlines
    return numbersOrText
      .split(/[\n,;\t\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePhone(numberRaw, defaultCountry) {
  const trimmed = numberRaw.trim();
  if (!trimmed) return null;
  // Convert leading 00 to + for international format
  const normalized = trimmed.startsWith("00") ? "+" + trimmed.slice(2) : trimmed;
  const parsed = parsePhoneNumberFromString(normalized, defaultCountry || undefined);
  if (parsed && parsed.isValid()) {
    return parsed.number; // E.164
  }
  return null;
}

function normalizeAndDeduplicate(numbersInput, defaultCountry) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const raw of toArrayNumbers(numbersInput)) {
    const e164 = normalizePhone(raw, defaultCountry);
    if (e164) {
      if (!seen.has(e164)) {
        seen.add(e164);
        valid.push(e164);
      }
    } else {
      invalid.push(raw);
    }
  }
  return { valid, invalid };
}

const sendBulkSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  numbers: z.union([z.array(z.string()), z.string()]),
  defaultCountry: z.string().trim().min(2).max(2).optional(),
  concurrency: z.number().int().min(1).max(50).optional(),
  dryRun: z.boolean().optional(),
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/send-bulk", async (req, res) => {
  try {
    const parsed = sendBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { message, numbers, defaultCountry, concurrency, dryRun } = parsed.data;
    const country = (defaultCountry || env.defaultCountry || "").toUpperCase() || undefined;
    const { valid, invalid } = normalizeAndDeduplicate(numbers, country);

    if (valid.length === 0) {
      return res.status(400).json({ error: "No valid phone numbers", invalid });
    }

    const limit = pLimit(concurrency || env.concurrency || 5);

    if (dryRun) {
      return res.json({
        dryRun: true,
        requested: valid.length,
        valid,
        invalid,
      });
    }

    const client = createTwilioClient();

    const useMessagingService = Boolean(env.twilioMessagingServiceSid);
    const common = useMessagingService
      ? { messagingServiceSid: env.twilioMessagingServiceSid }
      : { from: env.twilioFromNumber };

    const results = await Promise.all(
      valid.map((to) =>
        limit(async () => {
          try {
            const msg = await client.messages.create({ ...common, to, body: message });
            return { to, status: "sent", sid: msg.sid };
          } catch (err) {
            const anyErr = err;
            return {
              to,
              status: "failed",
              error: anyErr?.message || String(anyErr),
              code: anyErr?.code,
            };
          }
        })
      )
    );

    const sent = results.filter((r) => r.status === "sent");
    const failed = results.filter((r) => r.status === "failed");

    res.json({
      total: valid.length,
      sent: sent.length,
      failed: failed.length,
      invalid,
      results,
    });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Bulk SMS server listening on http://localhost:${env.port}`);
});

