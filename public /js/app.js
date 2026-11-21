const $ = s => document.querySelector(s);
let scanner = null;
let chart = null;
let timer = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}
function showMessage(el, text, error = false) {
  el.textContent = text || "";
  el.classList.toggle("error", error);
}
function dashboard(user) {
  $("#auth").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#welcome").textContent = `Welcome, ${user.name}${user.rollNo ? " · Roll No. " + user.rollNo : ""} (${user.role})`;
  $("#teacher-panel").classList.toggle("hidden", user.role !== "teacher");
  $("#student-panel").classList.toggle("hidden", user.role !== "student");
  loadRecords();
  if (user.role === "student") loadWeekly();
}
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation is not supported by this browser."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.message || "Could not get location. Enable GPS and allow location permission.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }) });
    dashboard(data.user);
    showMessage($("#auth-msg"), "");
  } catch (err) { showMessage($("#auth-msg"), err.message, true); }
});
$("#register-form").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await api("/api/register", { method: "POST", body: JSON.stringify({
      name: $("#register-name").value, rollNo: $("#register-rollno").value,
      email: $("#register-email").value, password: $("#register-password").value
    })});
    dashboard(data.user);
    showMessage($("#auth-msg"), "");
  } catch (err) { showMessage($("#auth-msg"), err.message, true); }
});

$("#get-location").addEventListener("click", async () => {
  try {
    showMessage($("#teacher-msg"), "Getting classroom location…");
    const p = await getPosition();
    $("#lat").value = p.lat; $("#lng").value = p.lng;
    showMessage($("#teacher-msg"), `Location captured. GPS accuracy: about ${Math.round(p.accuracy)} m.`);
  } catch (err) { showMessage($("#teacher-msg"), err.message, true); }
});
$("#make-qr").addEventListener("click", async () => {
  try {
    const data = await api("/api/qr", { method: "POST", body: JSON.stringify({
      lat: $("#lat").value, lng: $("#lng").value, radius: $("#radius").value,
      subject: $("#subject").value, startTime: $("#start-time").value, endTime: $("#end-time").value
    })});
    $("#qr-img").src = data.qr;
    $("#qr-img").classList.remove("hidden");
    showMessage($("#teacher-msg"), `QR created for ${data.lecture.subject}. Lecture ${data.lecture.startTime}–${data.lecture.endTime}.`);
    let remaining = 120;
    clearInterval(timer);
    const tick = () => {
      $("#countdown").textContent = remaining > 0 ? `QR expires in ${remaining} seconds` : "QR code expired. Generate a new one.";
      if (remaining <= 0) { clearInterval(timer); $("#qr-img").classList.add("hidden"); }
      remaining--;
    };
    tick(); timer = setInterval(tick, 1000);
    loadRecords();
  } catch (err) { showMessage($("#teacher-msg"), err.message, true); }
});

async function stopScanner() {
  if (scanner) {
    try { if (scanner.isScanning) await scanner.stop(); await scanner.clear(); } catch {}
    scanner = null;
  }
}
$("#start-scan").addEventListener("click", async () => {
  try {
    if (!window.Html5Qrcode) throw new Error("QR scanner library did not load. Check your internet connection.");
    await stopScanner();
    scanner = new Html5Qrcode("reader");
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } },
      async decodedText => {
        await stopScanner();
        await markAttendance(decodedText);
      }, () => {});
    showMessage($("#student-msg"), "Scanner is ready. Point your camera at the QR code.");
  } catch (err) { showMessage($("#student-msg"), err.message, true); }
});
$("#stop-scan").addEventListener("click", stopScanner);

async function markAttendance(token) {
  try {
    showMessage($("#student-msg"), "Checking your location…");
    const p = await getPosition();
    const data = await api("/api/attendance", { method: "POST", body: JSON.stringify({ token, ...p }) });
    showMessage($("#student-msg"), data.message);
    await loadRecords(); await loadWeekly();
  } catch (err) { showMessage($("#student-msg"), err.message, true); }
}
async function loadRecords() {
  try {
    const { records } = await api("/api/records");
    const user = (await api("/api/me")).user;
    const body = user.role === "teacher" ? $("#records") : $("#student-records");
    if (!body) return;
    body.innerHTML = "";
    records.forEach(r => {
      const row = document.createElement("tr");
      const values = user.role === "teacher"
        ? [r.studentName, r.rollNo, r.subject, r.date, `${r.startTime}–${r.endTime}`, r.status]
        : [r.subject, r.date, `${r.startTime}–${r.endTime}`, r.status];
      values.forEach(v => { const td = document.createElement("td"); td.textContent = v ?? ""; row.appendChild(td); });
      body.appendChild(row);
    });
    if (!records.length) body.innerHTML = `<tr><td colspan="${user.role === "teacher" ? 6 : 4}">No attendance records yet.</td></tr>`;
  } catch {}
}
async function loadWeekly() {
  try {
    const data = await api("/api/weekly-summary");
    const holder = $("#weekly-summary");
    holder.innerHTML = "";
    data.summary.forEach(item => {
      const card = document.createElement("div");
      card.className = "subject-card";
      const title = document.createElement("h4"); title.textContent = item.subject;
      const p1 = document.createElement("p"); p1.textContent = `Attended: ${item.attended} / ${item.held}`;
      const p2 = document.createElement("p"); p2.textContent = `Absent: ${item.absent}`;
      const p3 = document.createElement("p"); p3.textContent = `Attendance: ${item.percentage}%`;
      card.append(title, p1, p2, p3); holder.appendChild(card);
    });
    if (!data.summary.length) holder.textContent = "No lectures have been created this week yet.";
    const canvas = $("#attendance-chart");
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "pie",
      data: {
        labels: data.summary.map(x => x.subject),
        datasets: [{ data: data.summary.map(x => x.percentage) }]
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.label}: ${c.raw}% attendance` } } } }
    });
  } catch (err) { $("#weekly-summary").textContent = err.message; }
}
$("#refresh").addEventListener("click", loadRecords);
$("#student-refresh").addEventListener("click", async () => { await loadRecords(); await loadWeekly(); });
$("#logout").addEventListener("click", async () => {
  await stopScanner();
  try { await api("/api/logout", { method: "POST" }); } catch {}
  $("#dashboard").classList.add("hidden"); $("#auth").classList.remove("hidden");
});
(async () => {
  try { const data = await api("/api/me"); if (data.user) dashboard(data.user); } catch {}
})();
