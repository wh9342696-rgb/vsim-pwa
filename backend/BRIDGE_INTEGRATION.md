# VSIM Bridge Integration

The Android Bridge never connects to PostgreSQL and never chooses a user wallet. It sends normalized provider events to the API.

## Production environment

Set these variables on the API server:

```env
PORT=3000
APP_URL=https://your-domain.com
JWT_SECRET=<long-random-secret>
DB_HOST=<private-postgres-host>
DB_PORT=5432
DB_NAME=vsim_db
DB_USER=<database-user>
DB_PASSWORD=<database-password>
```

Expose only the API through HTTPS. Do not expose PostgreSQL to the Android device.

## Provisioning

1. Admin creates a bridge device from the Admin Bridge Devices area.
2. Admin provisions it with provider and merchant ID.
3. The API returns a one-time credential. Store it securely in the Android keystore.
4. The device authenticates and receives a 12-hour bearer token.
5. A revoked or disabled device cannot authenticate or submit events.

## API contract

Base path: `/api/v1/bridge`

- `POST /register`: `{ "bridgeDeviceId": "..." }`
- `POST /authenticate`: `{ "bridgeDeviceId": "...", "credential": "..." }`
- QR enrollment payload includes compatible aliases (`apiBase`, `bridgeApiBase`, `apiRoot`, `deviceId`, `bridgeDeviceId`, `device_id`, `deviceSecret`, `credential`, and `device_secret`); the app can scan it and call `/authenticate`.
- `GET /config`: bearer token required
- `POST /heartbeat`: `{ "appVersion": "1.0.0", "queueSize": 0, "simBalance": 0, "pingMs": 120, "simLines": { "MTN": "0770000000", "AIRTEL": "0750000000" } }`
- `POST /events`: normalized event, bearer token required
- `POST /sync`: bearer token required
- `POST /acknowledge`: bearer token required
- `GET /status`: bearer token required

Event body:

```json
{
  "eventId": "device-event-id",
  "provider": "MTN",
  "merchantId": "merchant-id",
  "transactionReference": "provider-reference",
  "transactionType": "deposit",
  "amount": 5000,
  "currency": "UGX",
  "providerTimestamp": "2026-08-21T12:00:00.000Z",
  "metadata": { "sender": "masked-value" }
}
```

Deposit events are matched only against one unambiguous pending deposit with the same amount and authorized merchant/provider. The bridge cannot specify a wallet user. Unmatched or ambiguous events are stored as `UNMATCHED` or `REVIEW_REQUIRED`. Repeated provider identities return an idempotent acknowledgement and do not create another wallet credit.

The Admin Bridge card displays `simLines.MTN`, `simLines.AIRTEL`, `simBalance`, `pingMs`, and the provisioned `mtn_merchant_id`/`airtel_merchant_id`. Send only installed lines; send `null` or omit a line when that SIM is not present. The card shows MTN, Airtel, or both based on the reported lines.

## Statuses

Devices: `provisioning`, `active`, `disabled`, `revoked`, `decommissioned`.
Events: `MATCHED`, `UNMATCHED`, `REVIEW_REQUIRED` and duplicate acknowledgements.

## Current limitations

Redis coordination, reversal/chargeback workflows, and automated test suites are not yet configured in this repository. PostgreSQL remains the financial source of truth; no Redis dependency is required for correctness.
