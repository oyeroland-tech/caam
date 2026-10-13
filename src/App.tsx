import React, { useState, useEffect, useRef } from 'react';
import {
  createDecartClient,
  models,
  resolveFpsNumber,
  type RealTimeClient,
  type ConnectionState,
  type RealTimeModels,
} from '@decartai/sdk';
import { SimliWebRTCClient } from './simliWebrtc';
import {
  Camera,
  Mic,
  Sparkles,
  Play,
  Square,
  FlipHorizontal2,
  Maximize2,
  Minimize2,
  PenLine,
  Image as ImageIcon,
  Hand,
  RotateCcw,
  Plus,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Cpu,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Volume2,
  VolumeX,
  Sliders,
  ShieldCheck,
} from 'lucide-react';

const FULL_APPEARANCE_BASE_INSTRUCTION =
  'Completely transform the person into the exact character shown in the reference image: match facial features, skin tone, hair, clothing, hands and arms. Seamless full-body replacement: whenever hands or arms appear in view, render them with the exact matching skin tone and character appearance, eliminating any raw camera background bleed-through or ghosting artifacts. Ensure fluid temporal consistency and natural motion. ';

export interface GesturePreset {
  id: string;
  emoji: string;
  label: string;
  prompt: string;
  description: string;
  isCustom?: boolean;
}

const DEFAULT_GESTURES: GesturePreset[] = [
  {
    id: 'wave',
    emoji: '👋',
    label: 'Saluer',
    prompt: 'Wave hand gently in a natural warm greeting gesture towards the camera while keeping character identity completely intact.',
    description: 'Fait signe de la main pour dire bonjour ou au revoir',
  },
  {
    id: 'cant-hear',
    emoji: '👂',
    label: 'Pas entendu',
    prompt: 'Cup hand to ear with an inquiring questioning expression, gesturing difficulty hearing clearly.',
    description: 'Main à l’oreille avec air interrogateur',
  },
  {
    id: 'thumbs-up',
    emoji: '👍',
    label: 'D’accord / Super',
    prompt: 'Give a clear confident thumbs up gesture with hand towards the camera with a friendly nod.',
    description: 'Pouce levé approbateur',
  },
  {
    id: 'nod-yes',
    emoji: '🤝',
    label: 'Hochement oui',
    prompt: 'Nod head affirmatively in calm understanding and agreement with warm polite smile.',
    description: 'Hochement de tête approbateur',
  },
  {
    id: 'thinking',
    emoji: '🤔',
    label: 'Réfléchir',
    prompt: 'Thoughtful pose, touching chin with finger looking slightly upward in reflection.',
    description: 'Main au menton l’air concentré',
  },
  {
    id: 'listen-shush',
    emoji: '🤫',
    label: 'Écouter attentivement',
    prompt: 'Raise index finger gently near lips gesturing to listen carefully.',
    description: 'Doigt levé pour demander l’écoute',
  },
  {
    id: 'reset-neutral',
    emoji: '🔄',
    label: 'Posture normale',
    prompt: 'Return to natural calm neutral conversation posture, hands resting down on desk, pleasant expression.',
    description: 'Revient à la posture assise calme et neutre',
  },
];

export interface SimliPresetFace {
  id: string;
  name: string;
  role: string;
  faceId: string;
}

const SIMLI_PRESET_FACES: SimliPresetFace[] = [
  {
    id: 'simli-jenna',
    name: 'Jenna (Officiel Simli)',
    role: 'Avatar HD Temps Réel',
    faceId: 'tmp9i8bbq7c',
  },
  {
    id: 'simli-tina',
    name: 'Tina (Pro Studio)',
    role: 'Avatar HD Temps Réel',
    faceId: 'cace3ef7-a4c4-425d-a8cf-a5358eb0c427',
  },
  {
    id: 'simli-laila',
    name: 'Laila (Naturel)',
    role: 'Avatar HD Temps Réel',
    faceId: 'b9e5fba3-071a-4e35-896e-211c4d6eaa7b',
  },
  {
    id: 'simli-kate',
    name: 'Kate (Corporate)',
    role: 'Avatar HD Temps Réel',
    faceId: 'd2a5c7c6-fed9-4f55-bcb3-062f7cd20103',
  },
];

export interface SavedAvatar {
  id: string;
  name: string;
  dataUrl: string;
  simliFaceId?: string;
}

interface DecartStatus {
  configured: boolean;
  keyPrefix: string | null;
  apiKeyName?: string;
  pool?: string;
  creditsOk: boolean;
  serverError: string | null;
}

interface SimliStatus {
  configured: boolean;
  secretName: string | null;
  keyPrefix: string | null;
  valid: boolean;
  serverMessage: string | null;
}

const STORAGE_KEY = 'facevo_pro_saved_avatars_v2';
const GESTURES_STORAGE_KEY = 'facevo_custom_gestures_v2';

export default function App() {
  const [activeEngine, setActiveEngine] = useState<'simli' | 'decart'>('decart');

  // Statuts des clés API
  const [simliStatus, setSimliStatus] = useState<SimliStatus>({
    configured: false,
    secretName: null,
    keyPrefix: null,
    valid: false,
    serverMessage: null,
  });
  const [decartStatus, setDecartStatus] = useState<DecartStatus>({
    configured: true,
    keyPrefix: 'dct_live…',
    apiKeyName: 'Live',
    pool: 'paid',
    creditsOk: false,
    serverError: null,
  });
  const [checkingKeys, setCheckingKeys] = useState<boolean>(false);

  // Paramètres Simli
  const [simliFaceId, setSimliFaceId] = useState<string>('tmp9i8bbq7c');
  const [simliModel, setSimliModel] = useState<'fasttalk' | 'artalk'>('fasttalk');
  const [simliTransport, setSimliTransport] = useState<'p2p' | 'livekit'>('p2p');
  const [simliMutedOutput, setSimliMutedOutput] = useState<boolean>(true);
  const [simliSpeaking, setSimliSpeaking] = useState<boolean>(false);
  const [micActive, setMicActive] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);

  // Paramètres Decart AI
  const [selectedModel, setSelectedModel] = useState<RealTimeModels>('lucy-2.5');
  const [preferredCodec, setPreferredCodec] = useState<'vp8' | 'h264'>('h264');
  const [autoHideLocalPreview, setAutoHideLocalPreview] = useState<boolean>(true);
  const [hideWatermarkCrop, setHideWatermarkCrop] = useState<boolean>(true);
  const [cropZoom, setCropZoom] = useState<number>(1.12);
  const [cropShiftY, setCropShiftY] = useState<number>(-2.5);
  const [showCropControls, setShowCropControls] = useState<boolean>(false);

  const [avatars, setAvatars] = useState<SavedAvatar[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [transformTab, setTransformTab] = useState<'gestures' | 'prompt'>('gestures');
  const [gestures, setGestures] = useState<GesturePreset[]>(() => {
    try {
      const raw = localStorage.getItem(GESTURES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_GESTURES;
  });
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);
  const [showAddGestureModal, setShowAddGestureModal] = useState<boolean>(false);
  const [newGestureEmoji, setNewGestureEmoji] = useState<string>('👋');
  const [newGestureLabel, setNewGestureLabel] = useState<string>('');
  const [newGesturePrompt, setNewGesturePrompt] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isApplyingLive, setIsApplyingLive] = useState<boolean>(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastDisconnectError, setLastDisconnectError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [liveSeconds, setLiveSeconds] = useState<number>(0);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [cleanVcamMode, setCleanVcamMode] = useState<boolean>(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAnalyserTimerRef = useRef<number | null>(null);
  const realtimeClientRef = useRef<RealTimeClient | null>(null);
  const simliClientRef = useRef<SimliWebRTCClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedAvatar =
    avatars.find((a) => a.id === selectedAvatarId) || avatars[0] || null;

  useEffect(() => {
    if (!selectedAvatarId && avatars.length > 0) {
      setSelectedAvatarId(avatars[0].id);
    }
  }, [avatars, selectedAvatarId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(avatars));
    } catch {
      // Ignore quota
    }
  }, [avatars]);

  useEffect(() => {
    try {
      localStorage.setItem(GESTURES_STORAGE_KEY, JSON.stringify(gestures));
    } catch {
      // Ignore quota
    }
  }, [gestures]);

  const checkAllStatuses = async () => {
    setCheckingKeys(true);
    try {
      const [simliRes, decartRes] = await Promise.all([
        fetch('/api/simli-status'),
        fetch('/api/decart-status'),
      ]);

      if (simliRes.ok) {
        const sData: SimliStatus = await simliRes.json();
        setSimliStatus(sData);
      }

      if (decartRes.ok) {
        const dData: DecartStatus = await decartRes.json();
        setDecartStatus(dData);
      }
    } catch {
      // Ignore
    } finally {
      setCheckingKeys(false);
    }
  };

  useEffect(() => {
    checkAllStatuses();
  }, []);

  useEffect(() => {
    if (connectionState !== 'generating' && connectionState !== 'connected') return;
    const timer = setInterval(() => {
      setLiveSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [connectionState]);

  useEffect(() => {
    return () => {
      realtimeClientRef.current?.disconnect();
      simliClientRef.current?.stop();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      cleanStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (micAnalyserTimerRef.current) {
        window.clearInterval(micAnalyserTimerRef.current);
      }
    };
  }, []);

  // --- Microphone pour Simli ---
  const enableMicrophone = async (): Promise<MediaStream | null> => {
    setCameraError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      micStreamRef.current = stream;
      setMicActive(true);
      setCameraError(null);

      // Si une session Simli tourne déjà, on branche immédiatement le micro dessus
      if (simliClientRef.current) {
        const track = stream.getAudioTracks()[0];
        if (track) {
          await simliClientRef.current.attachMicrophoneTrack(track).catch(() => {});
          setStatusBanner('Microphone branché en direct sur l’avatar Simli !');
        }
      }

      // En mode Éco CPU : ON, on évite la boucle d'analyse fréquentielle 10x/seconde
      if (!autoHideLocalPreview) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new AudioCtx();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const dataArr = new Uint8Array(analyser.frequencyBinCount);

          if (micAnalyserTimerRef.current) {
            window.clearInterval(micAnalyserTimerRef.current);
          }
          micAnalyserTimerRef.current = window.setInterval(() => {
            analyser.getByteFrequencyData(dataArr);
            let sum = 0;
            for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
            const avg = sum / dataArr.length;
            setMicLevel(Math.min(100, Math.round((avg / 90) * 100)));
          }, 120);
        } catch {
          // Ignore VU meter error
        }
      } else {
        setMicLevel(100);
      }

      return stream;
    } catch {
      setCameraError(
        'Accès micro bloqué par le cadre d’aperçu. Rafraîchissez la page (F5) pour activer la permission Microphone ajoutée, ou utilisez le bouton « Tester le mouvement des lèvres (Audio Démo) » ci-dessous.'
      );
      return null;
    }
  };

  const toggleMicrophone = async () => {
    if (micActive) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      if (micAnalyserTimerRef.current) {
        window.clearInterval(micAnalyserTimerRef.current);
        micAnalyserTimerRef.current = null;
      }
      setMicActive(false);
      setMicLevel(0);
      return;
    }
    await enableMicrophone();
  };

  // --- Caméra pour Decart AI ---
  const enableCamera = async (): Promise<MediaStream | null> => {
    setCameraError(null);
    try {
      const modelDef = models.realtime(selectedModel);
      const targetFps = resolveFpsNumber(modelDef.fps, 24);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: modelDef.width || 1280 },
          height: { ideal: modelDef.height || 720 },
          frameRate: { ideal: targetFps, max: 30 },
        },
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => {});
      }

      setCameraActive(true);
      return stream;
    } catch {
      setCameraError(
        'Impossible d’accéder à la caméra. Autorisez la caméra dans votre navigateur.'
      );
      return null;
    }
  };

  const toggleCamera = async () => {
    if (cameraActive) {
      if (connectionState !== 'disconnected' && activeEngine === 'decart') {
        stopLiveSession();
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setCameraActive(false);
      return;
    }
    await enableCamera();
  };

  const buildFullAppearancePrompt = (userText: string): string => {
    const trimmed = userText.trim();
    if (!trimmed) {
      return `${FULL_APPEARANCE_BASE_INSTRUCTION}Keep the exact pose, lip movements, facial expressions, clothing and background from the reference image.`;
    }
    return `${FULL_APPEARANCE_BASE_INSTRUCTION}${trimmed}`;
  };

  const handleTriggerGesture = async (gesture: GesturePreset) => {
    setActiveGestureId(gesture.id);
    setActivePresetId(gesture.id);
    if (gesture.id === 'reset-neutral') {
      setCustomPrompt('');
      await handleApplyTransformation('');
      setStatusBanner('Posture normale rétablie.');
      return;
    }
    setCustomPrompt(gesture.prompt);
    await handleApplyTransformation(gesture.prompt);
    setStatusBanner(`Action envoyée : ${gesture.emoji} ${gesture.label}`);
  };

  const handleAddCustomGesture = async () => {
    const label = newGestureLabel.trim();
    const rawPrompt = newGesturePrompt.trim();
    if (!label || !rawPrompt) return;

    let englishText = rawPrompt;
    try {
      const optRes = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: rawPrompt }),
      });
      if (optRes.ok) {
        const data = await optRes.json();
        if (data.englishPrompt) englishText = data.englishPrompt;
      }
    } catch {}

    const newG: GesturePreset = {
      id: `g-custom-${Date.now()}`,
      emoji: newGestureEmoji.trim() || '✨',
      label,
      prompt: englishText,
      description: rawPrompt,
      isCustom: true,
    };

    setGestures((prev) => [...prev, newG]);
    setNewGestureLabel('');
    setNewGesturePrompt('');
    setShowAddGestureModal(false);
    setStatusBanner(`Geste « ${newG.emoji} ${newG.label} » enregistré et prêt !`);
  };

  const handleDeleteCustomGesture = (id: string) => {
    setGestures((prev) => prev.filter((g) => g.id !== id));
    if (activeGestureId === id) {
      setActiveGestureId(null);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const maxDim = 768;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const cleanName =
          file.name.replace(/\.[^/.]+$/, '').slice(0, 22) || 'Avatar';
        const newAvatar: SavedAvatar = {
          id: `av-${Date.now()}`,
          name: cleanName,
          dataUrl: optimizedDataUrl,
          simliFaceId: simliFaceId,
        };

        setAvatars((prev) => [newAvatar, ...prev]);
        setSelectedAvatarId(newAvatar.id);
        setStatusBanner(`Avatar « ${cleanName} » importé et affiché au centre.`);

        if (
          activeEngine === 'decart' &&
          realtimeClientRef.current &&
          realtimeClientRef.current.isConnected()
        ) {
          try {
            setIsApplyingLive(true);
            const promptToSend = buildFullAppearancePrompt(customPrompt);
            await realtimeClientRef.current.setImage(optimizedDataUrl, {
              prompt: promptToSend,
              enhance: true,
            });
            setStatusBanner(`Apparence « ${cleanName} » envoyée en direct !`);
          } catch (err) {
            setStatusBanner(
              err instanceof Error
                ? err.message
                : 'Erreur lors du changement d’avatar.'
            );
          } finally {
            setIsApplyingLive(false);
          }
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSelectAvatar = async (avatar: SavedAvatar) => {
    setSelectedAvatarId(avatar.id);
    if (avatar.simliFaceId) {
      setSimliFaceId(avatar.simliFaceId);
    }
    if (
      activeEngine === 'decart' &&
      realtimeClientRef.current &&
      realtimeClientRef.current.isConnected()
    ) {
      try {
        setIsApplyingLive(true);
        const promptToSend = buildFullAppearancePrompt(customPrompt);
        await realtimeClientRef.current.setImage(avatar.dataUrl, {
          prompt: promptToSend,
          enhance: true,
        });
        setStatusBanner(`Apparence « ${avatar.name} » appliquée en direct !`);
      } catch (err) {
        setStatusBanner(
          err instanceof Error
            ? err.message
            : 'Impossible de changer l’apparence.'
        );
      } finally {
        setIsApplyingLive(false);
      }
    }
  };

  // --- Démarrage Moteur SIMLI (WebRTC Audio-to-Video Temps Réel) ---
  const startSimliLive = async () => {
    setStatusBanner(null);
    setLastDisconnectError(null);

    if (!remoteVideoRef.current || !remoteAudioRef.current) return;

    // On tente d'activer le micro, mais s'il est bloqué on lance QUAND MÊME le flux vidéo Simli !
    let activeMic = micStreamRef.current;
    if (!activeMic) {
      activeMic = await enableMicrophone();
    }

    try {
      setConnectionState('connecting');
      setLiveSeconds(0);

      const sessionRes = await fetch('/api/simli-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faceId: simliFaceId.trim() || 'tmp9i8bbq7c',
          model: simliModel,
          handleSilence: true,
          maxSessionLength: 3600,
          maxIdleTime: 300,
        }),
      });

      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData.session_token) {
        throw new Error(
          sessionData.error ||
            'Impossible de créer la session Simli. Vérifiez votre clé API Simli dans les Secrets.'
        );
      }

      const simliClient = new SimliWebRTCClient(
        remoteVideoRef.current,
        remoteAudioRef.current,
        {
          onConnected: () => {
            setConnectionState('generating');
            setStatusBanner(
              activeMic
                ? 'Simli Live connecté ! Parlez dans votre micro pour animer l’avatar en temps réel.'
                : 'Simli Live connecté ! Cliquez sur « Tester le mouvement des lèvres » à gauche ou rafraîchissez (F5) pour autoriser le micro.'
            );
          },
          onDisconnected: () => {
            setConnectionState('disconnected');
            setSimliSpeaking(false);
          },
          onSpeaking: () => setSimliSpeaking(true),
          onSilent: () => setSimliSpeaking(false),
          onError: (errMsg) => {
            setConnectionState('disconnected');
            setLastDisconnectError(`Erreur Simli : ${errMsg}`);
          },
        }
      );

      await simliClient.connect(sessionData, simliTransport);

      if (activeMic) {
        const audioTrack = activeMic.getAudioTracks()[0];
        if (audioTrack) {
          await simliClient.attachMicrophoneTrack(audioTrack).catch(() => {});
        }
      }

      simliClientRef.current = simliClient;
    } catch (err) {
      setConnectionState('disconnected');
      setLastDisconnectError(
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  // Envoie une impulsion vocale synthétique de 1,5 seconde pour tester le mouvement des lèvres Simli même sans parler
  const sendSimliDemoVoicePulse = () => {
    const client = simliClientRef.current;
    if (!client) return;
    const sampleRate = 16000;
    const durationSec = 1.5;
    const totalSamples = Math.floor(sampleRate * durationSec);
    const pcm = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const envelope = Math.sin(Math.PI * (t / durationSec)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4.5 * t));
      const carrier =
        0.6 * Math.sin(2 * Math.PI * 190 * t) +
        0.3 * Math.sin(2 * Math.PI * 520 * t) +
        0.1 * Math.sin(2 * Math.PI * 1100 * t);
      pcm[i] = Math.round(envelope * carrier * 18000);
    }
    client.sendRawPcm16(new Uint8Array(pcm.buffer));
    setStatusBanner('Signal vocal de test envoyé à l’avatar Simli !');
  };

  // --- Démarrage Moteur DECART AI ---
  const startDecartLive = async () => {
    setStatusBanner(null);
    setLastDisconnectError(null);

    if (!selectedAvatar && !customPrompt.trim()) {
      setStatusBanner(
        'Importez d’abord votre photo d’avatar via « + Ajouter un avatar » en bas.'
      );
      fileInputRef.current?.click();
      return;
    }

    let activeStream = localStreamRef.current;
    if (!activeStream) {
      activeStream = await enableCamera();
      if (!activeStream) return;
    }

    try {
      setConnectionState('connecting');
      setLiveSeconds(0);

      let englishText = customPrompt.trim();
      if (englishText) {
        const optRes = await fetch('/api/optimize-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: englishText }),
        });
        if (optRes.ok) {
          const { englishPrompt } = await optRes.json();
          if (englishPrompt) englishText = englishPrompt;
        }
      }

      const initialPrompt = buildFullAppearancePrompt(englishText);
      const modelDef = models.realtime(selectedModel);

      const client = createDecartClient({
        apiKeyProvider: async () => {
          const res = await fetch('/api/realtime-token', { method: 'POST' });
          const data = await res.json();
          if (!res.ok || !data.apiKey) {
            throw new Error(
              data.error || 'Échec de récupération du jeton Decart AI'
            );
          }
          return data.apiKey;
        },
      });

      const rtClient = await client.realtime.connect(activeStream, {
        model: modelDef,
        mirror: isMirrored,
        preferredVideoCodec: preferredCodec,
        resolution: '720p',
        speed: 'fast',
        retries: 0,
        queryParams: {
          watermark: 'false',
          branding: 'false',
          clean: 'true',
        },
        onRemoteStream: (transformedStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = transformedStream;
            remoteVideoRef.current.play().catch(() => {});
          }
        },
        onConnectionChange: (state) => {
          setConnectionState(state);
        },
        onQueuePosition: ({ position }) => {
          setStatusBanner(
            `Serveurs GPU sollicités — File d’attente position n°${position}…`
          );
        },
        initialState: {
          ...(selectedAvatar ? { image: selectedAvatar.dataUrl } : {}),
          prompt: {
            text: initialPrompt,
            enhance: true,
          },
        },
      });

      rtClient.on('sessionEnded', ({ reason }) => {
        setConnectionState('disconnected');
        if (reason === 'insufficient_credits' || reason === 'policy_violation') {
          setLastDisconnectError(
            'Le serveur Decart AI a coupé la session ("Insufficient credits" — Solde à 0,00 $). Basculez sur le moteur Simli (10 $ gratuits sans SMS) en haut de l’écran !'
          );
        } else {
          setLastDisconnectError(`Session terminée par le serveur (${reason}).`);
        }
      });

      rtClient.on('error', (err) => {
        setLastDisconnectError(`Erreur WebRTC : ${err.message}`);
      });

      realtimeClientRef.current = rtClient;
    } catch (error) {
      setConnectionState('disconnected');
      const rawMsg = error instanceof Error ? error.message : String(error);
      if (rawMsg.includes('1008') || rawMsg.toLowerCase().includes('insufficient')) {
        setLastDisconnectError(
          'Decart AI a refusé la session car le solde Decart est à 0,00 $ ("Insufficient credits"). Utilisez le moteur Simli (10 $ gratuits à l’inscription sans SMS) sélectionné en haut !'
        );
      } else {
        setLastDisconnectError(`Connexion interrompue : ${rawMsg}`);
      }
    }
  };

  const stopLiveSession = () => {
    if (realtimeClientRef.current) {
      realtimeClientRef.current.disconnect();
      realtimeClientRef.current = null;
    }
    if (simliClientRef.current) {
      simliClientRef.current.stop();
      simliClientRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setSimliSpeaking(false);
    setConnectionState('disconnected');
    setStatusBanner('Session arrêtée.');
  };

  const handleApplyTransformation = async (overridePrompt?: string) => {
    const rawText = overridePrompt !== undefined ? overridePrompt : customPrompt;
    setIsApplyingLive(true);

    try {
      let englishText = rawText;
      if (rawText.trim()) {
        const optRes = await fetch('/api/optimize-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: rawText }),
        });
        if (optRes.ok) {
          const { englishPrompt } = await optRes.json();
          if (englishPrompt) englishText = englishPrompt;
        }
      }

      const finalPrompt = buildFullAppearancePrompt(englishText);

      if (realtimeClientRef.current && realtimeClientRef.current.isConnected()) {
        await realtimeClientRef.current.setPrompt(finalPrompt, { enhance: true });
        setStatusBanner('Transformation appliquée en direct !');
      } else {
        setStatusBanner('Réglage enregistré pour le prochain démarrage.');
      }
    } catch (err) {
      setStatusBanner(
        err instanceof Error ? err.message : 'Impossible d’appliquer la transformation.'
      );
    } finally {
      setIsApplyingLive(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isLiveRunning =
    connectionState === 'connecting' ||
    connectionState === 'connected' ||
    connectionState === 'generating' ||
    connectionState === 'reconnecting';

  const promptCharCount = FULL_APPEARANCE_BASE_INSTRUCTION.length + customPrompt.length;

  return (
    <div className="h-dvh w-full flex flex-col bg-[#0B0D11] text-[#F1F5F9] overflow-hidden select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleAvatarUpload}
        className="hidden"
      />
      <audio ref={remoteAudioRef} autoPlay muted={simliMutedOutput} className="hidden" />

      {/* Top Bar Contrat 3 Zones */}
      <header className="h-14 border-b border-white/10 bg-[#11141B] px-4 sm:px-5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#FF5734] flex items-center justify-center font-display font-bold text-white text-sm">
            fE
          </div>
          <span className="font-display font-bold text-base tracking-tight text-white whitespace-nowrap">
            fac<span className="text-[#FF5734]">Evo</span> Direct Studio
          </span>
        </div>

        {/* Sélecteur de moteur en 1 clic : Simli (10$ Gratuits) vs Decart AI */}
        <div className="flex items-center gap-1 rounded-xl bg-[#0B0D11] border border-white/10 p-1">
          <button
            type="button"
            disabled={isLiveRunning}
            onClick={() => {
              setActiveEngine('simli');
              setLastDisconnectError(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeEngine === 'simli'
                ? 'bg-[#FF5734] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Moteur Simli (10 $ Gratuits · Sans SMS)</span>
          </button>
          <button
            type="button"
            disabled={isLiveRunning}
            onClick={() => {
              setActiveEngine('decart');
              setLastDisconnectError(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeEngine === 'decart'
                ? 'bg-[#FF5734] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Moteur Decart AI (Lucy 2.5)</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="hidden sm:inline text-xs font-mono tabular-nums text-slate-400">
            {formatTimer(liveSeconds)}
          </span>
          <button
            type="button"
            onClick={checkAllStatuses}
            disabled={checkingKeys}
            className="px-3 py-1.5 rounded-lg bg-[#1A202C] hover:bg-[#242B3B] border border-white/10 text-white text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${checkingKeys ? 'animate-spin' : ''}`} />
            <span>Vérifier ma clé</span>
          </button>
        </div>
      </header>

      {/* Espace principal */}
      <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 overflow-hidden">
        {!cleanVcamMode && (
          <div className="lg:w-[330px] xl:w-[360px] flex flex-col gap-3 shrink-0 overflow-y-auto pr-0.5">
            {activeEngine === 'simli' ? (
              <>
                {/* 1. Source Microphone Simli + Option Éco CPU : ON par défaut */}
                <div className="bg-[#12161F] rounded-2xl border border-white/10 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      1. Votre voix en direct
                    </span>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setAutoHideLocalPreview(!autoHideLocalPreview)}
                        className="text-[11px] font-mono text-emerald-400 hover:underline flex items-center gap-1"
                      >
                        {autoHideLocalPreview ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                        <span>{autoHideLocalPreview ? 'Éco CPU : ON' : 'Éco CPU : OFF'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSimliMutedOutput(!simliMutedOutput)}
                        className="text-[11px] font-mono text-slate-300 hover:text-white flex items-center gap-1"
                      >
                        {simliMutedOutput ? (
                          <>
                            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                            <span>Muet</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Son</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleMicrophone}
                    className={`w-full py-3.5 px-4 rounded-xl border flex items-center justify-between transition-colors cursor-pointer ${
                      micActive
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                        : 'bg-[#080A0E] border-white/10 hover:border-white/25 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Mic className={`w-4 h-4 ${micActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <div className="text-left">
                        <p className="text-xs font-semibold">
                          {micActive ? 'Microphone actif (Mode Éco CPU)' : 'Activer votre microphone'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {micActive
                            ? 'Parlez pour faire bouger les lèvres de l’avatar'
                            : 'Optionnel au démarrage (peut être activé après)'}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-emerald-400 tabular-nums">
                      {micActive ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  {cameraError && (
                    <p className="text-[11px] text-amber-400 leading-snug">{cameraError}</p>
                  )}
                </div>

                {/* 2. Configuration de l'Avatar Simli */}
                <section className="rounded-2xl border border-white/10 bg-[#12161F] p-3.5 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#FF7A5C]" />
                        <div>
                          <h2 className="text-xs font-semibold text-white">
                            2. Avatar Photoréaliste Simli
                          </h2>
                          <p className="text-[11px] text-slate-400">
                            Synchronisation labiale & mouvements 3D (&lt; 250 ms)
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Choix d'avatars officiels prêts à l'emploi */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] text-slate-300 font-medium">
                        Avatars HD prêts à l&rsquo;emploi :
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {SIMLI_PRESET_FACES.map((preset) => {
                          const isSelected = simliFaceId === preset.faceId;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              disabled={isLiveRunning}
                              onClick={() => setSimliFaceId(preset.faceId)}
                              className={`p-2 rounded-xl border text-left transition-colors ${
                                isSelected
                                  ? 'border-[#FF5734] bg-[#FF5734]/15 text-white'
                                  : 'border-white/10 bg-[#0B0D11] text-slate-300 hover:border-white/25'
                              }`}
                            >
                              <p className="text-xs font-semibold truncate">{preset.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono truncate">
                                {preset.faceId.slice(0, 11)}…
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Champ Face ID personnalisé (depuis app.simli.com) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-medium">
                          Ou collez votre propre <code className="font-mono text-[#FF7A5C]">faceId</code> :
                        </span>
                        <a
                          href="https://app.simli.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#FF7A5C] hover:underline flex items-center gap-1"
                        >
                          <span>Créer sur Simli</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <input
                        type="text"
                        value={simliFaceId}
                        disabled={isLiveRunning}
                        onChange={(e) => setSimliFaceId(e.target.value)}
                        placeholder="Ex: tmp9i8bbq7c"
                        className="w-full rounded-xl border border-white/10 bg-[#0B0D11] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#FF5734]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-xl bg-[#0B0D11] border border-white/10">
                        <label className="block text-[10px] text-slate-400 mb-0.5">
                          Modèle Lip-Sync
                        </label>
                        <select
                          value={simliModel}
                          disabled={isLiveRunning}
                          onChange={(e) =>
                            setSimliModel(e.target.value as 'fasttalk' | 'artalk')
                          }
                          className="w-full bg-transparent text-xs font-semibold text-white focus:outline-none"
                        >
                          <option value="fasttalk" className="bg-[#12161F]">
                            FastTalk (Ultra-rapide)
                          </option>
                          <option value="artalk" className="bg-[#12161F]">
                            ArtTalk (Expressif)
                          </option>
                        </select>
                      </div>

                      <div className="p-2 rounded-xl bg-[#0B0D11] border border-white/10">
                        <label className="block text-[10px] text-slate-400 mb-0.5">
                          Canal WebRTC
                        </label>
                        <select
                          value={simliTransport}
                          disabled={isLiveRunning}
                          onChange={(e) =>
                            setSimliTransport(e.target.value as 'p2p' | 'livekit')
                          }
                          className="w-full bg-transparent text-xs font-semibold text-emerald-400 focus:outline-none"
                        >
                          <option value="p2p" className="bg-[#12161F]">
                            P2P SFU (Direct)
                          </option>
                          <option value="livekit" className="bg-[#12161F]">
                            LiveKit Cloud
                          </option>
                        </select>
                      </div>
                    </div>

                    {isLiveRunning && (
                      <button
                        type="button"
                        onClick={sendSimliDemoVoicePulse}
                        className="w-full py-2 rounded-xl bg-[#1E2433] hover:bg-[#283044] border border-white/10 text-white text-xs font-semibold transition-colors"
                      >
                        Tester le mouvement des lèvres (Audio Démo)
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-white/10 space-y-1">
                    {simliStatus.configured ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Clé Simli &ldquo;{simliStatus.secretName}&rdquo; ({simliStatus.keyPrefix}) prête ✓
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Clé Simli à ajouter dans Secrets (nom : Simli)</span>
                      </div>
                    )}
                    {statusBanner && (
                      <p className="text-[11px] text-slate-300 leading-snug">{statusBanner}</p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              /* PANNEAU GAUCHE DECART AI */
              <>
                <div className="bg-[#12161F] rounded-2xl border border-white/10 p-3 space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-white">1. Votre caméra source</span>
                    <button
                      type="button"
                      onClick={() => setAutoHideLocalPreview(!autoHideLocalPreview)}
                      className="text-[11px] font-mono text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      {autoHideLocalPreview ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      <span>{autoHideLocalPreview ? 'Éco CPU : ON' : 'Éco CPU : OFF'}</span>
                    </button>
                  </div>

                  <div
                    onClick={toggleCamera}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggleCamera()}
                    className="w-full aspect-video rounded-xl overflow-hidden bg-[#080A0E] border border-white/10 hover:border-white/25 flex flex-col items-center justify-center relative cursor-pointer transition-colors"
                  >
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className={`w-full h-full object-cover ${isMirrored ? 'scale-x-[-1]' : ''} ${
                        !cameraActive || (isLiveRunning && autoHideLocalPreview) ? 'hidden' : ''
                      }`}
                    />

                    {!cameraActive && (
                      <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                        <Camera className="w-5 h-5 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-300">
                          Activer votre caméra
                        </span>
                      </div>
                    )}

                    {cameraActive && isLiveRunning && autoHideLocalPreview && (
                      <div className="flex flex-col items-center justify-center gap-1.5 p-4 text-center">
                        <Cpu className="w-5 h-5 text-emerald-400" />
                        <span className="text-xs font-medium text-white">
                          Retour local masqué (Mode Fluide)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <section className="rounded-2xl border border-white/10 bg-[#12161F] p-3.5 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#FF7A5C]" />
                        <div>
                          <h2 className="text-xs font-semibold text-white">
                            2. Transformer (Decart Lucy 2.5)
                          </h2>
                          <p className="text-[11px] text-slate-400">
                            Personnage, tenue, lèvres & décor
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-xl bg-[#0B0D11] border border-white/10">
                        <label className="block text-[10px] text-slate-400 mb-0.5">
                          Modèle Decart AI
                        </label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value as RealTimeModels)}
                          disabled={isLiveRunning}
                          className="w-full bg-transparent text-xs font-semibold text-white focus:outline-none"
                        >
                          <option value="lucy-2.1" className="bg-[#12161F]">
                            Lucy 2.1 (Ultra-Fluide · 30 FPS)
                          </option>
                          <option value="lucy-2.5" className="bg-[#12161F]">
                            Lucy 2.5 (HD · Photoréaliste)
                          </option>
                          <option value="lucy-vton-3.6" className="bg-[#12161F]">
                            Lucy VTON 3.6 (Tenue)
                          </option>
                        </select>
                      </div>

                      <div className="p-2 rounded-xl bg-[#0B0D11] border border-white/10">
                        <label className="block text-[10px] text-slate-400 mb-0.5">
                          Codec Vidéo Matériel
                        </label>
                        <select
                          value={preferredCodec}
                          onChange={(e) =>
                            setPreferredCodec(e.target.value as 'vp8' | 'h264')
                          }
                          disabled={isLiveRunning}
                          className="w-full bg-transparent text-xs font-semibold text-emerald-400 focus:outline-none"
                        >
                          <option value="h264" className="bg-[#12161F]">
                            H.264 (Accéléré GPU · Fluide)
                          </option>
                          <option value="vp8" className="bg-[#12161F]">
                            VP8 (Logiciel)
                          </option>
                        </select>
                      </div>
                    </div>

                    <div
                      className="flex gap-1 rounded-lg border border-white/10 bg-[#0B0D11] p-1"
                      role="tablist"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={transformTab === 'gestures'}
                        onClick={() => setTransformTab('gestures')}
                        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                          transformTab === 'gestures'
                            ? 'bg-[#FF5734] text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Hand className="w-3.5 h-3.5" />
                        <span>Gestes &amp; Mouvements</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={transformTab === 'prompt'}
                        onClick={() => setTransformTab('prompt')}
                        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors ${
                          transformTab === 'prompt'
                            ? 'bg-[#FF5734]/20 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <PenLine className="w-3.5 h-3.5 text-[#FF7A5C]" />
                        <span>Prompt</span>
                      </button>
                    </div>

                    {/* Onglet GESTES & MOUVEMENTS PRÉ-ENREGISTRÉS EN 1 CLIC */}
                    {transformTab === 'gestures' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-slate-300">
                            Cliquez sur une action pour animer l&rsquo;avatar en direct :
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowAddGestureModal(!showAddGestureModal)}
                            className="text-[11px] text-[#FF7A5C] hover:underline flex items-center gap-1 font-medium"
                          >
                            <Plus className="w-3 h-3" />
                            <span>{showAddGestureModal ? 'Fermer' : 'Créer un geste'}</span>
                          </button>
                        </div>

                        {/* Formulaire d'ajout d'une action personnalisée */}
                        {showAddGestureModal && (
                          <div className="p-3 rounded-xl bg-[#080A0E] border border-[#FF5734]/40 space-y-2.5">
                            <p className="text-xs font-semibold text-white">
                              Pré-enregistrer un nouveau mouvement :
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                maxLength={4}
                                value={newGestureEmoji}
                                onChange={(e) => setNewGestureEmoji(e.target.value)}
                                placeholder="👋"
                                className="w-12 text-center rounded-lg border border-white/10 bg-[#12161F] text-base p-1 focus:outline-none focus:border-[#FF5734]"
                              />
                              <input
                                type="text"
                                value={newGestureLabel}
                                onChange={(e) => setNewGestureLabel(e.target.value)}
                                placeholder="Nom (Ex: Coucou, Lever le doigt…)"
                                className="flex-1 rounded-lg border border-white/10 bg-[#12161F] px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#FF5734]"
                              />
                            </div>
                            <textarea
                              rows={2}
                              value={newGesturePrompt}
                              onChange={(e) => setNewGesturePrompt(e.target.value)}
                              placeholder="Que doit faire l'avatar ? (Ex: Faire un signe d'au revoir de la main en souriant)"
                              className="w-full resize-none rounded-lg border border-white/10 bg-[#12161F] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5734]"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setShowAddGestureModal(false)}
                                className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-white"
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={handleAddCustomGesture}
                                disabled={!newGestureLabel.trim() || !newGesturePrompt.trim()}
                                className="px-3 py-1 rounded-lg bg-[#FF5734] hover:bg-[#FF6B4A] text-white text-xs font-semibold disabled:opacity-50"
                              >
                                Enregistrer l&rsquo;action
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Grille des gestes disponibles */}
                        <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                          {gestures.map((gesture) => {
                            const isActive = activeGestureId === gesture.id;
                            return (
                              <button
                                key={gesture.id}
                                type="button"
                                onClick={() => handleTriggerGesture(gesture)}
                                className={`p-2.5 rounded-xl border text-left transition-all relative group cursor-pointer ${
                                  isActive
                                    ? 'border-[#FF5734] bg-[#FF5734]/20 shadow-md ring-1 ring-[#FF5734]'
                                    : 'border-white/10 bg-[#0B0D11] hover:border-white/30 hover:bg-[#12161F]'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <span className="text-xl leading-none select-none">
                                    {gesture.emoji}
                                  </span>
                                  {gesture.isCustom && (
                                    <span
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteCustomGesture(gesture.id);
                                      }}
                                      role="button"
                                      tabIndex={0}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-400 transition-opacity"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-semibold text-white mt-1 leading-tight">
                                  {gesture.label}
                                </p>
                                <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                                  {gesture.description}
                                </p>
                              </button>
                            );
                          })}
                        </div>

                        {/* Rétablir posture normale */}
                        {activeGestureId && activeGestureId !== 'reset-neutral' && (
                          <button
                            type="button"
                            onClick={() => {
                              const resetG = gestures.find((g) => g.id === 'reset-neutral');
                              if (resetG) handleTriggerGesture(resetG);
                              else handleApplyTransformation('');
                            }}
                            className="w-full py-1.5 px-3 rounded-xl border border-white/10 bg-[#1E2433] hover:bg-[#283044] text-slate-200 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                            <span>Revenir à la posture normale (Annuler le geste)</span>
                          </button>
                        )}
                      </div>
                    )}

                    {transformTab === 'prompt' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Français ou Anglais</span>
                          <span className="font-mono tabular-nums">{promptCharCount}/750</span>
                        </div>
                        <textarea
                          rows={2}
                          maxLength={671}
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          placeholder="Ex: Change the background to a beach."
                          className="w-full resize-none rounded-xl border border-white/10 bg-[#0B0D11] px-3 py-2 text-xs leading-relaxed text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5734]"
                        />
                        <button
                          type="button"
                          onClick={() => handleApplyTransformation()}
                          disabled={isApplyingLive}
                          className="w-full py-2 rounded-xl bg-[#1E2433] hover:bg-[#283044] border border-white/10 text-white text-xs font-semibold transition-colors"
                        >
                          {isApplyingLive ? 'Application…' : 'Appliquer au Live'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-white/10 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Clé Decart &ldquo;{decartStatus.apiKeyName || 'Live'}&rdquo; (
                        {decartStatus.keyPrefix || 'dct_live…'}) configurée
                      </span>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {/* Zone centrale : Écran vidéo WebRTC Temps Réel */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
          <div
            className={`flex-1 bg-[#080A0E] rounded-2xl border border-white/10 relative overflow-hidden flex items-center justify-center p-6 ${
              isFullscreen ? 'fixed inset-3 z-50' : ''
            }`}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{
                transform: hideWatermarkCrop
                  ? `${isMirrored ? 'scaleX(-1) ' : ''}scale(${cropZoom}) translateY(${cropShiftY}%)`
                  : isMirrored
                  ? 'scaleX(-1)'
                  : 'none',
                transformOrigin: 'center center',
              }}
              className={`w-full h-full transition-transform duration-200 ${
                hideWatermarkCrop ? 'object-cover' : 'object-contain'
              } ${
                connectionState === 'generating' || connectionState === 'connected'
                  ? 'block'
                  : 'hidden'
              }`}
            />

            {/* Masque physique opaque anti-filigrane au bas de la vidéo (Garantie 100% que rien ne dépasse) */}
            {hideWatermarkCrop && (connectionState === 'generating' || connectionState === 'connected') && (
              <div
                className="absolute bottom-0 left-0 right-0 pointer-events-none z-10 bg-[#080A0E]"
                style={{ height: '42px' }}
              />
            )}

            {/* Indicateur Anti-Filigrane en cours de Live */}
            {isLiveRunning && hideWatermarkCrop && (
              <div className="absolute top-3.5 right-3.5 z-20 px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/30 text-xs font-medium text-emerald-300 flex items-center gap-1.5 backdrop-blur-md shadow-lg">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Anti-Filigrane Actif (Rognage + Masque 100%)</span>
              </div>
            )}

            {isLiveRunning && activeEngine === 'simli' && (
              <div className="absolute top-3.5 left-3.5 z-20 px-3 py-1 rounded-lg bg-[#11141B]/90 border border-white/10 text-xs font-mono text-white flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    simliSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-emerald-400'
                  }`}
                />
                <span>
                  {simliSpeaking ? 'Avatar en train de parler…' : 'Simli Live — À l’écoute du micro'}
                </span>
              </div>
            )}

            {connectionState !== 'generating' && connectionState !== 'connected' && (
              <div className="max-w-lg w-full flex flex-col items-center text-center gap-4">
                {selectedAvatar && (
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="relative">
                      <img
                        src={selectedAvatar.dataUrl}
                        alt={selectedAvatar.name}
                        referrerPolicy="no-referrer"
                        className="h-44 sm:h-52 w-auto max-w-[240px] rounded-2xl object-cover border-2 border-[#FF5734] shadow-xl"
                      />
                      <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-md bg-[#FF5734] text-[10px] font-semibold text-white whitespace-nowrap shadow">
                        {activeEngine === 'simli'
                          ? `Simli FaceID : ${simliFaceId.slice(0, 10)}`
                          : 'Priorité : Image entière'}
                      </span>
                    </div>
                  </div>
                )}

                {activeEngine === 'simli' ? (
                  simliStatus.configured ? (
                    <div className="space-y-1.5">
                      <p className="text-sm font-display font-bold text-emerald-400">
                        Moteur Simli prêt — Clé secrète &ldquo;{simliStatus.secretName}&rdquo; (
                        {simliStatus.keyPrefix}) reconnue ✓
                      </p>
                      <p className="text-xs text-slate-300">
                        Cliquez sur <strong>« Démarrer le Live Simli »</strong> en bas à droite et
                        parlez dans votre microphone pour animer l&rsquo;avatar en temps réel.
                      </p>
                    </div>
                  ) : (
                    /* Guide rapide en 3 étapes pour activer les 10 $ gratuits de Simli sans SMS */
                    <div className="w-full rounded-2xl border border-[#FF5734]/40 bg-[#12161F] p-5 text-left space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-display font-bold uppercase tracking-wider text-[#FF7A5C]">
                          Activer vos 10 $ Gratuits Simli (Sans Carte ni SMS)
                        </span>
                        <a
                          href="https://app.simli.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-emerald-400 hover:underline flex items-center gap-1"
                        >
                          <span>Ouvrir app.simli.com</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>

                      <ol className="text-xs text-slate-200 space-y-2 list-decimal list-inside leading-relaxed">
                        <li>
                          Connectez-vous en 1 clic avec votre compte Google sur{' '}
                          <a
                            href="https://app.simli.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#FF7A5C] underline font-semibold"
                          >
                            app.simli.com
                          </a>{' '}
                          (10 $ de crédits gratuits crédités immédiatement).
                        </li>
                        <li>
                          Copiez votre <strong>API Key</strong> dans le tableau de bord Simli (et
                          créez votre avatar photo dans <em>Create Avatar</em> si vous voulez votre
                          propre <code className="font-mono text-emerald-400">faceId</code>).
                        </li>
                        <li>
                          Dans les paramètres <strong>Secrets</strong> d&rsquo;AI Studio, ajoutez un
                          secret nommé <code className="font-mono text-emerald-400">Simli</code> (ou
                          remplacez la valeur de votre secret{' '}
                          <code className="font-mono text-emerald-400">Live</code>), puis cliquez sur{' '}
                          <strong>« Vérifier ma clé »</strong> en haut à droite.
                        </li>
                      </ol>
                    </div>
                  )
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-sm font-display font-bold text-white">
                      Moteur Decart AI ({selectedModel.toUpperCase()})
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs">
                      <span className="text-emerald-400 font-medium flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        Clé Decart &ldquo;{decartStatus.apiKeyName || 'Cam'}&rdquo; ({decartStatus.keyPrefix || 'dct_cam…'}) : Solde Payé Actif ✓
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                      Votre compte Decart dispose de crédits actifs. Cliquez sur <strong>« Démarrer le Swap Decart »</strong> pour lancer votre appel avec protection anti-filigrane automatique.
                    </p>
                  </div>
                )}

                {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
                  <div className="w-full rounded-xl border border-white/15 bg-[#12161F] p-4 space-y-1">
                    <p className="text-xs font-semibold text-white">
                      Connexion en cours au serveur GPU{' '}
                      {activeEngine === 'simli' ? 'Simli WebRTC' : 'Decart AI'}…
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Ouverture du flux vidéo temps réel basse latence.
                    </p>
                  </div>
                )}

                {lastDisconnectError && (
                  <div className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-left space-y-2">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-200">
                          Information de connexion :
                        </p>
                        <p className="text-xs text-slate-200 leading-relaxed">
                          {lastDisconnectError}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Menu flottant de réglage précis Anti-Filigrane */}
            {showCropControls && (
              <div className="absolute bottom-16 right-3.5 z-40 w-72 rounded-2xl bg-[#12161F]/95 border border-white/15 p-3.5 shadow-2xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Réglage Rognage Anti-Filigrane
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCropControls(false)}
                    className="text-slate-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-300">
                    <span>Niveau de Zoom (Coupe les bords) :</span>
                    <span className="font-mono text-emerald-400">{Math.round(cropZoom * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="1.00"
                    max="1.35"
                    step="0.01"
                    value={cropZoom}
                    onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>100% (Brut)</span>
                    <span className="text-emerald-400 font-bold">118% (Optimal)</span>
                    <span>135%</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-300">
                    <span>Décalage Vertical (Centrage visage) :</span>
                    <span className="font-mono text-emerald-400">{cropShiftY > 0 ? `+${cropShiftY}` : cropShiftY}%</span>
                  </div>
                  <input
                    type="range"
                    min="-8"
                    max="8"
                    step="0.5"
                    value={cropShiftY}
                    onChange={(e) => setCropShiftY(parseFloat(e.target.value))}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>Haut (-8%)</span>
                    <span className="text-emerald-400 font-bold">-3.5% (Recommandé)</span>
                    <span>Bas (+8%)</span>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight border-t border-white/10 pt-2">
                  Le bandeau défilant &ldquo;AI générative&rdquo; est repoussé hors du cadre et physiquement coupé du flux.
                </p>
              </div>
            )}

            {/* Barre de contrôles du bas de l'écran vidéo */}
            <div className="absolute bottom-3.5 right-3.5 z-30 flex items-center gap-2">
              <div className="flex items-center rounded-xl border border-emerald-500/30 bg-[#11141B]/90 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHideWatermarkCrop(!hideWatermarkCrop)}
                  title="Activer/désactiver le rognage anti-filigrane"
                  className={`h-10 px-3 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    hideWatermarkCrop
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{hideWatermarkCrop ? 'Anti-Filigrane : ACTIF' : 'Anti-Filigrane : OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCropControls(!showCropControls)}
                  title="Ajuster le zoom et le centrage du rognage"
                  className="h-10 px-2.5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors border-l border-white/10"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCleanVcamMode(!cleanVcamMode)}
                className="h-10 px-3 rounded-xl border border-white/15 bg-[#11141B]/90 text-slate-200 hover:text-white text-xs font-medium transition-colors"
              >
                {cleanVcamMode ? 'Quitter Plein Écran VCam' : 'Mode VCam (WhatsApp / Zoom)'}
              </button>

              <button
                type="button"
                onClick={() => setIsMirrored(!isMirrored)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#11141B]/90 text-slate-200 hover:text-white transition-colors"
              >
                <FlipHorizontal2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#11141B]/90 text-slate-200 hover:text-white transition-colors"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Barre inférieure d'avatars + Bouton Démarrer */}
          {!cleanVcamMode && (
            <div className="rounded-2xl border border-white/10 bg-[#12161F] px-4 py-3 flex flex-col gap-2.5 shrink-0">
              <div className="w-full text-[11px] text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-0.5 bg-[#080A0E] p-2.5 rounded-xl border border-white/10">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-[#FF7A5C] font-semibold shrink-0">💡 Mains &amp; Mouvements en appel :</span>
                  <span className="text-slate-300 truncate sm:whitespace-normal">
                    Pour être 100% indétectable en appel (WhatsApp / Zoom), gardez vos mains posées naturellement au bureau. Évitez d’agiter les mains rapidement devant la webcam pour empêcher le retour de votre silhouette réelle.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-emerald-400 font-mono text-[10px]">Anti-Filigrane : {Math.round(cropZoom * 100)}%</span>
                  <span className="text-slate-400 font-mono text-[10px]">Codec : {preferredCodec.toUpperCase()}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 overflow-x-auto py-0.5 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-14 px-4 rounded-xl border-2 border-dashed border-[#FF5734]/60 bg-[#FF5734]/10 hover:bg-[#FF5734]/20 text-white flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#FF7A5C] shrink-0" />
                  <div className="text-left">
                    <p className="text-xs font-semibold whitespace-nowrap">Ajouter un avatar</p>
                    <p className="text-[10px] text-slate-300 whitespace-nowrap">
                      Photo de référence
                    </p>
                  </div>
                </button>

                {avatars.map((av) => {
                  const active = selectedAvatar?.id === av.id;
                  return (
                    <div
                      key={av.id}
                      onClick={() => handleSelectAvatar(av)}
                      className={`h-14 px-3 rounded-xl border flex items-center gap-2.5 shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'border-[#FF5734] bg-[#FF5734]/15 text-white'
                          : 'border-white/10 bg-[#0B0D11] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <img
                        src={av.dataUrl}
                        alt={av.name}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-cover border border-white/15 shrink-0"
                      />
                      <div>
                        <p className="text-xs font-semibold whitespace-nowrap">{av.name}</p>
                        <p className="text-[10px] text-emerald-400 whitespace-nowrap">
                          {activeEngine === 'simli' ? 'Avatar Simli' : 'Image entière'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAvatars((prev) => prev.filter((item) => item.id !== av.id));
                          if (selectedAvatarId === av.id) {
                            setSelectedAvatarId(null);
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() =>
                  isLiveRunning
                    ? stopLiveSession()
                    : activeEngine === 'simli'
                    ? startSimliLive()
                    : startDecartLive()
                }
                className={`h-12 px-7 rounded-xl font-semibold text-xs flex items-center gap-2.5 transition-colors whitespace-nowrap shrink-0 ${
                  isLiveRunning
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-[#FF5734] hover:bg-[#FF6B4A] text-white'
                }`}
              >
                {isLiveRunning ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Arrêter le Live</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {activeEngine === 'simli'
                        ? 'Démarrer le Live Simli'
                        : 'Démarrer le Swap Decart'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      </main>
    </div>
  );
}
