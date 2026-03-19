let peer;
let fileData;
let fileName;

// Utility to set status messages
const setStatus = (elementId, message, isError = false) => {
    const statusEl = document.getElementById(elementId);
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = isError ? '#ef4444' : '#9ca3af'; // Red for error, gray for normal
    }
};

// Attaches the global connection status listeners to the peer object
const attachConnectionListeners = (peerObject) => {
    const statusContainer = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-status-text');

    peerObject.on('open', id => {
        statusContainer.classList.add('connected');
        statusText.textContent = 'Connected to signaling server';
    });

    peerObject.on('error', err => {
        statusContainer.classList.remove('connected');
        statusText.textContent = `Connection error: ${err.type}. Please refresh.`;
        console.error("PeerJS error:", err);
    });

    peerObject.on('disconnected', () => {
        statusContainer.classList.remove('connected');
        statusText.textContent = 'Disconnected. Please refresh.';
    });
};


// --- SENDER LOGIC ---

function createRoomAndShare() {
    const roomKey = document.getElementById('sender-room-key').value;
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!roomKey) {
        setStatus('sender-status', 'Please create a room key.', true);
        return;
    }
    if (!file) {
        setStatus('sender-status', 'Please select a file.', true);
        return;
    }

    // Destroy the old peer object if it exists to start fresh
    if (peer) {
        peer.destroy();
    }

    // Create a new peer with the user-defined room key
    peer = new Peer(roomKey);
    
    // IMPORTANT: Re-attach the main connection status listeners to the new peer object
    attachConnectionListeners(peer);

    peer.on('open', id => {
        setStatus('sender-status', 'Room created. Waiting for peer...');
        fileName = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            fileData = e.target.result;
        };
        reader.readAsArrayBuffer(file);
    });

    peer.on('connection', conn => {
        setStatus('sender-status', 'Peer connected. Sending file...');
        conn.on('data', data => {
            if (data === 'request-file' && fileData) {
                conn.send({ fileData, fileName });
                setStatus('sender-status', 'File sent successfully!');
                setTimeout(() => conn.close(), 500);
            }
        });
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            setStatus('sender-status', 'Room key is already taken. Try another.', true);
        } else {
             // The global listener will handle the main status display
            console.error("Sender PeerJS error:", err);
        }
    });
}


// --- RECEIVER LOGIC ---

function connectAndDownload() {
    const roomKey = document.getElementById('receiver-room-key').value;
    if (!roomKey) {
        setStatus('receiver-status', 'Please enter a room key.', true);
        return;
    }

    // If the receiver's peer isn't initialized, do it now.
    if (!peer || peer.destroyed) {
        peer = new Peer();
        attachConnectionListeners(peer);
    }

    setStatus('receiver-status', 'Connecting to peer...');
    const conn = peer.connect(roomKey);

    conn.on('open', () => {
        setStatus('receiver-status', 'Connection established. Requesting file...');
        conn.send('request-file');
    });

    conn.on('data', data => {
        setStatus('receiver-status', 'File received. Preparing download...');
        const blob = new Blob([data.fileData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.fileName || 'downloaded_file';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('receiver-status', 'Download complete!');
    });

    conn.on('error', err => {
        console.error('Connection error:', err);
        setStatus('receiver-status', 'Connection failed. Check the key.', true);
    });
}

// Initialize the peer connection when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // This initial peer is primarily for the receiver or the initial state
    if (!peer) {
        peer = new Peer();
        attachConnectionListeners(peer);
    }
});

