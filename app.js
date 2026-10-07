let medicines = [];
let recognizedMedicine = null;
let lastOCRResult = null;

// Bundled medicines data as fallback
const FALLBACK_MEDICINES = [
  {
    id: "MED001",
    name: "Paracetamol",
    brand_names: ["Crocin", "Calpol"],
    aliases: ["acetaminophen", "paracetamol"],
    strengths: ["500 mg", "650 mg"],
    dosage: "As directed by a qualified healthcare professional.",
    warnings: ["Do not exceed the recommended dose.", "Check other medicines for paracetamol content."]
  },
  {
    id: "MED002",
    name: "Cetirizine",
    brand_names: ["Cetirizine"],
    aliases: ["cetirizine hydrochloride", "cetirizine hcl"],
    strengths: ["5 mg", "10 mg"],
    dosage: "As directed by a qualified healthcare professional.",
    warnings: ["May cause drowsiness.", "Avoid activities requiring alertness if affected."]
  },
  {
    id: "MED003",
    name: "Aspirin",
    brand_names: ["Disprin"],
    aliases: ["acetylsalicylic acid", "asa"],
    strengths: ["75 mg", "150 mg", "300 mg"],
    dosage: "As directed by a qualified healthcare professional.",
    warnings: ["May increase bleeding risk.", "Use only as directed."]
  },
  {
    id: "MED004",
    name: "Metformin",
    brand_names: ["Glucophage"],
    aliases: ["metformin hydrochloride", "metformin hcl"],
    strengths: ["500 mg", "850 mg", "1000 mg"],
    dosage: "As directed by a qualified healthcare professional.",
    warnings: ["Take only according to prescribed instructions.", "Report unusual or severe symptoms to a healthcare professional."]
  },
  {
    id: "MED005",
    name: "Amlodipine",
    brand_names: ["Norvasc"],
    aliases: ["amlodipine besylate"],
    strengths: ["2.5 mg", "5 mg", "10 mg"],
    dosage: "As directed by a qualified healthcare professional.",
    warnings: ["Take only according to prescribed instructions.", "Do not change the dose without medical advice."]
  }
];

function isSecureContext() {
  return window.location.protocol === "https:" || 
         window.location.hostname === "localhost" || 
         window.location.hostname === "127.0.0.1";
}

// Initialize Tesseract once
let tesseractReady = false;
let tesseractWorker = null;

async function initTesseract() {
  if (tesseractReady) return;
  
  try {
    showStatus("⏳ Loading OCR engine (this may take 30-60 seconds on first use)...");
    console.log("Initializing Tesseract worker...");
    
    tesseractWorker = await Tesseract.createWorker();
    await tesseractWorker.loadLanguage("eng");
    await tesseractWorker.initialize("eng");
    
    tesseractReady = true;
    console.info("✓ Tesseract OCR engine ready");
    showStatus("✓ OCR engine loaded. Ready to scan.");
  } catch (error) {
    console.error("Failed to initialize Tesseract:", error);
    showStatus("⚠️ OCR engine failed to load. Text recognition may not work.");
  }
}

// Clean up worker on page unload
window.addEventListener("beforeunload", async () => {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
  }
});

// Database
async function loadMedicines() {
  try {
    const res = await fetch("medicines.json", { mode: "same-origin" });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Could not load medicines.json`);
    }

    medicines = await res.json();
    console.info("✓ Loaded medicines from medicines.json");
    return;
  } catch (error) {
    console.warn("⚠ medicines.json load failed (using bundled fallback):", error.message);
    medicines = FALLBACK_MEDICINES;
  }
}

// Camera
async function initCamera() {
  const video = document.getElementById("camera");

  if (!video) {
    console.error("Camera element not found in DOM");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("❌ Camera access not supported in this browser.");
    return;
  }

  if (!isSecureContext()) {
    showStatus("❌ Camera requires HTTPS. Please access via HTTPS or use localhost.");
    return;
  }

  try {
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (rearCameraError) {
      console.warn("Rear camera request failed. Trying default camera.", rearCameraError);

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    }

    video.srcObject = stream;
    await video.play();
    showStatus("📷 Camera ready.");

  } catch (error) {
    console.error("Camera error:", error);
    
    if (error.name === "NotAllowedError") {
      showStatus("❌ Camera permission denied. Please allow camera access.");
    } else if (error.name === "NotFoundError") {
      showStatus("❌ No camera found on this device.");
    } else {
      showStatus("❌ Camera access failed: " + error.message);
    }
  }
}

// Image preprocessing - optimized for medicine labels
function preprocessImage(video) {
  const canvas = document.createElement("canvas");

  const width = video.videoWidth;
  const height = video.videoHeight;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Enhanced grayscale + aggressive contrast for text
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // More aggressive contrast (2.0 instead of 1.35)
    gray = ((gray - 128) * 2.0) + 128;
    gray = Math.max(0, Math.min(255, gray));

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// Optimized OCR - faster with fewer passes
async function performOCR(imageUrl) {
  if (!tesseractReady || !tesseractWorker) {
    showStatus("⚠️ OCR engine not ready. Initializing...");
    await initTesseract();
  }

  if (!tesseractReady) {
    return { text: "", confidence: 0 };
  }

  try {
    showStatus("🔍 Reading text from image...");

    // Use worker directly - much faster than old method
    const result = await tesseractWorker.recognize(imageUrl);

    const text = result.data.text || "";
    const confidence = result.data.confidence || 0;

    console.log("OCR Result:", { text: text.substring(0, 100), confidence });

    return { text, confidence };
  } catch (error) {
    console.error("OCR error:", error);
    showStatus("❌ Text reading failed: " + error.message);
    return { text: "", confidence: 0 };
  }
}

// Text normalization
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[|]/g, "l")
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOCRWord(word) {
  const replacements = {
    "paracetmol": "paracetamol",
    "paracelamol": "paracetamol",
    "paracetam0l": "paracetamol",
    "asprin": "aspirin",
    "aspirn": "aspirin",
    "metformn": "metformin",
    "amlodipne": "amlodipine",
    "atenol1": "atenolol",
    "crocin": "paracetamol",
    "calpol": "paracetamol",
    "disprin": "aspirin",
    "glucophage": "metformin"
  };

  return replacements[word] || word;
}

function normalizedWords(text) {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .map(normalizeOCRWord);
}

// Levenshtein distance
function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (maxLength === 0) return 1;

  return 1 - distance / maxLength;
}

// Medicine matching
function extractStrength(text, medicine = null) {
  if (!text || !text.trim()) {
    return null;
  }

  if (medicine && Array.isArray(medicine.strengths)) {
    for (const strength of medicine.strengths) {
      const strengthText = String(strength).toLowerCase();
      const numberMatch = strengthText.match(/(\d+(?:\.\d+)?)/);

      if (!numberMatch) {
        continue;
      }

      const number = numberMatch[1];
      const pattern = new RegExp(
        `\\b${number}\\s*(mg|mi|mcg|g|ml|%|iu)\\b`,
        "i"
      );

      if (pattern.test(text)) {
        return strength;
      }
    }
  }

  const matches = [
    ...text.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(mg|mi|mcg|g|ml|%|iu)\b/gi
    )
  ];

  if (matches.length === 0) {
    return null;
  }

  return `${matches[0][1]} ${matches[0][2]}`;
}

function scoreMedicine(medicine, text, ocrConfidence) {
  const words = normalizedWords(text);

  const candidates = [
    medicine.name,
    ...(medicine.aliases || []),
    ...(medicine.brand_names || [])
  ];

  let bestNameScore = 0;
  let matchedTerm = null;

  for (const candidate of candidates) {
    const candidateWords = normalizedWords(candidate);
    const normalizedCandidate = candidateWords.join(" ");

    if (normalizeText(text).includes(normalizedCandidate)) {
      bestNameScore = Math.max(bestNameScore, 1);
      matchedTerm = candidate;
      continue;
    }

    for (const candidateWord of candidateWords) {
      for (const word of words) {
        const score = similarity(word, candidateWord);

        if (score > bestNameScore) {
          bestNameScore = score;
          matchedTerm = candidate;
        }
      }
    }
  }

  const detectedStrength = extractStrength(text);
  let strengthScore = 0;

  if (
    detectedStrength &&
    medicine.strengths &&
    medicine.strengths.some(
      s => normalizeText(s) === normalizeText(detectedStrength)
    )
  ) {
    strengthScore = 1;
  }

  const normalizedOCRConfidence =
    Math.max(0, Math.min(100, ocrConfidence)) / 100;

  const finalScore =
    (bestNameScore * 0.60) +
    (normalizedOCRConfidence * 0.20) +
    (strengthScore * 0.20);

  return {
    medicine,
    score: finalScore,
    nameScore: bestNameScore,
    strengthScore,
    ocrConfidence: normalizedOCRConfidence,
    matchedTerm,
    detectedStrength
  };
}

function findMedicine(text, ocrConfidence) {
  if (!text.trim()) {
    return {
      recognized: false,
      reason: "NO_TEXT",
      feedback: "No text detected. Make sure the medicine label is clearly visible."
    };
  }

  const normalizedOCR = normalizeText(text);
  const exactMatches = [];

  for (const medicine of medicines) {
    const terms = [
      medicine.name,
      ...(medicine.aliases || []),
      ...(medicine.brand_names || [])
    ].filter(Boolean);

    for (const term of terms) {
      const normalizedTerm = normalizeText(term);

      if (!normalizedTerm) {
        continue;
      }

      const pattern = new RegExp(
        `(^|\\s)${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
        "i"
      );

      if (pattern.test(normalizedOCR)) {
        const isMainName =
          normalizeText(medicine.name) === normalizedTerm;

        exactMatches.push({
          medicine,
          matchedTerm: term,
          score: isMainName ? 0.98 : 0.94
        });
      }
    }
  }

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => b.score - a.score);

    const bestExact = exactMatches[0];
    const detectedStrength = extractStrength(text, bestExact.medicine);

    console.log("EXACT MATCH:", bestExact.medicine.name);

    return {
      recognized: true,
      medicine: bestExact.medicine,
      confidence: bestExact.score,
      matchedTerm: bestExact.matchedTerm,
      detectedStrength,
      ocrConfidence,
      matchType: "EXACT_TERM"
    };
  }

  const results = medicines
    .map(medicine => scoreMedicine(medicine, text, ocrConfidence))
    .sort((a, b) => b.score - a.score);

  const best = results[0];
  const second = results[1];

  if (!best) {
    return {
      recognized: false,
      reason: "NO_MEDICINES_IN_DATABASE"
    };
  }

  // LOWERED threshold from 0.72 to 0.50 for better recognition
  const MIN_CONFIDENCE = 0.50;

  const ambiguous = second && (best.score - second.score) < 0.08;

  if (best.score < MIN_CONFIDENCE) {
    return {
      recognized: false,
      reason: "LOW_CONFIDENCE",
      candidates: results.slice(0, 3).map(r => ({
        name: r.medicine.name,
        confidence: Number(r.score.toFixed(2))
      })),
      feedback: `Best match: ${best.medicine.name} (${Math.round(best.score * 100)}%). Try focusing the camera better.`
    };
  }

  if (ambiguous) {
    return {
      recognized: false,
      reason: "AMBIGUOUS_MATCH",
      candidates: results.slice(0, 3).map(r => ({
        name: r.medicine.name,
        confidence: Number(r.score.toFixed(2))
      }))
    };
  }

  return {
    recognized: true,
    medicine: best.medicine,
    confidence: Number(best.score.toFixed(2)),
    matchedTerm: best.matchedTerm,
    detectedStrength: best.detectedStrength,
    ocrConfidence
  };
}

// Main scan function
async function captureImage() {
  const video = document.getElementById("camera");

  if (!video || !video.videoWidth || !video.videoHeight) {
    showStatus("📹 Camera is not ready yet. Try again in a moment.");
    return;
  }

  try {
    showStatus("📸 Capturing and reading image...");

    const imageUrl = preprocessImage(video);
    const ocr = await performOCR(imageUrl);

    lastOCRResult = ocr;

    console.log("OCR TEXT:", ocr.text.substring(0, 200));
    console.log("OCR CONFIDENCE:", ocr.confidence);

    const result = findMedicine(ocr.text, ocr.confidence);

    console.log("MEDICINE RESULT:", result);

    displayRecognitionResult(result, ocr);

  } catch (error) {
    console.error("Scan failed:", error);
    showStatus("❌ Scan failed: " + error.message);
  }
}

// Display results
function displayRecognitionResult(result, ocr) {
  const container = document.getElementById("result");

  if (!container) {
    console.error("Result container not found in DOM");
    return;
  }

  container.style.display = "block";

  const medicineNameEl = document.getElementById("medicineName");
  const dosageEl = document.getElementById("dosage");
  const warningsEl = document.getElementById("warnings");

  if (!medicineNameEl || !dosageEl || !warningsEl) {
    console.error("Result elements not found in DOM");
    return;
  }

  if (!result.recognized) {
    recognizedMedicine = null;

    medicineNameEl.innerText = result.candidates 
      ? `${result.candidates[0].name} (${Math.round(result.candidates[0].confidence * 100)}%)?`
      : "Medicine not identified";
    
    dosageEl.innerText = `OCR: ${Math.round(ocr.confidence)}%`;
    warningsEl.innerText = result.feedback || formatFailureReason(result);

    showStatus("⚠️ Could not confidently identify. Try repositioning.");
    return;
  }

  recognizedMedicine = result.medicine;

  medicineNameEl.innerText = result.medicine.name;

  dosageEl.innerText =
    `Confidence: ${Math.round(result.confidence * 100)}%` +
    (result.detectedStrength ? ` | Strength: ${result.detectedStrength}` : "");

  warningsEl.innerText = `Warnings: ${result.medicine.warnings.join(", ")}`;

  showStatus("✓ Medicine identified!");
}

function formatFailureReason(result) {
  switch (result.reason) {
    case "NO_TEXT":
      return "No readable text detected. Make sure the label is clear and well-lit.";
    case "LOW_CONFIDENCE":
      return "Text detected but confidence is low. Try a clearer angle.";
    case "AMBIGUOUS_MATCH":
      return "Multiple possible matches. Please try again with better focus.";
    default:
      return "Medicine could not be identified. Check the label is visible.";
  }
}

function showStatus(message) {
  let status = document.getElementById("scan-status");

  if (!status) {
    status = document.createElement("p");
    status.id = "scan-status";
    status.style.marginTop = "10px";
    status.style.padding = "10px";
    status.style.borderRadius = "4px";
    status.style.backgroundColor = "#f0f0f0";
    document.body.appendChild(status);
  }

  status.innerText = message;
}

// Voice
function speakResult() {
  if (!recognizedMedicine) {
    alert("No medicine has been confidently identified.");
    return;
  }

  const message =
    `This medicine is ${recognizedMedicine.name}. ` +
    `Dosage information: ${recognizedMedicine.dosage}. ` +
    `Warnings: ${recognizedMedicine.warnings.join(". ")}.`;

  const utterance = new SpeechSynthesisUtterance(message);

  const voices = speechSynthesis.getVoices();
  const targetLanguage = "kn";

  const matchingVoice = voices.find(
    voice => voice.lang.startsWith(targetLanguage)
  );

  if (matchingVoice) {
    utterance.voice = matchingVoice;
    utterance.lang = matchingVoice.lang;
  } else {
    utterance.lang = "en-IN";
  }

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

speechSynthesis.onvoiceschanged = () =>
  speechSynthesis.getVoices();

// Startup
window.addEventListener("load", async () => {
  try {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    console.log(`🌐 App loaded on ${protocol}//${hostname}`);

    if (!isSecureContext()) {
      showStatus("⚠️ App works best on HTTPS. Camera may not be available.");
    }

    await loadMedicines();
    await initCamera();
    await initTesseract();
  } catch (error) {
    console.error("Initialization failed:", error);
    showStatus("❌ Initialization failed. See console for details.");
  }
});

// Uploaded image OCR
async function scanUploadedImage() {
  const input = document.getElementById("imageUpload");

  if (!input || !input.files || input.files.length === 0) {
    showStatus("Please select an image first.");
    return;
  }

  const file = input.files[0];

  if (!file.type.startsWith("image/")) {
    showStatus("Please select a valid image.");
    return;
  }

  try {
    showStatus("Preparing image...");

    const imageUrl = URL.createObjectURL(file);

    console.log("UPLOADED FILE:", file.name, file.size, "bytes");

    const preview = document.getElementById("ocrPreview");

    if (preview) {
      preview.src = imageUrl;
      preview.style.display = "block";
    }

    const ocr = await performOCR(imageUrl);

    URL.revokeObjectURL(imageUrl);

    lastOCRResult = ocr;

    const result = findMedicine(ocr.text, ocr.confidence);

    displayRecognitionResult(result, ocr);

  } catch (error) {
    console.error("Uploaded image OCR failed:", error);
    showStatus("❌ Could not read the image: " + error.message);
  }
}
