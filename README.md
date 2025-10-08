# Bulk SMS Sender (Twilio)

Send the same message to many phone numbers at once with validation and concurrency limiting.

## Prerequisites
- Node.js 18+
- Twilio account with a Messaging Service or a SMS-enabled phone number

## Setup
1. Install dependencies (already in this project):
   - `npm install`
2. Copy env template and fill values:
   - `cp .env.example .env`
   - Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
   - Provide either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`
   - Optionally set `DEFAULT_COUNTRY` (e.g. `US`) and `CONCURRENCY`

## Run
- Dev (auto-restart): `npm run dev`
- Prod: `npm start`
- Open `http://localhost:3000` for the UI

## API
`POST /api/send-bulk`

Body:
```json
{
  "message": "Hello!",
  "numbers": "+14155551234, +442071838750\n+919999888877",
  "defaultCountry": "US",
  "concurrency": 5,
  "dryRun": false
}
```

Response:
```json
{
  "total": 2,
  "sent": 2,
  "failed": 0,
  "invalid": [],
  "results": [{"to":"+14155551234","status":"sent","sid":"SM..."}]
}
```

## Notes
- Ensure recipients have opted in and comply with applicable messaging laws.
- Use "Dry run" to verify parsing before sending.
- Numbers are normalized to E.164 and deduplicated.

