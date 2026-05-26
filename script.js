// ================== FIREBASE CONFIG ==================
const firebaseConfig = {
    apiKey: "AIzaSyAIiUTo4vfh6cQNEeP6-gnCR-01wmvjVmc",
    authDomain: "aiproject-63331.firebaseapp.com",
    projectId: "aiproject-63331",
    storageBucket: "aiproject-63331.firebasestorage.app",
    messagingSenderId: "1021315967606",
    appId: "1:1021315967606:web:1257b476cae1945abb0d57"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const messagesRef = db.ref("public_chat");
const onlineRef = db.ref("online_users");
const usersRef = db.ref("users");

// ================== USER SETTINGS ==================
let username = localStorage.getItem("voidUsername") || "Guest" + Math.floor(Math.random() * 9999);
let userColor = localStorage.getItem("userColor") || "#" + Math.floor(Math.random() * 16777215).toString(16);
let userBio = localStorage.getItem("userBio") || "Just vibing in the void...";

let currentChat = "public";
let messageListener = null; // Prevent duplicate listeners

// DOM Elements
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const onlineCountEl = document.getElementById("online-count");

// ================== HELPER FUNCTIONS ==================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveUserProfile() {
    localStorage.setItem("voidUsername", username);
    localStorage.setItem("userColor", userColor);
    localStorage.setItem("userBio", userBio);
    
    usersRef.child(username.toLowerCase()).update({
        username: username,
        color: userColor,
        bio: userBio,
        lastSeen: Date.now()
    });
}

function showProfilePanel() {
    const panelHTML = `
        <div class="profile-panel">
            <h2>👤 Your Profile</h2>
            <p><strong>Username:</strong> ${escapeHtml(username)}</p>
            <p><strong>Color:</strong> <span style="color:${userColor}">${userColor}</span></p>
            <p><strong>Bio:</strong> ${escapeHtml(userBio)}</p>
            
            <button onclick="editProfile()">Edit Profile</button>
            <button onclick="closeProfilePanel()">Close</button>
        </div>
    `;
    const panel = document.createElement('div');
    panel.className = "modal";
    panel.innerHTML = panelHTML;
    document.body.appendChild(panel);
}

function editProfile() {
    const newName = prompt("New username:", username);
    const newBio = prompt("Your bio (max 80 chars):", userBio);
    
    if (newName && newName.trim() !== "") {
        username = newName.trim().substring(0, 25);
        userBio = newBio ? newBio.substring(0, 80) : userBio;
        userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
        
        saveUserProfile();
        closeProfilePanel();
        alert("Profile updated! Refreshing...");
        location.reload();
    }
}

function closeProfilePanel() {
    const modal = document.querySelector('.modal');
    if (modal) modal.remove();
}

// ================== SEND MESSAGE ==================
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    if (text.length > 500) {
        alert("Message too long! (Max 500 characters)");
        return;
    }

    const msgData = {
        username: username,
        userColor: userColor,
        text: text,
        timestamp: Date.now()
    };

    if (currentChat === "public") {
        messagesRef.push(msgData);
    } else {
        const dmPath = getDMPath(username, currentChat);
        db.ref(dmPath).push(msgData);
    }

    messageInput.value = "";
}

function getDMPath(user1, user2) {
    const sorted = [user1.toLowerCase(), user2.toLowerCase()].sort();
    return `dms/${sorted[0]}_${sorted[1]}`;
}

// ================== LOAD MESSAGES ==================
function loadMessages() {
    // Remove old listener to prevent duplicates
    if (messageListener) {
        messageListener.off();
    }

    messagesDiv.innerHTML = "";

    let ref = currentChat === "public" ? messagesRef : db.ref(getDMPath(username, currentChat));

    messageListener = ref.on("child_added", (snapshot) => {
        const msg = snapshot.val();
        if (!msg) return;

        const isOwn = msg.username === username;

        const html = `
            <div class="message ${isOwn ? 'own' : ''}">
                <div class="message-header" style="color: ${msg.userColor || '#ff00aa'}">
                    ${escapeHtml(msg.username)}
                </div>
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
            </div>
        `;

        messagesDiv.innerHTML += html;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

// ================== ONLINE USERS ==================
function setupOnline() {
    const myRef = onlineRef.push({ username: username, lastSeen: Date.now() });
    myRef.onDisconnect().remove();

    onlineRef.on("value", (snap) => {
        onlineCountEl.textContent = `${snap.numChildren()} online`;
    });

    saveUserProfile();
}

// ================== CHAT SWITCHING ==================
function openPublicChat() {
    currentChat = "public";
    document.querySelector('.logo').innerHTML = `VOID<span>CHAT</span>`;
    loadMessages();
}

function openDM(targetUser) {
    if (targetUser === username) return alert("Can't message yourself");
    currentChat = targetUser;
    document.querySelector('.logo').innerHTML = `VOIDCHAT • <span style="color:${userColor}">@${targetUser}</span>`;
    loadMessages();
}

// ================== INITIALIZE ==================
window.onload = () => {
    // Username setup
    if (!localStorage.getItem("voidUsername")) {
        const defaultName = "Guest" + Math.floor(Math.random() * 9999);
        const name = prompt("Choose your username:", defaultName);
        if (name) username = name.trim().substring(0, 25);
        saveUserProfile();
    }

    setupOnline();
    loadMessages(); // Initial load

    // Enter key - SINGLE listener
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); // Prevent double send
            sendMessage();
        }
    });
};