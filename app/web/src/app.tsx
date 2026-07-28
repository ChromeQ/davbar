import { StrictMode, useEffect, useRef, useState, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { CircleAlert, LoaderCircle, Settings, Trash2, WifiOff } from 'lucide-react';

import { decodeSpectra6, encodeSpectra6 } from '@chromeq/davbar-spectra6';
import { deviceConfig } from './device-config';
import './common.style.css';
import './app.style.css';

const DISPLAY_WIDTH = 400;
const DISPLAY_HEIGHT = 600;
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

const isApiResult = (value: unknown): value is ApiResult =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  typeof value.success === 'boolean' &&
  'message' in value &&
  typeof value.message === 'string';

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
  const [forgetDialogOpen, setForgetDialogOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetResult, setForgetResult] = useState<ApiResult | null>(null);
  const sourceFrame = mode === 'image' ? imageFrame : textFrame;
  const isUploading = uploadState === 'uploading';
  const appModalOpen = pendingReset !== null || uploadError !== null || isUploading;
  const modalOpen = appModalOpen || settingsOpen || forgetDialogOpen;

  useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isUploading && !forgetting) {
        setPendingReset(null);
        setUploadError(null);
        setSettingsOpen(false);
        setForgetDialogOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [forgetting, isUploading, modalOpen]);

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
    const firstBaseline = DISPLAY_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

    if (backgroundMode === 'linear') {
      const gradient = context.createLinearGradient(0, 0, 0, DISPLAY_HEIGHT);
      gradient.addColorStop(0, backgroundColour);
      gradient.addColorStop(1, gradientColour);
      context.fillStyle = gradient;
    } else if (backgroundMode === 'radial') {
      const gradient = context.createRadialGradient(
        DISPLAY_WIDTH / 2,
        DISPLAY_HEIGHT / 2,
        0,
        DISPLAY_WIDTH / 2,
        DISPLAY_HEIGHT / 2,
        Math.hypot(DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2)
      );
      gradient.addColorStop(0, backgroundColour);
      gradient.addColorStop(1, gradientColour);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = backgroundColour;
    }

    context.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    context.fillStyle = textColour;
    context.font = `${fontSize}px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    lines.forEach((line, index) => {
      context.fillText(line, DISPLAY_WIDTH / 2, firstBaseline + index * lineHeight, 360);
    });

    const imageData = context.getImageData(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);

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

    if (imageFrame) {
      context.putImageData(
        new ImageData(new Uint8ClampedArray(imageFrame.pixels), DISPLAY_WIDTH, DISPLAY_HEIGHT),
        0,
        0
      );
    } else {
      context.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    }
  }, [imageFrame, mode]);

  useEffect(() => {
    const previewCanvas = previewCanvasRef.current;

    if (!sourceFrame || !previewCanvas) {
      if (previewCanvas) {
        getCanvasContext(previewCanvas).clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      }

      setBinary(null);

      return;
    }

    try {
      const encoded = encodeSpectra6(
        new Uint8Array(sourceFrame.pixels),
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT
      );
      const decoded = decodeSpectra6(encoded.bytes, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      const rgba = new Uint8ClampedArray(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);

      for (let sourceOffset = 0, targetOffset = 0; sourceOffset < decoded.pixels.length; ) {
        rgba[targetOffset++] = decoded.pixels[sourceOffset++] ?? 0;
        rgba[targetOffset++] = decoded.pixels[sourceOffset++] ?? 0;
        rgba[targetOffset++] = decoded.pixels[sourceOffset++] ?? 0;
        rgba[targetOffset++] = 255;
      }

      getCanvasContext(previewCanvas).putImageData(
        new ImageData(rgba, DISPLAY_WIDTH, DISPLAY_HEIGHT),
        0,
        0
      );
      setBinary(encoded.bytes);
      setError('');
    } catch (encodingError) {
      setBinary(null);
      setError(encodingError instanceof Error ? encodingError.message : 'Preview failed.');
    }
  }, [sourceFrame]);

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
      const image = await createImageBitmap(file);

      if (image.width !== DISPLAY_WIDTH || image.height !== DISPLAY_HEIGHT) {
        image.close();
        setImageFrame(null);
        setFileName('');
        setError(`Image must be exactly ${DISPLAY_WIDTH} × ${DISPLAY_HEIGHT}px.`);

        return;
      }

      const canvas = sourceCanvasRef.current;
      if (!canvas) {
        image.close();

        return;
      }

      const context = getCanvasContext(canvas);
      context.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      context.drawImage(image, 0, 0);
      image.close();

      const imageData = context.getImageData(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);

      setImageFrame({ pixels: imageData.data });
      setFileName(file.name);
    } catch {
      setImageFrame(null);
      setFileName('');
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
      setImageFrame(null);
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

    if (mode === 'image' && imageFrame) {
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

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}.`);
      }

      setUploadState('success');
    } catch (uploadFailure) {
      setUploadState('error');
      const message =
        uploadFailure instanceof Error && uploadFailure.message !== 'Failed to fetch'
          ? uploadFailure.message
          : `The display service at ${deviceConfig.uploadHost} could not be reached.`;

      setUploadError(`${message} It may not be available yet.`);
    }
  };

  const openForgetDialog = () => {
    setSettingsOpen(false);
    setForgetResult(null);
    setForgetDialogOpen(true);
  };

  const returnToSettings = () => {
    setForgetDialogOpen(false);
    setSettingsOpen(true);
  };

  const forgetWifi = async () => {
    setForgetting(true);
    setForgetResult(null);

    try {
      const response = await fetch('/wifi', { method: 'DELETE' });
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

      setForgetResult(result);
    } catch (forgetError) {
      setForgetResult({
        success: false,
        message:
          forgetError instanceof Error ? forgetError.message : 'Unable to forget the saved WiFi.',
      });
    } finally {
      setForgetting(false);
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
        <h1>Keg Display Studio</h1>
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
            className={`canvas-stage ${sourceFrame ? 'has-image' : ''} ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <canvas ref={sourceCanvasRef} width={DISPLAY_WIDTH} height={DISPLAY_HEIGHT} />
            {!imageFrame && mode === 'image' && (
              <label className="canvas-placeholder upload-placeholder" htmlFor="image-file">
                <span>+</span>
                <p>Click or drag a 400 × 600px image here</p>
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
            <canvas ref={previewCanvasRef} width={DISPLAY_WIDTH} height={DISPLAY_HEIGHT} />
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
              className="upload-button"
              type="button"
              disabled={!binary || uploadState === 'uploading'}
              onClick={() => void uploadBinary()}
            >
              {uploadState === 'uploading' ? 'Uploading…' : 'Upload to display'}
            </button>
          </div>
          {uploadState === 'success' && <p className="message success-message">Upload complete.</p>}
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
              className={`modal-icon ${uploadError ? 'error-modal-icon' : ''} ${isUploading ? 'uploading-modal-icon' : ''}`}
              aria-hidden="true"
            >
              {isUploading ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : uploadError ? (
                <CircleAlert size={22} strokeWidth={1.8} />
              ) : (
                <Trash2 size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="modal-title">
              {isUploading
                ? 'Uploading to display'
                : uploadError
                  ? 'Upload failed'
                  : `Reset ${pendingReset}?`}
            </h2>
            <p id="modal-description">
              {isUploading
                ? `Sending the display image to ${deviceConfig.uploadHost}. This may take a moment.`
                : (uploadError ??
                  (pendingReset === 'image'
                    ? 'This removes the uploaded image and its preview. Your text composition will be kept.'
                    : 'This restores the default text and appearance. Your uploaded image will be kept.'))}
            </p>
            {!isUploading && (
              <div className="modal-actions">
                {uploadError ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    autoFocus
                    onClick={() => setUploadError(null)}
                  >
                    Close
                  </button>
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
              <button type="button" autoFocus onClick={openForgetDialog}>
                <WifiOff size={19} aria-hidden="true" />
                <span>
                  <strong>Forget saved WiFi</strong>
                  <small>Remove the saved network and return to setup mode</small>
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

      {forgetDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !forgetting) {
              setForgetDialogOpen(false);
            }
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forget-modal-title"
            aria-describedby="forget-modal-description"
            aria-busy={forgetting}
          >
            <div
              className={`modal-icon forget-modal-icon ${forgetResult?.success ? 'success-modal-icon' : ''}`}
              aria-hidden="true"
            >
              {forgetting ? (
                <LoaderCircle className="upload-spinner" size={22} strokeWidth={1.8} />
              ) : (
                <WifiOff size={22} strokeWidth={1.8} />
              )}
            </div>
            <h2 id="forget-modal-title">
              {forgetting
                ? 'Forgetting saved WiFi'
                : forgetResult?.success
                  ? 'WiFi forgotten'
                  : forgetResult
                    ? 'Unable to forget WiFi'
                    : 'Forget saved WiFi?'}
            </h2>
            <p id="forget-modal-description">
              {forgetResult?.message ??
                (forgetting
                  ? 'Removing the saved network from this device.'
                  : 'The device will remove its saved network and reboot into setup mode.')}
            </p>
            {!forgetting && (
              <div className="modal-actions">
                {forgetResult ? (
                  <button
                    className="modal-button primary-modal-button"
                    type="button"
                    onClick={() => setForgetDialogOpen(false)}
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
                      onClick={() => void forgetWifi()}
                    >
                      Forget WiFi
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
