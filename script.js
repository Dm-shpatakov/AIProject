// ========================= script.js =========================
// VOIDCHAT v2.0 — Firebase Realtime DB + Anonymous Auth

// ── Firebase Config ──────────────────────────────────────────
// ⚠️  Replace these values with your own from Firebase Console:
//     https://console.firebase.google.com → Project Settings → Your apps
const firebaseConfig = {
    apiKey:            "AIzaSy....",                        // ← your key
    authDomain:        "aiproject-63331.firebaseapp.com",
    databaseURL:       "https://aiproject-63331-default-rtdb.firebaseio.com",
    projectId:         "aiproject-63331",
    storageBucket:     "aiproject-63331.appspot.com",
    messagingSenderId: "1021315967606",
    appId:             "1:1021315967606:web:1257b476cae1945abb0d57"
};

firebase.initializeApp(firebaseConfig);

const db   = firebase.database();
const auth = firebase.auth();

// ── Global State ─────────────────────────────────────────────

let currentUser    = null;
let currentChat    = "public";
let currentListener = null;
let messagesEl, messageInput, onlineNumEl;
let lastSend       = 0;

// ── Local User Data ───────────────────────────────────────────

let username  = localStorage.getItem("username")  || "Ghost" + Math.floor(Math.random() * 9999);
let userColor = localStorage.getItem("color")     || randomColor();
let userBio   = localStorage.getItem("bio")       || "Just passing through...";

function randomColor() {
    const colors = ["#00ff9d","#ff00aa","#00aaff","#ffaa00","#aa00ff","#ff6600","#00ffff"];
    return colors[Math.floor(Math.random() * colors.length)];
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function chatId(uid1, uid2) {
    return [uid1, uid2].sort().join("_");
}

function initials(name) {
    return name.slice(0, 2).toUpperCase();
}

function showToast(msg, type = "success") {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();

    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    if (type === "error") {
        t.style.borderColor = "#ff4466";
        t.style.color = "#ff4466";
        t.style.boxShadow = "0 0 20px rgba(255,68,102,0.35)";
    }
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
        t.classList.remove("show");
        setTimeout(() => t.remove(), 300);
    }, 2500);
}

// ── Auth ──────────────────────────────────────────────────────

async function initAuth() {
    return new Promise((resolve) => {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                resolve(user);
            } else {
                await auth.signInAnonymously();
            }
        });
    });
}

// ── Save / Sync User ──────────────────────────────────────────

async function saveUser() {
    if (!currentUser) return;

    await db.ref("users/" + currentUser.uid).set({
        uid:           currentUser.uid,
        username,
        usernameLower: username.toLowerCase(),
        color:         userColor,
        bio:           userBio,
        lastSeen:      firebase.database.ServerValue.TIMESTAMP
    });

    // index by lowercase username for search
    await db.ref("usernames/" + username.toLowerCase()).set(currentUser.uid);

    localStorage.setItem("username", username);
    localStorage.setItem("color",    userColor);
    localStorage.setItem("bio",      userBio);
}

// ── Presence ─────────────────────────────────────────────────

function setupPresence() {
    const connectedRef = db.ref(".info/connected");

    connectedRef.on("value", (snap) => {
        if (snap.val() !== true) return;

        const presRef = db.ref("presence/" + currentUser.uid);

        presRef.set({
            username,
            color:  userColor,
            online: true,
            last:   firebase.database.ServerValue.TIMESTAMP
        });

        presRef.onDisconnect().remove();
    });

    db.ref("presence").on("value", (snap) => {
        onlineNumEl.textContent = snap.numChildren();
    });
}

// ── Send Message ──────────────────────────────────────────────

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (text.length > 500) {
        showToast("Message too long (max 500 chars)", "error");
        return;
    }

    const now = Date.now();
    if (now - lastSend < 700) {
        showToast("Slow down!", "error");
        return;
    }
    lastSend = now;

    const msg = {
        uid:       currentUser.uid,
        username,
        color:     userColor,
        text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    const ref = currentChat === "public"
        ? db.ref("publicMessages")
        : db.ref("dms/" + chatId(currentUser.uid, currentChat));

    try {
        await ref.push(msg);
        messageInput.value = "";
        updateCharCount();
    } catch (err) {
        showToast("Failed to send. Check connection.", "error");
    }
}

// ── Render Message ────────────────────────────────────────────

function render(msg) {
    // Remove empty-state if present
    const empty = messagesEl.querySelector(".empty-state");
    if (empty) empty.remove();

    const isMine = msg.uid === currentUser.uid;
    const time   = formatTime(msg.timestamp || Date.now());

    const el = document.createElement("div");
    el.className = "message" + (isMine ? " own" : "");

    el.innerHTML = `
        <div class="message-header" style="color:${msg.color}">
            ${isMine ? "YOU" : escapeHtml(msg.username)}
        </div>
        <div class="message-text">${escapeHtml(msg.text)}</div>
        <div class="timestamp">${time}</div>
    `;

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Load Chat ─────────────────────────────────────────────────

function clearListener() {
    if (currentListener) {
        currentListener.off();
        currentListener = null;
    }
}

function loadChat() {
    clearListener();
    messagesEl.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">◈</div>
            <div>Loading messages...</div>
        </div>
    `;

    const ref = currentChat === "public"
        ? db.ref("publicMessages").limitToLast(100)
        : db.ref("dms/" + chatId(currentUser.uid, currentChat)).limitToLast(100);

    currentListener = ref;

    // Use child_added for real-time streaming
    ref.on("child_added", (snap) => {
        // On first batch, clear the loading placeholder once
        const empty = messagesEl.querySelector(".empty-state");
        if (empty) empty.remove();
        render(snap.val());
    });
}

// ── Public Chat ───────────────────────────────────────────────

function openPublicChat() {
    currentChat = "public";
    document.querySelector(".logo-title").innerHTML = "VOID<span>CHAT</span>";
    document.querySelector(".logo-sub").textContent = "v2.0 // PUBLIC CHANNEL";
    document.querySelector(".chat-title").textContent = "// PUBLIC CHANNEL";
    document.querySelector(".chat-hint").textContent = "Messages are public";
    loadChat();
}

// ── Open DM ───────────────────────────────────────────────────

async function openDM(uid) {
    if (uid === currentUser.uid) {
        showToast("Can't DM yourself", "error");
        return;
    }

    const snap = await db.ref("users/" + uid).get();
    if (!snap.exists()) {
        showToast("User not found", "error");
        return;
    }

    const user = snap.val();
    currentChat = uid;

    document.querySelector(".logo-title").innerHTML =
        `DM <span style="color:${user.color}">@${escapeHtml(user.username)}</span>`;
    document.querySelector(".logo-sub").textContent = "// PRIVATE MESSAGE";
    document.querySelector(".chat-title").textContent = `// DM with @${user.username}`;
    document.querySelector(".chat-hint").textContent = "Private — only you two can see this";

    // Close search results
    document.getElementById("search-results").innerHTML = "";
    document.getElementById("user-search").value = "";

    loadChat();
}

// ── Search User ───────────────────────────────────────────────

async function searchUser() {
    const q   = document.getElementById("user-search").value.trim().toLowerCase();
    const out = document.getElementById("search-results");

    if (!q) {
        out.innerHTML = "";
        return;
    }

    out.innerHTML = `<div class="user-not-found">Searching...</div>`;

    try {
        // Exact match first
        const snap = await db.ref("usernames/" + q).get();

        if (!snap.exists()) {
            out.innerHTML = `<div class="user-not-found">No user found for "${escapeHtml(q)}"</div>`;
            return;
        }

        const uid      = snap.val();
        const userSnap = await db.ref("users/" + uid).get();

        if (!userSnap.exists()) {
            out.innerHTML = `<div class="user-not-found">User data not found</div>`;
            return;
        }

        const u         = userSnap.val();
        const isMe      = uid === currentUser.uid;
        const avatarBg  = u.color + "22";

        out.innerHTML = `
            <div class="user-card">
                <div class="user-avatar" style="background:${avatarBg}; border-color:${u.color}; color:${u.color}">
                    ${initials(u.username)}
                </div>
                <div class="user-info">
                    <div class="user-name" style="color:${u.color}">@${escapeHtml(u.username)}</div>
                    <div class="user-bio">${escapeHtml(u.bio || "No bio")}</div>
                </div>
                ${isMe
                    ? `<button onclick="showProfilePanel()">Edit Profile</button>`
                    : `<button onclick="openDM('${uid}')">Message</button>`
                }
            </div>
        `;
    } catch (err) {
        out.innerHTML = `<div class="user-not-found">Error searching. Try again.</div>`;
    }
}

// ── Profile Panel ─────────────────────────────────────────────

function showProfilePanel() {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "profile-modal";

    modal.innerHTML = `
        <div class="profile-panel">
            <h2>// EDIT PROFILE</h2>

            <div class="form-group">
                <label class="form-label">USERNAME</label>
                <input id="pname" value="${escapeHtml(username)}" maxlength="24" placeholder="Your username" />
            </div>

            <div class="form-group">
                <label class="form-label">BIO</label>
                <textarea id="pbio" maxlength="160" placeholder="Write something...">${escapeHtml(userBio)}</textarea>
            </div>

            <div class="form-group">
                <label class="form-label">ACCENT COLOR</label>
                <div class="color-row">
                    <input type="color" id="pcolor" value="${userColor}" />
                    <span class="color-preview" id="color-preview-text">${userColor}</span>
                </div>
            </div>

            <div class="profile-buttons">
                <button class="btn-primary" onclick="saveProfile()">SAVE</button>
                <button onclick="closeProfilePanel()">CANCEL</button>
            </div>
        </div>
    `;

    // Update color preview text live
    modal.querySelector("#pcolor").addEventListener("input", (e) => {
        modal.querySelector("#color-preview-text").textContent = e.target.value;
    });

    // Click outside to close
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeProfilePanel();
    });

    document.body.appendChild(modal);
}

function closeProfilePanel() {
    const modal = document.getElementById("profile-modal");
    if (modal) modal.remove();
}

async function saveProfile() {
    const newName  = document.getElementById("pname").value.trim();
    const newBio   = document.getElementById("pbio").value.trim();
    const newColor = document.getElementById("pcolor").value;

    if (!newName) {
        showToast("Username can't be empty", "error");
        return;
    }
    if (newName.length < 2) {
        showToast("Username too short (min 2 chars)", "error");
        return;
    }

    username  = newName;
    userBio   = newBio;
    userColor = newColor;

    try {
        await saveUser();
        closeProfilePanel();
        showToast("Profile saved!");
    } catch (err) {
        showToast("Save failed. Try again.", "error");
    }
}

// ── Char Counter ──────────────────────────────────────────────

function updateCharCount() {
    const counter = document.getElementById("char-count");
    const len     = messageInput.value.length;
    const left    = 500 - len;
    counter.textContent = left;
    counter.className   = "char-count" + (left < 50 ? " danger" : left < 100 ? " warn" : "");
}

// ── Particle Background ───────────────────────────────────────

function initParticles() {
    const canvas = document.getElementById("particles-canvas");
    if (!canvas) return;

    const ctx    = canvas.getContext("2d");
    let W, H, particles;

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function makeParticle() {
        return {
            x:    Math.random() * W,
            y:    Math.random() * H,
            r:    Math.random() * 1.5 + 0.3,
            dx:   (Math.random() - 0.5) * 0.25,
            dy:  -(Math.random() * 0.3 + 0.1),
            a:    Math.random()
        };
    }

    resize();
    particles = Array.from({ length: 80 }, makeParticle);
    window.addEventListener("resize", resize);

    function draw() {
        ctx.clearRect(0, 0, W, H);

        for (const p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,255,157,${p.a * 0.6})`;
            ctx.fill();

            p.x += p.dx;
            p.y += p.dy;
            p.a += (Math.random() - 0.5) * 0.01;
            p.a  = Math.max(0.05, Math.min(1, p.a));

            if (p.y < -5 || p.x < -5 || p.x > W + 5) {
                Object.assign(p, makeParticle());
                p.y = H + 5;
            }
        }

        requestAnimationFrame(draw);
    }

    draw();
}

// ── Init ──────────────────────────────────────────────────────

window.onload = async () => {
    messagesEl   = document.getElementById("messages");
    messageInput = document.getElementById("message-input");
    onlineNumEl  = document.getElementById("online-num");

    // Keyboard shortcuts
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) sendMessage();
    });
    messageInput.addEventListener("input", updateCharCount);

    // Search on Enter
    document.getElementById("user-search").addEventListener("keypress", (e) => {
        if (e.key === "Enter") searchUser();
    });

    // ESC closes modals
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeProfilePanel();
    });

    // Particles
    initParticles();

    // Auth + sync
    currentUser = await initAuth();
    await saveUser();
    setupPresence();
    loadChat();
};