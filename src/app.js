// @ts-check
import { createFileEnvelope, estimateEnvelopeSize, inspectFileEnvelope, openFileEnvelope } from "./core/envelope.js";
import { createSessionId, FRAME_HEADER_LENGTH, MAX_TRANSFER_BYTES, sessionIdToHex } from "./core/protocol.js";
import { createQrMatrix } from "../vendor/qrcode.js";

const PROFILES = {
  robust: { label: "USB WEBCAM", blockLength: 320, fps: 8, correctionLevel: "M", factor: 1.5 },
  balanced: { label: "BALANCED", blockLength: 768, fps: 14, correctionLevel: "M", factor: 1.32 },
  fast: { label: "FAST", blockLength: 1280, fps: 20, correctionLevel: "L", factor: 1.25 },
};

const CUSTOM_DENSITY_LIMITS = Object.freeze({ L: 2171, M: 1704, Q: 1203, H: 911 });
const CUSTOM_CORRECTION_STRENGTH = Object.freeze({ L: "7%", M: "15%", Q: "25%", H: "30%" });

const element = (id) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found;
};

const modeGate = element("modeGate");
const modeSwitch = element("modeSwitch");
const sendWorkspace = element("sendWorkspace");
const receiveWorkspace = element("receiveWorkspace");
const chooseModeButton = element("chooseModeButton");

const fileInput = /** @type {HTMLInputElement} */ (element("fileInput"));
const dropZone = element("dropZone");
const fileReadyStage = element("fileReadyStage");
const fileReadyGlyph = element("fileReadyGlyph");
const fileReadyName = element("fileReadyName");
const fileReadyMeta = element("fileReadyMeta");
const replaceFileButton = element("replaceFileButton");
const sendFileCard = element("sendFileCard");
const sendFileGlyph = element("sendFileGlyph");
const sendFileName = element("sendFileName");
const sendFileMeta = element("sendFileMeta");
const clearFileButton = element("clearFileButton");
const profileFieldset = /** @type {HTMLFieldSetElement} */ (element("profileFieldset"));
const customProfilePanel = element("customProfilePanel");
const customDensityInput = /** @type {HTMLInputElement} */ (element("customDensityInput"));
const customDensityValue = /** @type {HTMLOutputElement} */ (element("customDensityValue"));
const customSpeedInput = /** @type {HTMLInputElement} */ (element("customSpeedInput"));
const customSpeedValue = /** @type {HTMLOutputElement} */ (element("customSpeedValue"));
const customCorrectionInput = /** @type {HTMLSelectElement} */ (element("customCorrectionInput"));
const customCorrectionValue = element("customCorrectionValue");
const customQrMetric = element("customQrMetric");
const customCapacityMetric = element("customCapacityMetric");
const customLimitMetric = element("customLimitMetric");
const customRiskMetric = element("customRiskMetric");
const securityFieldset = /** @type {HTMLFieldSetElement} */ (element("securityFieldset"));
const encryptToggle = /** @type {HTMLInputElement} */ (element("encryptToggle"));
const sendPasswordRow = element("sendPasswordRow");
const sendPassphrase = /** @type {HTMLInputElement} */ (element("sendPassphrase"));
const sendSizeMetric = element("sendSizeMetric");
const sendTimeMetric = element("sendTimeMetric");
const sendRateMetric = element("sendRateMetric");
const sendProtectionMetric = element("sendProtectionMetric");
const startSendButton = /** @type {HTMLButtonElement} */ (element("startSendButton"));
const sendHelp = element("sendHelp");
const sendStageState = element("sendStageState");
const qrStage = element("qrStage");
const qrCanvas = /** @type {HTMLCanvasElement} */ (element("qrCanvas"));
const sendStageActions = element("sendStageActions");
const pauseSendButton = /** @type {HTMLButtonElement} */ (element("pauseSendButton"));
const fullscreenButton = element("fullscreenButton");
const cancelSendButton = element("cancelSendButton");
const sendTransferStrip = element("sendTransferStrip");
const sendStatusText = element("sendStatusText");
const sendProgressText = element("sendProgressText");
const sendProgressBar = /** @type {HTMLElement} */ (element("sendProgressBar"));
const sendSessionMetric = element("sendSessionMetric");
const sendFrameMetric = element("sendFrameMetric");
const sendElapsedMetric = element("sendElapsedMetric");
const sendQrMetric = element("sendQrMetric");

const cameraVideo = /** @type {HTMLVideoElement} */ (element("cameraVideo"));
const captureCanvas = /** @type {HTMLCanvasElement} */ (element("captureCanvas"));
const cameraPlaceholder = element("cameraPlaceholder");
const scanGuide = element("scanGuide");
const scanLine = element("scanLine");
const cameraState = element("cameraState");
const startCameraButton = /** @type {HTMLButtonElement} */ (element("startCameraButton"));
const stopCameraButton = /** @type {HTMLButtonElement} */ (element("stopCameraButton"));
const resetReceiveButton = element("resetReceiveButton");
const cameraSelect = /** @type {HTMLSelectElement} */ (element("cameraSelect"));
const receiveRingValue = element("receiveRingValue");
const receiveStatusTitle = element("receiveStatusTitle");
const receiveStatusDetail = element("receiveStatusDetail");
const receiveProgressBar = /** @type {HTMLElement} */ (element("receiveProgressBar"));
const receiveSessionMetric = element("receiveSessionMetric");
const receiveReadsMetric = element("receiveReadsMetric");
const receiveFramesMetric = element("receiveFramesMetric");
const receiveDamagedMetric = element("receiveDamagedMetric");
const compatibilityText = element("compatibilityText");
const resultPanel = element("resultPanel");
const resultName = element("resultName");
const resultMeta = element("resultMeta");
const resultHash = element("resultHash");
const downloadLink = /** @type {HTMLAnchorElement} */ (element("downloadLink"));
const receiveAnotherButton = element("receiveAnotherButton");
const resultPreview = element("resultPreview");
const passphraseDialog = /** @type {HTMLDialogElement} */ (element("passphraseDialog"));
const passphraseForm = /** @type {HTMLFormElement} */ (element("passphraseForm"));
const receivePassphrase = /** @type {HTMLInputElement} */ (element("receivePassphrase"));
const passphraseError = element("passphraseError");
const unlockButton = /** @type {HTMLButtonElement} */ (element("unlockButton"));

const qrContext = qrCanvas.getContext("2d", { alpha: false });
const captureContext = captureCanvas.getContext("2d", { alpha: false });
if (!qrContext || !captureContext) throw new Error("Canvas support is required.");

let activeMode = "";
let selectedFile = null;
let displayRefreshRate = 60;
let wakeLock = null;
let resultObjectUrl = "";

const senderWorker = createPortableSenderWorker();
let senderGeneration = 0;
let senderQueue = [];
let senderPendingBatches = 0;
let senderActive = false;
let senderPaused = false;
let senderAnimationId = 0;
let senderLastFrameAt = 0;
let senderStartedAt = 0;
let senderFramesShown = 0;
let senderBlockCount = 0;
let senderSuggestedFrames = 0;
let senderProfile = PROFILES.robust;
let senderSessionHex = "";
let senderEffectiveFps = senderProfile.fps;
let senderQrSize = 0;
let qrResizeObserver = null;

const decoderWorker = createPortableDecoderWorker();
let cameraStream = null;
let barcodeDetector = null;
let softwareQrDecoder = null;
let wasmQrDecoder = null;
let qrDecoderLabel = "";
let cameraRunning = false;
let detectionBusy = false;
let videoFrameRequestId = 0;
let animationFrameRequestId = 0;
let lastCameraScanAt = 0;
let cameraFrames = 0;
let decodeAttempts = 0;
let qrReads = 0;
let scanFailures = 0;
let scanRegion = null;
let pendingEnvelope = null;
let receiverComplete = false;

initialize();

async function initialize() {
  bindInterface();
  installQrCanvasSizing();
  await measureDisplayRefreshRate();
  updateSendEstimate();
  await checkReceiverSupport();
  registerOfflineApp();
  await enumerateCameras(false);
  const requestedMode = new URLSearchParams(location.search).get("mode");
  if (requestedMode === "send" || requestedMode === "receive") switchMode(requestedMode);
}

function bindInterface() {
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => switchMode(button.getAttribute("data-mode") || ""));
  }
  chooseModeButton.addEventListener("click", showModeGate);

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
  }
  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) selectFile(fileInput.files[0]); });
  clearFileButton.addEventListener("click", clearSelectedFile);
  replaceFileButton.addEventListener("click", () => fileInput.click());
  document.querySelectorAll('input[name="profile"]').forEach((input) => input.addEventListener("change", () => {
    updateCustomProfileUi();
    updateSendEstimate();
  }));
  for (const input of [customDensityInput, customSpeedInput, customCorrectionInput]) {
    input.addEventListener("input", () => { updateCustomProfileUi(); updateSendEstimate(); });
    input.addEventListener("change", () => { updateCustomProfileUi(); updateSendEstimate(); });
  }
  encryptToggle.addEventListener("change", () => {
    sendPasswordRow.classList.toggle("hidden", !encryptToggle.checked);
    sendProtectionMetric.textContent = encryptToggle.checked ? "AES-256" : "SHA-256";
    updateSendEstimate();
  });
  startSendButton.addEventListener("click", startSending);
  pauseSendButton.addEventListener("click", toggleSenderPause);
  cancelSendButton.addEventListener("click", () => stopSending(false));
  fullscreenButton.addEventListener("click", toggleQrFullscreen);

  startCameraButton.addEventListener("click", () => {
    if (pendingEnvelope && !receiverComplete) showPassphraseDialog();
    else startCamera();
  });
  stopCameraButton.addEventListener("click", stopCamera);
  resetReceiveButton.addEventListener("click", resetReceiver);
  cameraSelect.addEventListener("change", async () => {
    if (cameraRunning) { await stopCamera(); await startCamera(); }
  });
  receiveAnotherButton.addEventListener("click", async () => { resetReceiver(); await startCamera(); });

  for (const button of document.querySelectorAll("[data-toggle-password]")) {
    button.addEventListener("click", () => {
      const input = /** @type {HTMLInputElement} */ (element(button.getAttribute("data-toggle-password") || ""));
      input.type = input.type === "password" ? "text" : "password";
      button.textContent = input.type === "password" ? "SHOW" : "HIDE";
    });
  }
  passphraseForm.addEventListener("submit", handlePassphraseSubmit);
  passphraseDialog.addEventListener("cancel", () => {
    receiveStatusTitle.textContent = "PASSPHRASE NEEDED";
    receiveStatusDetail.textContent = "Tap Enter passphrase to unlock the protected file.";
    startCameraButton.textContent = "ENTER PASSPHRASE";
    startCameraButton.classList.remove("hidden");
  });

  senderWorker.addEventListener("message", handleSenderWorkerMessage);
  senderWorker.addEventListener("error", () => failSender("The QR generator stopped unexpectedly."));
  decoderWorker.addEventListener("message", handleDecoderWorkerMessage);
  decoderWorker.addEventListener("error", () => setReceiveError("The file decoder stopped unexpectedly."));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && senderActive && !senderPaused) setSenderPaused(true, "PAUSED — SCREEN NOT VISIBLE");
    else if (document.visibilityState === "visible" && senderActive && !senderPaused) acquireWakeLock();
  });
  document.addEventListener("fullscreenchange", () => { fullscreenButton.textContent = document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN"; });
  window.addEventListener("beforeunload", () => { stopCamera(); releaseWakeLock(); revokeResultUrl(); });
}

function switchMode(mode) {
  if (mode !== "send" && mode !== "receive") return;
  activeMode = mode;
  modeGate.classList.add("hidden");
  modeSwitch.classList.remove("hidden");
  sendWorkspace.classList.toggle("hidden", mode !== "send");
  receiveWorkspace.classList.toggle("hidden", mode !== "receive");
  for (const button of modeSwitch.querySelectorAll("[data-mode]")) button.classList.toggle("active", button.getAttribute("data-mode") === mode);
  if (mode === "send") stopCamera();
  if (mode === "receive" && senderActive && !senderPaused) setSenderPaused(true, "PAUSED — RECEIVER MODE OPEN");
  requestAnimationFrame(() => modeSwitch.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function showModeGate() {
  if (senderActive) stopSending(false);
  stopCamera();
  activeMode = "";
  modeGate.classList.remove("hidden");
  modeSwitch.classList.add("hidden");
  sendWorkspace.classList.add("hidden");
  receiveWorkspace.classList.add("hidden");
  modeGate.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectFile(file) {
  if (senderActive) stopSending(true);
  if (file.size > MAX_TRANSFER_BYTES - 65_536) {
    showToast("This file is above the 128 MiB safety limit.", "error");
    return;
  }
  selectedFile = file;
  fileInput.value = "";
  sendFileCard.classList.remove("empty");
  sendFileGlyph.textContent = getFileLabel(file);
  sendFileName.textContent = file.name || "unnamed-file";
  sendFileMeta.textContent = `${formatBytes(file.size)} · ${file.type || "unknown type"}`;
  fileReadyGlyph.textContent = getFileLabel(file);
  fileReadyName.textContent = file.name || "unnamed-file";
  fileReadyMeta.textContent = `${formatBytes(file.size)} · ${file.type || "unknown type"}`;
  dropZone.classList.add("hidden");
  fileReadyStage.classList.remove("hidden");
  sendStageState.textContent = "FILE READY";
  clearFileButton.classList.remove("hidden");
  profileFieldset.disabled = false;
  securityFieldset.disabled = false;
  startSendButton.disabled = false;
  sendHelp.textContent = file.size > 25 * 1024 * 1024
    ? "Large optical transfers can take a long time and use significant memory. Keep both devices powered."
    : "The sender cannot know when the other device has finished, so stop after the receiver confirms.";
  updateSendEstimate();
}

function clearSelectedFile() {
  stopSending(true);
  selectedFile = null;
  sendFileCard.classList.add("empty");
  sendFileGlyph.textContent = "--";
  sendFileName.textContent = "NO FILE SELECTED";
  sendFileMeta.textContent = "Choose a file to continue";
  fileReadyGlyph.textContent = "FILE";
  fileReadyName.textContent = "NO FILE SELECTED";
  fileReadyMeta.textContent = "Choose a file to continue";
  fileReadyStage.classList.add("hidden");
  dropZone.classList.remove("hidden");
  sendStageState.textContent = "WAITING FOR FILE";
  clearFileButton.classList.add("hidden");
  profileFieldset.disabled = true;
  securityFieldset.disabled = true;
  startSendButton.disabled = true;
  sendSizeMetric.textContent = "--";
  sendTimeMetric.textContent = "--";
  sendRateMetric.textContent = "--";
  sendHelp.textContent = "Choose a file first. The sender cannot know when the other device has finished, so stop after the receiver confirms.";
}

function selectedProfile() {
  const input = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="profile"]:checked'));
  if (input?.value === "custom") {
    const correctionLevel = customCorrectionInput.value in CUSTOM_DENSITY_LIMITS ? customCorrectionInput.value : "L";
    const maximum = CUSTOM_DENSITY_LIMITS[correctionLevel];
    return {
      label: "CUSTOM / LAB",
      blockLength: clampInteger(customDensityInput.value, 128, maximum),
      fps: clampInteger(customSpeedInput.value, 1, 60),
      correctionLevel,
      factor: 1.25,
    };
  }
  return PROFILES[input?.value] || PROFILES.robust;
}

function updateCustomProfileUi() {
  const selected = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="profile"]:checked'));
  customProfilePanel.classList.toggle("hidden", selected?.value !== "custom");

  const correction = customCorrectionInput.value in CUSTOM_DENSITY_LIMITS ? customCorrectionInput.value : "L";
  const densityLimit = CUSTOM_DENSITY_LIMITS[correction];
  customDensityInput.max = String(densityLimit);
  const density = clampInteger(customDensityInput.value, 128, densityLimit);
  const fps = clampInteger(customSpeedInput.value, 1, 60);
  customDensityInput.value = String(density);
  customSpeedInput.value = String(fps);

  const qrModules = estimateQrModules(density, correction);
  const rawBytesPerSecond = density * fps;
  const densityRatio = density / densityLimit;
  const risk = fps > 30 || (fps > 24 && densityRatio > 0.75)
    ? "EXTREME"
    : densityRatio > 0.82 || fps > 24 ? "HIGH"
      : densityRatio > 0.6 || fps > 18 ? "MEDIUM" : "LOW";

  customDensityValue.value = `${density} B`;
  customDensityValue.textContent = `${density} B`;
  customSpeedValue.value = `${fps} QR/S`;
  customSpeedValue.textContent = `${fps} QR/S`;
  customCorrectionValue.textContent = `${correction} / ${CUSTOM_CORRECTION_STRENGTH[correction]}`;
  customQrMetric.textContent = `${qrModules}×${qrModules}`;
  customCapacityMetric.textContent = `${formatBytes(rawBytesPerSecond)}/S`;
  customLimitMetric.textContent = `${densityLimit} B · ${CUSTOM_CORRECTION_STRENGTH[correction]} RECOVERY`;
  customRiskMetric.textContent = risk;
  customRiskMetric.dataset.risk = risk.toLowerCase();
}

function estimateQrModules(blockLength, correctionLevel) {
  const encodedLength = Math.ceil((FRAME_HEADER_LENGTH + blockLength) * 4 / 3);
  return createQrMatrix(`DOT2:${"a".repeat(encodedLength)}`, correctionLevel).size;
}

function clampInteger(value, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
}

function updateSendEstimate() {
  senderProfile = selectedProfile();
  senderEffectiveFps = Math.max(1, Math.min(senderProfile.fps, 60, Math.floor(displayRefreshRate)));
  sendRateMetric.textContent = `${senderEffectiveFps} QR/S · ${formatBytes(senderProfile.blockLength * senderEffectiveFps)}/S`;
  sendProtectionMetric.textContent = encryptToggle.checked ? "AES-256" : "SHA-256";
  if (!selectedFile) return;
  sendSizeMetric.textContent = formatBytes(selectedFile.size);
  const estimatedEnvelope = estimateEnvelopeSize(selectedFile.size, encryptToggle.checked, Math.min(1024, selectedFile.name.length * 4 + 128));
  const blockCount = Math.ceil(estimatedEnvelope / senderProfile.blockLength);
  const seconds = Math.max(1, Math.ceil((blockCount * senderProfile.factor) / senderEffectiveFps));
  sendTimeMetric.textContent = formatDuration(seconds);
}

async function startSending() {
  if (!selectedFile || senderActive) return;
  if (!globalThis.crypto?.subtle) { failSender("This browser does not provide the secure cryptography needed by the app."); return; }
  const passphrase = encryptToggle.checked ? sendPassphrase.value : "";
  if (encryptToggle.checked && passphrase.length < 10) {
    sendPassphrase.focus();
    showToast("Use a passphrase with at least 10 characters.", "error");
    return;
  }

  senderActive = true;
  senderPaused = false;
  senderQueue = [];
  senderPendingBatches = 0;
  senderFramesShown = 0;
  senderStartedAt = 0;
  senderLastFrameAt = 0;
  senderQrSize = 0;
  senderProfile = selectedProfile();
  senderEffectiveFps = Math.max(1, Math.min(senderProfile.fps, 60, Math.floor(displayRefreshRate)));
  setSendControlsLocked(true);
  dropZone.classList.add("hidden");
  fileReadyStage.classList.add("hidden");
  qrStage.classList.remove("hidden");
  requestAnimationFrame(fitQrCanvas);
  sendStageActions.classList.remove("hidden");
  sendTransferStrip.classList.remove("hidden");
  sendStageState.textContent = "PREPARING";
  sendStatusText.textContent = "PREPARING FILE LOCALLY";
  setSenderProgress(0);
  renderWaitingCanvas();

  try {
    const envelope = await createFileEnvelope(selectedFile, passphrase);
    if (!senderActive) return;
    const sessionId = createSessionId();
    senderSessionHex = sessionIdToHex(sessionId).slice(0, 12).toUpperCase();
    sendSessionMetric.textContent = senderSessionHex;
    senderWorker.postMessage({
      type: "init",
      payload: envelope.bytes.buffer,
      sessionId: sessionId.buffer,
      blockLength: senderProfile.blockLength,
      correctionLevel: senderProfile.correctionLevel,
    }, [envelope.bytes.buffer, sessionId.buffer]);
    sendStatusText.textContent = envelope.encrypted ? "BUILDING PROTECTED QR STREAM" : "BUILDING QR STREAM";
  } catch (error) {
    failSender(error instanceof Error ? error.message : String(error));
  }
}

function handleSenderWorkerMessage(event) {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "ready") {
    senderGeneration = message.generation;
    senderBlockCount = message.blockCount;
    senderSuggestedFrames = Math.ceil(senderBlockCount * senderProfile.factor);
    senderStartedAt = performance.now();
    sendStageState.textContent = "LIVE";
    sendStatusText.textContent = "BROADCASTING — WAIT FOR RECEIVER";
    acquireWakeLock();
    fillSenderQueue();
    cancelAnimationFrame(senderAnimationId);
    senderAnimationId = requestAnimationFrame(senderTick);
    return;
  }
  if (message.type === "frames") {
    if (message.generation !== senderGeneration || !senderActive) return;
    senderPendingBatches = Math.max(0, senderPendingBatches - 1);
    for (const frame of message.frames) senderQueue.push({ ...frame, modules: new Uint8Array(frame.modules) });
    fillSenderQueue();
    return;
  }
  if (message.type === "error") failSender(message.message || "QR generation failed.");
}

function fillSenderQueue() {
  if (!senderActive || senderGeneration === 0) return;
  while (senderQueue.length + senderPendingBatches * 3 < 10 && senderPendingBatches < 3) {
    senderPendingBatches += 1;
    senderWorker.postMessage({ type: "generate", count: 3, generation: senderGeneration });
  }
}

function senderTick(timestamp) {
  if (!senderActive) return;
  const interval = 1000 / senderEffectiveFps;
  if (!senderPaused && timestamp - senderLastFrameAt >= interval) {
    const frame = senderQueue.shift();
    if (frame) {
      senderLastFrameAt = timestamp;
      senderFramesShown += 1;
      senderQrSize = frame.size;
      renderQr(frame.modules, frame.size);
      updateSenderLiveMetrics();
      fillSenderQueue();
    }
  }
  senderAnimationId = requestAnimationFrame(senderTick);
}

function renderQr(modules, matrixSize) {
  const width = qrCanvas.width;
  const height = qrCanvas.height;
  const quietZone = 4;
  const totalModules = matrixSize + quietZone * 2;
  const scale = Math.max(1, Math.floor(Math.min(width, height) / totalModules));
  const drawSize = totalModules * scale;
  const offsetX = Math.floor((width - drawSize) / 2);
  const offsetY = Math.floor((height - drawSize) / 2);
  qrContext.fillStyle = "#ffffff";
  qrContext.fillRect(0, 0, width, height);
  qrContext.fillStyle = "#000000";
  qrContext.beginPath();
  for (let row = 0; row < matrixSize; row += 1) {
    for (let column = 0; column < matrixSize; column += 1) {
      if (modules[row * matrixSize + column]) qrContext.rect(offsetX + (column + quietZone) * scale, offsetY + (row + quietZone) * scale, scale, scale);
    }
  }
  qrContext.fill();
}

function installQrCanvasSizing() {
  if ("ResizeObserver" in globalThis) {
    qrResizeObserver = new ResizeObserver(() => fitQrCanvas());
    qrResizeObserver.observe(qrStage);
  }
  window.addEventListener("resize", fitQrCanvas);
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(fitQrCanvas));
}

function fitQrCanvas() {
  if (qrStage.classList.contains("hidden")) return;
  const style = getComputedStyle(qrStage);
  const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const availableWidth = Math.max(1, qrStage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, qrStage.clientHeight - verticalPadding);
  const size = Math.max(1, Math.floor(Math.min(920, availableWidth, availableHeight)));
  qrCanvas.style.width = `${size}px`;
  qrCanvas.style.height = `${size}px`;
}

function renderWaitingCanvas() {
  qrContext.fillStyle = "#ffffff";
  qrContext.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
  qrContext.fillStyle = "#050505";
  qrContext.font = "600 24px monospace";
  qrContext.textAlign = "center";
  qrContext.fillText("PREPARING TRANSFER", qrCanvas.width / 2, qrCanvas.height / 2);
}

function updateSenderLiveMetrics() {
  const progress = senderSuggestedFrames > 0 ? Math.min(1, senderFramesShown / senderSuggestedFrames) : 0;
  setSenderProgress(progress);
  sendFrameMetric.textContent = senderFramesShown.toLocaleString("en-US");
  sendQrMetric.textContent = senderQrSize ? `${senderQrSize}×${senderQrSize}` : "--";
  const elapsed = senderStartedAt ? Math.max(0, (performance.now() - senderStartedAt) / 1000) : 0;
  sendElapsedMetric.textContent = formatClock(elapsed);
  if (progress >= 1) {
    sendStatusText.textContent = "MINIMUM WINDOW REACHED — KEEP SHOWING UNTIL CONFIRMED";
    sendProgressText.textContent = "100%+";
  }
}

function setSenderProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  sendProgressBar.style.width = `${percent}%`;
  sendProgressText.textContent = `${percent}%`;
}

function toggleSenderPause() {
  if (!senderActive) return;
  setSenderPaused(!senderPaused);
}

function setSenderPaused(paused, label = "") {
  senderPaused = paused;
  pauseSendButton.textContent = paused ? "RESUME" : "PAUSE";
  sendStatusText.textContent = paused ? (label || "PAUSED") : "BROADCASTING — WAIT FOR RECEIVER";
  sendStageState.textContent = paused ? "PAUSED" : "LIVE";
  if (paused) releaseWakeLock();
  else { senderLastFrameAt = 0; acquireWakeLock(); }
}

function stopSending(silent) {
  if (!senderActive && silent) return;
  senderActive = false;
  senderPaused = false;
  senderGeneration = 0;
  senderQueue = [];
  senderPendingBatches = 0;
  cancelAnimationFrame(senderAnimationId);
  senderWorker.postMessage({ type: "reset" });
  releaseWakeLock();
  dropZone.classList.toggle("hidden", Boolean(selectedFile));
  fileReadyStage.classList.toggle("hidden", !selectedFile);
  qrStage.classList.add("hidden");
  sendStageActions.classList.add("hidden");
  sendTransferStrip.classList.add("hidden");
  sendStageState.textContent = selectedFile ? "READY" : "WAITING FOR FILE";
  pauseSendButton.textContent = "PAUSE";
  setSendControlsLocked(false);
  if (!silent) showToast("Display stopped. The selected file is still ready.");
}

function failSender(message) {
  stopSending(true);
  showToast(message, "error");
  sendHelp.textContent = message;
}

function setSendControlsLocked(locked) {
  profileFieldset.disabled = locked || !selectedFile;
  securityFieldset.disabled = locked || !selectedFile;
  startSendButton.disabled = locked || !selectedFile;
  clearFileButton.disabled = locked;
  startSendButton.textContent = locked ? "DISPLAYING" : "START DISPLAY";
}

async function toggleQrFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await qrStage.requestFullscreen();
  } catch { showToast("Full-screen mode is not available in this browser.", "error"); }
}

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* Wake lock is optional. */ }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch { /* no-op */ }
  wakeLock = null;
}

async function checkReceiverSupport() {
  barcodeDetector = null;
  softwareQrDecoder = typeof globalThis.jsQR === "function" ? globalThis.jsQR : null;
  wasmQrDecoder = null;

  if (
    typeof globalThis.ZXingWASM?.readBarcodes === "function"
    && typeof globalThis.ZXingWASM?.prepareZXingModule === "function"
    && typeof ZXING_READER_WASM_DATA_URL === "string"
  ) {
    try {
      globalThis.ZXingWASM.prepareZXingModule({
        overrides: {
          locateFile: (file) => file.endsWith(".wasm") ? ZXING_READER_WASM_DATA_URL : file,
        },
      });
      wasmQrDecoder = globalThis.ZXingWASM.readBarcodes;
    } catch {
      wasmQrDecoder = null;
    }
  }

  qrDecoderLabel = wasmQrDecoder
    ? "ZXing-C++ + jsQR software readers"
    : softwareQrDecoder ? "jsQR software reader" : "";

  if ("BarcodeDetector" in globalThis) {
    try {
      const Detector = globalThis.BarcodeDetector;
      const supported = typeof Detector.getSupportedFormats === "function"
        ? await Detector.getSupportedFormats()
        : ["qr_code"];
      if (supported.includes("qr_code")) {
        barcodeDetector = new Detector({ formats: ["qr_code"] });
        qrDecoderLabel = wasmQrDecoder || softwareQrDecoder
          ? `native + ${qrDecoderLabel}`
          : "native QR reader";
      }
    } catch {
      barcodeDetector = null;
    }
  }

  const cameraAvailable = Boolean(navigator.mediaDevices?.getUserMedia);
  const secureEnough = window.isSecureContext;
  const decoderAvailable = Boolean(barcodeDetector || wasmQrDecoder || softwareQrDecoder);

  if (!secureEnough) {
    compatibilityText.textContent = "Camera access needs HTTPS. Open QR Relay from a secure https:// address.";
  } else if (!cameraAvailable) {
    compatibilityText.textContent = "This browser does not expose camera access to web pages. Sending still works.";
  } else if (!decoderAvailable) {
    compatibilityText.textContent = "The camera can open, but the local QR reader is missing from this build. Rebuild the published artifact.";
  } else {
    compatibilityText.textContent = `Camera access is ready. This build uses ${qrDecoderLabel}; all QR processing stays on this device.`;
  }

  // Permission must be requested from a real user click. Do not block the button
  // merely because the experimental native BarcodeDetector API is absent.
  startCameraButton.disabled = !secureEnough || !cameraAvailable;
}

async function startCamera() {
  if (cameraRunning || receiverComplete) return;
  if (!window.isSecureContext) {
    setReceiveError("Camera access requires HTTPS. Open the secure https:// address, not an HTTP mirror.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setReceiveError("This browser does not provide camera access to web pages.");
    return;
  }

  startCameraButton.disabled = true;
  cameraState.textContent = "REQUESTING ACCESS";
  receiveStatusTitle.textContent = "OPENING CAMERA";
  receiveStatusDetail.textContent = "Choose Allow when the browser asks to use your camera.";

  try {
    cameraStream = await requestCameraStream();
    cameraVideo.srcObject = cameraStream;
    cameraVideo.setAttribute("playsinline", "");
    cameraVideo.muted = true;
    await cameraVideo.play();

    if (!barcodeDetector && !wasmQrDecoder && !softwareQrDecoder) {
      throw new Error("The QR reader is missing from this build. Rebuild and redeploy the published artifact.");
    }

    cameraRunning = true;
    detectionBusy = false;
    lastCameraScanAt = 0;
    scanFailures = 0;
    scanRegion = null;
    cameraPlaceholder.classList.add("hidden");
    scanGuide.classList.remove("hidden");
    scanLine.classList.remove("hidden");
    startCameraButton.classList.add("hidden");
    stopCameraButton.classList.remove("hidden");
    cameraState.textContent = "SCANNING";
    receiveStatusTitle.textContent = "LOOKING FOR SENDER";
    receiveStatusDetail.textContent = "Keep the complete QR code inside the guide.";
    await enumerateCameras(true);
    scheduleCameraFrame();
  } catch (error) {
    for (const track of cameraStream?.getTracks?.() || []) track.stop();
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraState.textContent = "CAMERA ERROR";
    receiveStatusTitle.textContent = "CAMERA NOT AVAILABLE";
    receiveStatusDetail.textContent = friendlyCameraError(error);
    startCameraButton.classList.remove("hidden");
    startCameraButton.disabled = false;
    stopCameraButton.classList.add("hidden");
  }
}

async function requestCameraStream() {
  const selectedDevice = cameraSelect.value;
  const attempts = [];
  if (selectedDevice) {
    attempts.push({
      audio: false,
      video: {
        deviceId: { exact: selectedDevice },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
    });
  }
  attempts.push({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 },
    },
  });
  attempts.push({ audio: false, video: true });

  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "NotAllowedError") throw error;
    }
  }
  throw lastError || new Error("The camera could not start.");
}

async function stopCamera() {
  cameraRunning = false;
  detectionBusy = false;
  if (typeof cameraVideo.cancelVideoFrameCallback === "function" && videoFrameRequestId) cameraVideo.cancelVideoFrameCallback(videoFrameRequestId);
  if (animationFrameRequestId) cancelAnimationFrame(animationFrameRequestId);
  videoFrameRequestId = 0;
  animationFrameRequestId = 0;
  for (const track of cameraStream?.getTracks?.() || []) track.stop();
  cameraStream = null;
  cameraVideo.srcObject = null;
  cameraPlaceholder.classList.remove("hidden");
  scanGuide.classList.add("hidden");
  scanLine.classList.add("hidden");
  stopCameraButton.classList.add("hidden");
  if (!receiverComplete) {
    startCameraButton.classList.remove("hidden");
    startCameraButton.disabled = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
    startCameraButton.textContent = pendingEnvelope ? "ENTER PASSPHRASE" : "START CAMERA";
    cameraState.textContent = "CAMERA OFF";
  }
}

function scheduleCameraFrame() {
  if (!cameraRunning) return;
  if (typeof cameraVideo.requestVideoFrameCallback === "function") {
    videoFrameRequestId = cameraVideo.requestVideoFrameCallback((time) => { scanCameraFrame(time); scheduleCameraFrame(); });
  } else {
    animationFrameRequestId = requestAnimationFrame((time) => { scanCameraFrame(time); scheduleCameraFrame(); });
  }
}

async function scanCameraFrame(timestamp) {
  cameraFrames += 1;
  // Give each displayed QR more than one decoding opportunity. Webcams aimed
  // at LCD panels need a slower cadence to avoid refresh tearing and moire.
  // ZXing-WASM is fast enough to analyze almost every 30 fps camera frame.
  // Keep the slower cadence only for the legacy jsQR-only fallback.
  const minimumInterval = barcodeDetector || wasmQrDecoder ? 32 : 95;
  if (!cameraRunning || detectionBusy || timestamp - lastCameraScanAt < minimumInterval || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  detectionBusy = true;
  lastCameraScanAt = timestamp;
  decodeAttempts += 1;
  try {
    const source = getCameraSourceRect();
    // Keep enough pixels per QR module when the code occupies only part of a
    // 1080p webcam frame. The old 760 px cap made dense screen captures fall
    // below the software reader's practical module resolution.
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
    const drawWidth = Math.max(240, Math.round(source.width * scale));
    const drawHeight = Math.max(240, Math.round(source.height * scale));
    if (captureCanvas.width !== drawWidth) captureCanvas.width = drawWidth;
    if (captureCanvas.height !== drawHeight) captureCanvas.height = drawHeight;
    captureContext.drawImage(cameraVideo, source.x, source.y, source.width, source.height, 0, 0, drawWidth, drawHeight);

    const result = await detectTransferQr(drawWidth, drawHeight);
    if (result?.value?.startsWith("DOT2:")) {
      qrReads += 1;
      receiveReadsMetric.textContent = qrReads.toLocaleString("en-US");
      if (result.box) updateScanRegion(result.box, source, drawWidth, drawHeight);
      scanFailures = 0;
      decoderWorker.postMessage({ type: "frame", value: result.value });
    } else {
      scanFailures += 1;
      if (scanFailures > 7) scanRegion = null;
      if (qrReads === 0 && decodeAttempts % 10 === 0) {
        cameraState.textContent = "SCANNING — NO QR YET";
        receiveStatusTitle.textContent = "CAMERA ACTIVE";
        receiveStatusDetail.textContent = `${decodeAttempts.toLocaleString("en-US")} camera frames analyzed at ${drawWidth}×${drawHeight}. Enlarge the QR, use Webcam mode, and keep it centered.`;
      }
    }
  } catch (error) {
    scanFailures += 1;
    if (scanFailures > 7) scanRegion = null;
    if (decodeAttempts % 10 === 0) {
      receiveStatusTitle.textContent = "SCANNER RETRYING";
      receiveStatusDetail.textContent = error instanceof Error
        ? `The QR reader is retrying after: ${error.message}`
        : "The QR reader is retrying the camera frame.";
    }
  } finally {
    detectionBusy = false;
  }
}

async function detectTransferQr(width, height) {
  if (barcodeDetector) {
    try {
      const codes = await barcodeDetector.detect(captureCanvas);
      const code = codes.find((item) => typeof item.rawValue === "string" && item.rawValue.startsWith("DOT2:"));
      if (code) return { value: code.rawValue, box: code.boundingBox || null };
    } catch {
      // Some implementations expose BarcodeDetector but fail on canvas input.
      // Fall through to the bundled software reader.
    }
  }

  let image = null;
  if (wasmQrDecoder) {
    try {
      image = captureContext.getImageData(0, 0, width, height);
      const codes = await wasmQrDecoder(image, {
        formats: ["QRCode"],
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
        tryDenoise: true,
        maxNumberOfSymbols: 1,
      });
      const code = codes.find((item) => typeof item.text === "string" && item.text.startsWith("DOT2:"));
      if (code) return { value: code.text, box: null };
    } catch {
      // Fall through to jsQR if the WebAssembly reader cannot process a frame.
    }
  }

  if (softwareQrDecoder) {
    image ||= captureContext.getImageData(0, 0, width, height);
    const code = softwareQrDecoder(image.data, width, height, { inversionAttempts: "dontInvert" });
    if (code?.data) return { value: code.data, box: jsQrBoundingBox(code.location) };
  }
  return null;
}

function jsQrBoundingBox(location) {
  if (!location) return null;
  const points = [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomRightCorner,
    location.bottomLeftCorner,
  ].filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function getCameraSourceRect() {
  const width = cameraVideo.videoWidth || 1280;
  const height = cameraVideo.videoHeight || 720;
  if (!scanRegion) {
    // Match the visible 13% scan-guide inset. Restricting the initial search
    // keeps recursive QR reflections and other browser windows out of jsQR's
    // finder-pattern search while preserving the camera's native pixels.
    const insetX = Math.round(width * 0.13);
    const insetY = Math.round(height * 0.13);
    return {
      x: insetX,
      y: insetY,
      width: Math.max(240, width - insetX * 2),
      height: Math.max(240, height - insetY * 2),
    };
  }
  return {
    x: clamp(scanRegion.x, 0, width - 1),
    y: clamp(scanRegion.y, 0, height - 1),
    width: clamp(scanRegion.width, 120, width - scanRegion.x),
    height: clamp(scanRegion.height, 120, height - scanRegion.y),
  };
}

function updateScanRegion(box, source, drawWidth, drawHeight) {
  if (!box || box.width <= 0 || box.height <= 0) return;
  const scaleX = source.width / drawWidth;
  const scaleY = source.height / drawHeight;
  const raw = {
    x: source.x + box.x * scaleX,
    y: source.y + box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
  const padding = Math.max(raw.width, raw.height) * 0.42;
  const videoWidth = cameraVideo.videoWidth;
  const videoHeight = cameraVideo.videoHeight;
  scanRegion = {
    x: clamp(raw.x - padding, 0, videoWidth),
    y: clamp(raw.y - padding, 0, videoHeight),
    width: clamp(raw.width + padding * 2, 120, videoWidth),
    height: clamp(raw.height + padding * 2, 120, videoHeight),
  };
  if (scanRegion.x + scanRegion.width > videoWidth) scanRegion.width = videoWidth - scanRegion.x;
  if (scanRegion.y + scanRegion.height > videoHeight) scanRegion.height = videoHeight - scanRegion.y;
}

function handleDecoderWorkerMessage(event) {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "locked") {
    receiveSessionMetric.textContent = message.session;
    receiveStatusTitle.textContent = "SENDER FOUND";
    receiveStatusDetail.textContent = `${formatBytes(message.totalLength)} optical package · keep both devices still.`;
    cameraState.textContent = "RECEIVING";
    return;
  }
  if (message.type === "progress") {
    updateReceiverProgress(message);
    return;
  }
  if (message.type === "complete") {
    updateReceiverProgress({ ...message, complete: true });
    pendingEnvelope = new Uint8Array(message.payload);
    receiverComplete = true;
    stopCamera();
    cameraState.textContent = "FILE REBUILT";
    receiveStatusTitle.textContent = "CHECKING FILE";
    receiveStatusDetail.textContent = "Verifying integrity and reading file details.";
    handleCompletedEnvelope();
    return;
  }
  if (message.type === "fatal") setReceiveError(message.message || "The decoder could not finish the file.");
}

function updateReceiverProgress(message) {
  const blockCount = Number(message.blockCount) || 0;
  const framesNew = Number(message.framesNew) || 0;
  const solved = Number(message.solved) || 0;
  const arrival = blockCount > 0 ? framesNew / (blockCount * 1.25) : 0;
  const solvedProgress = blockCount > 0 ? solved / blockCount : 0;
  const progress = message.complete ? 1 : Math.min(0.99, Math.max(arrival, solvedProgress));
  const percent = Math.round(progress * 100);
  receiveRingValue.textContent = String(percent);
  receiveProgressBar.style.width = `${percent}%`;
  receiveFramesMetric.textContent = framesNew.toLocaleString("en-US");
  receiveDamagedMetric.textContent = String((message.stats?.invalid || 0) + (message.stats?.mismatch || 0));
  if (!message.complete && framesNew > 0) {
    receiveStatusTitle.textContent = "RECEIVING FILE";
    receiveStatusDetail.textContent = `${framesNew.toLocaleString("en-US")} useful frames collected. Lost or repeated QR codes are safe to ignore.`;
  }
}

async function handleCompletedEnvelope() {
  if (!pendingEnvelope) return;
  try {
    const inspection = inspectFileEnvelope(pendingEnvelope);
    if (inspection.encrypted) {
      receiverComplete = false;
      receiveStatusTitle.textContent = "PASSPHRASE NEEDED";
      receiveStatusDetail.textContent = "The file is protected. Enter the sender's passphrase to verify and unlock it.";
      startCameraButton.textContent = "ENTER PASSPHRASE";
      startCameraButton.classList.remove("hidden");
      showPassphraseDialog();
    } else {
      await finalizeReceivedFile("");
    }
  } catch (error) {
    setReceiveError(error instanceof Error ? error.message : String(error));
  }
}

function showPassphraseDialog() {
  passphraseError.classList.add("hidden");
  passphraseError.textContent = "";
  receivePassphrase.value = "";
  if (!passphraseDialog.open) passphraseDialog.showModal();
  setTimeout(() => receivePassphrase.focus(), 50);
}

async function handlePassphraseSubmit(event) {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === "cancel") {
    passphraseDialog.close();
    receiveStatusTitle.textContent = "PASSPHRASE NEEDED";
    receiveStatusDetail.textContent = "Tap Enter passphrase when you are ready to unlock the file.";
    return;
  }
  await finalizeReceivedFile(receivePassphrase.value);
}

async function finalizeReceivedFile(passphrase) {
  if (!pendingEnvelope) return;
  unlockButton.disabled = true;
  passphraseError.classList.add("hidden");
  receiveStatusTitle.textContent = "VERIFYING FILE";
  receiveStatusDetail.textContent = "Checking the protected container and SHA-256 fingerprint.";
  try {
    const opened = await openFileEnvelope(pendingEnvelope, passphrase);
    if (opened.requiresPassphrase) { showPassphraseDialog(); return; }
    receiverComplete = true;
    if (passphraseDialog.open) passphraseDialog.close();
    showReceivedResult(opened);
    pendingEnvelope = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (passphraseDialog.open) {
      passphraseError.textContent = message;
      passphraseError.classList.remove("hidden");
      receiveStatusTitle.textContent = "UNLOCK FAILED";
      receiveStatusDetail.textContent = "Try the passphrase again. The file has not been opened.";
    } else setReceiveError(message);
  } finally {
    unlockButton.disabled = false;
  }
}

function showReceivedResult(opened) {
  const metadata = opened.metadata;
  revokeResultUrl();
  const blob = new Blob([opened.fileBytes], { type: metadata.type || "application/octet-stream" });
  resultObjectUrl = URL.createObjectURL(blob);
  downloadLink.href = resultObjectUrl;
  downloadLink.download = metadata.name;
  resultName.textContent = metadata.name;
  resultMeta.textContent = `${formatBytes(opened.fileBytes.length)} · ${metadata.type || "unknown type"} · ${opened.encrypted ? "AES-256-GCM protected" : "not encrypted"}`;
  resultHash.textContent = opened.digestHex;
  buildPreview(blob, metadata, opened.fileBytes);
  resultPanel.classList.remove("hidden");
  receiveStatusTitle.textContent = "TRANSFER VERIFIED";
  receiveStatusDetail.textContent = "The file is complete and its SHA-256 fingerprint matches.";
  cameraState.textContent = "COMPLETE";
  startCameraButton.classList.add("hidden");
  stopCameraButton.classList.add("hidden");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function buildPreview(blob, metadata, bytes) {
  resultPreview.replaceChildren();
  const type = (metadata.type || "").toLowerCase();
  const safeRasterImages = new Set([
    "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png",
    "image/webp", "image/x-icon", "image/vnd.microsoft.icon",
  ]);
  let preview = null;
  if (safeRasterImages.has(type)) {
    preview = document.createElement("img");
    preview.alt = `Preview of ${metadata.name}`;
    preview.src = resultObjectUrl;
  } else if (type.startsWith("audio/")) {
    preview = document.createElement("audio");
    preview.controls = true;
    preview.preload = "metadata";
    preview.src = resultObjectUrl;
  } else if (type.startsWith("video/")) {
    preview = document.createElement("video");
    preview.controls = true;
    preview.preload = "metadata";
    preview.src = resultObjectUrl;
  } else if (type.startsWith("text/") && bytes.length <= 1024 * 1024) {
    preview = document.createElement("pre");
    preview.textContent = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (preview) resultPreview.append(preview);
  else {
    const fallback = document.createElement("span");
    fallback.textContent = `${getExtension(metadata.name) || "FILE"} · VERIFIED · DOWNLOAD TO OPEN`;
    resultPreview.append(fallback);
  }
}

function resetReceiver() {
  stopCamera();
  decoderWorker.postMessage({ type: "reset" });
  pendingEnvelope = null;
  receiverComplete = false;
  cameraFrames = 0;
  decodeAttempts = 0;
  qrReads = 0;
  scanFailures = 0;
  scanRegion = null;
  receiveRingValue.textContent = "0";
  receiveProgressBar.style.width = "0%";
  receiveSessionMetric.textContent = "--";
  receiveReadsMetric.textContent = "0";
  receiveFramesMetric.textContent = "0";
  receiveDamagedMetric.textContent = "0";
  receiveStatusTitle.textContent = "READY TO SCAN";
  receiveStatusDetail.textContent = "Start the camera on this device.";
  cameraState.textContent = "CAMERA OFF";
  startCameraButton.textContent = "START CAMERA";
  startCameraButton.classList.remove("hidden");
  startCameraButton.disabled = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
  resultPanel.classList.add("hidden");
  if (passphraseDialog.open) passphraseDialog.close();
  revokeResultUrl();
}

function setReceiveError(message) {
  stopCamera();
  receiverComplete = false;
  cameraState.textContent = "ERROR";
  receiveStatusTitle.textContent = "TRANSFER NOT ACCEPTED";
  receiveStatusDetail.textContent = message;
  receiveProgressBar.style.width = "0%";
  receiveRingValue.textContent = "0";
  startCameraButton.classList.remove("hidden");
  startCameraButton.textContent = "TRY CAMERA AGAIN";
  showToast(message, "error");
}

async function enumerateCameras(preserveSelection) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const previous = preserveSelection ? cameraSelect.value : "";
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    cameraSelect.replaceChildren(new Option("Automatic rear camera", ""));
    devices.forEach((device, index) => cameraSelect.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
    if (previous && devices.some((device) => device.deviceId === previous)) cameraSelect.value = previous;
  } catch { /* Enumeration is optional before permission. */ }
}

function friendlyCameraError(error) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow Camera for this site in browser or system settings, reload the page, and try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is busy in another app or browser tab.";
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "The selected camera mode is not supported. Choose Automatic and try again.";
  if (!window.isSecureContext) return "Camera access requires a secure HTTPS address.";
  if (error instanceof Error && error.message) return error.message;
  return "The camera could not start. Check site and system camera permissions, then try again.";
}

async function measureDisplayRefreshRate() {
  const timestamps = [];
  await new Promise((resolve) => {
    const sample = (timestamp) => {
      timestamps.push(timestamp);
      if (timestamps.length < 25) requestAnimationFrame(sample);
      else resolve(undefined);
    };
    requestAnimationFrame(sample);
  });
  const differences = timestamps.slice(1).map((value, index) => value - timestamps[index]).filter((value) => value > 2 && value < 100);
  differences.sort((a, b) => a - b);
  const median = differences[Math.floor(differences.length / 2)] || 16.67;
  displayRefreshRate = clamp(Math.round(1000 / median), 30, 240);
}

async function registerOfflineApp() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch { /* Offline reuse is optional. */ }
}

function revokeResultUrl() {
  if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
  resultObjectUrl = "";
  downloadLink.removeAttribute("href");
}

function getFileLabel(file) {
  const extension = getExtension(file.name);
  if (extension) return extension.slice(0, 4);
  if (file.type.includes("image")) return "IMG";
  if (file.type.includes("audio")) return "AUD";
  if (file.type.includes("video")) return "VID";
  return "FILE";
}

function getExtension(name) {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toUpperCase() : "";
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB"];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `~${Math.ceil(seconds)} SEC`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} MIN`;
  return `~${(seconds / 3600).toFixed(1)} HR`;
}

function formatClock(seconds) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

function showToast(message, kind = "info") {
  let container = document.querySelector(".toast-stack");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-stack";
    document.body.append(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  container.append(toast);
  requestAnimationFrame(() => toast.classList.add("shown"));
  setTimeout(() => {
    toast.classList.remove("shown");
    setTimeout(() => toast.remove(), 250);
  }, 4200);
}
