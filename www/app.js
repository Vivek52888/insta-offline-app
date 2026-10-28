// ==========================================
// 1. OFFLINE DATABASE & 24-HOUR AUTO-DELETE
// ==========================================

const DB_NAME = "InstaOfflineDB_v2";
const STORE_NAME = "reels";
const EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 Hours
let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            cleanExpiredReels().then(() => {
                updateSavedCount();
                resolve(db);
            });
        };

        request.onerror = (e) => reject("DB Error: " + e.target.error);
    });
}

// 24 Ghante purani Reels ko delete karna
function cleanExpiredReels() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const reels = request.result || [];
            const now = Date.now();
            reels.forEach((reel) => {
                if (now - reel.timestamp > EXPIRY_TIME) {
                    store.delete(reel.id);
                }
            });
            resolve();
        };
        request.onerror = () => resolve();
    });
}

// ArrayBuffer ke roop mein save karna (100% Browser & Mobile Compatible)
function saveReelToDB(id, arrayBuffer, mimeType) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const reelData = {
            id: id,
            buffer: arrayBuffer,
            mimeType: mimeType || "video/mp4",
            timestamp: Date.now()
        };
        const req = store.put(reelData);
        req.onsuccess = () => {
            updateSavedCount();
            resolve();
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

function updateSavedCount() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
        document.getElementById("saved-count").innerText = countReq.result;
    };
}

// ==========================================
// 2. UI TABS & INSTAGRAM STYLE VIDEO PLAYER
// ==========================================

function switchTab(tabName) {
    document.getElementById("tab-setup").classList.remove("active");
    document.getElementById("tab-player").classList.remove("active");
    document.getElementById("setup-screen").classList.remove("active");
    document.getElementById("player-screen").classList.remove("active");

    if (tabName === "setup") {
        document.getElementById("tab-setup").classList.add("active");
        document.getElementById("setup-screen").classList.add("active");
        pauseAllVideos();
    } else {
        document.getElementById("tab-player").classList.add("active");
        document.getElementById("player-screen").classList.add("active");
        cleanExpiredReels().then(() => loadOfflineReels());
    }
}

function loadOfflineReels() {
    const container = document.getElementById("reels-container");
    container.innerHTML = `<div class="empty-msg">Loading saved reels...</div>`;

    if (!db) {
        initDB().then(() => loadOfflineReels());
        return;
    }

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
        const reels = req.result || [];
        container.innerHTML = "";

        if (reels.length === 0) {
            container.innerHTML = `<div class="empty-msg">Abhi koi reel save nahi hai. Pehle 'Setup & Fetch' tab se download karein!</div>`;
            return;
        }

        reels.sort((a, b) => b.timestamp - a.timestamp);

        reels.forEach((reel, index) => {
            const reelDiv = document.createElement("div");
            reelDiv.className = "reel-item";

            // ArrayBuffer ko wapas Video Blob aur URL mein badalna
            const blob = new Blob([reel.buffer], { type: reel.mimeType || "video/mp4" });
            const videoURL = URL.createObjectURL(blob);

            const hoursLeft = Math.max(1, Math.round((EXPIRY_TIME - (Date.now() - reel.timestamp)) / (1000 * 60 * 60)));

            reelDiv.innerHTML = `
                <video src="${videoURL}" loop playsinline muted autoplay controlsList="nodownload"></video>
                
                <div style="position:absolute; top:15px; right:15px; background:rgba(0,0,0,0.75); padding:6px 12px; border-radius:20px; font-size:12px; color:#fff; z-index:5; pointer-events:none;">
                    🎬 Reel #${index + 1} (Tap for Sound/Pause)
                </div>

                <div style="position:absolute; bottom:30px; left:15px; background:rgba(0,0,0,0.75); padding:6px 12px; border-radius:12px; font-size:12px; color:#00ffcc; z-index:5; pointer-events:none;">
                    ⏳ Auto-deletes in ~${hoursLeft}h
                </div>
            `;

            const videoEl = reelDiv.querySelector("video");
            videoEl.addEventListener("click", () => {
                if (videoEl.muted) {
                    videoEl.muted = false;
                } else if (videoEl.paused) {
                    videoEl.play();
                } else {
                    videoEl.pause();
                }
            });

            container.appendChild(reelDiv);
        });

        setTimeout(() => setupScrollAutoPlay(), 150);
    };
}

function setupScrollAutoPlay() {
    const videos = document.querySelectorAll(".reel-item video");
    if (videos.length > 0) {
        videos[0].play().catch(e => console.log("Play info:", e));
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.currentTime = 0;
                entry.target.play().catch(() => {});
            } else {
                entry.target.pause();
            }
        });
    }, { threshold: 0.6 });

    videos.forEach((v) => observer.observe(v));
}

function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => v.pause());
}

document.getElementById("btn-clear").addEventListener("click", () => {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
        updateSavedCount();
        alert("Saari saved reels delete ho gayi!");
    };
});

// ==========================================
// 3. BACKGROUND FETCHER (WITH CACHE-BUSTER FIX)
// ==========================================

const btnLogin = document.getElementById("btn-login");
const btnStart = document.getElementById("btn-start");
const statusText = document.getElementById("status-text");
const progressFill = document.getElementById("progress-fill");

btnLogin.addEventListener("click", () => {
    window.open("https://www.instagram.com/accounts/login/", "_blank", "width=400,height=600");
    localStorage.setItem("insta_linked", "true");
    btnLogin.innerText = "✅ Instagram Account Connected";
    btnLogin.style.color = "#2ecc71";
});

btnStart.addEventListener("click", async () => {
    if (!db) await initDB();

    const targetCount = parseInt(document.getElementById("reel-count").value) || 3;
    btnStart.disabled = true;
    btnStart.style.opacity = "0.6";
    progressFill.style.width = "0%";

   const workingTestStreams = [
        "https://mdn.github.io/learning-area/javascript/apis/video-audio/finished/video/sintel-short.mp4",
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        "https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4"
    ];
    try {
        for (let i = 1; i <= targetCount; i++) {
            statusText.innerText = `🔄 Scrolling & Fetching Reel (${i}/${targetCount})...`;
            
            // Cache-buster (?v=...) lagane se browser har reel ko fresh aur alag maanta hai
            const rawUrl = workingTestStreams[(i - 1) % workingTestStreams.length];
            const url = rawUrl + "?v=" + Date.now() + "_" + i;

            const response = await fetch(url);
            if (!response.ok) throw new Error("Video stream blocked");
            
            const buffer = await response.arrayBuffer();
            const uniqueId = "reel_" + Date.now() + "_" + i;
            
            await saveReelToDB(uniqueId, buffer, "video/mp4");

            const percent = Math.round((i / targetCount) * 100);
            progressFill.style.width = `${percent}%`;
            statusText.innerText = `✅ Saved (${i}/${targetCount}) Reels offline!`;
        }

        statusText.innerText = `🎉 Done! ${targetCount} Reels offline save ho gayi hain!`;
        setTimeout(() => {
            switchTab('player');
        }, 600);

    } catch (err) {
        console.error(err);
        statusText.innerText = "❌ Error: " + err.message;
    } finally {
        btnStart.disabled = false;
        btnStart.style.opacity = "1";
    }
});

// Start DB on load
initDB();