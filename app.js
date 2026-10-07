let medicines = [];
let recognizedMedicine = null;
let lastOCRResult = null;

// -----------------------------
// Database
// -----------------------------

async function loadMedicines() {
  const res = await fetch("medicines.json");

  if (!res.ok) {
    throw new Error("Could not load medicines.json");
  }

  medicines = await res.json();
}

// -----------------------------
// Camera
// -----------------------------

async function initCamera() {
  const video = document.getElementById("camera");

  try {
    // First try to explicitly request the rear/environment camera
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
      console.warn(
        "Rear camera request failed. Trying default camera.",
        rearCameraError
      );

      // Fallback for browsers that don't support exact camera selection
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

    showStatus("Camera ready.");

  } catch (error) {
    console.error("Camera error:", error);
    showStatus(
      "Camera access failed. Please allow camera permission."
    );
  }
}

// -----------------------------
// Image preprocessing
// -----------------------------

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

  // Convert image to grayscale and increase contrast.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let gray =
      0.299 * r +
      0.587 * g +
      0.114 * b;

    // Simple contrast enhancement
    gray = ((gray - 128) * 1.35) + 128;
    gray = Math.max(0, Math.min(255, gray));

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

// -----------------------------
// OCR
// -----------------------------

async function performOCR(imageUrl) {
  showStatus("Preparing image for OCR...");

  const image = new Image();

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = imageUrl;
  });

  // Create an enlarged grayscale/high-contrast version
  const canvas = document.createElement("canvas");
  const scale = 1.5;

  canvas.width = image.width * scale;
  canvas.height = image.height * scale;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  ctx.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const data = imageData.data;

  // Grayscale + contrast enhancement
  for (let i = 0; i < data.length; i += 4) {
    const gray =
      0.299 * data[i] +
      0.587 * data[i + 1] +
      0.114 * data[i + 2];

    // Increase contrast around the midpoint
    const contrast = ((gray - 128) * 1.5) + 128;
    const value = Math.max(0, Math.min(255, contrast));

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);

  const enhancedImage = canvas.toDataURL("image/png");
// Create a crop of the upper part of the image
const cropCanvas = document.createElement("canvas");

cropCanvas.width = canvas.width;
cropCanvas.height = Math.floor(canvas.height * 0.45);

const cropCtx = cropCanvas.getContext("2d");

cropCtx.drawImage(
  canvas,
  0,
  0,
  canvas.width,
  cropCanvas.height,
  0,
  0,
  cropCanvas.width,
  cropCanvas.height
);

const croppedImage = cropCanvas.toDataURL("image/png");

console.log("CROPPED OCR IMAGE:", croppedImage);
  const passes = [
  {
    name: "Original / Block",
    image: imageUrl,
    mode: 6
  },
  {
    name: "Original / Sparse",
    image: imageUrl,
    mode: 11
  },
  {
    name: "Enhanced / Block",
    image: enhancedImage,
    mode: 6
  },
  {
    name: "Enhanced / Sparse",
    image: enhancedImage,
    mode: 11
  },
  {
    name: "Cropped / Block",
    image: croppedImage,
    mode: 6
  },
  {
    name: "Cropped / Sparse",
    image: croppedImage,
    mode: 11
  }
];

  const results = [];

  for (const pass of passes) {
    showStatus(`Reading text... (${pass.name})`);

    try {
      const result = await Tesseract.recognize(
        pass.image,
        "eng",
        {
          logger: message => {
            if (message.status === "recognizing text") {
              const progress = Math.round(
                (message.progress || 0) * 100
              );

              showStatus(
                `Reading text... ${progress}% (${pass.name})`
              );
            }
          },

          // Tesseract page segmentation mode
          tessedit_pageseg_mode: pass.mode
        }
      );

      results.push({
        name: pass.name,
        text: result.data.text || "",
        confidence: result.data.confidence || 0
      });

      console.log(
        `[OCR ${pass.name}]`,
        result.data.text,
        "Confidence:",
        result.data.confidence
      );

    } catch (error) {
      console.warn(`OCR pass failed: ${pass.name}`, error);
    }
  }

  if (results.length === 0) {
    return {
      text: "",
      confidence: 0
    };
  }

  // Pick the highest-confidence OCR result
  results.sort((a, b) => b.confidence - a.confidence);

  const best = results[0];

  console.log("BEST OCR RESULT:", best);

  return {
    text: best.text,
    confidence: best.confidence
  };
}

// -----------------------------
// Text normalization
// -----------------------------

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[|]/g, "l")
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Common OCR substitutions.
// We don't blindly replace everything because that can
// create false medicine names.
function normalizeOCRWord(word) {
  const replacements = {
    "paracetmol": "paracetamol",
    "paracelamol": "paracetamol",
    "paracetam0l": "paracetamol",
    "asprin": "aspirin",
    "aspirn": "aspirin",
    "metformn": "metformin",
    "amlodipne": "amlodipine",
    "atenol1": "atenolol"
  };

  return replacements[word] || word;
}

function normalizedWords(text) {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .map(normalizeOCRWord);
}

// -----------------------------
// String similarity
// -----------------------------

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

// -----------------------------
// Medicine matching
// -----------------------------

function extractStrength(text, medicine = null) {
  if (!text || !text.trim()) {
    return null;
  }

  // --------------------------------------------------
  // If we know the medicine, first search specifically
  // for one of its known strengths.
  // --------------------------------------------------

  if (medicine && Array.isArray(medicine.strengths)) {

    for (const strength of medicine.strengths) {
      const strengthText = String(strength).toLowerCase();

      // Extract the numeric part, e.g. "650" from "650 mg"
      const numberMatch = strengthText.match(
        /(\d+(?:\.\d+)?)/
      );

      if (!numberMatch) {
        continue;
      }

      const number = numberMatch[1];

      // Search for the number followed by a likely OCR version
      // of the unit: mg, mi, mcg, g, etc.
      const pattern = new RegExp(
        `\\b${number}\\s*(mg|mi|mcg|g|ml|%|iu)\\b`,
        "i"
      );

      if (pattern.test(text)) {
        // Return the database's known/correct strength
        return strength;
      }
    }
  }

  // --------------------------------------------------
  // Fallback: find any strength-like value in OCR text
  // --------------------------------------------------

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

    // Exact phrase
    const normalizedCandidate = candidateWords.join(" ");

    if (
      normalizeText(text).includes(normalizedCandidate)
    ) {
      bestNameScore = Math.max(bestNameScore, 1);
      matchedTerm = candidate;
      continue;
    }

    // Compare individual OCR words to medicine name/aliases.
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

  // Strength matching
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

  // OCR confidence is already 0-100.
  const normalizedOCRConfidence =
    Math.max(0, Math.min(100, ocrConfidence)) / 100;

  /*
    Weighted confidence:

    60% medicine-name similarity
    20% OCR confidence
    20% strength match
  */
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
      reason: "NO_TEXT"
    };
  }

  const normalizedOCR = normalizeText(text);

  // --------------------------------------------------
  // First: look for an exact known medicine term
  // --------------------------------------------------

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

      // Match complete words/phrases rather than partial words.
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

  // --------------------------------------------------
  // If we found a strong exact medicine term,
  // use it even if overall OCR confidence is low.
  // --------------------------------------------------

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => b.score - a.score);

    const bestExact = exactMatches[0];

    const detectedStrength = extractStrength(
      text,
      bestExact.medicine
    );

    console.log(
      "EXACT MEDICINE MATCH:",
      bestExact.medicine.name,
      "Matched term:",
      bestExact.matchedTerm,
      "OCR confidence:",
      ocrConfidence
    );

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

  // --------------------------------------------------
  // Otherwise use the normal fuzzy scoring system
  // --------------------------------------------------

  const results = medicines
    .map(medicine =>
      scoreMedicine(medicine, text, ocrConfidence)
    )
    .sort((a, b) => b.score - a.score);

  const best = results[0];
  const second = results[1];

  if (!best) {
    return {
      recognized: false,
      reason: "NO_MEDICINES_IN_DATABASE"
    };
  }

  const MIN_CONFIDENCE = 0.72;

  const ambiguous =
    second &&
    (best.score - second.score) < 0.08;

  if (best.score < MIN_CONFIDENCE) {
    return {
      recognized: false,
      reason: "LOW_CONFIDENCE",
      candidates: results.slice(0, 3).map(r => ({
        name: r.medicine.name,
        confidence: Number(r.score.toFixed(2))
      }))
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

// -----------------------------
// Main scan function
// -----------------------------

async function captureImage() {
  const video = document.getElementById("camera");

  if (!video.videoWidth || !video.videoHeight) {
    showStatus("Camera is not ready yet.");
    return;
  }

  try {
    showStatus("Capturing image...");

    const imageUrl = preprocessImage(video);

    const ocr = await performOCR(imageUrl);

    lastOCRResult = ocr;

    console.log("OCR TEXT:", ocr.text);
    console.log("OCR CONFIDENCE:", ocr.confidence);

    const result = findMedicine(
      ocr.text,
      ocr.confidence
    );

    console.log("MEDICINE RESULT:", result);

    displayRecognitionResult(result, ocr);

  } catch (error) {
    console.error("Scan failed:", error);
    showStatus("Scan failed. Please try again.");
  }
}

// -----------------------------
// Results
// -----------------------------

function displayRecognitionResult(result, ocr) {
  const container = document.getElementById("result");

  container.style.display = "block";

  if (!result.recognized) {
    recognizedMedicine = null;

    document.getElementById("medicineName").innerText =
      "Medicine not confidently identified";

    document.getElementById("dosage").innerText =
      `OCR confidence: ${Math.round(ocr.confidence)}%`;

    document.getElementById("warnings").innerText =
      formatFailureReason(result);

    showStatus("Scan completed — verification required.");
    return;
  }

  recognizedMedicine = result.medicine;

  document.getElementById("medicineName").innerText =
    result.medicine.name;

  document.getElementById("dosage").innerText =
    `Confidence: ${Math.round(result.confidence * 100)}%` +
    (result.detectedStrength
      ? ` | Strength: ${result.detectedStrength}`
      : "");

  document.getElementById("warnings").innerText =
    `Warnings: ${result.medicine.warnings.join(", ")}`;

  showStatus("Medicine identified.");
}

function formatFailureReason(result) {
  switch (result.reason) {
    case "NO_TEXT":
      return "No readable text was detected.";

    case "LOW_CONFIDENCE":
      return "The detected text did not match a known medicine with sufficient confidence.";

    case "AMBIGUOUS_MATCH":
      return (
        "Multiple possible medicines were detected. " +
        result.candidates
          .map(c => `${c.name} (${Math.round(c.confidence * 100)}%)`)
          .join(", ")
      );

    default:
      return "Medicine could not be identified.";
  }
}

function showStatus(message) {
  let status = document.getElementById("scan-status");

  if (!status) {
    status = document.createElement("p");
    status.id = "scan-status";
    document.body.appendChild(status);
  }

  status.innerText = message;
}

// -----------------------------
// Voice
// -----------------------------

function speakResult() {
  if (!recognizedMedicine) {
    alert("No medicine has been confidently identified.");
    return;
  }

  const message =
    `This medicine is ${recognizedMedicine.name}. ` +
    `Dosage information: ${recognizedMedicine.dosage}. ` +
    `Warnings: ${recognizedMedicine.warnings.join(". ")}.`;

  const utterance =
    new SpeechSynthesisUtterance(message);

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

// -----------------------------
// Start application
// -----------------------------

window.addEventListener("load", async () => {
  try {
    await loadMedicines();
    await initCamera();
    showStatus("Ready to scan.");
  } catch (error) {
    console.error(error);
    showStatus("Application initialization failed.");
  }
});
// -----------------------------
// Uploaded image OCR
// -----------------------------

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

console.log("UPLOADED FILE:", file.name);
console.log("FILE TYPE:", file.type);
console.log("FILE SIZE:", file.size);

const preview = document.getElementById("ocrPreview");

if (preview) {
  preview.src = imageUrl;
  preview.style.display = "block";
}

const ocr = await performOCR(imageUrl);

    URL.revokeObjectURL(imageUrl);

    lastOCRResult = ocr;

    console.log("OCR TEXT:", ocr.text);
    console.log("OCR CONFIDENCE:", ocr.confidence);

    const result = findMedicine(
      ocr.text,
      ocr.confidence
    );

    console.log("MEDICINE RESULT:", result);

    displayRecognitionResult(result, ocr);

  } catch (error) {
    console.error("Uploaded image OCR failed:", error);
    showStatus("Could not read the image.");
  }
}
