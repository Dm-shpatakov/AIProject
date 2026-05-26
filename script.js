// ================== FIREBASE CONFIG ==================
const firebaseConfig = {
    apiKey: "AIzaSyAIiUTo4vfh6cQNEeP6-gnCR-01wmvjVmc",
    authDomain: "aiproject-63331.firebaseapp.com",
    projectId: "aiproject-63331",
    storageBucket: "aiproject-63331.firebasestorage.app",
    messagingSenderId: "1021315967606",
    appId: "1:1021315967606:web:1257b476cae1945abb0d57"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const messagesRef = db.ref("public_chat");
const onlineRef = db.ref("online_users");

// ================== USER SETTINGS ==================
let username = localStorage.getItem("voidUsername") || 
    "Guest" + Math.floor(Math.random() * 9999);

let userColor = localStorage.getItem("userColor") || 
    "#" + Math.floor(Math.random() * 16777215).toString(16);

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

function changeUsername() {
    const newName = prompt("Enter new username (max 25 chars):", username);
    if (newName && newName.trim() !== "") {
        username = newName.trim().substring(0, 25);
        localStorage.setItem("voidUsername", username);
        
        // Change color when username changes
        userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
        localStorage.setItem("userColor", userColor);
        
        alert(`Username changed to: ${username}`);
    }
}

function sendMessage() {
    const text = messageInput.value.trim();
    
    if (!text) return;
    if (text.length > 500) {
        alert("Message is too long! (Max 500 characters)");
        return;
    }

    messagesRef.push({
        username: username,
        userColor: userColor,
        text: text,
        timestamp: Date.now()
    });

    messageInput.value = "";
}

// ================== DISPLAY MESSAGES ==================
messagesRef.on("child_added", (snapshot) => {
    const msg = snapshot.val();
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

// ================== ONLINE USERS ==================
function setupOnline() {
    const myRef = onlineRef.push({ 
        username: username, 
        lastSeen: Date.now() 
    });

    myRef.onDisconnect().remove();

    onlineRef.on("value", (snap) => {
        const count = snap.numChildren();
        onlineCountEl.textContent = `${count} online`;
    });
}

// ================== EVENT LISTENERS ==================
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        sendMessage();
    }
});

// ================== INITIALIZE ==================
window.onload = () => {
    // Set username if not exists
    if (!localStorage.getItem("voidUsername")) {
        const defaultName = "Guest" + Math.floor(Math.random() * 9999);
        const name = prompt("Choose your username:", defaultName);
        if (name && name.trim() !== "") {
            username = name.trim().substring(0, 25);
        } else {
            username = defaultName;
        }
        localStorage.setItem("voidUsername", username);
    }

    setupOnline();

    setTimeout(() => {
        const cutoff = Date.now() - (48 * 60 * 60 * 1000); // 48 hours
        messagesRef.orderByChild('timestamp').endAt(cutoff).once('value', (snap) => {
            snap.forEach((child) => {
                child.ref.remove();
            });
        });
    }, 5000);
};