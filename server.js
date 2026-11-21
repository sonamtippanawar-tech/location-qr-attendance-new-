const express = require("express");
const session = require("express-session");
const QRCode = require("qrcode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ATTENDANCE_FILE = path.join(DATA_DIR, "attendance.json");
const LECTURES_FILE = path.join(DATA_DIR, "lectures.json");

app.set("trust proxy", 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-session-secret-before-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const file of [USERS_FILE, ATTENDANCE_FILE, LECTURES_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return []; }
}
function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(password, saved) {
  const actual = crypto.scryptSync(password, saved.salt, 64);
  const expected = Buffer.from(saved.hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
function safeUser(user) {
  return { id: user.id, name: user.name, rollNo: user.rollNo || "", email: user.email, role: user.role };
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Please log in first." });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ message: "Please log in first." });
    if (req.session.user.role !== role) return res.status(403).json({ message: "Not permitted." });
    next();
  };
}
function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
const QR_SECRET = process.env.QR_SECRET || "change-this-qr-secret-before-production";
function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", QR_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function readToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", QR_SECRET).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data.expiresAt > Date.now() ? data : null;
  } catch { return null; }
}
function seedDemoAccounts() {
  const users = read(USERS_FILE);
  if (!users.some(u => u.email === "teacher@example.com")) {
    const p = hashPassword("Teacher@123");
    users.push({ id: crypto.randomUUID(), name: "Demo Teacher", rollNo: "", email: "teacher@example.com", password: p, role: "teacher" });
  }
  if (!users.some(u => u.email === "student@example.com")) {
    const p = hashPassword("Student@123");
    users.push({ id: crypto.randomUUID(), name: "Demo Student", rollNo: "001", email: "student@example.com", password: p, role: "student" });
  }
  write(USERS_FILE, users);
}
seedDemoAccounts();

app.post("/api/register", (req, res) => {
  const { name, rollNo, email, password } = req.body || {};
  if (!name || !rollNo || !email || !password) return res.status(400).json({ message: "Please fill in all fields." });
  if (String(password).length < 8) return res.status(400).json({ message: "Password must contain at least 8 characters." });
  const users = read(USERS_FILE);
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedRoll = String(rollNo).trim();
  if (users.some(u => u.email === normalizedEmail)) return res.status(409).json({ message: "This email is already registered." });
  if (users.some(u => u.role === "student" && String(u.rollNo) === normalizedRoll)) return res.status(409).json({ message: "This roll number is already registered." });
  const user = {
    id: crypto.randomUUID(), name: String(name).trim(), rollNo: normalizedRoll,
    email: normalizedEmail, password: hashPassword(String(password)), role: "student"
  };
  users.push(user);
  write(USERS_FILE, users);
  req.session.user = safeUser(user);
  res.json({ message: "Registration successful.", user: req.session.user });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = read(USERS_FILE).find(u => u.email === String(email || "").trim().toLowerCase());
  if (!user || !checkPassword(String(password || ""), user.password)) return res.status(401).json({ message: "Incorrect email or password." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ message: "Could not start session." });
    req.session.user = safeUser(user);
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ message: "Could not save session." });
      res.json({ message: "Login successful.", user: req.session.user });
    });
  });
});

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out." });
  });
});

app.post("/api/qr", requireRole("teacher"), async (req, res) => {
  const { subject, startTime, endTime, lat, lng, radius } = req.body || {};
  const subjects = ["Mathematics", "Data Structures", "OOP", "Digital Electronics", "Software Engineering"];
  const latitude = Number(lat), longitude = Number(lng), allowedRadius = Number(radius);
  if (!subjects.includes(subject)) return res.status(400).json({ message: "Please select a valid subject." });
  if (!startTime || !endTime || endTime <= startTime) return res.status(400).json({ message: "Enter a valid lecture start and end time." });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(allowedRadius) || allowedRadius < 10 || allowedRadius > 1000) {
    return res.status(400).json({ message: "Check classroom location and radius (10–1000 metres)." });
  }
  const lecture = {
    id: crypto.randomUUID(), subject, date: new Date().toISOString().slice(0, 10),
    startTime, endTime, teacherId: req.session.user.id,
    latitude, longitude, radius: allowedRadius, createdAt: new Date().toISOString()
  };
  const lectures = read(LECTURES_FILE);
  lectures.push(lecture);
  write(LECTURES_FILE, lectures);
  const token = makeToken({ lectureId: lecture.id, subject, lat: latitude, lng: longitude, radius: allowedRadius, expiresAt: Date.now() + 120000 });
  const qr = await QRCode.toDataURL(token);
  res.json({ qr, expiresIn: 120, lecture: { id: lecture.id, subject, startTime, endTime, date: lecture.date } });
});

app.post("/api/attendance", requireRole("student"), (req, res) => {
  const { token, lat, lng, accuracy } = req.body || {};
  const data = readToken(token);
  if (!data) return res.status(400).json({ message: "QR code is invalid or expired. Ask your teacher for a new one." });
  const latitude = Number(lat), longitude = Number(lng), gpsAccuracy = Number(accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json({ message: "Could not read your location. Enable GPS and try again." });
  if (Number.isFinite(gpsAccuracy) && gpsAccuracy > 150) return res.status(400).json({ message: "GPS accuracy is weak. Move near a window or outdoors and try again." });
  const metres = distanceMeters(latitude, longitude, data.lat, data.lng);
  if (metres > data.radius) return res.status(403).json({ message: `Outside allowed area. Your distance is ${Math.round(metres)} m; limit is ${data.radius} m.` });
  const lectures = read(LECTURES_FILE);
  const lecture = lectures.find(l => l.id === data.lectureId);
  if (!lecture) return res.status(404).json({ message: "Lecture record was not found." });
  const records = read(ATTENDANCE_FILE);
  if (records.some(r => r.studentId === req.session.user.id && r.lectureId === lecture.id)) {
    return res.status(409).json({ message: "Attendance is already marked for this lecture." });
  }
  const record = {
    id: crypto.randomUUID(), studentId: req.session.user.id, studentName: req.session.user.name,
    rollNo: req.session.user.rollNo || "", subject: lecture.subject, lectureId: lecture.id,
    date: lecture.date, startTime: lecture.startTime, endTime: lecture.endTime,
    markedAt: new Date().toISOString(), status: "Present", distanceMetres: Math.round(metres)
  };
  records.push(record);
  write(ATTENDANCE_FILE, records);
  res.json({ message: `Attendance marked for ${lecture.subject}. Distance: ${Math.round(metres)} m.` });
});

app.get("/api/records", requireLogin, (req, res) => {
  let records = read(ATTENDANCE_FILE);
  if (req.session.user.role === "student") records = records.filter(r => r.studentId === req.session.user.id);
  res.json({ records: records.slice().reverse() });
});

function mondayOfWeek(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}
app.get("/api/weekly-summary", requireRole("student"), (req, res) => {
  const start = mondayOfWeek(new Date());
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const startKey = start.toISOString().slice(0,10);
  const endKey = end.toISOString().slice(0,10);
  const lectures = read(LECTURES_FILE).filter(l => l.date >= startKey && l.date < endKey);
  const records = read(ATTENDANCE_FILE).filter(r => r.studentId === req.session.user.id && r.date >= startKey && r.date < endKey);
  const subjects = [...new Set(lectures.map(l => l.subject))];
  const summary = subjects.map(subject => {
    const held = lectures.filter(l => l.subject === subject);
    const attended = records.filter(r => r.subject === subject && held.some(l => l.id === r.lectureId)).length;
    return { subject, held: held.length, attended, absent: Math.max(0, held.length - attended), percentage: held.length ? Math.round(attended / held.length * 100) : 0 };
  });
  res.json({ weekStarting: startKey, summary });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`AttendEase running on port ${PORT}`));
