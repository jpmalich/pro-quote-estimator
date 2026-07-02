# 4. Workflow

*Part of the [Pro-Quote documentation](README.md).*

## End-to-end flow

```mermaid
sequenceDiagram
    actor S as Supplier admin
    actor C as Contractor
    actor H as Homeowner

    S->>S: Set branding, signup code, price tiers
    S->>C: Hand out access code / send branded invite
    C->>C: Register company, upload logo, set labor rates
    S->>C: Assign price tier
    C->>C: Create estimate (siding / windows / ISS)
    C->>C: Measure — photos, HOVER PDF, blueprint, or satellite
    C->>C: Review takeoff preview → apply
    C->>C: Adjust lines, openings, adders, waste / tax / margin
    C->>H: Email branded quote (Resend)
    H-->>C: Opens quote (tracked sent → opened → clicked)
    H->>C: Accepts with optional note (public accept page)
    C->>S: Print material list → order materials
    Note over S: Sees quote counts per company,<br/>deliberately not quote contents
```

## Quote lifecycle

Delivery events arrive via Svix-verified Resend webhooks and drive the dashboard pipeline view:

```mermaid
stateDiagram-v2
    [*] --> Draft : estimate created
    Draft --> Sent : quote emailed
    Sent --> Opened : email opened
    Opened --> Clicked : quote link clicked
    Clicked --> Accepted : homeowner accepts on /accept/:token
    Accepted --> [*] : contractor notified, material list ordered
```

## Measurement-import flow (async AI runs)

Photo measure, blueprint, and HOVER imports run as background jobs on the backend with
status-polling endpoints; run documents expire after 24 hours (TTL indexes).

```mermaid
sequenceDiagram
    actor C as Contractor (browser)
    participant API as FastAPI backend
    participant AI as Claude (vision)
    participant DB as MongoDB

    C->>API: POST /measure/ai-measure (photos + reference dim)
    API->>DB: create run doc (status pending, TTL 24 h)
    API-->>C: run_id
    API->>AI: vision passes (measurements, cross-check)
    AI-->>API: extracted measurements
    API->>DB: update run doc (status done + result)
    loop poll
        C->>API: GET /measure/ai-measure/status/run_id
        API-->>C: stage / result
    end
    C->>C: Preview & reconcile takeoff
    C->>API: PUT /estimates/:id (apply lines / openings)
```
