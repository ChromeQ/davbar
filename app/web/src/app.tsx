import { StrictMode, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Download,
  Gauge,
  LoaderCircle,
  Power,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
} from 'lucide-react';

import { encodeSpectra6 } from '@chromeq/davbar-spectra6';
import { deviceConfig } from './device-config';
import { LaserDots, LaserPicker, useLaserPicker } from './laser-picker';
import {
  byLaserNumber,
  fetchChosenLaser,
  laserName,
  modeLabel,
  type ChosenLaser,
  type LaserItem,
} from './lasers';
import {
  CENTRED,
  drawImageInSquare,
  IMAGE_SIZE,
  panBy,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  screenPixels,
  type ImageFit,
  type Pan,
} from './screen';
import { drawStrip, STRIP_SIZE } from './strip';
import { useStripState } from './strip-values';
import './common.style.css';
import './app.style.css';

const IMAGE_UPLOAD_URL = '/image';
const DEFAULT_TEXT = deviceConfig.defaultText;
const DEFAULT_FONT_FAMILY = 'Roboto';
const DEFAULT_FONT_SIZE = 64;
const DEFAULT_TEXT_COLOUR = '#171713';
const DEFAULT_BACKGROUND_COLOUR = '#f7f5ee';
const DEFAULT_GRADIENT_COLOUR = '#ef2d56';

type SourceFrame = {
  pixels: Uint8ClampedArray;
};

type UploadState = 'idle' | 'uploading' | 'success' | 'error';
type BackgroundMode = 'solid' | 'linear' | 'radial';
type SourceMode = 'image' | 'text';
type ApiResult = {
  success: boolean;
  message: string;
};
type DeviceStatus = {
  hostname: string;
  ip: string;
  wifi: {
    ssid: string;
    rssi: number;
  };
  image: {
    updated: string | null;
    size: number;
  };
  uptime: number;
  firmware?: string;
  memory?: {
    free: number;
    lowest: number;
  };
  laser?: ChosenLaser | null;
  lasers?: LaserItem[];
};

const isApiResult = (value: unknown): value is ApiResult =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  typeof value.success === 'boolean' &&
  'message' in value &&
  typeof value.message === 'string';

const isDeviceStatus = (value: unknown): value is DeviceStatus => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate: Partial<DeviceStatus> = value;

  return (
    typeof candidate.hostname === 'string' &&
    typeof candidate.ip === 'string' &&
    typeof candidate.wifi === 'object' &&
    candidate.wifi !== null &&
    typeof candidate.wifi.ssid === 'string' &&
    typeof candidate.wifi.rssi === 'number' &&
    typeof candidate.image === 'object' &&
    candidate.image !== null &&
    (typeof candidate.image.updated === 'string' || candidate.image.updated === null) &&
    typeof candidate.image.size === 'number' &&
    typeof candidate.uptime === 'number'
  );
};

const formatUptime = (totalSeconds: number) => {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return [
    days > 0 ? `${days}d` : null,
    hours > 0 || days > 0 ? `${hours}h` : null,
    minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
};

// The Status dialog's line for a laser, with everything the tap knows about it.
const formatLaser = (laser: LaserItem) => {
  if (laser.lastHeardSeconds === null) {
    return `${laser.address} · not heard yet`;
  }

  const reading = laser.reading;

  return [
    laser.address,
    reading ? `${reading.distanceMm} mm` : 'no reading yet',
    reading ? `${reading.litres.toFixed(1)} L` : null,
    reading ? `${reading.percent}%` : null,
    reading?.mode,
    reading && reading.batteryPercent !== null
      ? `battery ${reading.batteryPercent.toFixed(1)}%`
      : null,
    reading && reading.temperatureC !== null ? `${reading.temperatureC.toFixed(1)}°` : null,
    laser.rssi === null ? null : `${laser.rssi} dBm`,
    `heard ${formatUptime(laser.lastHeardSeconds)} ago`,
  ]
    .filter(Boolean)
    .join(' · ');
};

const formatChosenLaser = (laser: ChosenLaser | null) =>
  laser ? `${laserName(laser)} · ${modeLabel(laser.mode)}` : 'None chosen';

type LaserDialogProps = {
  onClose: () => void;
  onSaved: (laser: ChosenLaser) => void;
};

// Its own component so the tap only searches every laser while it's open.
const LaserDialog = ({ onClose, onSaved }: LaserDialogProps) => {
  const picker = useLaserPicker();

  const save = async () => {
    const laser = await picker.save();

    if (laser) {
      onSaved(laser);
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="app-modal laser-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="laser-modal-title"
        aria-describedby="laser-modal-description"
        aria-busy={picker.saving}
      >
        <div className="modal-icon settings-modal-icon" aria-hidden="true">
          <Gauge size={22} strokeWidth={1.8} />
        </div>
        <h2 id="laser-modal-title">{deviceConfig.deviceName}'s laser</h2>
        <p id="laser-modal-description">Choose the laser in this tap's keg and its mode.</p>
        <LaserPicker picker={picker} />
        {picker.saveError && (
          <p className="laser-modal-error" role="alert">
            {picker.saveError}
          </p>
        )}
        <div className="modal-actions laser-modal-actions">
          <button className="modal-button" type="button" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button
            className="modal-button primary-modal-button"
            type="button"
            disabled={!picker.changed}
            onClick={() => void save()}
          >
            {picker.saving ? (
              <>
                <LoaderCircle className="upload-spinner" size={16} aria-hidden="true" />
                Saving
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const formatImageUpdated = (updated: string | null) => {
  if (!updated) {
    return 'Not available';
  }

  const date = new Date(updated);

  return Number.isNaN(date.getTime()) ? updated : date.toLocaleString();
};

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Canvas is not supported by this browser.');
  }

  return context;
}

const App = () => {
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SourceMode>('image');
  const [text, setText] = useState(DEFAULT_TEXT);
  const [fontFamily, setFontFamily] = useState(DEFAULT_FONT_FAMILY);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [textColour, setTextColour] = useState(DEFAULT_TEXT_COLOUR);
  const [backgroundColour, setBackgroundColour] = useState(DEFAULT_BACKGROUND_COLOUR);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('solid');
  const [gradientColour, setGradientColour] = useState(DEFAULT_GRADIENT_COLOUR);
  // The chosen image at its own size, so Fit, Fill and dragging can redraw it.
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [imageFit, setImageFit] = useState<ImageFit>('fit');
  const [pan, setPan] = useState<Pan>(CENTRED);
  // While dragging a filled image: where the pointer last was.
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const [imageFrame, setImageFrame] = useState<SourceFrame | null>(null);
  const [textFrame, setTextFrame] = useState<SourceFrame | null>(null);
  const [binary, setBinary] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [pendingReset, setPendingReset] = useState<SourceMode | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<ApiResult | null>(null);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [rebootResult, setRebootResult] = useState<ApiResult | null>(null);
  const [factoryResetDialogOpen, setFactoryResetDialogOpen] = useState(false);
  const [clearLog, setClearLog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [factoryResetResult, setFactoryResetResult] = useState<ApiResult | null>(null);
  const [laserDialogOpen, setLaserDialogOpen] = useState(false);
  // undefined until loaded; null when no laser is chosen.
  const [chosenLaser, setChosenLaser] = useState<ChosenLaser | null | undefined>(undefined);
  const [chosenLaserFailed, setChosenLaserFailed] = useState(false);
  const { strip } = useStripState();
  const stripValues = strip?.values ?? null;
  const sourceFrame = mode === 'image' ? imageFrame : textFrame;
  const canPan = mode === 'image' && image !== null && imageFit === 'fill';
  const isUploading = uploadState === 'uploading';
  const uploadSucceeded = uploadState === 'success';
  const appModalOpen =
    pendingReset !== null || uploadError !== null || isUploading || uploadSucceeded;
  const modalOpen =
    appModalOpen ||
    settingsOpen ||
    statusDialogOpen ||
    refreshDialogOpen ||
    rebootDialogOpen ||
    factoryResetDialogOpen ||
    laserDialogOpen;

  useEffect(() => {
    fetchChosenLaser()
      .then((laser) => setChosenLaser(laser))
      .catch(() => setChosenLaserFailed(true));
  }, []);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !isUploading &&
        !statusLoading &&
        !refreshing &&
        !rebooting &&
        !resetting
      ) {
        setPendingReset(null);
        setUploadError(null);
        setSettingsOpen(false);
        setStatusDialogOpen(false);
        setRefreshDialogOpen(false);
        setRebootDialogOpen(false);
        setFactoryResetDialogOpen(false);
        setLaserDialogOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUploading, modalOpen, rebooting, refreshing, resetting, statusLoading]);

  useEffect(() => {
    if (mode !== 'text') {
      return;
    }

    const canvas = sourceCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = getCanvasContext(canvas);
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.2;
    const firstBaseline = IMAGE_SIZE / 2 - ((lines.length - 1) * lineHeight) / 2;

    if (backgroundMode === 'linear') {
      const gradient = context.createLinearGradient(0, 0, 0, IMAGE_SIZE);
      gradient.addColorStop(0, backgroundColour);
      gradient.addColorStop(1, gradientColour);
      context.fillStyle = gradient;
    } else if (backgroundMode === 'radial') {
      const gradient = context.createRadialGradient(
        IMAGE_SIZE / 2,
        IMAGE_SIZE / 2,
        0,
        IMAGE_SIZE / 2,
        IMAGE_SIZE / 2,
        Math.hypot(IMAGE_SIZE / 2, IMAGE_SIZE / 2)
      );
      gradient.addColorStop(0, backgroundColour);
      gradient.addColorStop(1, gradientColour);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = backgroundColour;
    }

    context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    context.fillStyle = textColour;
    context.font = `${fontSize}px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    lines.forEach((line, index) => {
      context.fillText(line, IMAGE_SIZE / 2, firstBaseline + index * lineHeight, 360);
    });

    const imageData = context.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);

    setTextFrame({ pixels: imageData.data });
    setError('');
    setUploadState('idle');
  }, [
    backgroundColour,
    backgroundMode,
    fontFamily,
    fontSize,
    gradientColour,
    mode,
    text,
    textColour,
  ]);

  useEffect(() => {
    if (mode !== 'image') {
      return;
    }

    const canvas = sourceCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = getCanvasContext(canvas);

    if (!image) {
      context.clearRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
      setImageFrame(null);

      return;
    }

    drawImageInSquare(context, image, imageFit, pan);
    setImageFrame({ pixels: context.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data });
    setUploadState('idle');
  }, [image, imageFit, mode, pan]);

  // Encodes the image for the panel: these are the bytes uploaded.
  useEffect(() => {
    if (!sourceFrame) {
      setBinary(null);

      return;
    }

    try {
      setBinary(encodeSpectra6(new Uint8Array(sourceFrame.pixels), IMAGE_SIZE, IMAGE_SIZE).bytes);
      setError('');
    } catch (encodingError) {
      setBinary(null);
      setError(encodingError instanceof Error ? encodingError.message : 'Preview failed.');
    }
  }, [sourceFrame]);

  // The whole screen: the encoded image above the strip as the tap would draw it
  // now, so new strip values redraw the preview without encoding again.
  useEffect(() => {
    const previewCanvas = previewCanvasRef.current;

    if (!previewCanvas) {
      return;
    }

    const context = getCanvasContext(previewCanvas);

    if (!binary) {
      context.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

      return;
    }

    // Until the tap answers, the strip is left white (two white pixels a byte).
    const stripBytes = stripValues ? drawStrip(stripValues) : new Uint8Array(STRIP_SIZE).fill(0x11);
    context.putImageData(screenPixels(binary, stripBytes), 0, 0);
  }, [binary, stripValues]);

  const selectMode = (nextMode: SourceMode) => {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setBinary(null);
    setUploadState('idle');
    setError('');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setError('');
    setBinary(null);
    setUploadState('idle');

    try {
      const bitmap = await createImageBitmap(file);

      setImage((previous) => {
        previous?.close();
        return bitmap;
      });
      setPan(CENTRED);
      setFileName(file.name);
    } catch {
      setError('That file could not be read as an image.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (mode !== 'image') {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (mode !== 'image') {
      return;
    }

    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  // Dragging a filled image chooses which part of it shows.
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!canPan) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = { x: event.clientX, y: event.clientY };
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;

    if (!from || !image) {
      return;
    }

    // The canvas is shown smaller than its 400 pixels, so scale the movement up.
    const scale = IMAGE_SIZE / event.currentTarget.clientWidth;
    const dx = (event.clientX - from.x) * scale;
    const dy = (event.clientY - from.y) * scale;

    dragFrom.current = { x: event.clientX, y: event.clientY };
    setPan((previous) => panBy(image, previous, dx, dy));
  };

  const endPan = () => {
    dragFrom.current = null;
  };

  const handleBackgroundMode = (value: string) => {
    if (value === 'solid' || value === 'linear' || value === 'radial') {
      setBackgroundMode(value);
    }
  };

  const reverseGradient = () => {
    setBackgroundColour(gradientColour);
    setGradientColour(backgroundColour);
  };

  const resetMode = (targetMode: SourceMode) => {
    setError('');
    setUploadState('idle');
    setPendingReset(null);

    if (targetMode === 'image') {
      setImage((previous) => {
        previous?.close();
        return null;
      });
      setPan(CENTRED);
      setFileName('');

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      return;
    }

    setText(DEFAULT_TEXT);
    setFontFamily(DEFAULT_FONT_FAMILY);
    setFontSize(DEFAULT_FONT_SIZE);
    setTextColour(DEFAULT_TEXT_COLOUR);
    setBackgroundColour(DEFAULT_BACKGROUND_COLOUR);
    setBackgroundMode('solid');
    setGradientColour(DEFAULT_GRADIENT_COLOUR);
  };

  const requestReset = () => {
    const hasTextChanges =
      text !== DEFAULT_TEXT ||
      fontFamily !== DEFAULT_FONT_FAMILY ||
      fontSize !== DEFAULT_FONT_SIZE ||
      textColour !== DEFAULT_TEXT_COLOUR ||
      backgroundColour !== DEFAULT_BACKGROUND_COLOUR ||
      backgroundMode !== 'solid' ||
      gradientColour !== DEFAULT_GRADIENT_COLOUR;

    if (mode === 'image' && image) {
      setPendingReset('image');

      return;
    }

    if (mode === 'text' && hasTextChanges) {
      setPendingReset('text');

      return;
    }

    resetMode(mode);
  };

  const uploadBinary = async () => {
    if (!binary || !sourceFrame) {
      return;
    }

    setUploadState('uploading');
    setError('');
    setUploadError(null);

    try {
      const uploadBytes = new Uint8Array(binary);
      const response = await fetch(IMAGE_UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([uploadBytes.buffer], { type: 'application/octet-stream' }),
      });
      const responseBody = await response.text();
      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The display returned an invalid response.');
      }

      if (!isApiResult(result)) {
        throw new Error('The display returned an invalid response.');
      }

      if (!response.ok || !result.success) {
        throw new Error(result.message || `Upload failed with status ${response.status}.`);
      }

      setUploadState('success');
    } catch (uploadFailure) {
      setUploadState('error');
      const message =
        uploadFailure instanceof Error ? uploadFailure.message : 'Unable to upload the image.';

      setUploadError(
        message === 'Failed to fetch'
          ? `The display service at ${deviceConfig.uploadHost} could not be reached. It may not be available yet.`
          : message
      );
    }
  };

  const openFactoryResetDialog = () => {
    setSettingsOpen(false);
    setClearLog(false);
    setFactoryResetResult(null);
    setFactoryResetDialogOpen(true);
  };

  const downloadLog = () => {
    setSettingsOpen(false);

    // The device names the file in its response.
    const link = document.createElement('a');
    link.href = '/log';
    link.download = '';
    link.click();
  };

  const loadDeviceStatus = async () => {
    setStatusLoading(true);
    setStatus(null);
    setStatusError(null);

    try {
      const response = await fetch('/status', { cache: 'no-store' });
      const responseBody = await response.text();

      if (!responseBody) {
        throw new Error('The device closed the connection without returning a response.');
      }

      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The device returned an invalid response.');
      }

      if (!response.ok || !isDeviceStatus(result)) {
        throw new Error('The device returned an invalid response.');
      }

      setStatus(result);
    } catch (statusFailure) {
      setStatusError(
        statusFailure instanceof Error ? statusFailure.message : 'Unable to load device status.'
      );
    } finally {
      setStatusLoading(false);
    }
  };

  const openStatusDialog = () => {
    setSettingsOpen(false);
    setStatusDialogOpen(true);
    void loadDeviceStatus();
  };

  const openRefreshDialog = () => {
    setSettingsOpen(false);
    setRefreshResult(null);
    setRefreshDialogOpen(true);
  };

  const openRebootDialog = () => {
    setSettingsOpen(false);
    setRebootResult(null);
    setRebootDialogOpen(true);
  };

  const returnToSettings = () => {
    setStatusDialogOpen(false);
    setRefreshDialogOpen(false);
    setRebootDialogOpen(false);
    setFactoryResetDialogOpen(false);
    setSettingsOpen(true);
  };

  const refreshDisplay = async () => {
    setRefreshing(true);
    setRefreshResult(null);

    try {
      const response = await fetch('/refresh', { method: 'POST' });
      const responseBody = await response.text();

      if (!responseBody) {
        throw new Error('The device closed the connection without returning a response.');
      }

      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The device returned an invalid response.');
      }

      if (!isApiResult(result)) {
        throw new Error('The device returned an invalid response.');
      }

      setRefreshResult(result);
    } catch (refreshError) {
      setRefreshResult({
        success: false,
        message:
          refreshError instanceof Error ? refreshError.message : 'Unable to refresh the display.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const rebootDevice = async () => {
    setRebooting(true);
    setRebootResult(null);

    try {
      const response = await fetch('/reboot', { method: 'POST' });
      const responseBody = await response.text();

      if (!responseBody) {
        throw new Error('The device closed the connection without returning a response.');
      }

      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The device returned an invalid response.');
      }

      if (!isApiResult(result)) {
        throw new Error('The device returned an invalid response.');
      }

      setRebootResult(result);
    } catch (rebootError) {
      setRebootResult({
        success: false,
        message:
          rebootError instanceof Error ? rebootError.message : 'Unable to reboot the device.',
      });
    } finally {
      setRebooting(false);
    }
  };

  const factoryReset = async () => {
    setResetting(true);
    setFactoryResetResult(null);

    try {
      const response = await fetch('/factory-reset', {
        method: 'POST',
        body: new URLSearchParams({ clearLog: clearLog ? '1' : '0' }),
      });
      const responseBody = await response.text();

      if (!responseBody) {
        throw new Error('The device closed the connection without returning a response.');
      }

      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The device returned an invalid response.');
      }

      if (!isApiResult(result)) {
        throw new Error('The device returned an invalid response.');
      }

      setFactoryResetResult(result);
    } catch (resetError) {
      setFactoryResetResult({
        success: false,
        message:
          resetError instanceof Error ? resetError.message : 'Unable to factory reset the device.',
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">{deviceConfig.brandName}</p>
        <div className="settings-menu">
          <button
            className="settings-button"
            type="button"
            aria-label="Device settings"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-controls="settings-modal"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </div>
        <h1>
          Keg Display Studio <span className="tap-badge">{deviceConfig.deviceName}</span>
        </h1>
        <div className="display-spec">
          <span className="status-dot" />
          400 × 600 Spectra 6
        </div>
      </header>

      <section className="workspace">
        <article className="panel source-panel">
          <div className="panel-heading">
            <div className="compose-heading">
              <h2>Compose</h2>
              <button
                className="reset-button"
                type="button"
                aria-label={`Reset ${mode}`}
                title={`Reset ${mode}`}
                onClick={requestReset}
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="mode-switch" aria-label="Source type">
              <button
                className={mode === 'image' ? 'active' : ''}
                type="button"
                onClick={() => selectMode('image')}
              >
                Image
              </button>
              <button
                className={mode === 'text' ? 'active' : ''}
                type="button"
                onClick={() => selectMode('text')}
              >
                Text
              </button>
            </div>
          </div>

          <div
            className={`canvas-stage image-stage ${sourceFrame ? 'has-image' : ''} ${isDragging ? 'is-dragging' : ''} ${canPan ? 'can-pan' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <canvas ref={sourceCanvasRef} width={IMAGE_SIZE} height={IMAGE_SIZE} />
            {!image && mode === 'image' && (
              <label className="canvas-placeholder upload-placeholder" htmlFor="image-file">
                <span>+</span>
                <p>Click or drag an image here</p>
              </label>
            )}
          </div>

          <div className="source-controls">
            {mode === 'image' ? (
              <>
                <input
                  ref={fileInputRef}
                  id="image-file"
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
                <label className="file-picker" htmlFor="image-file">
                  <span>{fileName || 'Choose image'}</span>
                  <strong>Browse</strong>
                </label>
                {image && (
                  <div className="fit-row">
                    <div className="mode-switch" aria-label="How the image fills the square">
                      <button
                        className={imageFit === 'fit' ? 'active' : ''}
                        type="button"
                        onClick={() => setImageFit('fit')}
                      >
                        Fit
                      </button>
                      <button
                        className={imageFit === 'fill' ? 'active' : ''}
                        type="button"
                        onClick={() => setImageFit('fill')}
                      >
                        Fill
                      </button>
                    </div>
                    <p className="fit-hint">
                      {imageFit === 'fit'
                        ? 'The whole image, with white in the gaps.'
                        : 'Cropped to the square. Drag the image to choose what shows.'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-controls">
                <label className="text-field wide-field">
                  <span>Text</span>
                  <textarea
                    rows={2}
                    value={text}
                    maxLength={80}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
                <label className="text-field font-family-field">
                  <span>Font</span>
                  <select
                    value={fontFamily}
                    onChange={(event) => setFontFamily(event.target.value)}
                  >
                    <option value="Roboto">Roboto</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Arial">Arial</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Courier New">Courier New</option>
                  </select>
                </label>
                <label className="text-field size-field">
                  <span>Size</span>
                  <input
                    type="number"
                    min="12"
                    max="160"
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value))}
                  />
                </label>
                <label className="colour-field text-colour-field">
                  <span>Text</span>
                  <input
                    type="color"
                    value={textColour}
                    onChange={(event) => setTextColour(event.target.value)}
                  />
                </label>
                <label className="text-field gradient-mode-field">
                  <span>Background style</span>
                  <select
                    value={backgroundMode}
                    onChange={(event) => handleBackgroundMode(event.target.value)}
                  >
                    <option value="solid">Solid</option>
                    <option value="linear">Linear</option>
                    <option value="radial">Radial</option>
                  </select>
                </label>
                <label className="colour-field background-colour-field">
                  <span>{backgroundMode === 'solid' ? 'Colour' : 'Start'}</span>
                  <input
                    type="color"
                    value={backgroundColour}
                    onChange={(event) => setBackgroundColour(event.target.value)}
                  />
                </label>
                {backgroundMode !== 'solid' && (
                  <>
                    <label className="colour-field gradient-colour-field">
                      <span>End</span>
                      <input
                        type="color"
                        value={gradientColour}
                        onChange={(event) => setGradientColour(event.target.value)}
                      />
                    </label>
                    <button
                      className="reverse-gradient-button"
                      type="button"
                      aria-label="Reverse gradient colours"
                      title="Reverse gradient colours"
                      onClick={reverseGradient}
                    >
                      ⇄
                    </button>
                  </>
                )}
              </div>
            )}
            {error && <p className="message error-message">{error}</p>}
          </div>
        </article>

        <article className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <h2>Preview</h2>
            </div>
            <span className={`preview-state ${binary ? 'ready' : ''}`}>
              {binary ? 'Ready' : 'Waiting'}
            </span>
          </div>

          <div className={`canvas-stage preview-stage ${binary ? 'has-image' : ''}`}>
            <canvas ref={previewCanvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
            {!binary && (
              <div className="canvas-placeholder preview-placeholder">
                <span className="pixel-mark" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <p>Your six-colour preview appears here</p>
              </div>
            )}
          </div>

          <div className="upload-row">
            <div>
              <span className="upload-label">Binary output</span>
              <strong>
                {binary ? `${binary.byteLength.toLocaleString()} bytes` : 'Not generated'}
              </strong>
            </div>
            <button
              className="laser-button"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setLaserDialogOpen(true)}
            >
              <span className="upload-label">Laser</span>
              <strong>
                {chosenLaser ? (
                  <>
                    <LaserDots number={chosenLaser.number} />
                    {formatChosenLaser(chosenLaser)}
                  </>
                ) : chosenLaser === null ? (
                  'Choose a laser'
                ) : chosenLaserFailed ? (
                  'Not available'
                ) : (
                  'Checking…'
                )}
              </strong>
            </button>
            <button
              className="upload-button"
              type="button"
              disabled={!binary || uploadState === 'uploading'}
              onClick={() => void uploadBinary()}
            >
              {uploadState === 'uploading' ? 'Uploading…' : 'Upload to display'}
            </button>
          </div>
        </article>
      </section>

      {appModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isUploading) {
              setPendingReset(null);
              setUploadError(null);
            }
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            aria-describedby="modal-description"
            aria-busy={isUploading}
          >
            <div
              className={`modal-icon ${uploadError ? 'error-modal-icon' : ''} ${isUploading ? 'uploading-modal-icon' : ''} ${uploadSucceeded ? 'success-modal-icon' : ''}`}
              aria-hidden="true"
            >
              {isUploading ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : uploadSucceeded ? (
                <CheckCircle2 size={22} strokeWidth={1.8} />
              ) : uploadError ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <Trash2 size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="modal-title">
              {isUploading
                ? 'Uploading to display'
                : uploadSucceeded
                  ? 'Upload complete'
                  : uploadError
                    ? 'Upload failed'
                    : `Reset ${pendingReset}?`}
            </h2>
            <p id="modal-description">
              {isUploading
                ? `Sending the display image to ${deviceConfig.uploadHost}. This may take a moment.`
                : uploadSucceeded
                  ? 'The display image was uploaded successfully.'
                  : (uploadError ??
                    (pendingReset === 'image'
                      ? 'This removes the uploaded image and its preview. Your text composition will be kept.'
                      : 'This restores the default text and appearance. Your uploaded image will be kept.'))}
            </p>
            {!isUploading && (
              <div className="modal-actions">
                {uploadSucceeded ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    autoFocus
                    onClick={() => window.location.reload()}
                  >
                    Close
                  </button>
                ) : uploadError ? (
                  <>
                    <button
                      className="modal-button"
                      type="button"
                      onClick={() => setUploadError(null)}
                    >
                      Close
                    </button>
                    <button
                      className="modal-button primary-modal-button"
                      type="button"
                      autoFocus
                      onClick={() => void uploadBinary()}
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="modal-button"
                      type="button"
                      autoFocus
                      onClick={() => setPendingReset(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-button destructive-button"
                      type="button"
                      onClick={() => pendingReset && resetMode(pendingReset)}
                    >
                      Reset {pendingReset}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {laserDialogOpen && (
        <LaserDialog
          onClose={() => setLaserDialogOpen(false)}
          onSaved={(laser) => {
            setChosenLaser(laser);
            setChosenLaserFailed(false);
          }}
        />
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettingsOpen(false);
            }
          }}
        >
          <div
            id="settings-modal"
            className="app-modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
          >
            <div className="modal-icon settings-modal-icon" aria-hidden="true">
              <Settings size={22} strokeWidth={1.8} />
            </div>
            <h2 id="settings-modal-title">Device settings</h2>
            <div className="settings-list">
              <button type="button" autoFocus onClick={openStatusDialog}>
                <Activity size={19} aria-hidden="true" />
                <span>
                  <strong>Device status</strong>
                  <small>View network, laser, image, and uptime information</small>
                </span>
              </button>
              <button type="button" onClick={openRefreshDialog}>
                <RefreshCw size={19} aria-hidden="true" />
                <span>
                  <strong>Force refresh</strong>
                  <small>Refresh the display using the currently saved image</small>
                </span>
              </button>
              <button type="button" onClick={downloadLog}>
                <Download size={19} aria-hidden="true" />
                <span>
                  <strong>Download log</strong>
                  <small>Save the device's event log as a CSV file</small>
                </span>
              </button>
              <button type="button" onClick={openRebootDialog}>
                <Power size={19} aria-hidden="true" />
                <span>
                  <strong>Reboot device</strong>
                  <small>Restart the device without changing its settings</small>
                </span>
              </button>
              <button type="button" onClick={openFactoryResetDialog}>
                <RotateCcw size={19} aria-hidden="true" />
                <span>
                  <strong>Factory reset</strong>
                  <small>Clear the WiFi, laser, and screen image, then return to setup mode</small>
                </span>
              </button>
            </div>
            <div className="modal-actions">
              <button className="modal-button" type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {statusDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !statusLoading) {
              returnToSettings();
            }
          }}
        >
          <div
            className="app-modal status-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-modal-title"
            aria-busy={statusLoading}
          >
            <div className="modal-icon settings-modal-icon" aria-hidden="true">
              {statusLoading ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : statusError ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <Activity size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="status-modal-title">Device status</h2>
            {statusLoading ? (
              <p>Loading current device information.</p>
            ) : statusError ? (
              <p>{statusError}</p>
            ) : status ? (
              <dl className="status-list">
                <div>
                  <dt>Hostname</dt>
                  <dd>{status.hostname}</dd>
                </div>
                <div>
                  <dt>IP address</dt>
                  <dd>{status.ip}</dd>
                </div>
                <div>
                  <dt>WiFi network</dt>
                  <dd>{status.wifi.ssid}</dd>
                </div>
                <div>
                  <dt>Signal strength</dt>
                  <dd>{status.wifi.rssi} dBm</dd>
                </div>
                <div>
                  <dt>Image updated</dt>
                  <dd>{formatImageUpdated(status.image.updated)}</dd>
                </div>
                <div>
                  <dt>Image size</dt>
                  <dd>{status.image.size.toLocaleString()} bytes</dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>{formatUptime(status.uptime)}</dd>
                </div>
                {status.firmware && (
                  <div>
                    <dt>Firmware</dt>
                    <dd>{status.firmware}</dd>
                  </div>
                )}
                {status.memory && (
                  <div>
                    <dt>Free memory</dt>
                    <dd>
                      {Math.floor(status.memory.free / 1024)} KB (lowest{' '}
                      {Math.floor(status.memory.lowest / 1024)} KB)
                    </dd>
                  </div>
                )}
                {status.laser !== undefined && (
                  <div>
                    <dt>This tap's laser</dt>
                    <dd>{formatChosenLaser(status.laser)}</dd>
                  </div>
                )}
                {status.lasers?.length === 0 && (
                  <div>
                    <dt>Lasers heard</dt>
                    <dd>None yet</dd>
                  </div>
                )}
                {[...(status.lasers ?? [])].sort(byLaserNumber).map((laser) => (
                  <div key={laser.address}>
                    <dt>
                      {laserName(laser)}
                      {laser.address === status.laser?.address && ' (this tap)'}
                    </dt>
                    <dd>{formatLaser(laser)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {!statusLoading && (
              <div className="modal-actions">
                {statusError && (
                  <button
                    className="modal-button"
                    type="button"
                    onClick={() => void loadDeviceStatus()}
                  >
                    Retry
                  </button>
                )}
                <button
                  className="modal-button primary-modal-button"
                  type="button"
                  autoFocus
                  onClick={returnToSettings}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {refreshDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !refreshing) {
              setRefreshDialogOpen(false);
            }
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refresh-modal-title"
            aria-describedby="refresh-modal-description"
            aria-busy={refreshing}
          >
            <div
              className={`modal-icon ${refreshResult?.success ? 'success-modal-icon' : refreshResult ? 'error-modal-icon' : 'settings-modal-icon'}`}
              aria-hidden="true"
            >
              {refreshing ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : refreshResult?.success ? (
                <CheckCircle2 size={22} strokeWidth={1.8} />
              ) : refreshResult ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <RefreshCw size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="refresh-modal-title">
              {refreshing
                ? 'Requesting display refresh'
                : refreshResult?.success
                  ? 'Display refresh requested'
                  : refreshResult
                    ? 'Unable to refresh display'
                    : 'Are you sure you want to refresh display?'}
            </h2>
            <p id="refresh-modal-description">
              {refreshResult?.message ??
                (refreshing
                  ? 'Asking the device to refresh its display.'
                  : 'This forces the display to redraw the currently saved image.')}
            </p>
            {!refreshing && (
              <div className="modal-actions">
                {refreshResult ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    autoFocus
                    onClick={() => setRefreshDialogOpen(false)}
                  >
                    Close
                  </button>
                ) : (
                  <>
                    <button
                      className="modal-button"
                      type="button"
                      autoFocus
                      onClick={returnToSettings}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-button primary-modal-button"
                      type="button"
                      onClick={() => void refreshDisplay()}
                    >
                      Refresh display
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {rebootDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !rebooting) {
              setRebootDialogOpen(false);
            }
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reboot-modal-title"
            aria-describedby="reboot-modal-description"
            aria-busy={rebooting}
          >
            <div
              className={`modal-icon ${rebootResult?.success ? 'success-modal-icon' : rebootResult ? 'error-modal-icon' : 'settings-modal-icon'}`}
              aria-hidden="true"
            >
              {rebooting ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : rebootResult?.success ? (
                <CheckCircle2 size={22} strokeWidth={1.8} />
              ) : rebootResult ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <Power size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="reboot-modal-title">
              {rebooting
                ? 'Requesting device reboot'
                : rebootResult?.success
                  ? 'Device reboot requested'
                  : rebootResult
                    ? 'Unable to reboot device'
                    : 'Reboot device?'}
            </h2>
            <p id="reboot-modal-description">
              {rebootResult?.message ??
                (rebooting
                  ? 'Asking the device to restart.'
                  : 'The display service will be briefly unavailable while the device restarts.')}
            </p>
            {!rebooting && (
              <div className="modal-actions">
                {rebootResult ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    autoFocus
                    onClick={() => setRebootDialogOpen(false)}
                  >
                    Close
                  </button>
                ) : (
                  <>
                    <button
                      className="modal-button"
                      type="button"
                      autoFocus
                      onClick={returnToSettings}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-button primary-modal-button"
                      type="button"
                      onClick={() => void rebootDevice()}
                    >
                      Reboot device
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {factoryResetDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resetting) {
              setFactoryResetDialogOpen(false);
            }
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="factory-reset-modal-title"
            aria-describedby="factory-reset-modal-description"
            aria-busy={resetting}
          >
            <div
              className={`modal-icon factory-reset-modal-icon ${factoryResetResult?.success ? 'success-modal-icon' : ''}`}
              aria-hidden="true"
            >
              {resetting ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : factoryResetResult?.success ? (
                <CheckCircle2 size={22} strokeWidth={1.8} />
              ) : factoryResetResult ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <RotateCcw size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="factory-reset-modal-title">
              {resetting
                ? 'Resetting the device'
                : factoryResetResult?.success
                  ? 'Factory reset done'
                  : factoryResetResult
                    ? 'Unable to factory reset'
                    : 'Factory reset?'}
            </h2>
            <p id="factory-reset-modal-description">
              {factoryResetResult?.success
                ? `${factoryResetResult.message} To set it up again, join the ${deviceConfig.accessPointName} WiFi network.`
                : (factoryResetResult?.message ??
                  (resetting
                    ? 'Clearing the device.'
                    : 'The device will forget its WiFi network and laser and clear its screen image, then restart in setup mode. The screen keeps showing the current picture until a new one is sent. The log is kept unless you tick the box below.'))}
            </p>
            {!resetting && !factoryResetResult && (
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={clearLog}
                  onChange={(event) => setClearLog(event.target.checked)}
                />
                Also clear the log
              </label>
            )}
            {!resetting && (
              <div className="modal-actions">
                {factoryResetResult ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    onClick={() => setFactoryResetDialogOpen(false)}
                  >
                    Close
                  </button>
                ) : (
                  <>
                    <button
                      className="modal-button"
                      type="button"
                      autoFocus
                      onClick={returnToSettings}
                    >
                      Cancel
                    </button>
                    <button
                      className="modal-button destructive-button"
                      type="button"
                      onClick={() => void factoryReset()}
                    >
                      Factory reset
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
