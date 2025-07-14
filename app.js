const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const uploadDir = path.join(__dirname, 'uploads'); // Use absolute path for uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({ storage });

// Validate environment variables
const requiredEnvVars = ['GITHUB_TOKEN', 'REPO_OWNER', 'REPO_NAME', 'TELEGRAM_TOKEN', 'WEBHOOK_URL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Environment variable ${envVar} is missing.`);
    process.exit(1);
  }
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL.replace(/\/$/, ''); // Remove trailing slash

// Middleware to log incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

// Function to upload image to GitHub
async function uploadImageToGitHub(imagePath, repoOwner, repoName, uploadPath, githubToken, branch = 'main', commitMessage = 'Upload image via API') {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const encodedImage = imageBuffer.toString('base64');
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${uploadPath}`;
    const payload = {
      message: commitMessage,
      content: encodedImage,
      branch: branch,
    };
    const response = await axios.put(url, payload, {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    return response.data.content.download_url;
  } catch (error) {
    console.error('GitHub upload error:', error.message);
    throw error;
  }
}

// Endpoint to handle image uploads via HTTP
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }
    const uploadPath = `images/${Date.now()}_${req.file.originalname}`;
    const imageUrl = await uploadImageToGitHub(req.file.path, REPO_OWNER, REPO_NAME, uploadPath, GITHUB_TOKEN);
    await fs.unlink(req.file.path);
    res.json({ imageUrl });
  } catch (error) {
    console.error('Upload endpoint error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Telegram
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;
    if (update.message && update.message.photo) {
      const fileId = update.message.photo[update.message.photo.length - 1].file_id;
      const file = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
      const filePath = file.data.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
      const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
      const tempPath = path.join(__dirname, `temp_${Date.now()}.jpg`);
      await fs.writeFile(tempPath, response.data);
      const uploadPath = `images/${Date.now()}.jpg`;
      const imageUrl = await uploadImageToGitHub(tempPath, REPO_OWNER, REPO_NAME, uploadPath, GITHUB_TOKEN);
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: update.message.chat.id,
        text: `Image URL: ${imageUrl}`,
      });
      await fs.unlink(tempPath);
    } else if (update.message && update.message.text === '/start') {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: update.message.chat.id,
        text: 'Send an image to upload to GitHub!',
      });
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.sendStatus(500);
  }
});

// Endpoint to set Telegram webhook
app.get('/setWebhook', async (req, res) => {
  try {
    const webhookUrl = `${WEBHOOK_URL}/webhook/${TELEGRAM_TOKEN}`;
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${webhookUrl}`);
    console.log('Webhook set response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('Set webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to get webhook info (for debugging)
app.get('/getWebhookInfo', async (req, res) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo`);
    res.json(response.data);
  } catch (error) {
    console.error('Get webhook info error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    const webhookUrl = `${WEBHOOK_URL}/webhook/${TELEGRAM_TOKEN}`;
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${webhookUrl}`);
    console.log('Webhook set successfully:', response.data);
  } catch (error) {
    console.error('Failed to set webhook:', error.message);
  }
});

module.exports = app;
