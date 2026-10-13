import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { createDecartClient, decodeClientToken } from '@decartai/sdk';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

const getDecartApiKey = (): string | null => {
  const candidates = [
    process.env.Live,
    process.env.LIVE,
    process.env.live,
    process.env.DECART_API_KEY,
  ];

  for (const val of candidates) {
    const trimmed = val?.trim();
    if (
      trimmed &&
      trimmed !== 'MY_DECART_API_KEY' &&
      trimmed.startsWith('dct_') &&
      trimmed.length > 8
    ) {
      return trimmed;
    }
  }

  for (const [k, v] of Object.entries(process.env)) {
    if (v && typeof v === 'string') {
      const trimmed = v.trim();
      if (
        trimmed &&
        trimmed !== 'MY_DECART_API_KEY' &&
        trimmed.startsWith('dct_') &&
        trimmed.length > 8
      ) {
        return trimmed;
      }
    }
  }

  return null;
};

const getSimliApiKey = (): { key: string; secretName: string } | null => {
  const explicitCandidates: Array<[string, string | undefined]> = [
    ['Simli', process.env.Simli],
    ['SIMLI', process.env.SIMLI],
    ['simli', process.env.simli],
    ['SIMLI_API_KEY', process.env.SIMLI_API_KEY],
  ];

  for (const [name, val] of explicitCandidates) {
    const trimmed = val?.trim();
    if (trimmed && trimmed !== 'MY_SIMLI_API_KEY' && trimmed.length > 6) {
      return { key: trimmed, secretName: name };
    }
  }

  for (const [k, v] of Object.entries(process.env)) {
    if (/simli/i.test(k.trim()) && v) {
      const trimmed = v.trim();
      if (trimmed && trimmed !== 'MY_SIMLI_API_KEY' && trimmed.length > 6) {
        return { key: trimmed, secretName: k.trim() };
      }
    }
  }

  // Si l'utilisateur a mis sa clé Simli directement dans son secret "Live" (qui ne commence pas par "dct_")
  const liveCandidates: Array<[string, string | undefined]> = [
    ['Live', process.env.Live],
    ['LIVE', process.env.LIVE],
    ['live', process.env.live],
  ];
  for (const [name, val] of liveCandidates) {
    const trimmed = val?.trim();
    if (
      trimmed &&
      trimmed !== 'MY_DECART_API_KEY' &&
      trimmed !== 'MY_SIMLI_API_KEY' &&
      !trimmed.startsWith('dct_') &&
      trimmed.length > 6
    ) {
      return { key: trimmed, secretName: name };
    }
  }

  return null;
};

// Statut du moteur Simli
app.get('/api/simli-status', async (_req, res) => {
  const found = getSimliApiKey();
  if (!found) {
    res.json({
      configured: false,
      secretName: null,
      keyPrefix: null,
      valid: false,
      serverMessage:
        'Ajoutez votre clé API Simli dans les Secrets sous le nom "Simli" (ou remplacez la valeur de "Live").',
    });
    return;
  }

  const keyPrefix = `${found.key.slice(0, 6)}…`;

  try {
    const iceRes = await fetch('https://api.simli.ai/compose/ice', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': found.key,
      },
    });

    if (!iceRes.ok) {
      const errText = await iceRes.text();
      res.json({
        configured: true,
        secretName: found.secretName,
        keyPrefix,
        valid: false,
        serverMessage: `Clé "${found.secretName}" refusée par Simli (${iceRes.status}): ${errText.slice(0, 120)}`,
      });
      return;
    }

    res.json({
      configured: true,
      secretName: found.secretName,
      keyPrefix,
      valid: true,
      serverMessage: null,
    });
  } catch (err) {
    res.json({
      configured: true,
      secretName: found.secretName,
      keyPrefix,
      valid: true,
      serverMessage: err instanceof Error ? err.message : null,
    });
  }
});

// Crée une session WebRTC Simli (session_token + serveurs ICE)
app.post('/api/simli-session', async (req, res) => {
  try {
    const found = getSimliApiKey();
    if (!found) {
      res.status(400).json({
        error:
          'Aucune clé API Simli détectée dans les Secrets. Créez un secret nommé "Simli" (ou mettez votre clé Simli dans "Live") avec votre clé gratuite de app.simli.com.',
      });
      return;
    }

    const {
      faceId = 'tmp9i8bbq7c',
      model = 'fasttalk',
      handleSilence = true,
      maxSessionLength = 3600,
      maxIdleTime = 300,
    } = (req.body || {}) as {
      faceId?: string;
      model?: 'fasttalk' | 'artalk';
      handleSilence?: boolean;
      maxSessionLength?: number;
      maxIdleTime?: number;
    };

    const tokenRes = await fetch('https://api.simli.ai/compose/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': found.key,
      },
      body: JSON.stringify({
        faceId: faceId.trim(),
        model,
        handleSilence,
        maxSessionLength,
        maxIdleTime,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      res.status(tokenRes.status).json({
        error: `Erreur Simli (${tokenRes.status}) : ${errText}`,
      });
      return;
    }

    const tokenJson = (await tokenRes.json()) as { session_token?: string };
    if (!tokenJson.session_token) {
      res.status(500).json({
        error: 'Simli n’a pas renvoyé de session_token.',
      });
      return;
    }

    let iceServers: unknown[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
    try {
      const iceRes = await fetch('https://api.simli.ai/compose/ice', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-simli-api-key': found.key,
        },
      });
      if (iceRes.ok) {
        const parsedIce = await iceRes.json();
        if (Array.isArray(parsedIce) && parsedIce.length > 0) {
          iceServers = parsedIce;
        }
      }
    } catch {
      // Fallback STUN
    }

    res.json({
      session_token: tokenJson.session_token,
      iceServers,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Impossible de démarrer la session Simli.',
    });
  }
});

// Vérifie la clé "Live" Decart AI ET teste si le compte Decart AI dispose de crédits actifs
app.get('/api/decart-status', async (_req, res) => {
  const apiKey = getDecartApiKey();
  if (!apiKey) {
    res.json({
      configured: false,
      keyPrefix: null,
      creditsOk: false,
      serverError: 'Clé Decart "Live" non détectée dans les Secrets.',
    });
    return;
  }

  const keyPrefix = `${apiKey.slice(0, 8)}…`;

  try {
    const client = createDecartClient({ apiKey });
    const tokenData = await client.tokens.create({ expiresIn: 120 });
    const claims = decodeClientToken(tokenData.token);

    const wsCheck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const wsUrl = `wss://api3.decart.ai/v1/stream?api_key=${encodeURIComponent(tokenData.apiKey)}&model=lucy-2.5&user_agent=diagnostic`;
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve({ ok: true });
      }, 2500);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'livekit_join', passthrough: true }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'error') {
            clearTimeout(timer);
            try {
              ws.close();
            } catch {}
            resolve({ ok: false, error: msg.error || 'Erreur serveur Decart' });
          } else if (
            msg.type === 'livekit_room_info' ||
            msg.type === 'queue_position'
          ) {
            clearTimeout(timer);
            try {
              ws.close();
            } catch {}
            resolve({ ok: true });
          }
        } catch {
          // Ignore
        }
      };

      ws.onclose = (e) => {
        clearTimeout(timer);
        if (e.code === 1008) {
          resolve({ ok: false, error: 'Insufficient credits' });
        } else {
          resolve({ ok: true });
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, error: 'Erreur réseau WebSocket' });
      };
    });

    res.json({
      configured: true,
      keyPrefix,
      apiKeyName: claims?.apiKeyName || 'Live',
      pool: claims?.pool || 'paid',
      creditsOk: wsCheck.ok,
      serverError: wsCheck.error || null,
    });
  } catch (err) {
    res.json({
      configured: true,
      keyPrefix,
      creditsOk: false,
      serverError:
        err instanceof Error ? err.message : 'Clé API refusée par Decart AI',
    });
  }
});

app.post('/api/realtime-token', async (_req, res) => {
  try {
    const apiKey = getDecartApiKey();
    if (!apiKey) {
      res.status(400).json({
        error: 'Clé Decart "Live" introuvable dans les Secrets.',
      });
      return;
    }

    const client = createDecartClient({
      apiKey,
    });

    const tokenData = await client.tokens.create({
      expiresIn: 300,
    });

    res.json({
      apiKey: tokenData.apiKey,
      token: tokenData.token,
    });
  } catch (error) {
    console.error('Error creating Decart realtime token:', error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Impossible de créer le jeton WebRTC Decart AI.',
    });
  }
});

app.post('/api/optimize-prompt', async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || !prompt.trim()) {
      res.json({ englishPrompt: '' });
      return;
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
      res.json({ englishPrompt: prompt.trim() });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Translate and optimize the following live video transformation instruction into concise English (maximum 200 characters) suitable for the Decart Lucy 2.5 real-time video editing model. Output ONLY the English prompt text, nothing else:\n"${prompt.trim()}"`,
    });

    const englishPrompt = response.text?.trim() || prompt.trim();
    res.json({ englishPrompt });
  } catch {
    res.json({ englishPrompt: req.body?.prompt || '' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
