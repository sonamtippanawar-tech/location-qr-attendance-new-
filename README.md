# AttendEase – Location-Based QR Attendance System

## Features
- Teacher and student login
- Student registration with roll number
- Teacher selects subject and lecture start/end time
- Teacher captures classroom GPS location and sets radius
- QR code expires after 2 minutes
- Student scans QR code and location is verified
- Duplicate attendance prevention per student per lecture
- JSON file storage
- Student weekly subject-wise attendance summary and pie chart

## Run locally
1. Install Node.js.
2. Open this folder in VS Code.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Demo accounts
- Teacher: `teacher@example.com` / `Teacher@123`
- Student: `student@example.com` / `Student@123`

New student accounts can be created from the registration form.

## Important notes
- The demo uses JSON files, not MySQL or MongoDB.
- The weekly summary counts lectures created by the teacher during the current Monday–Sunday week. Lectures are recorded when the teacher generates a QR code.
- Geolocation and camera access generally require HTTPS or localhost.
- This is an academic prototype. For public production use, configure strong `SESSION_SECRET` and `QR_SECRET`, use a persistent database and session store, and add proper teacher account provisioning.
- On Render's free instance, local JSON files may be lost on redeploy/restart. Use a persistent disk or external database for durable records.
