let medicines = [];
let recognizedMedicine = null;

// 1. Load our JSON database when the app starts
async function loadMedicines() {
  const res = await fetch("medicines.json");
  medicines = await res.json();
}

// 2. Ask for camera permission and start the video stream
async function initCamera() {
  const video = document.getElementById("camera");
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  video.play();
}

// 3. Capture the current frame from the video and send it to the OCR engine
async function captureImage() {
  const video = document.getElementById("camera");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const imageUrl = canvas.toDataURL();
  
  document.body.innerHTML += "<p id='loading-text'>Recognizing... please wait</p>";
  
  // This uses Tesseract.js to read the text from the image
  const { data: { text } } = await Tesseract.recognize(imageUrl, "eng");
  console.log("OCR result:", text);
  
  // Remove the loading text once done
  const loading = document.getElementById("loading-text");
  if (loading) loading.remove();

  findMedicine(text);
}

// 4. Look through our 5 medicines to see if the name matches what the camera read
function findMedicine(text) {
  let low = text.toLowerCase();
  
  // Quick fix for common handwritten OCR typos
  if (low.includes("asprin")) {
    low += " aspirin";
  }

  // 1. Try an exact match
  for (let med of medicines) {
    if (low.includes(med.name.toLowerCase())) {
      recognizedMedicine = med;
      showResult(med);
      return;
    }
  }

  // 2. FUZZY MATCHING: Looks for parts of the medicine names in the text
  for (let med of medicines) {
    const medNameLower = med.name.toLowerCase();
    const partialName = medNameLower.substring(0, 4); 
    if (low.includes(partialName)) {
      recognizedMedicine = med;
      showResult(med);
      return;
    }
  }
  
  alert("Medicine not found. Try again.");
}

// 5. Update the webpage with the medicine details
function showResult(med) {
  const r = document.getElementById("result");
  r.style.display = "block";
  document.getElementById("medicineName").innerText = med.name;
  document.getElementById("dosage").innerText = "Dosage: " + med.dosage;
  document.getElementById("warnings").innerText = "Warnings: " + med.warnings.join(", ");
}

// 6. Voice output logic (we will fully test this in Hour 4-5)
function speakResult() {
  if (!recognizedMedicine) { 
    alert("Scan a medicine first"); 
    return;
  }
  
  const msg = `This medicine is ${recognizedMedicine.name}. Dosage: ${recognizedMedicine.dosage}. Warnings: ${recognizedMedicine.warnings.join(". ")}`;
  const u = new SpeechSynthesisUtterance(msg);
  
  // Get all available voices on your specific computer
  const voices = speechSynthesis.getVoices();
  
  // Try to find a voice that matches Kannada ("kn") or Hindi ("hi")
  // Change "kn" to "hi" if you want to switch back to testing Hindi!
  const targetLanguage = "kn"; 
  
  const matchingVoice = voices.find(voice => voice.lang.startsWith(targetLanguage));
  
  if (matchingVoice) {
    u.voice = matchingVoice;
    u.lang = matchingVoice.lang;
    console.log("Success! Found voice:", matchingVoice.name);
  } else {
    // If it can't find Kannada, fallback to Indian English so it at least sounds natural
    u.lang = "en-IN"; 
    console.log("Language pack not found on system. Falling back to en-IN.");
  }

  speechSynthesis.speak(u);
}

// This line forces Chrome to preload the voices in the background
speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

// Start everything when the window loads
window.onload = async () => {
  await loadMedicines();
  await initCamera();
};