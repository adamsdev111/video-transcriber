import express from 'express';
import multer from 'multer';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3847;

// Basic Auth middleware
const AUTH_USER = process.env.AUTH_USER || 'Arvis';
const AUTH_PASS = process.env.AUTH_PASS || 'Arvis777';

app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Arvis Video Transcriber"');
    return res.status(401).send('Authentication required');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (user === AUTH_USER && pass === AUTH_PASS) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Arvis Video Transcriber"');
  return res.status(401).send('Invalid credentials');
});

// Telegram config
const TELEGRAM_BOT_TOKEN = '8551198821:AAG8shPqfDe9fSPpfKhfeSvyDRLumL4kWsw';
const TELEGRAM_CHAT_ID = '6867200416';

// Upload config - max 500MB
const upload = multer({ 
  dest: '/tmp/video-uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Serve static HTML
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arvis Video Transcriber</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 90%;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 { margin: 0 0 10px; font-size: 28px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .upload-area {
      border: 2px dashed rgba(255,255,255,0.3);
      border-radius: 15px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 20px;
    }
    .upload-area:hover, .upload-area.dragover {
      border-color: #667eea;
      background: rgba(102,126,234,0.1);
    }
    .upload-area.has-file {
      border-color: #48bb78;
      background: rgba(72,187,120,0.1);
    }
    input[type="file"] { display: none; }
    .btn {
      width: 100%;
      padding: 15px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, opacity 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 10px;
      display: none;
    }
    .status.show { display: block; }
    .status.processing { background: rgba(102,126,234,0.2); }
    .status.success { background: rgba(72,187,120,0.2); }
    .status.error { background: rgba(245,101,101,0.2); }
    .filename { font-size: 14px; color: #aaa; margin-top: 10px; }
    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s linear infinite;
      margin-right: 10px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://rackslabs.com/wp-content/uploads/2023/03/Logo-principal-Blanco-sin-fondo.svg" alt="Racks Labs" style="height: 40px;">
    </div>
    <h1>🎬 Video Transcriber</h1>
    <p class="subtitle">Sube un video y Arvis te envia la transcripcion por Telegram</p>
    
    <form id="uploadForm" enctype="multipart/form-data">
      <div class="upload-area" id="dropArea">
        <div>📹 Arrastra un video aqui o haz click para seleccionar</div>
        <div class="filename" id="filename"></div>
        <input type="file" id="fileInput" name="video" accept="video/*,.mkv,.avi,.mov,.mp4,.webm">
      </div>
      <button type="submit" class="btn" id="submitBtn" disabled>Transcribir Video</button>
    </form>
    
    <div class="status" id="status"></div>
  </div>

  <script>
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const filename = document.getElementById('filename');
    const submitBtn = document.getElementById('submitBtn');
    const status = document.getElementById('status');
    const form = document.getElementById('uploadForm');

    dropArea.onclick = () => fileInput.click();
    
    ['dragenter', 'dragover'].forEach(e => {
      dropArea.addEventListener(e, ev => { ev.preventDefault(); dropArea.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(e => {
      dropArea.addEventListener(e, ev => { ev.preventDefault(); dropArea.classList.remove('dragover'); });
    });
    
    dropArea.addEventListener('drop', e => {
      fileInput.files = e.dataTransfer.files;
      updateFile();
    });
    
    fileInput.onchange = updateFile;
    
    function updateFile() {
      if (fileInput.files.length) {
        const file = fileInput.files[0];
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        filename.textContent = file.name + ' (' + sizeMB + ' MB)';
        dropArea.classList.add('has-file');
        submitBtn.disabled = false;
      }
    }
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      status.className = 'status show processing';
      status.innerHTML = '<span class="spinner"></span> Procesando video... esto puede tardar unos minutos';
      
      const formData = new FormData();
      formData.append('video', fileInput.files[0]);
      
      try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.success) {
          status.className = 'status show success';
          status.textContent = '✅ ' + data.message;
        } else {
          throw new Error(data.error);
        }
      } catch (err) {
        status.className = 'status show error';
        status.textContent = '❌ Error: ' + err.message;
      }
      
      submitBtn.disabled = false;
    };
  </script>
</body>
</html>`);
});

// Handle upload
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: 'No se recibio ningun archivo' });
  }

  const videoPath = req.file.path;
  const originalName = req.file.originalname;
  
  try {
    // Send "processing" message to Telegram
    await sendTelegram(`🎬 Procesando video: ${originalName}...`);
    
    // Extract audio
    const audioPath = `/tmp/audio_${Date.now()}.mp3`;
    await execAsync(`ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}" -y`);
    
    // Get OpenAI key from keychain
    const { stdout: apiKey } = await execAsync('security find-generic-password -s "openai:default" -a "clawdbot" -w');
    
    // Transcribe with Whisper
    const { stdout: transcription } = await execAsync(`curl -s https://api.openai.com/v1/audio/transcriptions \
      -H "Authorization: Bearer ${apiKey.trim()}" \
      -F file="@${audioPath}" \
      -F model="whisper-1" \
      -F language="es" | jq -r '.text // .error.message'`);
    
    // Cleanup
    fs.unlinkSync(videoPath);
    fs.unlinkSync(audioPath);
    
    // Send transcription to Telegram (split if too long)
    const header = `📝 Transcripcion de: ${originalName}\n\n`;
    const fullText = header + transcription;
    
    if (fullText.length > 4000) {
      // Split into chunks
      const chunks = splitText(transcription, 3900);
      await sendTelegram(header + chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await sendTelegram(`(Parte ${i+1}/${chunks.length})\n\n${chunks[i]}`);
      }
    } else {
      await sendTelegram(fullText);
    }
    
    res.json({ success: true, message: 'Transcripcion enviada a Telegram!' });
    
  } catch (err) {
    console.error(err);
    // Cleanup on error
    try { fs.unlinkSync(videoPath); } catch {}
    await sendTelegram(`❌ Error procesando ${originalName}: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

function splitText(text, maxLen) {
  const chunks = [];
  while (text.length > maxLen) {
    let splitAt = text.lastIndexOf('. ', maxLen);
    if (splitAt === -1) splitAt = maxLen;
    chunks.push(text.slice(0, splitAt + 1));
    text = text.slice(splitAt + 1).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    })
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Video Transcriber running at http://localhost:${PORT}`);
});
