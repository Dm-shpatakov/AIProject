(function () {
    "use strict";

        const firebaseConfig = {
    apiKey: "AIzaSyCQTxLVX7slgDA0NHPkprz-7PuPZRhOJwE",
    authDomain: "aiproject1-4f3fa.firebaseapp.com",
    databaseURL: "https://aiproject1-4f3fa-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "aiproject1-4f3fa",
    storageBucket: "aiproject1-4f3fa.firebasestorage.app",
    messagingSenderId: "795151805871",
    appId: "1:795151805871:web:44b33fa90cb8609b55d35a"
    };

    firebase.initializeApp(firebaseConfig);
    const db   = firebase.database();
    const auth = firebase.auth();

    // ─── 2) STATE ──────────────────────────────────────────────────────
    const COLORS = ["#c6ff3d","#ff6b5b","#79e0ff","#ffcf6b","#c79bff","#5bff9d","#ff9d5b"];

    let currentUser    = null;
    let currentChat    = "public";
    let listenerRef    = null;
    let presenceListenerRef = null;
    let renderedKeys   = new Set();
    let lastDay        = null;
    let lastSentAt     = 0;

    let username  = localStorage.getItem("vc_username") || "ghost-" + Math.floor(Math.random() * 9999);
    let userColor = localStorage.getItem("vc_color")    || COLORS[Math.floor(Math.random() * COLORS.length)];
    let userBio   = localStorage.getItem("vc_bio")      || "just passing through";

    let $messages, $input, $onlineNum, $onlineList, $meName, $meAvatar, $connStatus, $shell, $backBtn;

    // ─── 3) UTILS ──────────────────────────────────────────────────────
    const esc = (str) => {
        const d = document.createElement("div");
        d.textContent = str == null ? "" : str;
        return d.innerHTML;
    };

    const linkify = (text) =>
        esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    const fmtTime = (ts) =>
        new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const fmtDay = (ts) => {
        const d = new Date(ts);
        const today = new Date();
        const yest  = new Date(); yest.setDate(today.getDate() - 1);
        const same  = (a, b) => a.toDateString() === b.toDateString();
        if (same(d, today)) return "today";
        if (same(d, yest))  return "yesterday";
        return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    };

    const initials = (name) => (name || "??").trim().slice(0, 2).toUpperCase();
    const chatId   = (a, b) => [a, b].sort().join("_");

    const toast = (msg, type) => {
        document.querySelectorAll(".toast").forEach((t) => t.remove());
        const t = document.createElement("div");
        t.className = "toast" + (type === "error" ? " error" : "");
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add("show"));
        setTimeout(() => {
            t.classList.remove("show");
            setTimeout(() => t.remove(), 300);
        }, 2400);
    };

    const normalizeUsername = (raw) =>
        (raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);

    // ─── 4) AUTH ───────────────────────────────────────────────────────
    function initAuth() {
        return new Promise((resolve, reject) => {
            auth.onAuthStateChanged(async (user) => {
                if (user) return resolve(user);
                try { await auth.signInAnonymously(); }
                catch (e) { console.error(e); reject(e); }
            });
        });
    }

    // ─── 5) PROFILE SYNC ───────────────────────────────────────────────
    async function saveUser() {
        if (!currentUser) return;
        const norm = normalizeUsername(username);
        if (!norm) throw new Error("invalid username");

        const existing = await db.ref("usernames/" + norm).get();
        if (existing.exists() && existing.val() !== currentUser.uid) {
            throw new Error("username taken");
        }

        const oldNorm = localStorage.getItem("vc_norm");
        if (oldNorm && oldNorm !== norm) {
            await db.ref("usernames/" + oldNorm).remove().catch(() => {});
        }

        await db.ref("users/" + currentUser.uid).set({
            uid:           currentUser.uid,
            username,
            usernameLower: norm,
            color:         userColor,
            bio:           userBio,
            lastSeen:      firebase.database.ServerValue.TIMESTAMP
        });
        await db.ref("usernames/" + norm).set(currentUser.uid);

        localStorage.setItem("vc_username", username);
        localStorage.setItem("vc_color",    userColor);
        localStorage.setItem("vc_bio",      userBio);
        localStorage.setItem("vc_norm",     norm);

        renderMe();
    }

    function renderMe() {
        $meName.textContent   = "@" + username;
        $meName.style.color   = userColor;
        $meAvatar.textContent = initials(username);
        $meAvatar.style.color = userColor;
        $meAvatar.style.borderColor = userColor + "55";
        $meAvatar.style.background  = userColor + "10";
    }

    // ─── 6) PRESENCE ───────────────────────────────────────────────────
    function setupPresence() {
        const connectedRef = db.ref(".info/connected");

        connectedRef.on("value", (snap) => {
            const online = snap.val() === true;
            setConnStatus(online ? "online" : "offline");
            if (!online) return;

            const presRef = db.ref("presence/" + currentUser.uid);
            presRef.onDisconnect().remove();
            presRef.set({
                uid:      currentUser.uid,
                username,
                color:    userColor,
                last:     firebase.database.ServerValue.TIMESTAMP
            });
        });

        if (presenceListenerRef) presenceListenerRef.off();
        presenceListenerRef = db.ref("presence");
        presenceListenerRef.on("value", (snap) => {
            const list = [];
            snap.forEach((c) => list.push(c.val()));
            $onlineNum.textContent = list.length;
            renderOnlineList(list);
        });
    }

    function renderOnlineList(list) {
        const me     = list.find((u) => u.uid === currentUser.uid);
        const others = list.filter((u) => u.uid !== currentUser.uid)
                           .sort((a, b) => (a.username || "").localeCompare(b.username || ""));
        const ordered = me ? [me, ...others] : others;

        if (ordered.length === 0) {
            $onlineList.innerHTML = '<div class="online-empty">no one in the void…</div>';
            return;
        }

        $onlineList.innerHTML = ordered.map((u) => {
            const isMe = u.uid === currentUser.uid;
            const action = isMe ? "you" : "→";
            const onclick = isMe ? "VC.showProfilePanel()" : "VC.openDM('" + u.uid + "')";
            return (
                '<div class="u-card" onclick="' + onclick + '">' +
                    '<div class="av" style="color:' + u.color + '; border-color:' + u.color + '55; background:' + u.color + '10">' +
                        esc(initials(u.username)) +
                    '</div>' +
                    '<div class="stack">' +
                        '<div class="name" style="color:' + u.color + '">@' + esc(u.username) + '</div>' +
                        '<div class="bio">' + (isMe ? "this is you" : "click to DM") + '</div>' +
                    '</div>' +
                    '<span class="arrow">' + action + '</span>' +
                '</div>'
            );
        }).join("");
    }

    function setConnStatus(state) {
        if (!$connStatus) return;
        $connStatus.classList.remove("connecting", "online", "offline");
        $connStatus.classList.add(state);
        const label = $connStatus.querySelector(".conn-label");
        if (label) label.textContent = state === "online" ? "online" : state === "offline" ? "offline" : "connecting…";
    }

    // ─── 7) MESSAGES ───────────────────────────────────────────────────
    function chatRef() {
        return currentChat === "public"
            ? db.ref("publicMessages")
            : db.ref("dms/" + chatId(currentUser.uid, currentChat));
    }

    async function sendMessage() {
        const text = $input.value.trim();
        if (!text) return;
        if (text.length > 500) return toast("max 500 chars", "error");

        const now = Date.now();
        if (now - lastSentAt < 600) return toast("slow down", "error");
        lastSentAt = now;

        const payload = {
            uid:       currentUser.uid,
            username,
            color:     userColor,
            text,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };

        try {
            await chatRef().push(payload);
            $input.value = "";
            updateCharCount();
        } catch (e) {
            console.error(e);
            toast("failed to send", "error");
        }
    }

    function clearMessagesUI() {
        $messages.innerHTML = "";
        renderedKeys = new Set();
        lastDay = null;
    }

    function renderMessage(key, m) {
        if (renderedKeys.has(key)) return;
        renderedKeys.add(key);

        const emptyEl = $messages.querySelector(".empty");
        if (emptyEl) emptyEl.remove();

        const ts = m.timestamp || Date.now();

        const day = fmtDay(ts);
        if (day !== lastDay) {
            lastDay = day;
            const sep = document.createElement("div");
            sep.className = "day-divider";
            sep.textContent = day;
            $messages.appendChild(sep);
        }

        const isMine = m.uid === currentUser.uid;
        const el = document.createElement("div");
        el.className = "msg" + (isMine ? " own" : "");
        el.innerHTML =
            '<div class="msg-head">' +
                '<span class="msg-name" style="color:' + (m.color || "var(--lime)") + '">' +
                    (isMine ? "you" : "@" + esc(m.username)) +
                '</span>' +
                '<span class="msg-time">' + fmtTime(ts) + '</span>' +
            '</div>' +
            '<div class="msg-text">' + linkify(m.text || "") + '</div>';

        $messages.appendChild(el);
        $messages.scrollTop = $messages.scrollHeight;
    }

    function loadChat() {
        if (listenerRef) { listenerRef.off(); listenerRef = null; }

        clearMessagesUI();
        $messages.innerHTML =
            '<div class="empty">' +
                '<div class="empty-glyph">◌</div>' +
                '<div class="empty-text">loading the signal…</div>' +
            '</div>';

        const ref = chatRef().limitToLast(100);
        listenerRef = ref;
        ref.on("child_added", (snap) => renderMessage(snap.key, snap.val()));
    }

    // ─── 8) CHAT MODES ─────────────────────────────────────────────────
    function openPublicChat() {
        currentChat = "public";
        document.getElementById("chat-title").textContent = "public channel";
        document.getElementById("chat-hint").textContent  = "everyone with the link can read & write";
        $backBtn.classList.remove("visible");
        if ($shell) $shell.classList.remove("show-chat");
        loadChat();
    }

    async function openDM(uid) {
        if (uid === currentUser.uid) return toast("can't DM yourself", "error");

        const snap = await db.ref("users/" + uid).get();
        if (!snap.exists()) return toast("user not found", "error");

        const u = snap.val();
        currentChat = uid;
        document.getElementById("chat-title").innerHTML =
            'dm with <span style="color:' + u.color + '">@' + esc(u.username) + '</span>';
        document.getElementById("chat-hint").textContent = "private — only you two can see this";
        $backBtn.classList.add("visible");
        if ($shell) $shell.classList.add("show-chat");

        document.getElementById("search-results").innerHTML = "";
        document.getElementById("user-search").value = "";

        loadChat();
    }

    // ─── 9) SEARCH ─────────────────────────────────────────────────────
    async function searchUser() {
        const raw = document.getElementById("user-search").value;
        const q   = normalizeUsername(raw);
        const out = document.getElementById("search-results");

        if (!q) { out.innerHTML = ""; return; }

        out.innerHTML = '<div class="u-empty">searching…</div>';
        try {
            const snap = await db.ref("usernames/" + q).get();
            if (!snap.exists()) {
                out.innerHTML = '<div class="u-empty">no soul named "' + esc(q) + '"</div>';
                return;
            }
            const uid = snap.val();
            const userSnap = await db.ref("users/" + uid).get();
            if (!userSnap.exists()) {
                out.innerHTML = '<div class="u-empty">user data missing</div>';
                return;
            }
            const u = userSnap.val();
            const isMe = uid === currentUser.uid;
            const onclick = isMe ? "VC.showProfilePanel()" : "VC.openDM('" + uid + "')";
            out.innerHTML =
                '<div class="u-card" onclick="' + onclick + '">' +
                    '<div class="av" style="color:' + u.color + '; border-color:' + u.color + '55; background:' + u.color + '10">' +
                        esc(initials(u.username)) +
                    '</div>' +
                    '<div class="stack">' +
                        '<div class="name" style="color:' + u.color + '">@' + esc(u.username) + '</div>' +
                        '<div class="bio">' + esc(u.bio || "no bio") + '</div>' +
                    '</div>' +
                    '<span class="arrow">' + (isMe ? "you" : "→") + '</span>' +
                '</div>';
        } catch (e) {
            console.error(e);
            out.innerHTML = '<div class="u-empty">search failed</div>';
        }
    }

    // ─── 10) PROFILE MODAL ─────────────────────────────────────────────
    function showProfilePanel() {
        const root = document.getElementById("modal-root");
        const swatches = COLORS.map((c) =>
            '<div class="color-swatch ' + (c === userColor ? "active" : "") + '" style="background:' + c + '" data-color="' + c + '"></div>'
        ).join("");

        root.innerHTML =
            '<div class="modal">' +
                '<div class="modal-panel">' +
                    '<div class="modal-title">edit your shadow</div>' +
                    '<div class="modal-sub">you are anonymous — but you can still have style</div>' +

                    '<div class="field">' +
                        '<label>username</label>' +
                        '<input id="p-username" maxlength="24" value="' + esc(username) + '" />' +
                    '</div>' +

                    '<div class="field">' +
                        '<label>bio</label>' +
                        '<textarea id="p-bio" maxlength="160">' + esc(userBio) + '</textarea>' +
                    '</div>' +

                    '<div class="field">' +
                        '<label>accent color</label>' +
                        '<div class="color-grid" id="p-colors">' + swatches + '</div>' +
                    '</div>' +

                    '<div class="modal-actions">' +
                        '<button class="btn ghost" onclick="VC.closeProfilePanel()">cancel</button>' +
                        '<button class="btn primary" onclick="VC.saveProfile()">save</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        root.querySelectorAll(".color-swatch").forEach((sw) => {
            sw.addEventListener("click", () => {
                root.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
                sw.classList.add("active");
                userColor = sw.dataset.color;
            });
        });

        root.querySelector(".modal").addEventListener("click", (e) => {
            if (e.target.classList.contains("modal")) closeProfilePanel();
        });
    }

    function closeProfilePanel() {
        document.getElementById("modal-root").innerHTML = "";
    }

    async function saveProfile() {
        const newName = document.getElementById("p-username").value.trim();
        const newBio  = document.getElementById("p-bio").value.trim();
        const norm    = normalizeUsername(newName);

        if (!norm || norm.length < 2) return toast("username too short", "error");
        if (norm.length > 24)         return toast("username too long", "error");

        const prev = { username, userBio };
        username = norm;
        userBio  = newBio;

        try {
            await saveUser();
            closeProfilePanel();
            toast("profile saved");
        } catch (e) {
            username = prev.username;
            userBio  = prev.userBio;
            console.error(e);
            toast(e.message === "username taken" ? "username already taken" : "save failed", "error");
        }
    }

    // ─── 11) MISC UI ───────────────────────────────────────────────────
    function updateCharCount() {
        const left = 500 - $input.value.length;
        const el = document.getElementById("char-count");
        el.textContent = left;
        el.className = "char-count" + (left < 40 ? " danger" : left < 100 ? " warn" : "");
    }

    function copyShareLink() {
        const url = window.location.origin + window.location.pathname;
        navigator.clipboard.writeText(url).then(
            () => toast("link copied — share it!"),
            () => toast("copy failed", "error")
        );
    }

    // ─── 12) PARTICLES ─────────────────────────────────────────────────
    function initParticles() {
        const canvas = document.getElementById("particles");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let W, H, parts;

        const resize = () => {
            W = canvas.width  = window.innerWidth;
            H = canvas.height = window.innerHeight;
        };
        const mk = () => ({
            x:  Math.random() * W,
            y:  Math.random() * H,
            r:  Math.random() * 1.4 + 0.3,
            dx: (Math.random() - 0.5) * 0.18,
            dy: -(Math.random() * 0.25 + 0.06),
            a:  Math.random() * 0.6 + 0.1
        });

        resize();
        parts = Array.from({ length: 70 }, mk);
        window.addEventListener("resize", resize);

        (function draw() {
            ctx.clearRect(0, 0, W, H);
            for (const p of parts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(198,255,61," + (p.a * 0.55) + ")";
                ctx.fill();
                p.x += p.dx; p.y += p.dy;
                if (p.y < -4 || p.x < -4 || p.x > W + 4) {
                    Object.assign(p, mk());
                    p.y = H + 4;
                }
            }
            requestAnimationFrame(draw);
        })();
    }

    // ─── 13) BOOT ──────────────────────────────────────────────────────
    async function boot() {
        $messages    = document.getElementById("messages");
        $input       = document.getElementById("message-input");
        $onlineNum   = document.getElementById("online-num");
        $onlineList  = document.getElementById("online-list");
        $meName      = document.getElementById("me-name");
        $meAvatar    = document.getElementById("me-avatar");
        $connStatus  = document.getElementById("conn-status");
        $shell       = document.querySelector(".shell");
        $backBtn     = document.getElementById("back-btn");

        $input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        $input.addEventListener("input", updateCharCount);
        document.getElementById("user-search").addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); searchUser(); }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeProfilePanel();
        });

        renderMe();
        initParticles();

        try {
            currentUser = await initAuth();
            username = normalizeUsername(username) || "ghost-" + Math.floor(Math.random() * 9999);
            try {
                await saveUser();
            } catch (e) {
                if (e.message === "username taken") {
                    username = username + "-" + Math.floor(Math.random() * 999);
                    await saveUser();
                } else {
                    throw e;
                }
            }
            setupPresence();
            loadChat();
        } catch (e) {
            console.error(e);
            toast("failed to connect to the void", "error");
            setConnStatus("offline");
        }
    }

    window.addEventListener("DOMContentLoaded", boot);

    window.VC = {
        sendMessage,
        searchUser,
        openDM,
        openPublicChat,
        showProfilePanel,
        closeProfilePanel,
        saveProfile,
        copyShareLink
    };
})();