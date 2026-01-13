# Appointment Notification AWS Application

## Overview
This project implements a **serverless appointment booking system** on AWS.

**Patient-side flow (Yellow part in diagram):**
S3 Static Website → API Gateway → Lambda → DynamoDB  
Available appointment slots are cached in Lambda using Redis (ElastiCache).

Patients can:
- View available appointment slots
- Book an appointment
- Receive confirmation/notification (via backend workflow)

---

## Architecture Components
- **S3**: Hosts the static patient website (HTML/CSS/JS)
- **API Gateway**: Exposes REST APIs for slot viewing and booking
- **Lambda Functions**:
  - `GetBookingSlotLambda`: Fetches available slots (with Redis cache)
  - `BookAppointmentLambda`: Books appointment using conditional write
- **DynamoDB**: Stores appointment slots and booking data
- **ElastiCache (Redis)**: Caches available appointment slots

---

## DynamoDB Table Design

### Table Name
`Appointments` (or `PatientBookings` – name must match Lambda env var)

### Primary Key
- `appointmentId` (String, Partition Key)

### Attributes
**Slot Attributes**
- `appointmentDate` (String, YYYY-MM-DD)
- `appointmentTime` (String, HH:MM)
- `status` (String: AVAILABLE | PENDING | ACCEPTED | DECLINED)

**Booking Attributes**
- `patientName` (String)
- `patientEmail` (String)
- `notes` (String, optional)

**Recommended (optional)**
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)
- `decisionReason` (String)

---

## Frontend (Patient Website)

### Location
`phase_1/frontend/`

### Files
- `index.html`
- `styles.css`
- `app.js`
- `config.js`

### API Endpoints (defined in config.js)
```js
const API_BASE_URL = "https://<api-id>.execute-api.<region>.amazonaws.com/prod";
```

Endpoints used:
- `GET /appointment-slot`
- `POST /book-appointment`

---

## How to Deploy (For Teammates)

### 1. DynamoDB
1. Create a DynamoDB table
2. Partition key: `appointmentId` (String)
3. (Optional) Add GSIs if required
4. Update table name in Lambda environment variables

### 2. Populate Appointment Slots
Run:
```bash
python populate_db.py
```
This creates AVAILABLE appointment slots in DynamoDB.

---

### 3. Redis / ElastiCache
1. Create Redis cluster
2. Note endpoint + port
3. Set Lambda environment variables:
   - `REDIS_HOST`
   - `REDIS_PORT`
   - `CACHE_TTL_SECONDS`

---

### 4. Lambda Functions
Deploy:
- `GetBookingSlotLambda`
- `BookAppointmentLambda`

Environment variables required:
- `TABLE_NAME`
- `REDIS_HOST`
- `REDIS_PORT`
- `CACHE_TTL_SECONDS`

---

### 5. API Gateway
Create REST API:
- GET `/appointment-slot` → GetBookingSlotLambda
- POST `/book-appointment` → BookAppointmentLambda

Enable CORS.

---

### 6. S3 Static Website (Patient UI)
1. Create S3 bucket
2. Enable **Static Website Hosting**
3. Upload all files from `phase_1/frontend/`
4. Make bucket public or use CloudFront
5. Update `config.js` with API Gateway URL

---

## Cache Behavior
- Available slots are cached in Redis
- Cache is refreshed when TTL expires
- Booking uses DynamoDB conditional write to prevent double booking
- (Optional improvement) Invalidate Redis cache after successful booking

---

## How to Test
1. Open S3 website URL
2. View available appointment slots
3. Book a slot
4. Verify slot status changes from AVAILABLE → PENDING

---

## Notes
- Ensure **region consistency** (S3, Lambda, DynamoDB, Redis)
- If slots appear stale, Redis cache TTL may not have expired
- Booking conflicts return HTTP 409
