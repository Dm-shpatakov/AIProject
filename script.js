// ================= FIREBASE INIT =================
const firebaseConfig = {
    apiKey: "AIzaSy....",
    authDomain: "aiproject-63331.firebaseapp.com",
    databaseURL: "https://aiproject-63331-default-rtdb.firebaseio.com",
    projectId: "aiproject-63331",
    storageBucket: "aiproject-63331.appspot.com",
    messagingSenderId: "1021315967606",
    appId: "1:1021315967606:web:1257b476cae1945abb0d57"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// ================= GLOBAL STATE =================

let currentUser = null;
let currentChat = "public";
let currentListener = null;

// DOM (set after load)
let messagesEl;
let messageInput;
let onlineCountEl;

// ================= LOCAL USER DATA =================

let username = localStorage.getItem("username");
let userColor = localStorage.getItem("color");
let userBio = localStorage.getItem("bio");

if (!username) username = "Guest" + Math.floor(Math.random() * 9999);
if (!userColor) userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
if (!userBio) userBio = "Just vibing...";

// ================= HELPERS =================

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function chatId(uid1, uid2) {
    return [uid1, uid2].sort().join("_");
}

// ================= AUTH =================

async function initAuth() {
    return new Promise((resolve) => {
        auth.onAuthStateChanged(async (user) => {
            if (user) resolve(user);
            else await auth.signInAnonymously();
        });
    });
}

// ================= SAVE USER =================

async function saveUser() {
    if (!currentUser) return;

    await db.ref("users/" + currentUser.uid).set({
        uid: currentUser.uid,
        username,
        usernameLower: username.toLowerCase(),
        color: userColor,
        bio: userBio,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    await db.ref("usernames/" + username.toLowerCase()).set(currentUser.uid);

    localStorage.setItem("username", username);
    localStorage.setItem("color", userColor);
    localStorage.setItem("bio", userBio);
}

// ================= PRESENCE =================

function setupPresence() {
    const connectedRef = db.ref(".info/connected");

    connectedRef.on("value", (snap) => {
        if (snap.val() === true) {
            const ref = db.ref("presence/" + currentUser.uid);

            ref.set({
                username,
                online: true,
                last: firebase.database.ServerValue.TIMESTAMP
            });

            ref.onDisconnect().remove();
        }
    });

    db.ref("presence").on("value", (snap) => {
        onlineCountEl.textContent = snap.numChildren() + " online";
    });
}

// ================= SEND MESSAGE =================

let lastSend = 0;

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (text.length > 500) return alert("Too long");

    if (Date.now() - lastSend < 700) return;
    lastSend = Date.now();

    const msg = {
        uid: currentUser.uid,
        username,
        color: userColor,
        text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    let ref;

    if (currentChat === "public") {
        ref = db.ref("publicMessages");
    } else {
        ref = db.ref("dms/" + chatId(currentUser.uid, currentChat));
    }

    await ref.push(msg);

    messageInput.value = "";
}

// ================= LOAD CHAT =================

function clearListener() {
    if (currentListener) currentListener.off();
}

function render(msg) {
    const isMine = msg.uid === currentUser.uid;

    const html = `
        <div class="message ${isMine ? "own" : ""}">
            <div class="message-header" style="color:${msg.color}">
                ${escapeHtml(msg.username)}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="timestamp">${formatTime(msg.timestamp || Date.now())}</div>
        </div>
    `;

    messagesEl.insertAdjacentHTML("beforeend", html);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function loadChat() {
    clearListener();
    messagesEl.innerHTML = "";

    let ref;

    if (currentChat === "public") {
        ref = db.ref("publicMessages").limitToLast(100);
    } else {
        ref = db.ref("dms/" + chatId(currentUser.uid, currentChat)).limitToLast(100);
    }

    currentListener = ref;

    ref.on("child_added", (snap) => {
        render(snap.val());
    });
}

// ================= PUBLIC CHAT =================

function openPublicChat() {
    currentChat = "public";
    document.querySelector(".logo").innerHTML = `VOID<span>CHAT</span>`;
    loadChat();
}

// ================= OPEN DM =================

async function openDM(uid) {
    if (uid === currentUser.uid) return alert("You can't DM yourself");

    const snap = await db.ref("users/" + uid).get();
    if (!snap.exists()) return alert("User not found");

    const user = snap.val();

    currentChat = uid;

    document.querySelector(".logo").innerHTML =
        `DM • <span style="color:${user.color}">@${user.username}</span>`;

    loadChat();
}

// ================= SEARCH USER =================

async function searchUser() {
    const q = document.getElementById("user-search").value.toLowerCase();
    const out = document.getElementById("search-results");

    if (!q) return;

    const snap = await db.ref("usernames/" + q).get();

    if (!snap.exists()) {
        out.innerHTML = `<div class="user-card">User not found</div>`;
        return;
    }

    const uid = snap.val();
    const userSnap = await db.ref("users/" + uid).get();

    if (!userSnap.exists()) {
        out.innerHTML = `<div class="user-card">User not found</div>`;
        return;
    }

    const u = userSnap.val();

    out.innerHTML = `
        <div class="user-card">
            <div style="color:${u.color}; font-size:26px">
                ${escapeHtml(u.username)}
            </div>
            <div>${escapeHtml(u.bio)}</div>
            <button onclick="openDM('${uid}')">Message</button>
        </div>
    `;
}

// ================= PROFILE =================

function showProfilePanel() {
    const div = document.createElement("div");
    div.className = "modal";

    div.innerHTML = `
        <div class="profile-panel">
            <h2>Profile</h2>

            <input id="pname" value="${escapeHtml(username)}" />
            <textarea id="pbio">${escapeHtml(userBio)}</textarea>

            <button onclick="saveProfile()">Save</button>
            <button onclick="this.closest('.modal').remove()">Close</button>
        </div>
    `;

    document.body.appendChild(div);
}

async function saveProfile() {
    username = document.getElementById("pname").value.trim();
    userBio = document.getElementById("pbio").value.trim();

    await saveUser();

    document.querySelector(".modal").remove();
}

// ================= INIT =================

window.onload = async () => {
    messagesEl = document.getElementById("messages");
    messageInput = document.getElementById("message-input");
    onlineCountEl = document.getElementById("online-count");

    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    currentUser = await initAuth();

    await saveUser();

    setupPresence();

    loadChat();
};