// ========================= script.js =========================

// ================= FIREBASE =================

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_BUCKET",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// ================= GLOBALS =================

let currentUser = null;
let currentChat = "public";
let currentListener = null;

const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const onlineCountEl = document.getElementById("online-count");

// ================= LOCAL PROFILE =================

let username = localStorage.getItem("void_username");
let userColor = localStorage.getItem("void_color");
let userBio = localStorage.getItem("void_bio");

if (!username) {
    username = "Guest" + Math.floor(Math.random() * 9999);
}

if (!userColor) {
    userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
}

if (!userBio) {
    userBio = "Lost in the void...";
}

// ================= HELPERS =================

function escapeHtml(text) {

    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
}

function formatTime(timestamp) {

    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getChatId(uid1, uid2) {

    return [uid1, uid2].sort().join("_");
}

function saveLocalProfile() {

    localStorage.setItem("void_username", username);
    localStorage.setItem("void_color", userColor);
    localStorage.setItem("void_bio", userBio);
}

// ================= AUTH =================

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

// ================= USER SAVE =================

async function saveUserProfile() {

    const uid = currentUser.uid;

    const userData = {
        uid,
        username,
        usernameLower: username.toLowerCase(),
        color: userColor,
        bio: userBio,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    };

    await db.ref(`users/${uid}`).set(userData);

    await db.ref(`usernames/${username.toLowerCase()}`).set(uid);

    saveLocalProfile();
}

// ================= PRESENCE =================

function setupPresence() {

    const connectedRef = db.ref(".info/connected");

    connectedRef.on("value", (snap) => {

        if (snap.val() === true) {

            const statusRef = db.ref(`presence/${currentUser.uid}`);

            statusRef.set({
                username,
                online: true,
                lastChanged: firebase.database.ServerValue.TIMESTAMP
            });

            statusRef.onDisconnect().remove();
        }

    });

    db.ref("presence").on("value", (snap) => {

        onlineCountEl.textContent =
            `${snap.numChildren()} online`;
    });
}

// ================= SEND MESSAGE =================

let lastMessageTime = 0;

async function sendMessage() {

    const text = messageInput.value.trim();

    if (!text) return;

    if (text.length > 500) {
        return alert("Message too long");
    }

    const now = Date.now();

    if (now - lastMessageTime < 700) {
        return;
    }

    lastMessageTime = now;

    const msgData = {
        uid: currentUser.uid,
        username,
        userColor,
        text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    let ref;

    if (currentChat === "public") {

        ref = db.ref("publicMessages");

    } else {

        const chatId =
            getChatId(currentUser.uid, currentChat);

        ref = db.ref(`privateChats/${chatId}/messages`);
    }

    await ref.push(msgData);

    messageInput.value = "";
}

// ================= LOAD MESSAGES =================

function removeCurrentListener() {

    if (currentListener) {
        currentListener.off();
    }
}

function renderMessage(msg) {

    const isOwn = msg.uid === currentUser.uid;

    const html = `
        <div class="message ${isOwn ? "own" : ""}">

            <div
                class="message-header"
                style="color:${msg.userColor}"
            >
                ${escapeHtml(msg.username)}
            </div>

            <div class="message-text">
                ${escapeHtml(msg.text)}
            </div>

            <div class="timestamp">
                ${formatTime(msg.timestamp || Date.now())}
            </div>

        </div>
    `;

    messagesEl.insertAdjacentHTML("beforeend", html);

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function loadMessages() {

    removeCurrentListener();

    messagesEl.innerHTML = "";

    let ref;

    if (currentChat === "public") {

        ref = db.ref("publicMessages")
            .limitToLast(100);

    } else {

        const chatId =
            getChatId(currentUser.uid, currentChat);

        ref = db.ref(`privateChats/${chatId}/messages`)
            .limitToLast(100);
    }

    currentListener = ref;

    ref.on("child_added", (snap) => {

        const msg = snap.val();

        if (!msg) return;

        renderMessage(msg);
    });
}

// ================= PUBLIC CHAT =================

function openPublicChat() {

    currentChat = "public";

    document.querySelector(".logo").innerHTML =
        `VOID<span>CHAT</span>`;

    loadMessages();
}

// ================= SEARCH USER =================

async function searchUser() {

    const input =
        document.getElementById("user-search");

    const resultEl =
        document.getElementById("search-results");

    const query =
        input.value.trim().toLowerCase();

    if (!query) {

        resultEl.innerHTML = "";

        return;
    }

    const usernameSnap =
        await db.ref(`usernames/${query}`).get();

    if (!usernameSnap.exists()) {

        resultEl.innerHTML = `
            <div class="user-card">
                User not found
            </div>
        `;

        return;
    }

    const targetUID = usernameSnap.val();

    const userSnap =
        await db.ref(`users/${targetUID}`).get();

    if (!userSnap.exists()) {

        resultEl.innerHTML = `
            <div class="user-card">
                User not found
            </div>
        `;

        return;
    }

    const user = userSnap.val();

    resultEl.innerHTML = `
        <div class="user-card">

            <div
                class="user-name"
                style="color:${user.color}"
            >
                ${escapeHtml(user.username)}
            </div>

            <div class="user-bio">
                ${escapeHtml(user.bio)}
            </div>

            <button onclick="openDM('${targetUID}')">
                Message
            </button>

        </div>
    `;
}

// ================= OPEN DM =================

async function openDM(targetUID) {

    if (targetUID === currentUser.uid) {
        return alert("You cannot DM yourself");
    }

    const userSnap =
        await db.ref(`users/${targetUID}`).get();

    if (!userSnap.exists()) {
        return alert("User not found");
    }

    const targetUser = userSnap.val();

    currentChat = targetUID;

    document.querySelector(".logo").innerHTML =
        `DM • <span style="color:${targetUser.color}">
            @${escapeHtml(targetUser.username)}
        </span>`;

    loadMessages();
}

// ================= PROFILE =================

function showProfilePanel() {

    const modal = document.createElement("div");

    modal.className = "modal";

    modal.innerHTML = `
        <div class="profile-panel">

            <h2>Edit Profile</h2>

            <input
                id="edit-name"
                maxlength="25"
                value="${escapeHtml(username)}"
            >

            <textarea
                id="edit-bio"
                maxlength="80"
            >${escapeHtml(userBio)}</textarea>

            <button onclick="saveProfileChanges()">
                Save
            </button>

            <button onclick="closeModal()">
                Close
            </button>

        </div>
    `;

    document.body.appendChild(modal);
}

async function saveProfileChanges() {

    const newName =
        document.getElementById("edit-name")
        .value
        .trim();

    const newBio =
        document.getElementById("edit-bio")
        .value
        .trim();

    if (!newName) {
        return alert("Username required");
    }

    const takenSnap =
        await db.ref(
            `usernames/${newName.toLowerCase()}`
        ).get();

    if (
        takenSnap.exists() &&
        takenSnap.val() !== currentUser.uid
    ) {
        return alert("Username already taken");
    }

    username = newName;
    userBio = newBio;

    await saveUserProfile();

    closeModal();

    alert("Profile updated");
}

function closeModal() {

    const modal =
        document.querySelector(".modal");

    if (modal) modal.remove();
}

// ================= ENTER KEY =================

messageInput.addEventListener("keypress", (e) => {

    if (e.key === "Enter") {

        e.preventDefault();

        sendMessage();
    }
});

// ================= INIT =================

window.onload = async () => {

    currentUser = await initAuth();

    await saveUserProfile();

    setupPresence();

    loadMessages();
};